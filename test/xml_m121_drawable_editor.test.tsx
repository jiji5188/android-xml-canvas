// M121：DrawableEditor（结构树编辑器）+ 入口路由器
// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ShapeEditor } from "@/components/ShapeEditor";
import { DrawableEditor } from "@/components/DrawableEditor";
import { parseDrawable } from "@/lib/xml/drawable-node";

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
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

/** M124 换成结构树后：行 = .axv-dt-row，插槽名 = .axv-dt-slot-tag */
const treeRows = (h: HTMLElement) => h.querySelectorAll(".axv-dt-row").length;
const slotTags = (h: HTMLElement) =>
  Array.from(h.querySelectorAll(".axv-dt-slot-tag")).map((n) => n.textContent?.trim());
const pickRow = (h: HTMLElement, i: number) =>
  h.querySelectorAll<HTMLDivElement>(".axv-dt-row")[i]?.click();

const SELECTOR_XML = `<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_pressed="true">
        <shape android:shape="rectangle"><solid android:color="#FF0000FF"/></shape>
    </item>
    <item>
        <shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape>
    </item>
</selector>`;

const SHAPE_XML = `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FFEEEEEE"/>
    <corners android:radius="8dp"/>
</shape>`;

describe("M121 入口路由：非纯形状直接进结构树", () => {  it("selector 资源打开的是结构树编辑器，不是形状面板", async () => {
    const h = await mount(
      <ShapeEditor
        attrName="android:background"
        value="@drawable/bg_sel"
        existingXml={SELECTOR_XML}
        existingNames={["bg_sel"]}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(h.querySelector('[aria-label="drawable 编辑器"]')).toBeTruthy();
    // 根 + 2 个状态
    expect(treeRows(h)).toBe(3);
  });

  it("纯形状也进结构树编辑器（M135 淘汰旧形状面板）", async () => {
    const h = await mount(
      <ShapeEditor
        attrName="android:background"
        value="@drawable/bg"
        existingXml={SHAPE_XML}
        existingNames={["bg"]}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(h.querySelector('[aria-label="drawable 编辑器"]')).toBeTruthy();
    expect(h.querySelector('[aria-label="自定义形状"]')).toBeNull();
    // 根只有一层 shape
    expect(treeRows(h)).toBe(1);
  });
});

describe("M121 DrawableEditor：树 + 参数 + 保存", () => {
  it("结构页显示子树（内容 / 遮罩），不出现 item 字样", async () => {
    const ripple = `<ripple xmlns:android="http://schemas.android.com/apk/res/android" android:color="#33FFFFFF">
    <item><shape android:shape="oval"><solid android:color="#FF00C853"/></shape></item>
    <item android:id="@android:id/mask"><shape android:shape="oval"><solid android:color="#FFFFFFFF"/></shape></item>
</ripple>`;
    const h = await mount(
      <DrawableEditor
        attrName="android:background"
        value=""
        existingXml={ripple}
        existingNames={[]}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    const names = slotTags(h);
    expect(names).toEqual(["内容", "遮罩"]);
    // M135：XML 代码框常驻，全文会含 <item>；这里只查结构树本身不出现 item 这个词
    const treeText = [...h.querySelectorAll(".axv-dt-row")].map((r) => r.textContent).join(" ");
    expect(treeText).not.toContain("item");
  });

  it("参数页能改形状填充色，保存出来的 XML 跟着变", async () => {
    let saved: { name: string; xml: string } | null = null;
    const h = await mount(
      <DrawableEditor
        attrName="android:background"
        value="@drawable/bg"
        existingXml={SELECTOR_XML}
        existingNames={[]}
        onClose={() => {}}
        onSave={(name, xml) => {
          saved = { name, xml };
        }}
      />,
    );

    // 选中第 1 个状态项（第 0 行是根）；M131 起颜色编辑在「形状」页（参数页只剩 schema 属性）
    pickRow(h, 1);
    await flush();
    byText(h, "形状")!.click();
    await flush();

    const hex = h.querySelector<HTMLInputElement>(".axv-attr-color .axv-attr-input");
    expect(hex?.value).toBe("#FF0000FF");

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(hex, "#FF00FF00");
    hex!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    byText(h, "保存并应用")!.click();
    await flush();

    expect(saved).not.toBeNull();
    const xml = saved!.xml;
    expect(xml).toContain("<selector");
    expect(xml).toContain("#FF00FF00");
    // 存出来的东西必须还能被解析，且结构没散
    const back = parseDrawable(xml)!;
    expect(back.t).toBe("selector");
    if (back.t === "selector") expect(back.items.length).toBe(2);
  });

  it("加一层 → 撤销回到原样", async () => {
    const layer = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><shape><solid android:color="#FF111111"/></shape></item>
</layer-list>`;
    const h = await mount(
      <DrawableEditor
        attrName="android:background"
        value=""
        existingXml={layer}
        existingNames={[]}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(treeRows(h)).toBe(2); // 根 + 1 层
    // M124：加组件走「＋」菜单
    h.querySelector<HTMLButtonElement>('[title="加组件"]')!.click();
    await flush();
    const addShape = h.querySelector<HTMLButtonElement>('.axv-dt-add-item[aria-label="形状"]')!;
    addShape.click();
    await flush();
    expect(treeRows(h)).toBe(3);

    h.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!.click();
    await flush();
    expect(treeRows(h)).toBe(2);
  });

  it("结构有错时禁止保存，并给出路径提示", async () => {
    const emptyLayer = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android"></layer-list>`;
    const h = await mount(
      <DrawableEditor
        attrName="android:background"
        value=""
        existingXml={emptyLayer}
        existingNames={[]}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    expect(h.textContent).toContain("至少要有一层");
    const saveBtn = byText(h, "保存并应用")!;
    expect(saveBtn.disabled).toBe(true);
  });

  it("遮罩层不能移动（ripple 的位置有语义）", async () => {
    const ripple = `<ripple xmlns:android="http://schemas.android.com/apk/res/android" android:color="#33FFFFFF">
    <item><color android:color="#FF111111"/></item>
    <item android:id="@android:id/mask"><color android:color="#FFFFFFFF"/></item>
</ripple>`;
    const h = await mount(
      <DrawableEditor
        attrName="android:background"
        value=""
        existingXml={ripple}
        existingNames={[]}
        onClose={() => {}}
        onSave={() => {}}
      />,
    );
    const arrows = Array.from(h.querySelectorAll(".axv-dt-op")).filter(
      (b) => b.getAttribute("title") === "上移" || b.getAttribute("title") === "下移",
    );
    expect(arrows.length).toBe(0);
  });
});


const selXml = `<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_pressed="true">
        <shape android:shape="rectangle"><solid android:color="#FF0000FF"/></shape>
    </item>
    <item>
        <shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape>
    </item>
</selector>`;

const llXml = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
      <item><shape android:shape="rectangle"><solid android:color="#FF000000"/></shape></item>
      <item><shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape></item>
    </layer-list>`;

describe("M134：「这一层」面板（item 上的属性）", () => {
  it("selector：能设状态位，保存进 XML", async () => {
    let saved: { name: string; xml: string } | null = null;
    const h = await mount(
      <DrawableEditor
        attrName="android:background"
        value=""
        existingXml={selXml}
        existingNames={[]}
        onClose={() => {}}
        onSave={(name, xml) => {
          saved = { name, xml };
        }}
      />,
    );

    pickRow(h, 2);
    await flush();
    byText(h, "参数")!.click();
    await flush();

    const panel = h.querySelector(".axv-slot");
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("这个状态生效的条件");

    const rows = [...panel!.querySelectorAll(".axv-slot-state")];
    const enabledRow = rows.find((r) => r.textContent?.includes("启用"));
    expect(enabledRow).toBeTruthy();
    const offBtn = [...enabledRow!.querySelectorAll<HTMLButtonElement>(".axv-shape-seg-btn")].find(
      (b) => b.textContent === "否",
    );
    offBtn!.click();
    await flush();

    byText(h, "保存并应用")!.click();
    await flush();
    expect(saved).not.toBeNull();
    expect(saved!.xml).toContain('android:state_enabled="false"');
    const back = parseDrawable(saved!.xml)!;
    expect(back.t).toBe("selector");
    if (back.t === "selector") {
      expect(back.items[back.items.length - 1].states["state_enabled"]).toBe("false");
    }
  });

  it("layer：能改偏移/对齐/不透明度，保存进 XML", async () => {
    let saved: { name: string; xml: string } | null = null;
    const h = await mount(
      <DrawableEditor
        attrName="android:background"
        value=""
        existingXml={llXml}
        existingNames={[]}
        onClose={() => {}}
        onSave={(name, xml) => {
          saved = { name, xml };
        }}
      />,
    );

    pickRow(h, 2);
    await flush();
    byText(h, "参数")!.click();
    await flush();

    const panel = h.querySelector(".axv-slot");
    expect(panel).toBeTruthy();
    expect(panel!.textContent).toContain("这一层 · 第 2 层");

    const inputs = panel!.querySelectorAll<HTMLInputElement>(".axv-slot-grid .axv-attr-input");
    expect(inputs.length).toBeGreaterThanOrEqual(4);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(inputs[0], "8");
    inputs[0].dispatchEvent(new Event("input", { bubbles: true }));
    setter?.call(inputs[1], "4");
    inputs[1].dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    // M163c：对齐改成了可输入下拉，找 gravity 专用的那个 input[list]
    const g = [...panel!.querySelectorAll<HTMLInputElement>("input.axv-attr-input[list]")]
      .find((i) => i.getAttribute("list")!.includes("gravity"));
    expect(g).toBeTruthy();
    setter?.call(g!, "center");
    g!.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    const allIn = panel!.querySelectorAll<HTMLInputElement>(".axv-attr-input");
    const op = allIn[allIn.length - 1];
    setter?.call(op, "0.5");
    op.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    byText(h, "保存并应用")!.click();
    await flush();

    expect(saved!.xml).toContain('android:left="8dp"');
    expect(saved!.xml).toContain('android:top="4dp"');
    expect(saved!.xml).toContain('android:gravity="center"');
    expect(saved!.xml).toContain('android:alpha="0.5"');
  });
});
