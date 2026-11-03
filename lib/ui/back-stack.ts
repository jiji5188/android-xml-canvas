// lib/ui/back-stack.ts — 安卓硬件返回键的后退栈（M100）
//
// 背景：APK 里 MainActivity.onBackPressed 以前只判 web.canGoBack()，
// 而 SPA 的浮层（左栏面板、弹窗、图标编辑器…）全是 React state，历史栈里没痕迹，
// 于是「面板开着按返回」= 直接退出 App。
//
// 方案：JS 维护一个后进先出的处理函数栈，原生返回键先 evaluateJavascript 问
// window.__axvHandleBack()：返回 "1" 表示消费掉了（关掉了最上层浮层），"0" 才继续走
// canGoBack / finish。
//
// 纯 TS，无 React 依赖，浏览器里也能手动调 window.__axvHandleBack() 验证。

type BackFn = () => void;

interface Entry {
  id: number;
  fn: BackFn;
  label?: string;
}

const stack: Entry[] = [];
let seq = 0;

/** 注册一个返回处理函数，返回注销函数（幂等，重复调用安全） */
export function registerBack(fn: BackFn, label?: string): () => void {
  const id = ++seq;
  stack.push({ id, fn, label });
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const i = stack.findIndex((e) => e.id === id);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 当前栈里的标签，按从底到顶排列（排查拿不准谁在挡返回键时用） */
export function backStackLabels(): string[] {
  return stack.map((e) => e.label ?? `#${e.id}`);
}

/** 当前栈深度（测试用） */
export function backStackDepth(): number {
  return stack.length;
}

/**
 * 弹掉最上层并执行它。
 * @returns true = 有人消费了（原生不要退出 App）
 */
export function handleBack(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  stack.pop();
  try {
    top.fn();
  } catch {
    // 单个浮层抛错不该把返回键整体搞挂
  }
  return true;
}

/** 清空（页面卸载/测试用） */
export function resetBackStack(): void {
  stack.length = 0;
}

declare global {
  interface Window {
    __axvHandleBack?: () => string;
    __axvBackList?: () => string[];
  }
}

/**
 * 把 handleBack 挂到 window 上供原生调用。
 * 返回值用 "1"/"0" 字符串，evaluateJavascript 拿到的就是 JSON 字符串。
 * 重复调用安全（幂等覆盖）。
 */
export function installBackBridge(): void {
  if (typeof window === "undefined") return;
  window.__axvHandleBack = () => (handleBack() ? "1" : "0");
  // 调试入口：控制台敲 __axvBackList() 能看到还有哪几层在挡返回键
  window.__axvBackList = () => backStackLabels();
}
