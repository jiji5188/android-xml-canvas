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
}

declare global {
  interface Window {
    AxvNative?: AxvNativeBridge;
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
