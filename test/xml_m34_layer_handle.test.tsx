// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { LayerTree } from "@/components/LayerTree";
import type { XmlNode } from "@/lib/xml/types";

/** 构造一棵最小树：#0 → #1(LinearLayout 容器，含 #1/0) + #2(TextView) */
function makeRoot(): XmlNode {
  const mk = (tag: string, path: string, children: XmlNode[] = []): XmlNode =>
    ({ tag, attrs: {}, children, path } as unknown as XmlNode);
  const leaf = mk("TextView", "#1/0");
  const box = mk("LinearLayout", "#1", [leaf]);
  const t2 = mk("TextView", "#2");
  return mk("android", "#0", [box, t2]);
}

function firePointer(el: Element, type: string, x: number, y: number) {
  // jsdom 没有 PointerEvent，用 Event + 自定义属性兜底：
  // LayerTree 内部只读 ev.clientX/clientY/pointerId/pointerType/button，不依赖具体类
  const base = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(base, {
    clientX: { value: x, configurable: true },
    clientY: { value: y, configurable: true },
    pointerId: { value: 1, configurable: true },
    pointerType: { value: "mouse", configurable: true },
    button: { value: 0, configurable: true },
  });
  el.dispatchEvent(base);
}

const windowEl = window as unknown as Element;

/** jsdom 里所有 getBoundingClientRect 都是 0，拖拽依赖真实坐标 → 按行号虚拟出 32px 高的行 */
function stubRows(host: HTMLElement) {
  const rows = Array.from(host.querySelectorAll(".axv-lt-row")) as HTMLElement[];
  rows.forEach((el, i) => {
    const top = i * 32;
    el.getBoundingClientRect = () =>
      ({ top, left: 0, width: 300, height: 32, bottom: top + 32, right: 300, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  });
  // jsdom 没有 elementsFromPoint：返回命中行（LayerTree 用它做落点命中测试）
  (document as unknown as { elementsFromPoint: (x: number, y: number) => Element[] }).elementsFromPoint = (
    _x: number,
    y: number,
  ) => rows.filter((el) => {
    const r = el.getBoundingClientRect();
    return y >= r.top && y <= r.bottom;
  });
  return rows;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("M34 图层树拖拽手柄", () => {
  it("↑↓按钮已移除，手柄存在（每非根行一个）", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <LayerTree
        root={makeRoot()}
        selectedPath=""
        onSelect={() => {}}
        onMove={() => {}}
        onRemove={() => {}}
        onDragMove={() => {}}
      />,
    );
    await tick();
    expect(host.querySelector("button[aria-label='上移']")).toBeNull();
    expect(host.querySelector("button[aria-label='下移']")).toBeNull();
    expect(host.querySelectorAll("button.axv-lt-handle").length).toBe(3);
    document.body.removeChild(host);
  });

  it("在手柄上按下并移到 #1 上 1/4 → onDragMove('#2', {path:'#1', zone:'before'})", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onDragMove = vi.fn();
    const root = createRoot(host);
    root.render(
      <LayerTree
        root={makeRoot()}
        selectedPath=""
        onSelect={() => {}}
        onMove={() => {}}
        onRemove={() => {}}
        onDragMove={onDragMove}
      />,
    );
    await tick();
    const rows = stubRows(host);
    const row2 = rows.find((r) => r.dataset.path === "#2")!;
    const row1 = rows.find((r) => r.dataset.path === "#1")!;
    const handle = row2.querySelector(".axv-lt-handle") as HTMLElement;
    const r2 = row2.getBoundingClientRect();
    const r1 = row1.getBoundingClientRect();

    firePointer(handle, "pointerdown", r2.left + 40, r2.top + r2.height / 2);
    // mouse 模式：位移 > DRAG_SLOP(8px) 即拖拽（#2 在 #1 下方，向上移）
    firePointer(windowEl, "pointermove", r2.left + 40, r1.top + r1.height * 0.1);
    firePointer(windowEl, "pointerup", r2.left + 40, r1.top + r1.height * 0.1);
    await tick();

    expect(onDragMove).toHaveBeenCalledTimes(1);
    const [from, target] = onDragMove.mock.calls[0] as [string, { path: string; zone: string }];
    expect(from).toBe("#2");
    expect(target.path).toBe("#1");
    expect(target.zone).toBe("before");
    document.body.removeChild(host);
  });

  it("点手柄不触发选中", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const onSelect = vi.fn();
    const root = createRoot(host);
    root.render(
      <LayerTree
        root={makeRoot()}
        selectedPath=""
        onSelect={onSelect}
        onMove={() => {}}
        onRemove={() => {}}
        onDragMove={() => {}}
      />,
    );
    await tick();
    const row2 = host.querySelector('.axv-lt-row[data-path="#2"]') as HTMLElement;
    const handle = row2.querySelector(".axv-lt-handle") as HTMLElement;
    handle.click();
    await tick();
    expect(onSelect).not.toHaveBeenCalled();
    document.body.removeChild(host);
  });
});
