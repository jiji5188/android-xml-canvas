// @vitest-environment jsdom
// M437：代码编辑器长按菜单「点外面关闭」—— 通用钩子 useOutsidePointerdown 单测
// M438/M438b：软键盘弹起（APK）→ ① 底部日志抽屉收起 ② 悬浮错误说明面板隐藏
//
// 用户需求原话（2026-11-20）：
//   "如果用户不选择菜单项时点击菜单面板外围（如代码编辑器任意位置）可以销毁弹窗，不影响输入"
//   "代码编辑器下方的日志输出抽屉在 APK 版本中弹出输入法时自动收起抽屉"
//   "弹出输入法时自动收起抽屉和隐藏 悬浮的错误说明面板"

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { useOutsidePointerdown } from "@/components/use-outside-pointerdown";
import { useSoftKeyboard } from "@/components/use-soft-keyboard";
import { ProblemsDrawer } from "@/components/ProblemsDrawer";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => cleanup());

/* ============ M437 useOutsidePointerdown ============ */

/** 宿主：面板（ref）+ 面板外按钮。onOutside 既打 spy 又驱动关闭（模拟 setCtxMenu(null)）。 */
function Harness({ onOutside }: { onOutside: () => void }) {
  const [open, setOpen] = useState(true);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => {
    onOutside();
    setOpen(false);
  }, [onOutside]);
  useOutsidePointerdown(open, panelRef, close);
  return (
    <div>
      <div ref={panelRef} data-testid="panel">
        <button data-testid="inside">菜单项</button>
      </div>
      <button data-testid="outside">编辑器别处</button>
      {open ? <span data-testid="panel-open">开</span> : <span data-testid="panel-closed">关</span>}
    </div>
  );
}

describe("M437 useOutsidePointerdown（点外面关菜单，不影响输入）", () => {
  it("点面板外（pointerdown）→ 回调 + 面板销毁", () => {
    const onOutside = vi.fn();
    render(<Harness onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("panel-closed")).toBeTruthy();
  });

  it("点面板内不触发回调、面板保留", () => {
    const onOutside = vi.fn();
    render(<Harness onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("inside"));
    expect(onOutside).not.toHaveBeenCalled();
    expect(screen.getByTestId("panel-open")).toBeTruthy();
  });

  it("enabled=false（面板已关）时点哪里都不回调", () => {
    const onOutside = vi.fn();
    function HarnessOff({ onOutside }: { onOutside: () => void }) {
      const ref = useRef<HTMLDivElement | null>(null);
      useOutsidePointerdown(false, ref, onOutside);
      return (
        <div>
          <div ref={ref} data-testid="panel">
            <button data-testid="inside">菜单项</button>
          </div>
          <button data-testid="outside">别处</button>
        </div>
      );
    }
    render(<HarnessOff onOutside={onOutside} />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("事件不拦截：点外面的按钮 onClick 仍照常触发（不影响输入/操作）", () => {
    const onOutside = vi.fn();
    const onBtn = vi.fn();
    function Harness2() {
      const ref = useRef<HTMLDivElement | null>(null);
      useOutsidePointerdown(true, ref, onOutside);
      return (
        <div>
          <div ref={ref}>面板</div>
          <button data-testid="outside" onClick={onBtn}>
            别处
          </button>
        </div>
      );
    }
    render(<Harness2 />);
    fireEvent.pointerDown(screen.getByTestId("outside"));
    fireEvent.click(screen.getByTestId("outside"));
    expect(onOutside).toHaveBeenCalledTimes(1);
    expect(onBtn).toHaveBeenCalledTimes(1); // 点击本身没被吞掉
  });
});

/* ============ M438b useSoftKeyboard（键盘检测钩子） ============ */

/** jsdom 没有 visualViewport：装一个可控桩（高度可改 + 手动触发 resize）。返回 vv 与清理函数。 */
function installVv() {
  const listeners: Array<() => void> = [];
  const vv = {
    _h: window.innerHeight,
    _ls: listeners,
    get height() {
      return vv._h;
    },
    addEventListener(_t: string, fn: () => void) {
      listeners.push(fn);
    },
    removeEventListener(_t: string, fn: () => void) {
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  return {
    vv,
    fireResize: () => listeners.forEach((fn) => fn()),
    cleanup: () => {
      delete (window as unknown as Record<string, unknown>).visualViewport;
    },
  };
}

function KbProbe({ enabled }: { enabled: boolean }) {
  const kb = useSoftKeyboard(enabled);
  return <span data-testid="kb">{kb ? "on" : "off"}</span>;
}

describe("M438b useSoftKeyboard（软键盘是否弹出）", () => {
  it("enabled=false（web/桌面）→ 恒 off，focusin 也不开", () => {
    const { cleanup: vvClean } = installVv();
    try {
      render(<KbProbe enabled={false} />);
      expect(screen.getByTestId("kb").textContent).toBe("off");
      const input = document.createElement("input");
      document.body.appendChild(input);
      fireEvent.focusIn(input);
      expect(screen.getByTestId("kb").textContent).toBe("off");
      input.remove();
    } finally {
      vvClean();
    }
  });

  it("输入框 focusin → on；焦点移到按钮 → off", () => {
    const { cleanup: vvClean } = installVv();
    try {
      render(<KbProbe enabled />);
      expect(screen.getByTestId("kb").textContent).toBe("off");
      const input = document.createElement("input");
      document.body.appendChild(input);
      act(() => { fireEvent.focusIn(input); });
      expect(screen.getByTestId("kb").textContent).toBe("on");
      const btn = document.createElement("button");
      document.body.appendChild(btn);
      act(() => { fireEvent.focusIn(btn); });
      expect(screen.getByTestId("kb").textContent).toBe("off");
      input.remove();
      btn.remove();
    } finally {
      vvClean();
    }
  });

  it("CodeMirror 的 contenteditable focusin 也算弹键盘", () => {
    const { cleanup: vvClean } = installVv();
    try {
      render(<KbProbe enabled />);
      const cm = document.createElement("div");
      cm.setAttribute("contenteditable", "true");
      document.body.appendChild(cm);
      act(() => { fireEvent.focusIn(cm); });
      expect(screen.getByTestId("kb").textContent).toBe("on");
      cm.remove();
    } finally {
      vvClean();
    }
  });

  it("visualViewport 缩水 ≥120px → on；恢复 → off", () => {
    const { vv, fireResize, cleanup: vvClean } = installVv();
    try {
      render(<KbProbe enabled />);
      expect(screen.getByTestId("kb").textContent).toBe("off");
      vv._h = window.innerHeight - 250;
      act(() => fireResize());
      expect(screen.getByTestId("kb").textContent).toBe("on");
      vv._h = window.innerHeight;
      act(() => fireResize());
      expect(screen.getByTestId("kb").textContent).toBe("off");
    } finally {
      vvClean();
    }
  });

  it("小幅缩水（<120px）不算弹键盘", () => {
    const { vv, fireResize, cleanup: vvClean } = installVv();
    try {
      render(<KbProbe enabled />);
      vv._h = window.innerHeight - 60;
      act(() => fireResize());
      expect(screen.getByTestId("kb").textContent).toBe("off");
    } finally {
      vvClean();
    }
  });
});

/* ============ M438 ProblemsDrawer hideOnKeyboard ============ */

const noTr = (key: string, fallback: string) => fallback;

function Drawer({ onOpenChange, hideOnKeyboard }: { onOpenChange?: (o: boolean) => void; hideOnKeyboard?: boolean }) {
  return (
    <ProblemsDrawer
      problems={[]}
      onGotoLine={() => {}}
      tr={noTr}
      onOpenChange={onOpenChange}
      hideOnKeyboard={hideOnKeyboard}
    />
  );
}

function openDrawer() {
  const bar = document.querySelector('.axv-drawer [role="button"]') as HTMLElement;
  fireEvent.click(bar);
}

function isDrawerOpen() {
  return document.querySelector(".axv-drawer")?.classList.contains("axv-drawer-open") ?? false;
}

describe("M438 ProblemsDrawer hideOnKeyboard（键盘弹起 → 抽屉收起）", () => {
  it("hideOnKeyboard=false：抽屉照常可开", () => {
    render(<Drawer hideOnKeyboard={false} />);
    openDrawer();
    expect(isDrawerOpen()).toBe(true);
  });

  it("hideOnKeyboard=true → 抽屉自动收起 + 通知父组件", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(<Drawer hideOnKeyboard={false} onOpenChange={onOpenChange} />);
    openDrawer();
    expect(isDrawerOpen()).toBe(true);
    rerender(<Drawer hideOnKeyboard onOpenChange={onOpenChange} />);
    expect(isDrawerOpen()).toBe(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("收起后仍可手动重新打开（只收不锁）", () => {
    const { rerender } = render(<Drawer hideOnKeyboard={false} />);
    openDrawer();
    rerender(<Drawer hideOnKeyboard />);
    expect(isDrawerOpen()).toBe(false);
    openDrawer();
    expect(isDrawerOpen()).toBe(true);
  });

  it("键盘收起（hideOnKeyboard 回 false）不会自动打开抽屉", () => {
    const { rerender } = render(<Drawer hideOnKeyboard={false} />);
    openDrawer();
    rerender(<Drawer hideOnKeyboard />);
    expect(isDrawerOpen()).toBe(false);
    rerender(<Drawer hideOnKeyboard={false} />);
    expect(isDrawerOpen()).toBe(false); // 只收不展开
  });
});
