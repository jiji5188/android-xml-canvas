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
