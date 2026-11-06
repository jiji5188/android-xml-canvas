/**
 * M154：真机渲染桥（设备端 aapt2 → 资源包 → 系统 LayoutInflater）
 *
 * 为什么要它：画布是 CSS 模拟的，圆角/渐变/ripple/state 这些总有偏差。
 * 这里把当前 xml + 依赖资源整成 res 树丢给原生，`libaapt2.so` 现场 compile/link，
 * 再用 ResourcesLoader 挂上去真渲染，拿真控件跟画布对照，差在哪一眼就看出来。
 *
 * 协议（异步，不堵 JS 线程）：
 *   JS → AxvNative.renderReal(id, payloadJson)
 *   原生 → window.__axvRender(id, resultJson)
 */

export interface RenderFile {
  /** res 内相对路径，例如 layout/activity_main.xml、drawable/bg.xml */
  path: string;
  text: string;
  /** M159：二进制资源（png/webp）走 base64；有它时 text 可为空 */
  base64?: string;
}

export interface RealRenderResult {
  ok: boolean;
  /** 写进去的文件数 */
  files?: number;
  /** 生成的资源包字节数 */
  bytes?: number;
  /** 端上 compile + link 耗时 */
  ms?: number;
  /** compile / link */
  stage?: string;
  /** 完整日志落在 AndroidUIIDE/log/render-*.log 的路径 */
  logFile?: string;
  log?: string;
}

interface RenderBridge {
  renderReal?(id: string, payload: string): void;
}

type Resolver = (r: RealRenderResult) => void;

const pending = new Map<string, Resolver>();
let seq = 0;
let installed = false;

function bridge(): RenderBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { AxvNative?: RenderBridge }).AxvNative ?? null;
}

/** 当前运行环境有没有「设备端真渲染」这个能力（网页版永远没有） */
export function hasRealRender(): boolean {
  const b = bridge();
  return !!(b && typeof b.renderReal === "function");
}

function install(): void {
  if (typeof window === "undefined") return;
  // 每次调用都确保回调还在：WebView 页刷新 / 渲染进程重启会把 window 上的挂回去掉
  if (installed && typeof (window as { __axvRender?: unknown }).__axvRender === "function") return;
  installed = true;
  (window as unknown as { __axvRender?: (id: string, json: string) => void }).__axvRender = (
    id,
    json,
  ) => {
    const done = pending.get(id);
    if (!done) return;
    pending.delete(id);
    let r: RealRenderResult;
    try {
      r = JSON.parse(json) as RealRenderResult;
    } catch {
      r = { ok: false, log: "返回的 JSON 解析失败: " + String(json).slice(0, 400) };
    }
    done(r);
  };
}

const PKG = "com.axv.render";

/**
 * 把 res 文件丢给原生编译 + 渲染。
 * @param layoutName 布局名（不带 .xml），必须是 files 里 layout/<name>.xml 的那个
 */
export function renderReal(
  layoutName: string,
  files: RenderFile[],
  timeoutMs = 25000,
): Promise<RealRenderResult> {
  const b = bridge();
  if (!b || typeof b.renderReal !== "function") {
    return Promise.resolve({ ok: false, log: "当前环境不支持真机渲染（网页版 / 旧 APK）" });
  }
  const name = layoutName.replace(/\.xml$/i, "");
  const list = files.filter((f) => f && f.path && f.text);
  if (!list.some((f) => f.path === `layout/${name}.xml`)) {
    return Promise.resolve({ ok: false, log: `文件清单里没有 layout/${name}.xml` });
  }
  // M156：先查布局里引用的 @string/@color… 在不在文件清单里。
  // 不查的话设备端 aapt2 只会丢一句 "resource string/xxx not found"，看不出是「没定义」还是「没上传」。
  const missing = unresolvedRefs(list, name);
  // M159：现在收集阶段会给缺失资源生成占位（能编译），所以这里不再“发现缺失就不让渲染”，
  // 否则永远卡在资源检查、根本看不到真实效果。只有确实无法造假的二进制资源才拦。
  const hard = missing.filter((m) => /^(font|interpolator)\//.test(m));
  if (hard.length > 0) {
    return Promise.resolve({
      ok: false,
      stage: "资源检查",
      log:
        `布局引用了 ${hard.length} 个无法自动占位的资源：${hard.slice(0, 8).join("、")}` +
        (hard.length > 8 ? " …" : "") +
        "。字体/插值器需要真实的二进制文件，请把对应 res 目录上传。",
    });
  }
  install();
  seq += 1;
  const id = `r${Date.now().toString(36)}${seq}`;
  return new Promise<RealRenderResult>((resolve) => {
    const timer = window.setTimeout(() => {
      if (pending.delete(id)) resolve({ ok: false, log: "真机渲染超时（25s），aapt2 可能卡住了" });
    }, timeoutMs);
    pending.set(id, (r) => {
      window.clearTimeout(timer);
      resolve(r);
    });
    try {
      b.renderReal!(id, JSON.stringify({ pkg: PKG, layout: name, files: list }));
    } catch (e) {
      window.clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, log: "调用原生失败: " + String(e) });
    }
  });
}

/**
 * 扫布局里引用的 app 内资源，返回「文件清单里找不到定义」的引用。
 * 只查确定能在 res 里定义的类；@android: / @+id / @id / ?attr 不动。
 */
export function unresolvedRefs(files: RenderFile[], layoutName?: string): string[] {
  // 只查目标布局（其它布局可能是项目的半成品，不参与本次渲染）
  const target = (layoutName || "").replace(/\.xml$/i, "");
  const layoutFiles = target
    ? files.filter((f) => {
        const m = f.path.match(/^layout(-[^/]+)?\/([^/]+)\.xml$/i);
        return !!m && m[2] === target;
      })
    : files.filter((f) => /^layout(-[^/]+)?\/.*\.xml$/i.test(f.path));
  if (layoutFiles.length === 0) return [];

  // 1) 已定义资源索引
  const defs = new Set<string>();
  for (const f of files) {
    const p = f.path;
    if (/^values(-[^/]+)?\//i.test(p)) {
      const tagRe = /<(string|color|dimen|style|integer|bool|fraction|array|string-array|integer-array|plurals|attr|item)\b[^>]*?\bname="([^"]+)"/g;
      let tm: RegExpExecArray | null;
      while ((tm = tagRe.exec(f.text || "")) !== null) defs.add(`${tm[1]}/${tm[2]}`);
      // <string-array>/<array> 里的 <item> 不单独算；@array/xxx 的 key 就是外层 name
      continue;
    }
    const d = p.match(/^(drawable|mipmap|anim|animator|color|menu|xml|font|interpolator)(-[^/]+)?\/([^/]+?)(\.[a-z0-9]+)?$/i);
    if (d) defs.add(`${d[1]}/${d[3]}`);
  }

  // 2) 布局里的引用
  const want = new Set<string>();
  const refRe = /@(?!\+)(?!\*?android:)(string|color|dimen|style|integer|bool|fraction|array|string-array|integer-array|plurals|drawable|mipmap|anim|animator|menu|xml|font)\/([A-Za-z0-9_.]+)/g;
  for (const f of layoutFiles) {
    let rm: RegExpExecArray | null;
    while ((rm = refRe.exec(f.text || "")) !== null) want.add(`${rm[1]}/${rm[2].replace(/\.\w+$/, "")}`);
  }
  return [...want].filter((w) => !defs.has(w)).sort();
}
