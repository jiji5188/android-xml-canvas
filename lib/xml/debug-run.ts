/**
 * M405：debug 运行（AIDE 同款，不装包）——设备端把项目 Java 编译成 dex、动态加载执行、
 * 捕获 System.out/err/异常，回传给 WebView 显示在编辑器下方「调试日志」面板。
 *
 * 两步协议（都异步，不堵 JS 线程）：
 *   ① JS → AxvNative.debugCompileToDexAsync(id, payloadJson)   原生 → window.__axvDebugCompile(id, json)
 *   ② JS → AxvNative.debugRunAsync(id, payloadJson)            原生 → window.__axvDebugRun(id, json)
 *
 * 限制：跑在宿主 App 进程，无独立 Application/Context → 只能跑纯逻辑（算法/工具函数），
 * 不能起 Activity / 用系统 Context。System.out/err 会被劫持进缓冲区。
 */

import { axvNative, ensureGlobalCallback, pendingTable } from "./native-bridge";

/** ① 编译步入参（与 buildInstallApk 的 java 部分同构，但只到 dex 字节） */
export interface DebugCompileInput {
  /** 应用包名（R.java 包名用） */
  pkg: string;
  /** 项目 Java 源码（path 相对项目根，含 JS 生成的 R.java——若代码引用 R） */
  javaSources: { path: string; code: string }[];
  /** 项目依赖库（.jar/.aar 实体） */
  libs?: { path: string; base64: string }[];
  /** 候选入口类全限定名（JS 按「含 main/debug 的类」算好；自动探测用） */
  candidates?: string[];
}

export interface DebugCompileResult {
  ok: boolean;
  step?: string;
  /** dex 字节 base64 数组（② 执行步要用） */
  dex?: string[];
  bytes?: number;
  log?: string;
}

/** ② 执行步入参 */
export interface DebugRunInput {
  /** ① 产出的 dex 字节（base64） */
  dex: string[];
  /** 显式入口（全限定类名）；不传则自动探测 */
  entryClass?: string;
  /** 入口方法名（main / debug / 自定义 static）；默认探测 main 再 debug */
  entryMethod?: string;
  /** main(String[]) 的 args */
  args?: string[];
  /** 执行超时（毫秒），默认 30000 */
  timeoutMs?: number;
  /** 候选入口类（自动探测用；同 ① 的 candidates） */
  candidates?: string[];
}

export interface DebugRunResult {
  ok: boolean;
  /** env / dex / entry / timeout / exception / done */
  step?: string;
  stdout?: string;
  stderr?: string;
  /** 入口方法返回值（String.valueOf；void → ""） */
  returnValue?: string;
  /** 异常类名 + message（无异常为空） */
  exception?: string;
  stackTrace?: string;
  /** 实际执行的入口（全限定.方法(参数)） */
  entry?: string;
  ms?: number;
  log?: string;
}

interface DebugBridge {
  debugCompileToDexAsync?(id: string, payload: string): void;
  debugRunAsync?(id: string, payload: string): void;
}

function bridge(): DebugBridge | null {
  return axvNative<DebugBridge>();
}

/** 当前环境能不能 debug 运行（网页版永远不能——需要设备端 ECJ/D8） */
export function hasDebugRun(): boolean {
  const b = bridge();
  return !!(b && typeof b.debugRunAsync === "function" && typeof b.debugCompileToDexAsync === "function");
}

const compileTable = pendingTable<DebugCompileResult>("debugc");
const runTable = pendingTable<DebugRunResult>("debugr");

function installCallbacks(): void {
  ensureGlobalCallback("__axvDebugCompile", () => {
    (window as unknown as { __axvDebugCompile?: (id: string, json: string) => void }).__axvDebugCompile = (
      id: string,
      json: string,
    ) => {
      const fn = compileTable.take(id);
      if (!fn) return;
      let r: DebugCompileResult;
      try {
        r = JSON.parse(json) as DebugCompileResult;
      } catch {
        r = { ok: false, log: "原生返回的不是合法 JSON：" + String(json).slice(0, 200) };
      }
      fn(r);
    };
  });
  ensureGlobalCallback("__axvDebugRun", () => {
    (window as unknown as { __axvDebugRun?: (id: string, json: string) => void }).__axvDebugRun = (
      id: string,
      json: string,
    ) => {
      const fn = runTable.take(id);
      if (!fn) return;
      let r: DebugRunResult;
      try {
        r = JSON.parse(json) as DebugRunResult;
      } catch {
        r = { ok: false, step: "env", log: "原生返回的不是合法 JSON：" + String(json).slice(0, 200) };
      }
      fn(r);
    };
  });
}

/** ① 编译项目 Java 成 dex（promise 永远 resolve，错误放 ok=false + log） */
export function debugCompile(input: DebugCompileInput): Promise<DebugCompileResult> {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b || typeof b.debugCompileToDexAsync !== "function") {
      resolve({ ok: false, step: "env", log: "当前不在 App 里（网页版没有 ECJ/D8），请在手机上操作" });
      return;
    }
    installCallbacks();
    const id = compileTable.nextId();
    compileTable.put(id, resolve);
    try {
      b.debugCompileToDexAsync(id, JSON.stringify(input));
    } catch (e) {
      compileTable.drop(id);
      resolve({ ok: false, step: "env", log: String(e) });
    }
    setTimeout(() => {
      if (compileTable.pending.has(id)) {
        compileTable.drop(id);
        resolve({ ok: false, step: "timeout", log: "编译超时（90s 没回话）" });
      }
    }, 90000);
  });
}

/** ② 执行 dex（动态加载 + 反射调 main/debug + 捕获输出） */
export function debugRun(input: DebugRunInput): Promise<DebugRunResult> {
  return new Promise((resolve) => {
    const b = bridge();
    if (!b || typeof b.debugRunAsync !== "function") {
      resolve({ ok: false, step: "env", log: "当前不在 App 里（网页版没有 ECJ/D8），请在手机上操作" });
      return;
    }
    installCallbacks();
    const id = runTable.nextId();
    runTable.put(id, resolve);
    const timeout = Math.max(5000, input.timeoutMs ?? 30000);
    try {
      b.debugRunAsync(id, JSON.stringify({
        dex: input.dex,
        entryClass: input.entryClass || "",
        entryMethod: input.entryMethod || "",
        args: input.args || [],
        candidates: input.candidates || [],
        timeoutMs: timeout,
      }));
    } catch (e) {
      runTable.drop(id);
      resolve({ ok: false, step: "env", log: String(e) });
    }
    // 执行步超时兜底（比 native 的 timeoutMs 多留 5s 网络/JNI 余量）
    setTimeout(() => {
      if (runTable.pending.has(id)) {
        runTable.drop(id);
        resolve({ ok: false, step: "timeout", log: "执行超时（JS 侧 " + Math.round(timeout / 1000 + 5) + "s 没回话）" });
      }
    }, timeout + 5000);
  });
}
