// @vitest-environment jsdom
// M83：底部样式抽屉（移植 svg-board 的 sheet）+ 4 个 tab 子页
// 断言：① 抽屉存在且默认展开；② 4 个 tab（样式/排列/图层/画布）都在；③ 切换 tab 只显示对应面板；
// ④ 折叠后再点标题能展开；⑤ 点 tab 不会连带折叠抽屉。
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
  root.render(<IconCanvasEditor name="ic_test" onClose={() => {}} onSave={() => {}} existingNames={[]} />);
  await flush();
}

const tab = (label: string) =>
  [...document.querySelectorAll<HTMLElement>(".axv-cv-sheet-tab")].find(
    (b) => b.textContent?.trim() === label,
  ) ?? null;

const sheetBody = () => document.querySelector(".axv-cv-sheet-body")!.textContent ?? "";

describe("M83 底部样式抽屉", () => {
  beforeEach(async () => {
    await mount();
  });

  it("抽屉默认展开，六个 tab 齐全", () => {
    const sheet = document.querySelector(".axv-cv-sheet");
    expect(sheet).not.toBeNull();
    expect(sheet!.classList.contains("is-collapsed")).toBe(false);
    expect([...document.querySelectorAll(".axv-cv-sheet-tab")].map((b) => b.textContent?.trim())).toEqual([
      "样式",
      "属性",
      "排列",
      "图层",
      "资源",
      "画布",
    ]);
  });

  it("默认在「样式」页：有填充/描边/不透明度，没有图层列表", () => {
    expect(document.querySelector(".axv-cv-sheet-pane")).not.toBeNull();
    const text = sheetBody();
    expect(text).toContain("填充");
    expect(text).toContain("描边");
    expect(text).toContain("不透明度");
    expect(document.querySelector(".axv-cv-layers")).toBeNull();
  });

  it("切到「图层」页 → 出现图层列表，样式参数让位", async () => {
    tab("图层")!.click();
    await flush();
    expect(document.querySelector(".axv-cv-layers")).not.toBeNull();
    expect(tab("图层")!.classList.contains("on")).toBe(true);
    expect(sheetBody()).toContain("图形（0）");
  });

  it("切到「画布」页 → 出现背景色行", async () => {
    tab("画布")!.click();
    await flush();
    const text = sheetBody();
    expect(text).toContain("背景");
    expect(text).toContain("透明");
  });

  it("切到「排列」页：没选中时给出提示，且无对齐按钮", async () => {
    tab("排列")!.click();
    await flush();
    expect(sheetBody()).toContain("先在画布上框选");
    expect(document.querySelectorAll(".axv-cv-align-btn").length).toBe(0);
  });

  it("点标题折叠，再点展开", async () => {
    const head = document.querySelector<HTMLElement>(".axv-cv-sheet-head")!;
    head.click();
    await flush();
    expect(document.querySelector(".axv-cv-sheet")!.classList.contains("is-collapsed")).toBe(true);
    head.click();
    await flush();
    expect(document.querySelector(".axv-cv-sheet")!.classList.contains("is-collapsed")).toBe(false);
  });

  it("点 tab 不会把抽屉折叠（标题区的 onClick 已隔离）", async () => {
    tab("图层")!.click();
    await flush();
    expect(document.querySelector(".axv-cv-sheet")!.classList.contains("is-collapsed")).toBe(false);
  });
});
