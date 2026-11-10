// lib/xml/apk-repack.ts — M212：导入 APK → 换里面的原始资源（图片/assets/raw/lib）→ 重签名
//
// 能力边界（重要）：APK 里的 layout / values 是「编译过的二进制 AXML + resources.arsc」，
// 要改它们必须整套反编译再回编（apktool 级别），这里不做。本模块只换「原样存着的文件」：
//   res/drawable*/xxx.png|webp|jpg、assets/**、res/raw/**、lib/**、任意原始条目
// 替换后再用 apksig 重新签名，产出可直接安装的 APK。
//
// 协议：
//   pickApk()            → 拉起系统选择器，原生回 window.__axvPickedApk(path, "ok:name"|"err:x")
//   listApkEntries(path) → 同步返回 [{name,size}]（失败返回 "err:..."）
//   repackApkAsync(id, payload) → 原生回 window.__axvRepackApk(id, "ok:<path>"|"err:step:msg")

export interface ApkEntry {
  name: string;
  size: number;
}

export interface RepackInput {
  /** 源 APK 绝对路径（pickApk 给的） */
  apk: string;
  /** 要替换/新增的条目：name 是 APK 内的路径，base64 是新内容 */
  replacements: { name: string; base64: string }[];
  keystore: string;
  storePass: string;
  alias?: string;
  keyPass?: string;
  outName?: string;
}

export interface RepackResult {
  ok: boolean;
  path?: string;
  log?: string;
  step?: string;
}

interface RepackBridge {
  pickApk?(): void;
  listApkEntries?(path: string): string;
  repackApkAsync?(id: string, payload: string): void;
}

function bridge(): RepackBridge | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { AxvNative?: RepackBridge }).AxvNative ?? null;
}

export function hasApkRepack(): boolean {
  const b = bridge();
  return !!(b && typeof b.pickApk === "function" && typeof b.repackApkAsync === "function");
}

/** 拉起系统 APK 选择器；resolve 出 { path?, err? } */
export function pickApk(): Promise<{ path?: string; name?: string; err?: string }> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve({ err: "当前环境不支持" });
      return;
    }
    const w = window as unknown as {
      __axvPickedApk?: (path: string, result: string) => void;
    };
    const prev = w.__axvPickedApk;
    w.__axvPickedApk = (path: string, result: string) => {
      w.__axvPickedApk = prev;
      const r = String(result || "");
      if (r.startsWith("err:")) resolve({ err: r.slice(4) || "已取消" });
      else resolve({ path, name: r.startsWith("ok:") ? r.slice(3) : "" });
    };
    const b = bridge();
    if (!b || typeof b.pickApk !== "function") {
      w.__axvPickedApk = prev;
      resolve({ err: "当前环境不支持导入 APK" });
      return;
    }
    try {
      b.pickApk();
    } catch (e) {
      w.__axvPickedApk = prev;
      resolve({ err: String(e) });
    }
    // 兜底：5 分钟没回话（用户可能去干别的了，不再挂着）
    setTimeout(() => {
      if (w.__axvPickedApk) {
        w.__axvPickedApk = prev;
        resolve({ err: "选择超时" });
      }
    }, 300000);
  });
}

/** 列出 APK 条目（同步）；失败时返回空数组并带 error */
export function listApkEntries(apkPath: string): { entries: ApkEntry[]; error?: string } {
  const b = bridge();
  if (!b || typeof b.listApkEntries !== "function") return { entries: [], error: "当前环境不支持" };
  let raw = "";
  try {
    raw = b.listApkEntries(apkPath) || "";
  } catch (e) {
    return { entries: [], error: String(e) };
  }
  if (raw.startsWith("err:")) return { entries: [], error: raw.slice(4) };
  const body = raw.startsWith("ok:") ? raw.slice(3) : raw;
  try {
    const arr = JSON.parse(body) as ApkEntry[];
    if (!Array.isArray(arr)) return { entries: [], error: "返回格式不对" };
    return {
      entries: arr
        .filter((e) => e && typeof e.name === "string")
        .map((e) => ({ name: e.name, size: Number(e.size) || 0 }))
        .sort((a, b2) => a.name.localeCompare(b2.name)),
    };
  } catch {
    return { entries: [], error: "返回不是合法 JSON" };
  }
}

const pending = new Map<string, (r: RepackResult) => void>();
let seq = 0;
let installed = false;

function install(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __axvRepackApk?: (id: string, json: string) => void };
  if (installed && typeof w.__axvRepackApk === "function") return;
  installed = true;
  w.__axvRepackApk = (id: string, raw: string) => {
    const fn = pending.get(id);
    if (!fn) return;
    pending.delete(id);
    const s = String(raw || "");
    if (s.startsWith("ok:")) fn({ ok: true, path: s.slice(3) });
    else if (s.startsWith("err:")) {
      const rest = s.slice(4);
      const colon = rest.indexOf(":");
      fn({ ok: false, step: colon > 0 ? rest.slice(0, colon) : undefined, log: colon > 0 ? rest.slice(colon + 1) : rest });
    } else fn({ ok: false, log: s.slice(0, 300) });
  };
}

/** 重打包（promise 永远 resolve） */
export function repackApk(input: RepackInput): Promise<RepackResult> {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b || typeof b.repackApkAsync !== "function") {
      resolve({ ok: false, step: "env", log: "当前环境不支持（请在手机上操作）" });
      return;
    }
    install();
    const id = "rep" + ++seq + "-" + Date.now();
    pending.set(id, resolve);
    try {
      b.repackApkAsync(id, JSON.stringify(input));
    } catch (e) {
      pending.delete(id);
      resolve({ ok: false, step: "env", log: String(e) });
      return;
    }
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ ok: false, step: "timeout", log: "重打包超时（90s 没回话）" });
      }
    }, 90000);
  });
}

/** 这个条目能不能换（能换的：原始二进制/文本；不能换的：编译产物 AXML / arsc） */
export function isReplaceableEntry(name: string): boolean {
  if (!name || name.endsWith("/")) return false;
  if (name === "resources.arsc") return false;
  if (/^AndroidManifest\.xml$/i.test(name)) return false;
  if (/^res\/(layout|xml|menu|values|anim|animator|transition|color|drawable|mipmap)[^/]*\/.*\.xml$/i.test(name)) {
    // 这些目录里的 .xml 是编译过的 AXML，不能直接换；但 drawable 下的图片可以
    return false;
  }
  if (/\.(png|webp|jpg|jpeg|gif|bmp|9\.png)$/i.test(name)) return true;
  if (/\.(ttf|otf|mp3|mp4|wav|ogg|bin|dat|json|txt|js|html|css|so)$/i.test(name)) return true;
  if (/^assets\//i.test(name)) return true;
  if (/^lib\//i.test(name)) return true;
  if (/^res\/raw\//i.test(name)) return true;
  // 其余默认允许（用户自己知道在换什么）
  return true;
}
