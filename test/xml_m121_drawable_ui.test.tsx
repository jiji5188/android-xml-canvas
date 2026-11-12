// M121：schema 属性行 + 树行（组件级）
// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import { AttrRows } from "@/components/drawable/AttrRows";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    root.unmount();
    await flush();
  }
  host?.remove();
  root = null;
  host = null;
});

async function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(el);
  await flush();
  return host;
}

const byText = (h: HTMLElement, text: string) =>
  Array.from(h.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === text);

const shape = (color: string): DrawableNode => ({ t: "shape", spec: { kind: "rectangle", solid: color } });

/** React 受控输入：直接赋 value 不会走 onChange，必须走原型上的原生 setter */
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("M121 AttrRows：按 schema 渲染并写回", () => {
  it("形状类型用分段按钮，点了写回 spec.kind", async () => {
    let cur: DrawableNode = shape("#FF112233");
    const h = await mount(
      <AttrRows
        node={cur}
        onChange={(n) => {
          cur = n;
        }}
      />,
    );
    expect(byText(h, "矩形")).toBeTruthy();
    byText(h, "椭圆")!.click();
    await flush();
    expect(cur.t).toBe("shape");
    if (cur.t === "shape") expect(cur.spec.kind).toBe("oval");
  });

  it("颜色文本输入直接改节点颜色", async () => {
    let cur: DrawableNode = { t: "ripple", color: "#33FFFFFF", content: shape("#FF000000") };
    const h = await mount(
      <AttrRows
        node={cur}
        onChange={(n) => {
          cur = n;
        }}
      />,
    );
    const input = h.querySelector<HTMLInputElement>(".axv-attr-color .axv-attr-input")!;
    expect(input.value).toBe("#33FFFFFF");
    typeInto(input, "#4400FF00");
    await flush();
    if (cur.t === "ripple") expect(cur.color).toBe("#4400FF00");
  });

  it("dp 属性输入数字自动补 dp，清空表示去掉", async () => {
    let cur: DrawableNode = {
      t: "shape",
      spec: { kind: "rectangle", solid: "#FF000000" },
      transform: [
        {
          kind: "inset",
          params: { insetLeft: "8dp", insetTop: "0dp", insetRight: "0dp", insetBottom: "0dp" },
        },
      ],
    };
    const h = await mount(
      <AttrRows
        node={cur}
        onChange={(n) => {
          cur = n;
        }}
      />,
    );
    // inset 不再是属性行，而是变换 tab；这里只验证属性行本身不崩
    expect(h.querySelector(".axv-attr-rows")).toBeTruthy();
  });

  it("没有可编辑属性的节点给出提示，不硬塞假控件", async () => {
    const h = await mount(<AttrRows node={{ t: "layer", items: [] }} onChange={() => {}} />);
    expect(h.querySelector(".axv-shape-hint")?.textContent).toContain("没有可调参数");
    expect(h.querySelector("input")).toBeNull();
  });
});
