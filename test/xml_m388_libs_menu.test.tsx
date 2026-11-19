// @vitest-environment jsdom
// M388：库面板表项次要动作改长按弹菜单
// 1) LibsItemMenu：portal 渲染、点击触发并关闭、点外关闭、Esc 关闭
// 2) useLongPress：长按 450ms 弹（带 payload）、位移>8px 取消、pointerup 取消、右键立即弹
// 3) LibsPanel 常用库 tab 冒烟：行内只有「下载」按钮，没有「存 libs / 应用到项目」内联按钮

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { LibsItemMenu, useLongPress, type LibsItemMenuState, type LibsMenuItem } from "@/components/LibsItemMenu";
import { LibsPanel } from "@/components/LibsPanel";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => cleanup());

describe("M388 LibsItemMenu", () => {
  const items: LibsMenuItem[] = [
    { key: "save", label: "存 libs", onClick: () => {} },
    { key: "del", label: "删除", danger: true, onClick: () => {} },
  ];

  it("portal 渲染出菜单项", () => {
    render(<LibsItemMenu state={{ x: 10, y: 10, items }} onClose={() => {}} />);
    expect(document.querySelector(".axv-tfm")).toBeTruthy();
    expect(screen.getByText("存 libs")).toBeTruthy();
    expect(screen.getByText("删除")).toBeTruthy();
  });

  it("点菜单项 → onClick 触发并由宿主关闭", () => {
    const onItem = vi.fn();
    function Harness() {
      const [menu, setMenu] = useState<LibsItemMenuState | null>({ x: 10, y: 10, items: [{ key: "save", label: "存 libs", onClick: onItem }] });
      return menu ? <LibsItemMenu state={menu} onClose={() => setMenu(null)} /> : null;
    }
    render(<Harness />);
    expect(document.querySelector(".axv-tfm")).toBeTruthy();
    fireEvent.click(screen.getByText("存 libs"));
    expect(onItem).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".axv-tfm")).toBeNull();
  });

  it("点外面（pointerdown）关闭", () => {
    const onClose = vi.fn();
    render(
      <LibsItemMenu
        state={{ x: 10, y: 10, items: [{ key: "save", label: "存 libs", onClick: () => {} }] }}
        onClose={onClose}
      />,
    );
    // target 必须是 Node（menu 外的元素）：派到 body
    fireEvent(document.body, new Event("pointerdown", { bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc 关闭", () => {
    const onClose = vi.fn();
    render(
      <LibsItemMenu
        state={{ x: 10, y: 10, items: [{ key: "save", label: "存 libs", onClick: () => {} }] }}
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("M388 useLongPress", () => {
  /** 测试宿主：行上绑 bindLongPress(items)，菜单状态提升到 state */
  function Harness({ items, onOpen }: { items: number[]; onOpen?: (x: number, y: number, p: number[]) => void }) {
    const bind = useLongPress<number[]>((x, y, p) => onOpen?.(x, y, p));
    return (
      <div data-testid="row" {...bind(items)}>
        row
      </div>
    );
  }

  function pressOn(row: Element, init: { pointerType?: string; button?: number } = {}) {
    const e = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.assign(e, { pointerType: init.pointerType ?? "touch", button: init.button ?? 0, clientX: 30, clientY: 40 });
    fireEvent(row, e);
  }

  it("长按 450ms → open(payload) 触发", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const { getByTestId } = render(<Harness items={[7, 8]} onOpen={onOpen} />);
    pressOn(getByTestId("row"));
    vi.advanceTimersByTime(449);
    expect(onOpen).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][2]).toEqual([7, 8]);
    vi.useRealTimers();
  });

  it("pointerup 抬起 → 取消，不弹", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const { getByTestId } = render(<Harness items={[1]} onOpen={onOpen} />);
    pressOn(getByTestId("row"));
    fireEvent(window, new Event("pointerup"));
    vi.advanceTimersByTime(600);
    expect(onOpen).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("位移 > 8px（滑动列表）→ 取消", () => {
    vi.useFakeTimers();
    const onOpen = vi.fn();
    const { getByTestId } = render(<Harness items={[1]} onOpen={onOpen} />);
    pressOn(getByTestId("row"));
    const mv = new Event("pointermove", { bubbles: true });
    Object.assign(mv, { clientX: 30, clientY: 60 });
    fireEvent(getByTestId("row"), mv);
    vi.advanceTimersByTime(600);
    expect(onOpen).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("右键（button=2）→ 立即弹", () => {
    const onOpen = vi.fn();
    const { getByTestId } = render(<Harness items={[3]} onOpen={onOpen} />);
    pressOn(getByTestId("row"), { button: 2 });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][2]).toEqual([3]);
  });

  it("M431b：长按/右键弹菜单后，随后的 click 被拦截（行上 onClick 不触发）；再点一次正常触发", () => {
    const onOpen = vi.fn();
    const onClick = vi.fn();
    function Harness2() {
      const bind = useLongPress<number[]>((x, y, p) => onOpen?.(x, y, p));
      return (
        <div data-testid="row" {...bind([1])} onClick={onClick}>
          row
        </div>
      );
    }
    const { getByTestId } = render(<Harness2 />);
    const row = getByTestId("row");
    // 右键弹菜单 → click 被吃掉
    fireEvent.contextMenu(row);
    expect(onOpen).toHaveBeenCalledTimes(1);
    fireEvent.click(row);
    expect(onClick).not.toHaveBeenCalled();
    // 再点一次（新按下）→ onClick 正常
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
    // 长按弹菜单 → click 同样被吃掉
    vi.useFakeTimers();
    pressOn(row);
    vi.advanceTimersByTime(500);
    expect(onOpen).toHaveBeenCalledTimes(2);
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("contextmenu 事件 → 弹 + preventDefault", () => {
    const onOpen = vi.fn();
    const { getByTestId } = render(<Harness items={[3]} onOpen={onOpen} />);
    const row = getByTestId("row");
    const cm = new Event("contextmenu", { bubbles: true, cancelable: true });
    fireEvent(row, cm);
    expect(cm.defaultPrevented).toBe(true);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe("M388 LibsPanel 常用库 tab", () => {
  const tr = (key: string, fallback: string) => fallback;

  it("行内只有「下载」，没有「存 libs / 应用到项目」内联按钮", () => {
    render(<LibsPanel tr={tr} />);
    // 切到常用库 tab
    fireEvent.click(screen.getByText("常用库"));
    // 目录数据来自 LIBRARY_CATALOG（静态），必有下载按钮
    const dl = screen.getAllByText("下载");
    expect(dl.length).toBeGreaterThan(0);
    // 内联次要按钮不再存在（只有长按菜单里有）
    expect(screen.queryByText("存 libs")).toBeNull();
    expect(screen.queryByText("应用到项目（maven）")).toBeNull();
  });
});
