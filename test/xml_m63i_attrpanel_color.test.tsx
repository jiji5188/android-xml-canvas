// @vitest-environment jsdom
// M63i：右侧属性面板里颜色属性（如 textColor）的取色块 → 自定义 HSV 取色器（ColorField）
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { AttrPanel } from "@/components/AttrPanel";
import type { ResolvedNode } from "@/lib/xml/types";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

const node = (attrs: Record<string, string>) =>
  ({
    tag: "TextView",
    attrs,
    rawAttrs: attrs,
    path: "0",
    bounds: { x: 0, y: 0, w: 100, h: 40 },
    children: [],
    text: "hello",
    resolved: {},
  }) as unknown as ResolvedNode;

async function mount(textColor: string) {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <AttrPanel
      node={node({ "android:textColor": textColor })}
      onCommit={() => {}}
      onRemove={() => {}}
      onAddAttr={() => {}}
    />,
  );
  await flush();
  return root;
}

describe("M63i 属性面板颜色选择器", () => {
  it("hex 颜色属性不再用原生 input[type=color]，而是 .axv-cf-swatch", async () => {
    const root = await mount("#FF5722");
    expect(document.querySelector('.axv-attr-color input[type="color"]')).toBeNull();
    expect(document.querySelector(".axv-attr-color .axv-cf-swatch")).not.toBeNull();
    root.unmount();
  });

  it("点色块 → 打开 HSV 面板（蒙版居中）", async () => {
    const root = await mount("#FF5722");
    const sw = document.querySelector(".axv-attr-color .axv-cf-swatch") as HTMLElement;
    sw.click();
    await flush();
    expect(document.querySelector(".axv-cp-mask .axv-cp")).not.toBeNull();
    root.unmount();
  });

  it("带 alpha 的 #AARRGGBB 也能正确回显（色块不透明）", async () => {
    const root = await mount("#80FF0000");
    const sw = document.querySelector(".axv-attr-color .axv-cf-swatch") as HTMLElement;
    expect(sw).not.toBeNull();
    // 内部叠色层带上 rgba
    expect(sw.innerHTML.toLowerCase()).toContain("rgba(255");
    root.unmount();
  });
});
