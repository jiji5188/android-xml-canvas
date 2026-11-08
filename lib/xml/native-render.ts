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

import { dedupeValuesFiles, definedValueKeys } from "./res-collect";

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

export function renderableFiles(files: RenderFile[]): RenderFile[] {
  return files.filter((f) => f && f.path && (f.text || f.base64));
}

/**
 * M161：图片 base64 清洗。设备侧出现“png 0 字节 / 不是 PNG 签名”就是因为拿到了空串、
 * 只含换行的串，或被包成 data URL —— Java 那边 Base64.decode 对空白串返回空数组不报错，
 * 结果写出 0 字节文件，aapt2 一读就爆。这里统一归一化，无效就返回 null。
 */
export function cleanBase64(s: string | undefined | null): string | null {
  if (!s) return null;
  let v = String(s).trim();
  const m = /^data:[^,]*;base64,/i.exec(v);
  if (m) v = v.slice(m[0].length);
  v = v.replace(/\s+/g, "");
  if (!v) return null;
  try {
    // 校验：既要能解，也要真的解出字节（atob 在浏览器/Node 都有）
    const bin = atob(v);
    if (!bin.length) return null;
  } catch {
    return null;
  }
  return v;
}

/**
 * M162：根据 base64 开头字节判断真实图片格式。
 * 用户工程里经常把 jpg/webp 存成 .png，aapt2 按扩展名校验签名 →
 * “file does not start with PNG signature” 直接整包失败。
 */
export function sniffImageKind(b64: string): "png" | "jpg" | "webp" | "xml" | null {
  try {
    const head = atob(b64.slice(0, 32));
    const c = (i: number) => head.charCodeAt(i) & 0xff;
    if (c(0) === 0x89 && c(1) === 0x50 && c(2) === 0x4e && c(3) === 0x47) return "png";
    if (c(0) === 0xff && c(1) === 0xd8 && c(2) === 0xff) return "jpg";
    if (head.startsWith("RIFF") && head.slice(8, 12) === "WEBP") return "webp";
    const t = head.replace(/^\uFEFF/, "").trimStart();
    if (t.startsWith("<?xml") || t.startsWith("<")) return "xml";
  } catch {
    return null;
  }
  return null;
}

/**
 * M169b：把 <include> 标签里的 android:layout="@layout/x" 改成无前缀的 layout="@layout/x"
 *
 * AOSP LayoutInflater.parseInclude：
 *   int layout = attrs.getAttributeResourceValue(null, ATTR_LAYOUT, 0);
 * 命名空间参数是 null，带 android: 前缀真机一律取不到 → 抛
 * "You must specify a layout in the include tag: <include layout=\"@layout/layoutID\" />"。
 * 只动 include 标签内部的 layout= 本身，不碰 android:layout_width / layout_margin 等。
 */
export function fixIncludeLayoutNs(text: string): string {
  if (!/<include\b/i.test(text)) return text;
  return (
    text
      // 1) 去掉 android: 前缀
      .replace(/<include\b[^>]*>/gi, (tag) => tag.replace(/\bandroid\s*:\s*layout\s*=/gi, "layout="))
      // 2) 根本没写 layout 的自闭合 include 直接删（真机必崩）
      .replace(/<include\b[^>]*\/>/gi, (tag) =>
        /\slayout\s*=\s*"\s*@?layout\/[^"\s]+"/i.test(tag) ? tag : "",
      )
  );
}

/**
 * M170：同名同目录的不同文件会让 aapt2 link 报
 *   drawable/x.xml: error: duplicate value for resource 'drawable/x' with config ''
 * （同一资源名 + 同一 config 只能有一次定义）。常见场景：项目里既有 drawable/x.png
 * 又有工具生成的 drawable/x.xml。这里同目录同名的只留一个，xml 优先。
 * 注意限定符目录（drawable-hdpi / drawable-anydpi-v26）算不同目录，各自保留。
 */
export function dedupeSameNameRes(files: RenderFile[]): RenderFile[] {
  const RES_DIR = /^(drawable|mipmap|layout|anim|animator|menu|xml|raw|font|interpolator|color|values|navigation|transition)(-[^/]*)?$/i;
  const seen = new Map<string, number>();
  const out: RenderFile[] = [];
  for (const f of files) {
    const m = f.path.match(/^([^/]+)\/([^/]+)$/);
    if (!m || !RES_DIR.test(m[1])) {
      out.push(f);
      continue;
    }
    const base = m[2].replace(/\.[^.]*$/, "");
    const key = `${m[1]}/${base}`;
    const prev = seen.get(key);
    if (prev === undefined) {
      seen.set(key, out.length);
      out.push(f);
      continue;
    }
    // 同名同目录：xml 优先（xml 才是用户/工具编辑的那份）
    if (/\.xml$/i.test(m[2]) && !/\.xml$/i.test(out[prev].path)) out[prev] = f;
  }
  return out;
}

/**
 * M170：`<adaptive-icon>` 只能住在 `mipmap-anydpi-v26/` 这类带 -v26 的目录里。
 * 一旦被摆到 drawable/（不同限定符），aapt2 link 会在 --min-sdk-version 24 下报
 *   drawable/ic_launcher.xml: error: <adaptive-icon> elements require a sdk version of at least 26.
 * 这里把描错的文件搬回 mipmap-anydpi-v26/（资源名不变，引用 @mipmap/x 仍可用）。
 */
export function relocateAdaptiveIcons(files: RenderFile[]): RenderFile[] {
  const have = new Set(files.map((f) => f.path));
  const out: RenderFile[] = [];
  for (const f of files) {
    if (!f.text || !/<adaptive-icon\b/.test(f.text)) {
      out.push(f);
      continue;
    }
    const seg = f.path.split("/")[0] || "";
    // 已带 v26+ 限定符就没事
    if (/^mipmap/.test(seg) && /-v(2[6-9]|[3-9][0-9])/.test(seg)) {
      out.push(f);
      continue;
    }
    const base = f.path.split("/").pop() || "";
    const to = `mipmap-anydpi-v26/${base}`;
    // 目标已有同名同目录的，直接丢掉这份，避免 link 报 duplicate value
    if (have.has(to)) continue;
    have.add(to);
    out.push({ ...f, path: to });
  }
  return out;
}

/**
 * M160：发给设备前最后一道兵——把清单里确实缺的资源就地生成占位。
 * 不依赖收集阶段（收集可能因预算/IO 失败漏掉），否则 aapt2 一句 not found 就整包失败。
 */
export function withPlaceholders(files: RenderFile[], missing: string[]): RenderFile[] {  // 注意不能在这里 missing 为空就直接 return：即使没有缺失资源，也要处理
  // 收集阶段已经生成的占位布局（把指向它们的 <include> 删掉）。
  const have = new Set(files.map((f) => f.path));
  const out = [...files];
  const valueLines: string[] = [];
  const stubLayouts: string[] = [];
  const push = (path: string, text: string) => {
    if (have.has(path)) return;
    have.add(path);
    out.push({ path, text });
  };
  for (const key of missing) {
    const slash = key.indexOf("/");
    if (slash < 0) continue;
    const type = key.slice(0, slash);
    const name = key.slice(slash + 1);
    if (type === "drawable" || type === "mipmap") {
      push(
        `drawable/${name}.xml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#00000000" /></shape>\n`,
      );
    } else if (type === "layout") {
      stubLayouts.push(name);
      push(
        `layout/${name}.xml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<!--axv-stub-->\n<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" />\n`,
      );
    } else if (type === "menu" || type === "anim" || type === "animator" || type === "xml") {
      const root = type === "menu" ? "menu" : type === "xml" ? "x" : "set";
      push(
        `${type}/${name}.xml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<${root} xmlns:android="http://schemas.android.com/apk/res/android" />\n`,
      );
    } else if (type === "color") valueLines.push(`    <color name="${name}">#00000000</color>`);
    else if (type === "string") valueLines.push(`    <string name="${name}" />`);
    else if (type === "dimen") valueLines.push(`    <dimen name="${name}">0dp</dimen>`);
    else if (type === "bool") valueLines.push(`    <bool name="${name}">false</bool>`);
    else if (type === "integer") valueLines.push(`    <integer name="${name}">0</integer>`);
    else if (type === "fraction") valueLines.push(`    <fraction name="${name}">50%</fraction>`);
    else if (type === "style") valueLines.push(`    <style name="${name}" parent="" />`);
    else if (type === "id") valueLines.push(`    <item type="id" name="${name}" />`);
    else if (type === "array" || type === "string-array" || type === "integer-array")
      valueLines.push(`    <${type} name="${name}" />`);
    else if (type === "plurals")
      valueLines.push(`    <plurals name="${name}"><item quantity="other">%s</item></plurals>`);
  }
  if (valueLines.length > 0) {
    push(
      "values/axv_auto.xml",
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${valueLines.join("\n")}\n</resources>\n`,
    );
  }
  // M161：占位布局虽然能过 aapt2 link，但运行时 <include layout="@layout/x"> 仍可能拿到
  // 资源 id 0（真机报 “You must specify a layout in the include tag”）。
  // 收集阶段产生的占位布局也一并识别（带 <!--axv-stub--> 标记），统一把这些 include 删掉：
  // 预览少一块，总比整页白屏加报错强。
  for (const f of out) {
    const m = f.path.match(/^layout(-[^/]+)?\/([^/]+)\.xml$/i);
    if (m && (f.text || "").includes("axv-stub")) stubLayouts.push(m[2]);
  }
  const uniqStubLayouts = [...new Set(stubLayouts)];
  if (uniqStubLayouts.length > 0) {
    for (let i = 0; i < out.length; i++) {
      const f = out[i];
      if (!f.text) continue;
      let t = f.text;
      let changed = false;
      for (const n of uniqStubLayouts) {
        const re = new RegExp(
          `<include\\b[^>]*\\blayout\\s*=\\s*"@layout/${n}"[^>]*?/?>`,
          "g",
        );
        if (re.test(t)) {
          t = t.replace(re, "");
          changed = true;
        }
      }
      if (changed) out[i] = { ...f, text: t };
    }
  }
  return out;
}

/**
 * 把 res 文件丢给原生编译 + 渲染。
 * @param layoutName 布局名（不带 .xml），必须是 files 里 layout/<name>.xml 的那个
 */
/**
 * M192e：把「收集到的 res 文件清单」洗成「能直接喂 aapt2 的清单」。
 *
 * 真机渲染与「打包 APK」走的是同一套 prepare：base64 洗坏图片、缺失资源补占位、
 * 重名资源去重、adaptive-icon 归位、include 命名空间纠正。以前这些只写在 renderReal
 * 里，打包时直接拿 collectProjectRes 的原始结果 → aapt2 在 layout 上报 syntax error。
 */
export function prepareFiles(
  layoutName: string,
  files: RenderFile[],
): { files: RenderFile[]; blocked?: string } {
  const name = layoutName.replace(/\.xml$/i, "");
  const list = renderableFiles(files);
  if (!list.some((f) => f.path === `layout/${name}.xml`)) {
    return { files: [], blocked: `文件清单里没有 layout/${name}.xml` };
  }
  const missing = unresolvedRefs(list, name);
  const hard = missing.filter((m) => /^(font|interpolator)\//.test(m));
  if (hard.length > 0) {
    return {
      files: [],
      blocked:
        `布局引用了 ${hard.length} 个无法自动占位的资源：${hard.slice(0, 8).join("、")}` +
        (hard.length > 8 ? " …" : "") +
        "。字体/插值器需要真实的二进制文件，请把对应 res 目录上传。",
    };
  }
  // M161：先洗一遍 base64，洗坏的 png 直接丢掉，改由 withPlaceholders 出透明占位，
  // 否则设备端写出 0 字节 png，aapt2 compile 直接失败
  const cleaned: RenderFile[] = [];
  const broken: string[] = [];
  for (const f of list) {
    if (!f.base64) {
      cleaned.push(f);
      continue;
    }
    const v = cleanBase64(f.base64);
    if (!v) {
      const m = f.path.match(/^(drawable|mipmap)(-[^/]+)?\/(.+?)\.(png|webp|jpg|jpeg)$/i);
      if (m) broken.push(`${m[1]}/${m[3]}`);
      continue;
    }
    const em = f.path.match(/^(.*)\.(png|webp|jpg|jpeg)$/i);
    if (em) {
      const kind = sniffImageKind(v);
      if (!kind) {
        const m = f.path.match(/^(drawable|mipmap)(-[^/]+)?\/(.+?)\.(png|webp|jpg|jpeg)$/i);
        if (m) broken.push(`${m[1]}/${m[3]}`);
        continue;
      }
      const want = kind === "jpg" ? "jpg" : kind;
      const cur = em[2].toLowerCase();
      const same = cur === want || (cur === "jpeg" && want === "jpg");
      if (!same) {
        cleaned.push({ ...f, path: `${em[1]}.${want}`, base64: v });
        continue;
      }
    }
    cleaned.push({ ...f, base64: v });
  }
  const missingAll = broken.length ? [...new Set([...missing, ...broken])] : missing;
  let filled = withPlaceholders(cleaned, missingAll);
  const projectDefs = new Set<string>();
  for (const f of filled) {
    if (f.path === "values/res_values.xml" || !/^values(\/|$)/.test(f.path) || !/\.xml$/i.test(f.path) || !f.text) continue;
    for (const k of definedValueKeys(f.text)) projectDefs.add(k);
  }
  filled = dedupeValuesFiles(filled, projectDefs);
  filled = dedupeSameNameRes(filled);
  filled = relocateAdaptiveIcons(filled);
  filled = filled.map((f) =>
    f.text && /^layout(-[^/]+)?\//.test(f.path) ? { ...f, text: fixIncludeLayoutNs(f.text) } : f,
  );
  return { files: filled };
}

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
  const prep = prepareFiles(name, files);
  if (prep.blocked) {
    return Promise.resolve({ ok: false, stage: "资源检查", log: prep.blocked });
  }
  const filled = prep.files;
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
      b.renderReal!(id, JSON.stringify({ pkg: PKG, layout: name, files: filled }));
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

  // M160：不只看目标布局——layout 里 include 的布局、以及所有要一起编的 drawable/mipmap xml
  // 内部也会引用图标（selector/layer-list），漏扫就会在 aapt2 阶段报 not found
  const includedLayouts = new Set<string>();
  for (const f of layoutFiles) {
    const inc = /@layout\/([A-Za-z0-9_]+)/g;
    let im: RegExpExecArray | null;
    while ((im = inc.exec(f.text || "")) !== null) includedLayouts.add(im[1]);
  }
  const scanFiles = files.filter((f) => {
    const p = f.path;
    if (layoutFiles.includes(f)) return true;
    const lm = p.match(/^layout(-[^/]+)?\/([^/]+)\.xml$/i);
    if (lm && includedLayouts.has(lm[2])) return true;
    return /^(drawable|mipmap)(-[^/]+)?\/.*\.xml$/i.test(p);
  });

  // 2) 布局里的引用
  const want = new Set<string>();
  const refRe = /@(?!\+)(?!\*?android:)(string|color|dimen|style|integer|bool|fraction|array|string-array|integer-array|plurals|drawable|mipmap|anim|animator|menu|xml|font)\/([A-Za-z0-9_.]+)/g;
  for (const f of scanFiles) {
    let rm: RegExpExecArray | null;
    while ((rm = refRe.exec(f.text || "")) !== null) want.add(`${rm[1]}/${rm[2].replace(/\.\w+$/, "")}`);
  }
  return [...want].filter((w) => !defs.has(w)).sort();
}
