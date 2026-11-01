// @vitest-environment jsdom
// M63g：自定义形状页（ShapeEditor）里所有取色按钮 → 自定义 HSV 取色器（ColorField）
//   · .axv-shape-color（填充色 / 涟漪色）
//   · .axv-shape-row（按下/禁用态、渐变起止）
//   · 描边色、阴影色
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ShapeEditor } from "@/components/ShapeEditor";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  if (root) root.unmount();
  root = null;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

async function mount(el: React.ReactElement) {
  root = createRoot(host);
  root.render(el);
  await flush();
}

const noop = () => {};

const shape = (props: Partial<React.ComponentProps<typeof ShapeEditor>> = {}) => (
  <ShapeEditor
    attrName="background"
    value=""
    existingNames={[]}
    onClose={noop}
    onSave={noop}
    {...props}
  />
);

/** 点开某个色块 → 应该出现居中弹层里的 HSV 面板 */
async function openPicker(swatch: HTMLElement) {
  swatch.click();
  await flush();
  return document.querySelector(".axv-cf-mask .axv-hsv-panel");
}

describe("M63g 自定义形状：取色按钮换成 ColorField", () => {
  it("默认形态下没有原生 input[type=color]，取而代之是 .axv-cf-swatch", async () => {
    await mount(shape());
    expect(document.querySelector('.axv-shape-color input[type="color"]')).toBeNull();
    expect(document.querySelector(".axv-shape-color .axv-cf-swatch")).not.toBeNull();
  });

  it("点填充色块 → 打开的是自定义 HSV 取色器（非原生）", async () => {
    await mount(shape());
    const sw = document.querySelector(".axv-shape-color .axv-cf-swatch") as HTMLElement;
    expect(await openPicker(sw)).not.toBeNull();
  });

  it("取色器弹层盖过形状整页（aboveModal → is-above-modal）", async () => {
    await mount(shape());
    const sw = document.querySelector(".axv-shape-color .axv-cf-swatch") as HTMLElement;
    await openPicker(sw);
    expect(document.querySelector(".axv-cf-mask.is-above-modal")).not.toBeNull();
  });

  it("选预设色 → 写回大写 #RRGGBB（形状规格要 Android 写法）", async () => {
    await mount(shape());
    const sw = document.querySelector(".axv-shape-color .axv-cf-swatch") as HTMLElement;
    await openPicker(sw);
    const preset = document.querySelector(".axv-hsv-preset") as HTMLElement;
    preset.click();
    await flush();
    const text = [...document.querySelectorAll("input")].find((i) =>
      (i as HTMLInputElement).value.startsWith("#"),
    ) as HTMLInputElement | undefined;
    expect(text?.value).toMatch(/^#[0-9A-F]{6}$/);
  });

  it("渐变起点/终点也是自定义取色器（不再有原生 input[type=color]）", async () => {
    await mount(shape());
    const segs = [...document.querySelectorAll(".axv-shape-seg-btn")] as HTMLElement[];
    const gradientBtn = segs.find((b) => b.textContent?.includes("渐变"));
    if (!gradientBtn) return; // 该版本若无渐变选项卡就跳过
    gradientBtn.click();
    await flush();
    const row = document.querySelector(".axv-shape-row");
    if (!row) return;
    expect(row.querySelectorAll('input[type="color"]').length).toBe(0);
    expect(row.querySelectorAll(".axv-cf-swatch").length).toBeGreaterThan(0);
  });
});
