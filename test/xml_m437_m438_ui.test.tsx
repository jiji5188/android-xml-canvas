// @vitest-environment jsdom
// M437：代码编辑器长按菜单「点外面关闭」—— 通用钩子 useOutsidePointerdown 单测
// M438：日志/问题抽屉在 APK（软键盘弹出）时自动收起 —— ProblemsDrawer + collapseOnKeyboard
//
// 用户需求原话（2026-11-20）：
//   "如果用户不选择菜单项时点击菜单面板外围（如代码编辑器任意位置）可以销毁弹窗，不影响输入"
//   "代码编辑器下方的日志输出抽屉在 APK 版本中弹出输入法时自动收起抽屉"

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { useOutsidePointerdown } from "@/components/use-outside-pointerdown";
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

/* ============ M438 ProblemsDrawer collapseOnKeyboard ============ */

const noTr = (key: string, fallback: string) => fallback;

function Drawer({ onOpenChange, collapseOnKeyboard }: { onOpenChange?: (o: boolean) => void; collapseOnKeyboard?: boolean }) {
  return (
    <ProblemsDrawer
      problems={[]}
      onGotoLine={() => {}}
      tr={noTr}
      onOpenChange={onOpenChange}
      collapseOnKeyboard={collapseOnKeyboard}
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

describe("M438 抽屉软键盘自动收起（APK）", () => {
  it("collapseOnKeyboard=false（web）：focusin 不收起", () => {
    render(<Drawer collapseOnKeyboard={false} />);
    openDrawer();
    expect(isDrawerOpen()).toBe(true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();
    expect(isDrawerOpen()).toBe(true);
    input.remove();
  });

  it("collapseOnKeyboard=true：输入框 focusin（模拟弹键盘）→ 抽屉自动收起 + 通知父组件", () => {
    const onOpenChange = vi.fn();
    render(<Drawer collapseOnKeyboard onOpenChange={onOpenChange} />);
    openDrawer();
    expect(isDrawerOpen()).toBe(true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.focusIn(input);
    expect(isDrawerOpen()).toBe(false);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    input.remove();
  });

  it("contenteditable（CodeMirror）focusin 也收起", () => {
    render(<Drawer collapseOnKeyboard />);
    openDrawer();
    const cm = document.createElement("div");
    // 用 "true"（jsdom 对 "plaintext-only" 这种新值不识别，isContentEditable 会返 false）
    cm.setAttribute("contenteditable", "true");
    document.body.appendChild(cm);
    act(() => { fireEvent.focusIn(cm); });
    expect(isDrawerOpen()).toBe(false);
    cm.remove();
  });

  it("点普通按钮 focusin 不收起（不是输入控件）", () => {
    render(<Drawer collapseOnKeyboard />);
    openDrawer();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    fireEvent.focusIn(btn);
    expect(isDrawerOpen()).toBe(true);
    btn.remove();
  });

  it("收起后仍可用把手重新打开（只收不锁）", () => {
    render(<Drawer collapseOnKeyboard />);
    openDrawer();
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.focusIn(input);
    expect(isDrawerOpen()).toBe(false);
    input.remove();
    openDrawer();
    expect(isDrawerOpen()).toBe(true);
  });
});

/* ============ M438 visualViewport 路径（键盘弹起 adjustResize）============ */

describe("M438b visualViewport 缩水收起（键盘弹起，adjustResize 模式）", () => {
  function installVv() {
    type Vv = {
      _h: number;
      _ls: Array<() => void>;
      height: number;
      addEventListener: (t: string, fn: () => void) => void;
      removeEventListener: (t: string, fn: () => void) => void;
    };
    const vv: Vv = {
      _h: window.innerHeight,
      _ls: [],
      get height() {
        return this._h;
      },
      addEventListener(_t: string, fn: () => void) {
        this._ls.push(fn);
      },
      removeEventListener(_t: string, fn: () => void) {
        const i = this._ls.indexOf(fn);
        if (i >= 0) this._ls.splice(i, 1);
      },
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    return vv;
  }

  it("vv.height 比 innerHeight 小 ≥120 → 收起；键盘收起（vv 恢复）不自动打开", () => {
    const vv = installVv();
    try {
      render(<Drawer collapseOnKeyboard />);
      openDrawer();
      expect(isDrawerOpen()).toBe(true);
      // 键盘弹起：vv.height 缩小 200（act 包裹：state 更新同步刷 DOM）
      vv._h = window.innerHeight - 200;
      act(() => { vv._ls.forEach((fn) => fn()); });
      expect(isDrawerOpen()).toBe(false);
      // 键盘收起：vv.height 恢复 → 不应该自动重新打开（只收不展开）
      vv._h = window.innerHeight;
      act(() => { vv._ls.forEach((fn) => fn()); });
      expect(isDrawerOpen()).toBe(false);
      // 手动重开仍可用
      openDrawer();
      expect(isDrawerOpen()).toBe(true);
    } finally {
      delete (window as unknown as Record<string, unknown>).visualViewport;
    }
  });

  it("vv 缩水 <120px（普通横滚条等小幅变化）不收起", () => {
    const vv = installVv();
    try {
      render(<Drawer collapseOnKeyboard />);
      openDrawer();
      vv._h = window.innerHeight - 60;
      act(() => { vv._ls.forEach((fn) => fn()); });
      expect(isDrawerOpen()).toBe(true);
    } finally {
      delete (window as unknown as Record<string, unknown>).visualViewport;
    }
  });
});
