// lib/xml/runtime-log.ts — M288：把「被打出来的 App」的运行日志收进编辑器抽屉
//
// 链路：
//   生成的 APK（AxvRuntimeLog）→ sendBroadcast(com.jiji.axv.RUNTIME_LOG, setPackage=com.jiji.axv)
//   → AXV 编辑器 MainActivity 的动态 BroadcastReceiver
//   → web.evaluateJavascript(window.__axvRuntimeLog(json))
//   → 这里（环形缓冲 500 条 + 订阅通知）→ ProblemsDrawer 的「运行日志」tab
//
// 为什么广播：不用 adb、不用文件共享、不碰 Android 11 的分区存储限制；
// 只在本机内存里传，日志不落盘。

export interface RuntimeLogEntry {
  id: string;
  /** 毫秒时间戳 */
  ts: number;
  /** 产生日志的 App 包名（区分多个项目） */
  appPkg: string;
  /** log / lifecycle / crash */
  level: string;
  line: string;
}

const MAX = 500;

let seq = 0;
let buf: RuntimeLogEntry[] = [];
const subs = new Set<(entries: RuntimeLogEntry[]) => void>();

function notify() {
  for (const fn of subs) {
    try {
      fn(buf);
    } catch {
      /* 单个订阅者出错不影响其它 */
    }
  }
}

/** 当前全部条目（新在后，跟时间顺序一致） */
export function runtimeLogEntries(): RuntimeLogEntry[] {
  return buf;
}

/** 订阅变化；返回取消函数 */
export function subscribeRuntimeLog(fn: (entries: RuntimeLogEntry[]) => void): () => void {
  subs.add(fn);
  fn(buf);
  return () => {
    subs.delete(fn);
  };
}

export function clearRuntimeLog(): void {
  buf = [];
  notify();
}

/** 追加一条（供测试和 JS 桥用）；返回是否真的加入 */
export function pushRuntimeLog(raw: Partial<RuntimeLogEntry> | null | undefined): boolean {
  if (!raw || typeof raw.line !== "string" || !raw.line) return false;
  const entry: RuntimeLogEntry = {
    id: `rt${++seq}`,
    ts: typeof raw.ts === "number" && raw.ts > 0 ? raw.ts : Date.now(),
    appPkg: typeof raw.appPkg === "string" ? raw.appPkg : "",
    level: typeof raw.level === "string" && raw.level ? raw.level : "log",
    line: raw.line,
  };
  // 同一条连续重复的日志（如 onResume 刷屏）折叠成 ×N，避免把缓冲冲掉
  const last = buf[buf.length - 1];
  if (last && last.appPkg === entry.appPkg && entry.ts - last.ts < 1000) {
    const m = / · ×(\d+)$/.exec(last.line);
    const base = m ? last.line.replace(/ · ×\d+$/, "") : last.line;
    if (base === entry.line) {
      last.line = `${base} · ×${(m ? Number(m[1]) : 1) + 1}`;
      last.ts = entry.ts;
      notify();
      return true;
    }
  }
  buf = buf.length >= MAX ? [...buf.slice(buf.length - MAX + 1), entry] : [...buf, entry];
  notify();
  return true;
}

/**
 * 装全局回调（幂等）。原生侧调用 window.__axvRuntimeLog(JSON 字符串)。
 * 只应在浏览器环境调用一次。
 */
export function installRuntimeLogBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    __axvRuntimeLog?: (json: string) => void;
    __axvRuntimeLogInstalled?: boolean;
  };
  if (w.__axvRuntimeLogInstalled) return;
  w.__axvRuntimeLogInstalled = true;
  w.__axvRuntimeLog = (json: string) => {
    try {
      pushRuntimeLog(JSON.parse(json) as Partial<RuntimeLogEntry>);
    } catch {
      /* 坏数据丢掉，不要把编辑器弄崩 */
    }
  };
}

/** 复制用纯文本 */
export function runtimeLogText(entries: RuntimeLogEntry[]): string {
  return entries
    .map((e) => {
      const d = new Date(e.ts);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      const lv = e.level === "crash" ? "E/" : e.level === "lifecycle" ? "L/" : "I/";
      return `${hh}:${mm}:${ss} ${lv}${e.appPkg ? `[${e.appPkg}] ` : ""}${e.line}`;
    })
    .join("\n");
}
