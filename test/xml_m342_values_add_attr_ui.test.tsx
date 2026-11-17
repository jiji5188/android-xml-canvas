// test/xml_m342_values_add_attr_ui.test.tsx — M342：style 节点内添加属性的 UI
import { describe, it, expect, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ValuesEditor } from "../components/ValuesEditor";

const THEMES = `<resources>
    <style name="Theme.App" parent="Theme.Material3.Light">
        <item name="android:colorPrimary">#0B5FA5</item>
    </style>
    <style name="Theme.App.Dialog" parent="Theme.App">
        <item name="android:windowBackground">@color/white</item>
    </style>
</resources>
`;

const THEMES_EMPTY = `<resources>
    <style name="Theme.Empty" parent="Theme.Material3.Light" />
</resources>
`;

describe("M342 ValuesEditor style 节点添加属性", () => {
  it("每个 style 标题行都有添加属性按钮", () => {
    const html = renderToStaticMarkup(
      <ValuesEditor xml={THEMES} onChange={() => {}} onNote={() => {}} />,
    );
    // 两个 style 各一个「给 xxx 添加属性」按钮
    const addBtns = (html.match(/axv-val-add-attr/g) || []).length;
    expect(addBtns).toBeGreaterThanOrEqual(2);
    // 按钮标题里带样式名
    expect(html).toContain('aria-label="给 Theme.App 添加属性"');
    expect(html).toContain('aria-label="给 Theme.App.Dialog 添加属性"');
  });

  it("自闭合 style 也能添加属性", () => {
    const html = renderToStaticMarkup(
      <ValuesEditor xml={THEMES_EMPTY} onChange={() => {}} onNote={() => {}} />,
    );
    expect(html).toContain("axv-val-add-attr");
    expect(html).toContain('aria-label="给 Theme.Empty 添加属性"');
  });

  it("非 style 行（普通资源/子项）没有添加属性按钮", () => {
    const xml = `<resources>
    <string name="app_name">My App</string>
</resources>`;
    const html = renderToStaticMarkup(
      <ValuesEditor xml={xml} onChange={() => {}} onNote={() => {}} />,
    );
    // string 行没有添加属性按钮
    expect(html).not.toContain("axv-val-add-attr");
  });

  it("style 标题行带折叠 + parent 输入 + 添加属性按钮", () => {
    const html = renderToStaticMarkup(
      <ValuesEditor xml={THEMES} onChange={() => {}} onNote={() => {}} />,
    );
    expect(html).toContain("axv-val-fold");
    expect(html).toContain("axv-val-parent");
    expect(html).toContain("axv-val-add-attr");
  });
});
