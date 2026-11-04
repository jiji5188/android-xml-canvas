// M117：形状编辑器优化 UI（环形 + 预设 + 圆角快捷 + 撤销/重做 + 预览背景）
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ShapeEditor } from "@/components/ShapeEditor";
import { buildShapeXml, parseShapeSpec, specToCss, argbColorsForPreview, type ShapeSpec } from "@/lib/xml/shape-gen";

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement;

async function mount(extra: Record<string, unknown> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <ShapeEditor
      attrName="android:background"
      value=""
      existingNames={[]}
      onClose={() => {}}
      onSave={() => {}}
      {...extra}
    />,
  );
  await flush();
}

beforeEach(async () => {
  document.body.innerHTML = "";
});

afterEach(async () => {
  if (root) {
    root.unmount();
    root = null;
  }
  document.body.innerHTML = "";
});

describe("M117 形状编辑器 UI", () => {
  it("KINDS 里多了一个「环形」（ring），点它切到 ring 并出现环洞比例滑杆", async () => {
    await mount();

    // 先打开底部抽屉的「形状」页
    const shapeTab = Array.from(host!.querySelectorAll<HTMLButtonElement>(".axv-cv-sheet-tab")).find(
      (b) => b.textContent === "形状",
    );
    shapeTab!.click();
    await flush();

    const ringBtn = Array.from(host!.querySelectorAll<HTMLButtonElement>(".axv-shape-seg-btn")).find(
      (b) => b.textContent === "环形",
    );
    expect(ringBtn, "应存在「环形」形状选项").toBeTruthy();

    ringBtn!.click();
    await flush();

    const holeRange = host!.querySelector<HTMLInputElement>(".axv-shape-field input[type=range]");
    expect(holeRange, "切到 ring 后应有环洞比例滑杆").toBeTruthy();
    expect(host!.textContent).toContain("环洞比例");
  });

  it("预设行存在且可点击（胶囊 = rectangle + radius 999）", async () => {
    await mount();
    const shapeTabBtn = Array.from(host!.querySelectorAll<HTMLButtonElement>(".axv-cv-sheet-tab")).find(
      (b) => b.textContent === "形状",
    );
    shapeTabBtn!.click();
    await flush();

    const presetBtns = Array.from(host!.querySelectorAll<HTMLButtonElement>(".axv-shape-preset"));
    expect(presetBtns.length).toBeGreaterThanOrEqual(4);
    expect(presetBtns.map((b) => b.textContent)).toContain("胶囊");

    const capsule = presetBtns.find((b) => b.textContent === "胶囊")!;
    capsule.click();
    await flush();

    const chips = Array.from(host!.querySelectorAll<HTMLButtonElement>(".axv-shape-radius-chip"));
    expect(chips.length).toBeGreaterThan(0);
    const activeChip = chips.find((c) => c.classList.contains("is-on"));
    expect(activeChip, "点击胶囊预设后应有选中 chip").toBeTruthy();
    expect(activeChip!.textContent).toBe("胶囊");
  });

  it("顶栏有撤销/重做按钮，初始不可用；改一次后撤销可用", async () => {
    await mount();

    const undoBtn = host!.querySelector<HTMLButtonElement>(".axv-cv-head-tools button[title='撤销']");
    const redoBtn = host!.querySelector<HTMLButtonElement>(".axv-cv-head-tools button[title='重做']");
    expect(undoBtn).toBeTruthy();
    expect(redoBtn).toBeTruthy();
    expect(undoBtn!.disabled).toBe(true);
    expect(redoBtn!.disabled).toBe(true);

    const shapeTabBtn = Array.from(host!.querySelectorAll<HTMLButtonElement>(".axv-cv-sheet-tab")).find(
      (b) => b.textContent === "形状",
    );
    shapeTabBtn!.click();
    await flush();
    const presetBtns = Array.from(host!.querySelectorAll<HTMLButtonElement>(".axv-shape-preset"));
    presetBtns.find((b) => b.textContent === "圆形")!.click();
    await flush();

    expect(undoBtn!.disabled).toBe(false);
  });

  it("预览背景切换 3 档（透明格/白/深）都能点", async () => {
    await mount();
    const bgBtns = Array.from(host!.querySelectorAll<HTMLButtonElement>(".axv-shape-pv-bg-btn"));
    expect(bgBtns.length).toBe(3);
    expect(bgBtns[0].classList.contains("is-on")).toBe(true);
    bgBtns[2].click();
    await flush();
    expect(bgBtns[2].classList.contains("is-on")).toBe(true);
  });

  it("buildShapeXml + parseShapeSpec 双向：ring 资源名带洞比例后缀", () => {
    const spec: ShapeSpec = { kind: "ring", solid: "#FF00FF00", ringHole: 0.5 };
    const xml = buildShapeXml(spec);
    const back = parseShapeSpec(xml)!;
    expect(back.kind).toBe("ring");
    expect(back.ringHole).toBeCloseTo(0.5, 1);
    expect(back.solid).toBe("#FF00FF00");
  });

  it("specToCss：ring + 透明洞用 radial-gradient，洞比例随 ringHole 变", () => {
    const css40 = specToCss(argbColorsForPreview({ kind: "ring", solid: "#FF123456", ringHole: 0.4 }));
    const css80 = specToCss(argbColorsForPreview({ kind: "ring", solid: "#FF123456", ringHole: 0.8 }));
    expect(css40.background).toContain("radial-gradient(ellipse farthest-side");
    expect(css40.background).toMatch(/40%/);
    expect(css80.background).toMatch(/80%/);
  });
});
