// lib/xml/system-download.ts — M357：系统下载器封装。
// 目标：把库下载交给「系统自带的下载器」，切页面/重新进入不中断：
//   - Android（APK，AxvNative 存在）：走原生 DownloadManager（后台跑、系统通知、可取消、报进度），目标落共享库 /AndroidUIIDE/libs
//   - 浏览器（H5，无 AxvNative）：走浏览器原生下载（a[download] 到用户 Downloads），切标签页不中断
// 下载失败策略：逐个候选镜像换源重试；全失败就记清「哪些没下成」，绝不静默假装成功。

import { nativeBridge } from "./native-save";

export interface SysDownloadOpts {
  /** 轮询下载进度的间隔（默认 400ms）；DownloadManager 模式用，浏览器模式忽略 */
  pollMs?: number;
  /** 单个镜像最长等待（默认 120s）；超时算该镜像失败，换下一个 */
  perSourceTimeoutMs?: number;
  /** 每次换源前的额外等待（默认 200ms） */
  onProgress?: (name: string, cur: number, total: number, sourceIdx: number) => void;
  /** 打开原生 ProgressDialog（APK 用；浏览器忽略）。opKey 建议 "dl:"+name */
  showNativeProgress?: boolean;
}

export interface SysDownloadResult {
  ok: boolean;
  /** 成功时 */
  okUrl?: string;
  /** 交给系统下载（DownloadManager）时的 jobId；浏览器模式为 undefined */
  jobId?: string;
  /** 浏览器原生下载（结果交给浏览器，无法可靠追踪） */
  browser?: boolean;
  /** 缺 All-files-access 权限（APK）→ 引导授权 */
  missingPermission?: boolean;
  /** 全镜像都失败：记清没下成的（name + 试过的 url 数） */
  error?: string;
  /** 试过的镜像数（换源次数） */
  attemptedSources?: number;
}

/** 浏览器原生下载：a[download]，浏览器存到用户 Downloads，切页不中断。 */
export function triggerBrowserDownload(url: string, name: string): void {
  if (typeof document === "undefined") return;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
}

/** 查 DownloadManager 进度（APK）。浏览器/无 jobId → {browser:true}。 */
export function downloadProgress(jobId: string): {
  state: number; cur: number; total: number; done: boolean; failed: boolean; gone?: boolean; browser?: boolean; error?: string;
} {
  const b = nativeBridge();
  if (!b?.downloadProgress || !jobId) return { state: 0, cur: 0, total: 0, done: false, failed: false, browser: true };
  try {
    const raw = b.downloadProgress(jobId);
    return JSON.parse(raw) as any;
  } catch {
    return { state: 0, cur: 0, total: 0, done: false, failed: false };
  }
}

/** 取消 DownloadManager 下载（APK；可选）。 */
export function cancelSystemDownload(jobId: string): boolean {
  const b = nativeBridge();
  if (!b?.cancelDownload || !jobId) return false;
  try { return b.cancelDownload(jobId).startsWith("ok"); } catch { return false; }
}

/**
 * 系统下载 + 镜像换源 + 进度轮询。
 * @param urls 候选镜像（按优先级排，逐个试）
 * @param name 目标文件名（含扩展，如 jxl-2.9.3.jar）
 * @param destDir 目标目录（绝对路径；APK 传共享库 /AndroidUIIDE/libs；浏览器忽略）
 */
export function systemDownload(urls: string[], name: string, destDir: string, opts: SysDownloadOpts = {}): SysDownloadResult {
  const b = nativeBridge();
  const clean = (urls || []).map((u) => (u || "").trim()).filter((u) => u && u.length > 4);
  if (clean.length === 0) return { ok: false, error: "无候选 URL", attemptedSources: 0 };

  // ---- 浏览器：交给浏览器原生下载（不追踪进度，切页不中断）----
  if (!b?.systemDownload) {
    triggerBrowserDownload(clean[0], name);
    return { ok: true, browser: true, okUrl: clean[0] };
  }

  // ---- APK：DownloadManager，逐个镜像换源 ----
  const pollMs = opts.pollMs ?? 400;
  const perSourceTimeoutMs = opts.perSourceTimeoutMs ?? 120000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < clean.length; i++) {
    const r = b.systemDownload(JSON.stringify([clean[i]]), name, destDir);
    if (r === "err:no-permission") {
      closeNativeProgress(opts, name);
      return { ok: false, missingPermission: true, attemptedSources: i + 1, error: "缺 All-files-access 权限，下载不到" };
    }
    if (!r.startsWith("ok:")) {
      // 这个镜像 enqueue 就失败 → 换下一个
      continue;
    }
    const jobId = r.slice(3);

    // 进度轮询（同时驱动原生 ProgressDialog，如果开了）
    const start = Date.now();
    let lastSent = -1;
    for (;;) {
      if (Date.now() - start > perSourceTimeoutMs) break; // 这个镜像太慢/卡了 → 换下一个
      const p = downloadProgress(jobId);
      if (p.done) {
        closeNativeProgress(opts, name);
        return { ok: true, okUrl: clean[i], jobId, attemptedSources: i + 1 };
      }
      if (p.failed || p.gone) break; // 失败/已被系统移除 → 换下一个镜像
      const pct = p.total > 0 ? Math.floor((p.cur / p.total) * 100) : -1;
      if (opts.onProgress) opts.onProgress(name, p.cur, p.total, i);
      if (pct !== lastSent) { lastSent = pct; sendNativeProgress(opts, name, pct); }
      void sleep(pollMs);
    }
    // 到这说明这个镜像没成（超时/失败），取消它再换源
    cancelSystemDownload(jobId);
  }

  closeNativeProgress(opts, name);
  return {
    ok: false,
    attemptedSources: clean.length,
    error: `全部 ${clean.length} 个源都试了 → 没下成 ${name}`,
  };
}

function sendNativeProgress(opts: SysDownloadOpts, name: string, pct: number) {
  const b = nativeBridge();
  if (!b?.setOpProgress || !opts.showNativeProgress) return;
  const key = "dl:" + name;
  b.setOpProgress(key, pct, pct >= 0 ? `${pct}%` : "正在下载…");
}

function closeNativeProgress(opts: SysDownloadOpts, name: string) {
  const b = nativeBridge();
  if (!b?.closeOpProgress || !opts.showNativeProgress) return;
  b.closeOpProgress("dl:" + name);
}

/** 打开原生 ProgressDialog（下载类：可关闭；打包编译类：不可关闭）。 */
export function showNativeProgress(title: string, msg: string, cancelable: boolean, opKey: string) {
  const b = nativeBridge();
  if (b?.showOpProgress) b.showOpProgress(opKey, title, msg, cancelable);
}

/** 关闭原生 ProgressDialog。 */
export function closeNativeDialog(opKey: string) {
  const b = nativeBridge();
  if (b?.closeOpProgress) b.closeOpProgress(opKey);
}

/** M361：更新原生 ProgressDialog 的进度文案（打包分节回传用）。 */
export function setNativeProgress(opKey: string, msg: string, percent = -1) {
  const b = nativeBridge();
  if (b?.setOpProgress) b.setOpProgress(opKey, percent, msg);
}
