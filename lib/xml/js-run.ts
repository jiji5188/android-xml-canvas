// lib/xml/js-run.ts — M409 step4：JavaScript 沙箱执行
//
// 为什么用 Worker 而不是 new Function 直接跑：
//   1. 死循环（while(true)）会冻死主线程 → Worker 可 terminate 强杀
//   2. 全局污染隔离（用户的 window/document 改动不影响编辑器）
//   3. 超时可控（默认 5s，上限 60s）
//
// 局限（写清楚，别让人误以为能跑一切）：
//   - 不支持 import / require（没有模块解析器）；只能跑单文件脚本
//   - 没有 DOM / fetch（Worker 里可以 fetch，但没有 document）
//   - 若宿主页 CSP 禁 unsafe-eval，会创建失败 → 返回 step:"env"

export interface JsRunInput {
  /** 源码（单文件，忽略 import/require） */
  code: string;
  /** 超时（毫秒），默认 5000，[1000, 60000] */
  timeoutMs?: number;
  /** 传给 main(args) 的参数 */
  args?: string[];
}

export interface JsRunResult {
  ok: boolean;
  /** env（无 Worker / CSP）/ timeout / exception / done */
  step?: "env" | "timeout" | "exception" | "done";
  /** console.log 收集（按行） */
  stdout?: string;
  stderr?: string;
  /** 入口函数返回值（String.valueOf；无返回 → ""） */
  returnValue?: string;
  /** 异常 message */
  exception?: string;
  /** 异常堆栈 */
  stackTrace?: string;
  ms?: number;
  log?: string;
}

/** 当前环境能不能跑 JS 沙箱（需要 Worker + Blob URL） */
export function hasJsRun(): boolean {
  return (
    typeof Worker !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function"
  );
}

/**
 * 生成 Worker 脚本文本（纯函数，可单测）。
 *
 * 约定：源码里若有 `function main(args)` / `async function main(args)`，会自动调用并取返回值；
 * 没有 main 就只执行顶层语句。console.log/info/warn 进 stdout，console.error 进 stderr。
 */
export function buildJsWorkerScript(code: string, args: string[] = []): string {
  // 用数组拼，避免模板串里反引号/美元符转义地狱
  return [
    "const __out = [];",
    "const __err = [];",
    "const __fmt = (v) => {",
    "  try {",
    "    if (typeof v === 'string') return v;",
    "    if (typeof v === 'undefined') return 'undefined';",
    "    if (typeof v === 'function') return '[Function ' + (v.name || 'anonymous') + ']';",
    "    return JSON.stringify(v);",
    "  } catch { return String(v); }",
    "};",
    "const console = {",
    "  log: (...a) => __out.push(a.map(__fmt).join(' ')),",
    "  info: (...a) => __out.push(a.map(__fmt).join(' ')),",
    "  warn: (...a) => __out.push(a.map(__fmt).join(' ')),",
    "  error: (...a) => __err.push(a.map(__fmt).join(' ')),",
    "};",
    "const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;",
    "const __src = " + JSON.stringify(code) + ";",
    "const __args = " + JSON.stringify(args) + ";",
    "(async () => {",
    "  try {",
    "    const fn = new AsyncFunction('console', 'args', __src + '\\n;return (typeof main === \\'function\\') ? await main(args) : undefined;');",
    "    const r = await fn(console, __args);",
    "    let ret;",
    "    try { ret = (r === undefined) ? '' : __fmt(r); } catch { ret = String(r); }",
    "    self.postMessage({ out: __out, err: __err, result: ret, error: null });",
    "  } catch (e) {",
    "    self.postMessage({",
    "      out: __out,",
    "      err: __err,",
    "      result: '',",
    "      error: { message: (e && e.message) ? String(e.message) : String(e), stack: (e && e.stack) ? String(e.stack) : '' },",
    "    });",
    "  }",
    "})();",
  ].join("\n");
}

/** 在 Worker 沙箱里跑一段 JS（promise 永远 resolve，错误放 ok=false + step） */
export function runJs(input: JsRunInput): Promise<JsRunResult> {
  const timeoutMs = Math.max(1000, Math.min(input.timeoutMs ?? 5000, 60000));
  return new Promise((resolve) => {
    if (!hasJsRun()) {
      resolve({ ok: false, step: "env", log: "当前环境不支持 JS 沙箱（需要 Worker）" });
      return;
    }
    const started = Date.now();
    let worker: Worker | null = null;
    let url = "";
    let done = false;

    const finish = (r: JsRunResult) => {
      if (done) return;
      done = true;
      try {
        worker?.terminate();
      } catch {
        /* ignore */
      }
      try {
        if (url) URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
      resolve({ ...r, ms: Date.now() - started });
    };

    try {
      const blob = new Blob([buildJsWorkerScript(input.code, input.args || [])], {
        type: "text/javascript",
      });
      url = URL.createObjectURL(blob);
      worker = new Worker(url);
    } catch (e) {
      resolve({ ok: false, step: "env", log: "创建沙箱失败（可能被 CSP 拦截）：" + String(e) });
      return;
    }

    const timer = setTimeout(() => {
      finish({ ok: false, step: "timeout", log: `执行超时（${timeoutMs}ms 未结束，可能是死循环）` });
    }, timeoutMs);

    worker.onmessage = (ev: MessageEvent) => {
      clearTimeout(timer);
      const d = (ev.data || {}) as {
        out?: string[];
        err?: string[];
        result?: string;
        error?: { message?: string; stack?: string } | null;
      };
      const stdout = (d.out || []).join("\n");
      const stderr = (d.err || []).join("\n");
      if (d.error) {
        finish({
          ok: false,
          step: "exception",
          stdout,
          stderr,
          exception: d.error.message || "",
          stackTrace: d.error.stack || "",
        });
      } else {
        finish({ ok: true, step: "done", stdout, stderr, returnValue: d.result ?? "" });
      }
    };

    worker.onerror = (ev: ErrorEvent) => {
      clearTimeout(timer);
      finish({ ok: false, step: "exception", log: ev.message || "沙箱执行出错" });
    };
  });
}
