// lib/xml/native-save.ts
// 浏览器里走 blob 下载；装进 APK 壳（WebView）里走原生保存桥 window.AxvNative，
// 由原生写进用户可见目录（默认「下载/XML画板」，也可由用户自选文件夹）。
// 为什么必须这样：WebView 不支持 blob: 链接的下载，点了完全没反应。

export interface AxvNativeBridge {
  /** 保存文件，base64 传输；返回 "ok:<路径>" 或 "err:<原因>" */
  saveFile(name: string, mime: string, base64: string): string;
  /** 复制到系统剪贴板（ClipboardManager）；返回 "ok" 或 "err:<原因>" */
  copyText?(text: string): string;
  /** 当前工作目录的人类可读名称，如「下载/XML画板」 */
  getWorkspace(): string;
  /** 弹出系统文件夹选择器，选完即成为新的默认工作目录 */
  pickWorkspace(): void;

  /* ===== M16i：工作目录 ===== */
  /** 内置默认工作目录绝对路径（如 /storage/emulated/0/AndroidUIIDE/Project） */
  getDefaultWorkspace?(): string;
  /** 当前生效目录 + 权限状态（JSON 字符串） */
  getWorkspaceInfo?(): string;
  /** 是否已拿到「所有文件访问」 */
  hasAllFilesAccess?(): boolean;
  /** M30：只列顶层项目卡片（不递归），轮询面板用；返回 JSON 字符串，旧 APK 没有此方法 */
  listTopProjects?(): string;
  /** 跳系统设置申请「所有文件访问」 */
  requestAllFilesAccess?(): void;
  /** 列工作目录下的项目（JSON 字符串） */
  listProjects?(): string;
  /** 读文本：绝对路径（限默认目录）或 content:// URI */
  readText?(target: string): string | null;
  /** M31：读二进制（项目图标等）→ base64；读不到返回 null */
  readBase64?(target: string): string | null;
  /** M31h：列一层目录（绝对路径）→ {"ok":true,"items":[{name,kind,path}]}；越界/不支持返回 ok:false */
  listDir?(path: string): string | null;
  /** M19：触觉反馈。type: "long"(长按) / "toggle"(开关·勾选·单选)。
   *  原生用 Vibrator 精确时长；无马达设备静默。返回 true 表示原生已处理。 */
  haptic?(type: string): void;

  /* ===== M21：保存回原路径 / 另存为 ===== */
  /** 把文本写回原路径（content:// 或默认目录内绝对路径）；返回 "ok:..."/"err:..." */
  writeText?(target: string, base64: string): string;
  /** 另存整包：Java 弹文件夹选择器，写完回调 window.AxvNativeSaved(json) */
  saveBundle?(name: string, filesJson: string): void;
}

declare global {
  interface Window {
    AxvNative?: AxvNativeBridge;
    /** M21：saveBundle 完成回调（Java 侧 evaluateJavascript 调用） */
    AxvNativeSaved?: (json: string) => void;
  }
}

export function nativeBridge(): AxvNativeBridge | null {
  if (typeof window === "undefined") return null;
  const b = window.AxvNative;
  return b && typeof b.saveFile === "function" ? b : null;
}

/** 是否运行在原生壳里（决定 UI 上要不要显示「保存位置」） */
export function nativeAvailable(): boolean {
  return nativeBridge() !== null;
}

export function workspaceLabel(): string {
  try {
    const b = nativeBridge();
    if (!b) return "";
    return b.getWorkspace() || "";
  } catch {
    return "";
  }
}

export function chooseWorkspace(): boolean {
  try {
    const b = nativeBridge();
    if (!b) return false;
    b.pickWorkspace();
    return true;
  } catch {
    return false;
  }
}

const CHUNK = 0x8000; // 分块避免 String.fromCharCode 参数过多爆栈

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...Array.from(bytes.subarray(i, i + CHUNK)));
  }
  return btoa(out);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 按扩展名猜 MIME（原生写 MediaStore 时需要） */
export function mimeOfName(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "svg":
      return "image/svg+xml";
    case "xml":
      return "text/xml";
    case "zip":
      return "application/zip";
    case "json":
      return "application/json";
    case "txt":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

/** 原生保存字节。返回 true 表示已交给原生处理（调用方不要再走 blob 下载） */
export function saveBytesNative(name: string, bytes: Uint8Array, mime?: string): boolean {
  const b = nativeBridge();
  if (!b) return false;
  try {
    const r = b.saveFile(name, mime || mimeOfName(name), bytesToBase64(bytes));
    return typeof r === "string" && r.startsWith("ok");
  } catch {
    return false;
  }
}

export function saveTextNative(name: string, text: string, mime?: string): boolean {
  try {
    return saveBytesNative(name, new TextEncoder().encode(text), mime || mimeOfName(name));
  } catch {
    return false;
  }
}

/** M21：把文本写回原路径（content:// 或默认目录内绝对路径） */
export function writeTextNative(target: string, text: string): boolean {
  const b = nativeBridge();
  if (!b?.writeText) return false;
  try {
    const r = b.writeText(target, bytesToBase64(new TextEncoder().encode(text)));
    return typeof r === "string" && r.startsWith("ok");
  } catch {
    return false;
  }
}

/** 原生复制文本（ClipboardManager）；不是原生壳或壳没有 copyText 时返回 false，调用方自己走 clipboard API */
export function copyTextNative(text: string): boolean {
  const b = nativeBridge();
  if (!b || typeof b.copyText !== "function") return false;
  try {
    const r = b.copyText(text);
    return typeof r === "string" && r.startsWith("ok");
  } catch {
    return false;
  }
}

/** 原生触觉反馈（Vibrator 精确时长）；壳里没有 haptic 桥时返回 false，调用方回退 navigator.vibrate */
export function hapticNative(type: "long" | "toggle" | "none"): boolean {
  const b = nativeBridge();
  if (!b || typeof b.haptic !== "function") return false;
  try {
    b.haptic(type);
    return true;
  } catch {
    return false;
  }
}

/** 触觉反馈统一入口：原生壳优先（精确时长），桌面浏览器回退 navigator.vibrate（能震就震）。
 *  ms=0 直接不震。 */
export function vibrateSmart(ms: number, type?: "long" | "toggle" | "none"): void {
  if (ms <= 0) return;
  if (type && hapticNative(type)) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* Safari 直接抛，忽略 */
  }
}

/** 原生保存 dataURL（PNG / SVG 导出都产出 dataURL） */
export function saveDataUrlNative(name: string, dataUrl: string, mime?: string): boolean {
  if (!nativeAvailable()) return false;
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return false;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  try {
    const type = mime || mimeOfName(name);
    if (/;base64/i.test(meta)) {
      const b = nativeBridge();
      if (!b) return false;
      const r = b.saveFile(name, type, payload);
      return typeof r === "string" && r.startsWith("ok");
    }
    const bytes = new TextEncoder().encode(decodeURIComponent(payload));
    return saveBytesNative(name, bytes, type);
  } catch {
    return false;
  }
}
