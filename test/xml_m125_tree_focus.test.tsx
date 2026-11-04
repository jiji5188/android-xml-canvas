// M125：结构树默认折叠 + 预览只看选中层
// @vitest-environment jsdom
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DrawableTree } from "@/components/drawable/DrawableTree";
import { parseDrawable, type DrawableNode } from "@/lib/xml/drawable-node";
import { focusDoc } from "@/lib/xml/drawable-focus";
import type { Path } from "@/lib/xml/drawable-edit";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

const DEEP = `<ripple xmlns:android="http://schemas.android.com/apk/res/android" android:color="#33FFFFFF">
  <item>
    <layer-list>
      <item><shape android:shape="oval"><solid android:color="#FFE5E7EB"/></shape></item>
      <item android:left="4dp"><shape android:shape="oval"><solid android:color="#FFFFFFFF"/></shape></item>
    </layer-list>
  </item>
</ripple>`;

async function mount(xml: string) {
  const state: { root: DrawableNode; path: Path } = { root: parseDrawable(xml)!, path: [] };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const render = () =>
    root!.render(
      React.createElement(DrawableTree, {
        root: state.root,
        path: state.path,
        onSelect: (p: Path) => {
          state.path = p;
          render();
        },
        onChange: (n: DrawableNode) => {
          state.root = n;
          render();
        },
      }),
    );
  render();
  await flush();
  await flush();
  return state;
}

const rows = () => [...host!.querySelectorAll(".axv-dt-row")] as HTMLElement[];

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
});

describe("M125 默认折叠", () => {
  it("默认只展开顶层：根 + 它的直接子项，孙子不出现", async () => {
    await mount(DEEP);
    const texts = rows().map((r) => r.textContent ?? "");
    expect(texts.length).toBe(2); // ripple 根 + 内容(layer)
    expect(texts[1]).toContain("图层叠加");
    // layer 里的两个 shape 还没展开
    expect(texts.join("|")).not.toContain("形状 · 椭圆");
  });

  it("手动展开一层才看到下一层，且行距按 8 递增", async () => {
    await mount(DEEP);
    rows()[1].querySelector<HTMLButtonElement>(".axv-dt-chev")!.click();
    await flush();
    const list = rows();
    expect(list.length).toBe(4);
    const pads = list.map((r) => parseInt(r.style.paddingLeft || "0", 10));
    // 8dp 一档：根 8、内容 16、两个形状 24
    expect(pads).toEqual([8, 16, 24, 24]);
  });
});

describe("M125 只看选中层", () => {
  const LAYERED = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><shape><solid android:color="#FF111111"/></shape></item>
    <item android:left="6dp" android:alpha="0.5"><shape><solid android:color="#FF222222"/></shape></item>
  </layer-list>`;

  it("选中第 2 层时只保留这一层，偏移和不透明度带过来", () => {
    const doc = parseDrawable(LAYERED)!;
    const one = focusDoc(doc, [1]);
    expect(one.t).toBe("layer");
    if (one.t !== "layer") throw new Error("not layer");
    expect(one.items.length).toBe(1);
    expect(one.items[0].offset?.l).toBe(6);
    expect(one.items[0].alpha).toBe(0.5);
    expect(one.items[0].node.t).toBe("shape");
  });

  it("选中根就是原树（不复制、不丢东西）", () => {
    const doc = parseDrawable(LAYERED)!;
    expect(focusDoc(doc, [])).toBe(doc);
  });

  it("selector 的子项也能单独看", () => {
    const sel = parseDrawable(`<selector xmlns:android="http://schemas.android.com/apk/res/android">
      <item android:state_pressed="true"><color android:color="#FF0000FF"/></item>
      <item><color android:color="#FFFFFFFF"/></item>
    </selector>`)!;
    const one = focusDoc(sel, [0]);
    expect(one.t).toBe("selector");
    if (one.t !== "selector") throw new Error("not selector");
    expect(one.items.length).toBe(1);
    expect(one.items[0].node.t).toBe("color");
  });
});
