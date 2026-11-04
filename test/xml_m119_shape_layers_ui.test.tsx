// M119：形状编辑器「图层」抽屉（加层 / 排序 / 删除 / 改某一层 / 边距）
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ShapeEditor } from "@/components/ShapeEditor";
import { parseShapeSpec } from "@/lib/xml/shape-gen";

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement;
let saved: { name: string; xml: string } | null = null;

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
      onSave={(name: string, xml: string) => {
        saved = { name, xml };
      }}
      {...extra}
    />,
  );
  await flush();
}

const btn = (text: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === text);
const sheetTab = async (label: string) => {
  const t = Array.from(host.querySelectorAll<HTMLButtonElement>(".axv-cv-sheet-tab")).find(
    (b) => b.textContent === label,
  );
  t!.click();
  await flush();
};
const rows = () => Array.from(host.querySelectorAll(".axv-layer-row"));
const saveAndParse = async () => {
  saved = null;
  btn("保存并应用")!.click();
  await flush();
  expect(saved, "保存应回传 XML").toBeTruthy();
  return { xml: saved!.xml, spec: parseShapeSpec(saved!.xml) };
};

beforeEach(() => {
  document.body.innerHTML = "";
  saved = null;
});

afterEach(() => {
  if (root) {
    root.unmount();
    root = null;
  }
  document.body.innerHTML = "";
});

describe("M119 形状编辑器图层", () => {
  it("抽屉里有「图层」页；加一层后保存输出 layer-list", async () => {
    await mount();
    await sheetTab("图层");
    expect(rows().length).toBe(0);

    btn("添加一层")!.click();
    await flush();
    expect(rows().length).toBe(1);

    const { xml, spec } = await saveAndParse();
    expect(xml).toContain("<layer-list");
    expect(xml.match(/<item/g)?.length).toBe(1);
    expect(spec?.layers?.length).toBe(1);
  });

  it("加两层后能选中某层编辑（只改那一层）", async () => {
    await mount();
    await sheetTab("图层");
    btn("添加一层")!.click();
    await flush();
    btn("再加一层")!.click();
    await flush();
    expect(rows().length).toBe(2);

    // 列表是反向显示的：第一行 = 最顶层（索引 1）；新加的层已经自动选中，不要再点（点了会取消选中）
    expect(host.querySelector(".axv-layer-target")?.textContent).toContain("2");

    // 改形状为椭圆 —— 只作用于选中的那一层
    await sheetTab("形状");
    const ovalBtn = Array.from(host.querySelectorAll<HTMLButtonElement>(".axv-shape-seg-btn")).find(
      (b) => b.textContent === "椭圆",
    );
    ovalBtn!.click();
    await flush();

    const { spec } = await saveAndParse();
    expect(spec?.layers?.length).toBe(2);
    expect(spec?.layers?.[1].spec.kind).toBe("oval");
    expect(spec?.layers?.[0].spec.kind).toBe("rectangle");
  });

  it("上移 / 下移改变层的叠放顺序", async () => {
    await mount();
    await sheetTab("图层");
    btn("添加一层")!.click();
    await flush();
    // 第一层加完就处于选中态，直接改形状即可
    await sheetTab("形状");
    Array.from(host.querySelectorAll<HTMLButtonElement>(".axv-shape-seg-btn"))
      .find((b) => b.textContent === "椭圆")!
      .click();
    await flush();
    await sheetTab("图层");
    btn("再加一层")!.click();
    await flush();
    // 新层复制上一层（也是 oval），把它改回矩形，这样两层可辨认
    await sheetTab("形状");
    Array.from(host.querySelectorAll<HTMLButtonElement>(".axv-shape-seg-btn"))
      .find((b) => b.textContent === "矩形")!
      .click();
    await flush();
    await sheetTab("图层");

    // 现在底层是 oval(0)，上层是 rectangle(1)；把 oval 上移
    const bottomRow = rows()[1];
    (bottomRow.querySelector('button[title="上移一层"]') as HTMLButtonElement).click();
    await flush();

    const { spec } = await saveAndParse();
    expect(spec?.layers?.length).toBe(2);
    expect(spec?.layers?.[0].spec.kind).toBe("rectangle");
    expect(spec?.layers?.[1].spec.kind).toBe("oval");
  });

  it("删除这层后回到单层；删光后不再输出 layer-list", async () => {
    await mount();
    await sheetTab("图层");
    btn("添加一层")!.click();
    await flush();
    btn("再加一层")!.click();
    await flush();

    (rows()[0].querySelector('button[title="删除这层"]') as HTMLButtonElement).click();
    await flush();
    expect(rows().length).toBe(1);

    (rows()[0].querySelector('button[title="删除这层"]') as HTMLButtonElement).click();
    await flush();
    expect(rows().length).toBe(0);

    const { xml, spec } = await saveAndParse();
    expect(xml).not.toContain("<layer-list");
    expect(spec?.layers).toBeUndefined();
  });

  it("选中层后可设边距，写进 item 属性", async () => {
    await mount();
    await sheetTab("图层");
    btn("添加一层")!.click();
    await flush();
    expect(host.querySelector(".axv-layer-target")).toBeTruthy();

    const numInputs = Array.from(host.querySelectorAll<HTMLInputElement>(".axv-shape-corners input"));
    expect(numInputs.length).toBe(4); // 左 / 上 / 右 / 下
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(numInputs[0], "8");
    numInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const { xml } = await saveAndParse();
    expect(xml).toContain('android:left="8dp"');
  });
});
