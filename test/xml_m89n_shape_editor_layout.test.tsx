// @vitest-environment jsdom
// M89n：形状编辑器改用图标编辑器的 UI 布局（顶栏 / 左工具条+画布 / 右侧参数栏 / 底部抽屉 / 底栏保存）
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

describe("M89n 形状编辑器 = 图标编辑器的布局骨架", () => {
  it("顶栏 + 左工具条 + 画布 + 右参数栏（可滑出）+ 底部抽屉", async () => {
    await mount(shape());
    expect(document.querySelector(".axv-icon-page.axv-cv-page")).not.toBeNull();
    expect(document.querySelector(".axv-shape-head .axv-icon-back")).not.toBeNull();
    expect(document.querySelector(".axv-cv-left .axv-cv-tools")).not.toBeNull();
    expect(document.querySelector(".axv-cv-stage .axv-dp-box")).not.toBeNull();
    expect(document.querySelector(".axv-cv-form-toggle")).not.toBeNull();
    expect(document.querySelector(".axv-cv-form")).not.toBeNull();
    expect(document.querySelector(".axv-cv-sheet")).not.toBeNull();
    expect(document.querySelector(".axv-icon-page-foot .axv-btn-primary")).not.toBeNull();
  });

  it("工具条 = 4 种形状（含环形）+ 涟漪 + 阴影（6 个按钮）", async () => {
    await mount(shape());
    expect(document.querySelectorAll(".axv-cv-tool").length).toBe(6);
  });

  it("底部抽屉分四页：形状 / 填充 / 描边 / 效果", async () => {
    await mount(shape());
    const tabs = [...document.querySelectorAll(".axv-cv-sheet-tab")].map((b) => b.textContent?.trim());
    expect(tabs).toEqual(["形状", "填充", "描边", "效果", "图层"]);
  });

  it("切到椭圆 → 画布预览变圆（同一套渲染规则）", async () => {
    await mount(shape());
    const tools = [...document.querySelectorAll(".axv-cv-tool")] as HTMLElement[];
    const oval = tools.find((b) => b.getAttribute("aria-label") === "椭圆") as HTMLElement;
    oval.click();
    await flush();
    const prev = document.querySelector(".axv-cv-stage .axv-dp-layer") as HTMLElement;
    expect(prev.style.borderRadius).toBe("50%");
    expect(oval.getAttribute("aria-pressed")).toBe("true");
  });

  it("保存并应用 → 回传资源名 + 生成的 XML（oval 走 <oval>）", async () => {
    let got: { name: string; xml: string } | null = null;
    await mount(shape({ value: "@drawable/bg_card", onSave: (name, xml) => (got = { name, xml }) }));
    const tools = [...document.querySelectorAll(".axv-cv-tool")] as HTMLElement[];
    (tools.find((b) => b.getAttribute("aria-label") === "椭圆") as HTMLElement).click();
    await flush();
    (document.querySelector(".axv-icon-page-foot .axv-btn-primary") as HTMLElement).click();
    await flush();
    expect(got).not.toBeNull();
    expect(got!.name).toBe("bg_card");
    expect(got!.xml).toContain('android:shape="oval"');
  });

  it("抽屉分页切换后内容跟着换（形状页有圆角，描边页有虚线开关）", async () => {
    await mount(shape());
    const tab = (label: string) =>
      [...document.querySelectorAll(".axv-cv-sheet-tab")].find((b) => b.textContent?.trim() === label) as HTMLElement;
    tab("描边").click();
    await flush();
    expect(document.querySelector(".axv-cv-sheet-pane")?.textContent).toContain("虚线");
    tab("形状").click();
    await flush();
    expect(document.querySelector(".axv-cv-sheet-pane")?.textContent).toContain("圆角");
  });
});
