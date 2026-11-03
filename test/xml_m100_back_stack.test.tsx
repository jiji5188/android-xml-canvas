// @vitest-environment jsdom
// M100：安卓硬件返回键 → 先关最上层浮层，再考虑 goBack/退出
//
// 覆盖三件事：
//   ① 后退栈本身（LIFO、注销幂等、空栈返回 false）
//   ② window.__axvHandleBack 桥（原生 evaluateJavascript 就调它）
//   ③ React 钩子 useBackGuard + XmlEditor 真的注册了这些浮层（源码护栏）

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import {
  registerBack,
  handleBack,
  backStackDepth,
  resetBackStack,
  installBackBridge,
} from "@/lib/ui/back-stack";
import { useBackGuard } from "@/components/useBackGuard";

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
};

describe("M100 后退栈", () => {
  beforeEach(() => resetBackStack());
  afterEach(() => resetBackStack());

  it("空栈时返回 false（让原生继续 goBack/退出）", () => {
    expect(handleBack()).toBe(false);
  });

  it("后进先出：最后注册的先被消费", () => {
    const order: string[] = [];
    registerBack(() => order.push("panel"));
    registerBack(() => order.push("dialog"));
    expect(backStackDepth()).toBe(2);
    expect(handleBack()).toBe(true);
    expect(order).toEqual(["dialog"]);
    expect(backStackDepth()).toBe(1);
    expect(handleBack()).toBe(true);
    expect(order).toEqual(["dialog", "panel"]);
    expect(handleBack()).toBe(false);
  });

  it("注销幂等：重复调用不会误删别人的条目", () => {
    const a = registerBack(() => {});
    const b = registerBack(() => {});
    a();
    a(); // 第二次不应删到 b
    expect(backStackDepth()).toBe(1);
    expect(handleBack()).toBe(true);
    // 剩下的确实是 b（已执行过）
    expect(backStackDepth()).toBe(0);
    b();
  });

  it("单个处理器抛错不影响整栈", () => {
    registerBack(() => {
      throw new Error("boom");
    });
    expect(() => handleBack()).not.toThrow();
    expect(backStackDepth()).toBe(0);
  });
});

describe("M100 window.__axvHandleBack 桥", () => {
  beforeEach(() => resetBackStack());
  afterEach(() => resetBackStack());

  it("没装桥时 window 上不该有函数；装上后分别返回 '1' / '0'", () => {
    installBackBridge();
    expect(typeof window.__axvHandleBack).toBe("function");
    expect(window.__axvHandleBack!()).toBe("0"); // 空栈
    registerBack(() => {});
    expect(window.__axvHandleBack!()).toBe("1"); // 消费掉
    expect(window.__axvHandleBack!()).toBe("0"); // 已经空了
  });
});

describe("M100 useBackGuard", () => {
  let root: Root | null = null;

  beforeEach(() => resetBackStack());
  afterEach(() => {
    root?.unmount();
    root = null;
    document.body.innerHTML = "";
    resetBackStack();
  });

  function Probe({ open, onBack }: { open: boolean; onBack: () => void }) {
    useBackGuard(open, onBack);
    return null;
  }

  async function mount(el: React.ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(el);
    await flush();
  }

  it("open=true 时注册，返回键触发 onBack", async () => {
    let hits = 0;
    await mount(<Probe open onBack={() => hits++} />);
    expect(backStackDepth()).toBe(1);
    expect(handleBack()).toBe(true);
    expect(hits).toBe(1);
  });

  it("open=false 时不占用返回键", async () => {
    await mount(<Probe open={false} onBack={() => {}} />);
    expect(backStackDepth()).toBe(0);
    expect(handleBack()).toBe(false);
  });

  it("关闭后自动注销（不残留）", async () => {
    let hits = 0;
    await mount(<Probe open onBack={() => hits++} />);
    expect(backStackDepth()).toBe(1);
    root!.render(<Probe open={false} onBack={() => hits++} />);
    await flush();
    expect(backStackDepth()).toBe(0);
    expect(hits).toBe(0);
  });
});
