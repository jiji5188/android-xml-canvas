// @vitest-environment jsdom
// M88o：样式面板在「未选中」时编辑的是「新图形默认样式」
// 背景：面板以前无论有没有选中都会 early-return，文案却写着「改的是下一个新图形」——
// 实际改不动。现在未选中时读写 defStyle，且新建图形继承它。
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import IconCanvasEditor from "@/components/IconCanvasEditor";

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;

async function mount() {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <IconCanvasEditor name="ic_test" onClose={() => {}} onSave={() => {}} existingNames={[]} />,
  );
  await flush();
}

const pane = () => document.querySelector(".axv-cv-sheet-pane")!;
const rows = () => [...pane().querySelectorAll(".axv-icon-ed-row")].map((r) => r.textContent ?? "");
const swatches = () =>
  [...pane().querySelectorAll(".axv-cv-swatch-val")].map((b) => b.textContent ?? "");
const ranges = () => [...pane().querySelectorAll<HTMLInputElement>("input[type=range]")];

/** React 受控 range：用原生 setter + input 事件才认 */
const setRange = (el: HTMLInputElement, v: number) => {
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!;
  desc.set!.call(el, String(v));
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("M88o 新图形默认样式", () => {
  beforeEach(async () => {
    await mount();
  });

  it("未选中时标题变成「新图形默认样式」并给出说明", () => {
    const text = pane().textContent ?? "";
    expect(text).toContain("新图形默认样式");
    expect(text).toContain("下一个新图形");
  });

  it("有 填充 / 描边 / 粗细 / 不透明度 四行，粗细是滑杆", () => {
    const r = rows();
    expect(r.some((t) => t.startsWith("填充"))).toBe(true);
    expect(r.some((t) => t.startsWith("描边"))).toBe(true);
    expect(r.some((t) => t.startsWith("粗细"))).toBe(true);
    expect(r.some((t) => t.startsWith("不透明度"))).toBe(true);
    // 范围滑杆：粗细 + 不透明度
    expect(ranges().length).toBeGreaterThanOrEqual(2);
    expect(ranges()[0].max).toBe("6");
  });

  it("改滑杆只动默认样式，不给画布上已有图形上色", async () => {
    const before = swatches()[0];
    setRange(ranges()[0], 2.5);
    await flush();
    // 填充色没变、粗细读数变了
    expect(swatches()[0]).toBe(before);
    expect(pane().textContent).toContain("2.5");
  });

  it("点预设色块 = 只改默认填充色", async () => {
    const before = swatches()[0];
    const preset = pane().querySelectorAll<HTMLElement>(".axv-cv-preset");
    preset[2].click();
    await flush();
    expect(swatches()[0]).not.toBe(before);
    expect(swatches()[0]).toBe("#b3261e");
  });
});
