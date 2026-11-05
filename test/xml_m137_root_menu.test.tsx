// test/xml_m137_root_menu.test.tsx — 根标签下拉（M137）
// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { DrawableEditor } from "@/components/DrawableEditor";

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

async function mount(xml: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <DrawableEditor
      value="res/drawable/bg_btn.xml"
      attrName="bg_btn"
      existingXml={xml}
      existingNames={["bg_btn"]}
      onClose={() => {}}
      onSave={() => {}}
    />,
  );
  await flush();
  return host;
}

const LAYER = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><shape><solid android:color="#FFDDE3EA"/></shape></item>
    <item android:left="8dp"><shape><solid android:color="#FF3B82F6"/></shape></item>
</layer-list>`;

const tagBtn = (h: HTMLElement) => h.querySelector<HTMLButtonElement>(".axv-dt-roottag");
const menuOpts = (h: HTMLElement) =>
  Array.from(h.querySelectorAll<HTMLButtonElement>(".axv-dt-rootopt"));

describe("M137 根标签下拉", () => {
  it("标题旁的根标签可点开，列出四个可转类型，当前项打勾且不可点", async () => {
    const h = await mount(LAYER);
    const btn = tagBtn(h)!;
    expect(btn.textContent).toContain("图层叠加");
    expect(menuOpts(h)).toHaveLength(0);

    btn.click();
    await flush();
    const opts = menuOpts(h);
    expect(opts).toHaveLength(4);
    expect(opts.map((o) => o.textContent?.includes("状态选择"))).toContain(true);
    const on = opts.find((o) => o.classList.contains("is-on"))!;
    expect(on.textContent).toContain("图层叠加");
    expect(on.disabled).toBe(true);
    // 非当前项带「会丢什么」的提醒
    const other = opts.find((o) => !o.classList.contains("is-on"))!;
    expect(other.querySelector(".axv-dt-rootopt-hint")?.textContent?.length).toBeGreaterThan(0);
  });

  it("点「状态选择」→ 根标签立刻变、树重建、XML 跟着换，并有提示条", async () => {
    const h = await mount(LAYER);
    tagBtn(h)!.click();
    await flush();
    menuOpts(h)
      .find((o) => o.textContent?.includes("状态选择"))!
      .click();
    await flush();

    expect(tagBtn(h)?.textContent).toContain("状态选择");
    const note = h.querySelector(".axv-dt-rootnote")?.textContent ?? "";
    expect(note).toContain("已改成");
    expect(note).toContain("状态");
    // XML 代码区换成 selector 根
    const code = h.textContent ?? "";
    expect(code).toContain("<selector");
    // 层级没丢：两行仍在地
    expect(h.querySelectorAll(".axv-dt-row").length).toBeGreaterThanOrEqual(2);
  });

  it("提示条可以关掉", async () => {
    const h = await mount(LAYER);
    tagBtn(h)!.click();
    await flush();
    menuOpts(h)
      .find((o) => o.textContent?.includes("水波纹"))!
      .click();
    await flush();
    expect(h.querySelector(".axv-dt-rootnote")).not.toBeNull();
    h.querySelector<HTMLButtonElement>(".axv-dt-rootnote-x")!.click();
    await flush();
    expect(h.querySelector(".axv-dt-rootnote")).toBeNull();
  });

  it("只读根（vector）不给下拉，标题保持静态标签", async () => {
    const h = await mount(`<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp"/>`);
    expect(tagBtn(h)).toBeNull();
    expect(h.querySelector(".axv-dt-head-tag")?.textContent).toContain("矢量图");
  });
});
