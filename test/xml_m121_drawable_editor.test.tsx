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

describe("M121 入口路由：非纯形状直接进结构树", () => {
  it("selector 资源打开的是结构树编辑器，不是形状面板", async () => {
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
    expect(h.querySelectorAll(".axv-layer-row").length).toBe(2);
  });

  it("纯形状仍然走原来的形状面板", async () => {
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
    expect(h.querySelector('[aria-label="drawable 编辑器"]')).toBeNull();
    expect(h.querySelector('[aria-label="自定义形状"]')).toBeTruthy();
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
    const names = Array.from(h.querySelectorAll(".axv-layer-name")).map((n) => n.textContent);
    expect(names).toEqual(["内容", "遮罩"]);
    expect(h.textContent).not.toContain("item");
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

    // 选中第 1 个状态项 → 参数页
    h.querySelectorAll<HTMLButtonElement>(".axv-layer-pick")[0].click();
    await flush();
    byText(h, "参数")!.click();
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
    expect(h.querySelectorAll(".axv-layer-row").length).toBe(1);
    byText(h, "＋形状")!.click();
    await flush();
    expect(h.querySelectorAll(".axv-layer-row").length).toBe(2);

    h.querySelector<HTMLButtonElement>('[aria-label="撤销"]')!.click();
    await flush();
    expect(h.querySelectorAll(".axv-layer-row").length).toBe(1);
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
    const arrows = Array.from(h.querySelectorAll(".axv-layer-op")).filter(
      (b) => b.textContent === "↑" || b.textContent === "↓",
    );
    expect(arrows.length).toBe(0);
  });
});
