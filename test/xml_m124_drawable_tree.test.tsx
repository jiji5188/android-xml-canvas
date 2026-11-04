// @vitest-environment jsdom

// M124：结构树（和左侧图层面板同一套树形展示）
// 测四件事：整棵树一眼可见（不是只有当前层）、折叠、加组件走 schema、删除/上下移真的改树。
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DrawableTree } from "@/components/drawable/DrawableTree";
import { parseDrawable, type DrawableNode } from "@/lib/xml/drawable-node";
import type { Path } from "@/lib/xml/drawable-edit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const SELECTOR = `<selector xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:state_pressed="true">
    <shape android:shape="rectangle"><solid android:color="#FF1D4ED8"/><corners android:radius="8dp"/></shape>
  </item>
  <item>
    <shape android:shape="rectangle"><solid android:color="#FF3B82F6"/><corners android:radius="8dp"/></shape>
  </item>
</selector>`;

const NESTED = `<ripple xmlns:android="http://schemas.android.com/apk/res/android" android:color="#33FFFFFF">
  <item>
    <layer-list>
      <item><shape android:shape="oval"><solid android:color="#FFE5E7EB"/></shape></item>
      <item><shape android:shape="oval"><solid android:color="#FFFFFFFF"/></shape></item>
    </layer-list>
  </item>
</ripple>`;

async function mount(xml: string, path: Path = []) {
  const state: { root: DrawableNode; path: Path } = { root: parseDrawable(xml)!, path };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  const render = () => {
    root!.render(
      React.createElement(DrawableTree, {
        root: state.root,
        path: state.path,
        onSelect: (p: Path) => {
          state.path = p;
          render();
        },
        onChange: (next: DrawableNode) => {
          state.root = next;
          render();
        },
      }),
    );
  };
  render();
  await flush();
  await flush();
  return state;
}

const rows = () => [...host!.querySelectorAll(".axv-dt-row")] as HTMLElement[];
const rowText = () => rows().map((r) => r.textContent?.trim() ?? "");
const byTitle = (title: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.getAttribute("title") === title);

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

describe("M124 结构树", () => {
  it("整棵树一次显示：根 + 每个状态 + 状态里的形状", async () => {
    await mount(SELECTOR);
    const texts = rowText();
    expect(texts[0]).toContain("状态选择");
    expect(texts.join("|")).toContain("按下");
    expect(texts.join("|")).toContain("兜底");
    // 深一层的 shape 也在（不是只有当前层）
    expect(texts.filter((t) => t.includes("形状 · 矩形")).length).toBe(2);
    // 每层一格：根 + 2 个状态（状态里就是那个 shape，不再多一行）
    expect(rows().length).toBe(3); // 根 + 2 状态
  });

  it("嵌套容器按深度缩进，层级一眼可见", async () => {
    await mount(NESTED);
    const pads = rows().map((r) => parseInt(r.style.paddingLeft || "0", 10));
    for (let i = 1; i < pads.length; i++) expect(pads[i]).toBeGreaterThanOrEqual(pads[i - 1] - 14);
    expect(Math.max(...pads)).toBeGreaterThanOrEqual(pads[0] + 28);
    expect(rowText().join("|")).toContain("图层叠加");
  });

  it("折叠后子节点不渲染，再点回来还在", async () => {
    await mount(SELECTOR);
    const before = rows().length;
    const chev = rows()[0].querySelector<HTMLButtonElement>(".axv-dt-chev")!;
    chev.click();
    await flush();
    expect(rows().length).toBe(1);
    rows()[0].querySelector<HTMLButtonElement>(".axv-dt-chev")!.click();
    await flush();
    expect(rows().length).toBe(before);
  });

  it("加组件菜单给的是 schema 允许的类型，点了能真的加进去", async () => {
    await mount(SELECTOR);
    byTitle("加组件")[0].click();
    await flush();
    const menu = host!.querySelector(".axv-dt-add")!;
    expect(menu.textContent).toContain("形状");
    expect(menu.textContent).toContain("水波纹");
    const addBtn = [...menu.querySelectorAll<HTMLButtonElement>(".axv-dt-add-item")].find(
      (b) => b.textContent?.includes("水波纹"),
    )!;
    addBtn.click();
    await flush();
    expect(rowText().join("|")).toContain("水波纹");
    expect(host!.querySelector(".axv-dt-add")).toBeNull();
  });

  it("删除子节点只删那一个，兄弟还在", async () => {
    const state = await mount(SELECTOR);
    const before = rows().length;
    byTitle("删除")[0].click();
    await flush();
    expect(rows().length).toBe(before - 1); // 删的是那一个状态行（它的 shape 就在这行上）
    const node = state.root;
    expect(node.t).toBe("selector");
    if (node.t === "selector") expect(node.items.length).toBe(1);
  });

  it("下移真的换顺序（第一个状态排到后面）", async () => {
    const state = await mount(SELECTOR);
    byTitle("下移")[0].click();
    await flush();
    const node = state.root;
    if (node.t !== "selector") throw new Error("root not selector");
    const first = node.items[0];
    expect(first.states?.state_pressed).toBeUndefined();
    expect(node.items[1].states?.state_pressed).toBe("true");
  });

  it("选中行会带 sel 类（参数页跟着它走）", async () => {
    const state = await mount(SELECTOR);
    rows()[2].click();
    await flush();
    expect(state.path.length).toBeGreaterThan(0);
    const sel = host!.querySelector(".axv-dt-row.sel")!;
    expect(sel.getAttribute("data-path")).toBe(state.path.join("/"));
  });
});
