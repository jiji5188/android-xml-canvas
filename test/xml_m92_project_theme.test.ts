// test/xml_m92_project_theme.test.ts — M92：预览吃工程主题（含 values-night）
// 用户痛点：预览配色跟真机对不上，因为工具只用了内置预设主题，没读工程 themes.xml。
import { describe, expect, it } from "vitest";
import { buildResourceExtras } from "../lib/xml/resdir";
import { buildPalette, LIGHT_PALETTE, DARK_PALETTE } from "../lib/xml/theme-palette";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import { mergeResourceFragment } from "../lib/xml/resources";
import type { ResourceTable } from "../lib/xml/types";

function makeFile(text: string, name: string): File {
  const buf = Buffer.from(text, "utf8");
  return {
    name,
    type: "text/plain",
    size: buf.length,
    text: async () => text,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  } as unknown as File;
}

const THEMES_DAY = `<resources>
  <style name="Theme.MyApp" parent="Theme.Material3.DayNight">
    <item name="colorPrimary">@color/brand</item>
    <item name="colorOnPrimary">#FFFFFFFF</item>
    <item name="colorOnSurface">#FF1B1B1F</item>
    <item name="android:windowBackground">@color/bg_day</item>
  </style>
</resources>`;

const THEMES_NIGHT = `<resources>
  <style name="Theme.MyApp" parent="Theme.Material3.DayNight">
    <item name="colorPrimary">@color/brand_night</item>
    <item name="android:windowBackground">#FF121212</item>
  </style>
</resources>`;

const COLORS = `<resources>
  <color name="brand">#FF3366</color>
  <color name="bg_day">#FAFAFA</color>
</resources>`;

const COLORS_NIGHT = `<resources>
  <color name="brand_night">#8899FF</color>
</resources>`;

const LAYOUT = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent"
    android:orientation="vertical">
  <Button android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="OK" />
</LinearLayout>`;

async function loadRes() {
  return buildResourceExtras([
    { name: "themes.xml", path: "app/src/main/res/values/themes.xml", file: makeFile(THEMES_DAY, "themes.xml") },
    { name: "themes.xml", path: "app/src/main/res/values-night/themes.xml", file: makeFile(THEMES_NIGHT, "themes.xml") },
    { name: "colors.xml", path: "app/src/main/res/values/colors.xml", file: makeFile(COLORS, "colors.xml") },
    { name: "colors.xml", path: "app/src/main/res/values-night/colors.xml", file: makeFile(COLORS_NIGHT, "colors.xml") },
  ]);
}

/** 模拟 XmlEditor 的组装：valuesXml 走 mergeResourceFragment，主题/夜间/语言从 extras 补上 */
async function resTable(nightMode: boolean): Promise<ResourceTable> {
  const extras = await loadRes();
  const base = mergeResourceFragment(extras.valuesXml);
  return {
    ...base,
    themeAttrs: extras.themeAttrs,
    themeAttrsNight: extras.themeAttrsNight,
    colorsNight: extras.colorsNight,
    stringsByLocale: extras.stringsByLocale,
    nightMode,
  } as ResourceTable;
}

describe("M92 工程主题 → 预览调色板", () => {
  it("读 values/themes.xml 的 colorPrimary / windowBackground", async () => {
    const res = await loadRes();
    expect(res.themeAttrs?.colorPrimary).toBe("@color/brand");
    expect(res.themeAttrsNight?.colorPrimary).toBe("@color/brand_night");
    expect(res.colorsNight?.brand_night).toBe("#8899FF");
  });

  it("浅色调色板用工程主色，深色调色板用 values-night 那套", async () => {
    const day = buildPalette(await resTable(false));
    expect(day.fromProject).toBe(true);
    expect(day.primary.toUpperCase()).toBe("#FF3366");
    expect(day.surface.toUpperCase()).toBe("#FAFAFA");

    const night = buildPalette(await resTable(true));
    expect(night.primary.toUpperCase()).toBe("#8899FF");
    // 夜间没写 windowBackground 的 color 引用时用原值
    expect(night.surface.toUpperCase()).toBe("#121212");
  });

  it("没有工程主题时保持工具原观感（fromProject=false）", () => {
    const p = buildPalette(DEFAULT_RESOURCES as ResourceTable);
    expect(p.fromProject).toBe(false);
    expect(p.primary).toBe(LIGHT_PALETTE.primary);
    expect(p.surface).toBe(LIGHT_PALETTE.surface);
    expect(buildPalette({ ...DEFAULT_RESOURCES, nightMode: true }).surface).toBe(DARK_PALETTE.surface);
  });

  it("有主题时 Button 默认底色 = 主题主色；无主题仍是中性灰", async () => {
    const root = parseLayoutXml(LAYOUT).root!;
    const themed = buildRenderModel(root, await resTable(false), 2);
    const btn = themed.root.children[0];
    expect(String(btn.style.backgroundColor).toUpperCase()).toBe("#FF3366");

    const plain = buildRenderModel(root, DEFAULT_RESOURCES as ResourceTable, 2);
    expect(String(plain.root.children[0].style.backgroundColor).toUpperCase()).toBe("#E8E8EC");
  });

  it("有主题且根布局没写 background 时，用 windowBackground 当前景色", async () => {
    const root = parseLayoutXml(LAYOUT).root!;
    const m = buildRenderModel(root, await resTable(false), 2);
    expect(String(m.root.style.backgroundColor).toUpperCase()).toBe("#FAFAFA");
  });
});
