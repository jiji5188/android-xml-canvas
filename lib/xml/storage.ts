// lib/xml/storage.ts — 自动保存用的 localStorage 读写（M7c 从 XmlEditor 抽出）
// 全部 try/catch：无 SSR、无痕模式、配额超限都不能把编辑器搞崩。

export const LS_KEY_XML = "axv.autosave.xml";
export const LS_KEY_HIST = "axv.autosave.history";
export const LS_KEY_RES = "axv.autosave.resources";
export const LS_KEY_ICONS = "axv.autosave.icons"; // M3g：图标选择器生成的矢量资源
export const LS_KEY_DEVICE = "axv.device";
export const LS_KEY_ZOOM = "axv.zoom";
/** 多文件项目（文件列表 + 各自的 xml） */
export const LS_KEY_PROJECT = "axv.project.v1";

/** 安全读 localStorage 字符串 */
export function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 安全写 localStorage 字符串（失败静默） */
export function lsSet(key: string, val: string): void {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    // 超配额/隐私模式：放弃这次写入，不影响主流程
  }
}

/** 安全读 JSON（损坏/类型不符返回 null） */
export function lsGetJson<T>(key: string): T | null {
  const raw = lsGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 安全写 JSON；超过 maxBytes 字节就不写（避免把配额吃光） */
export function lsSetJson(key: string, value: unknown, maxBytes = 4_500_000): boolean {
  try {
    const blob = JSON.stringify(value);
    if (!blob || blob.length > maxBytes) return false;
    lsSet(key, blob);
    return true;
  } catch {
    return false;
  }
}
