// @vitest-environment node
// M340：values 片段按类型拆成标准 7 文件（strings/colors/dimens/integers/arrays/styles/themes）
import { describe, expect, it } from "vitest";
import {
  STANDARD_VALUES_FILES,
  fileForElement,
  splitValuesIntoStandardFiles,
} from "../lib/xml/values-split";

const FRAG = [
  '<string name="app_name">MyApp</string>',
  '<color name="brand">#123456</color>',
  '<dimen name="gap">8dp</dimen>',
  '<integer name="max">10</integer>',
  '<string-array name="opts"><item>a</item><item>b</item></string-array>',
  '<style name="Theme.App" parent="Theme.Material3.Light"><item name="colorPrimary">@color/brand</item></style>',
  '<style name="App.Widget"><item name="android:background">@color/brand</item></style>',
  '<bool name="flag">true</bool>',
].join("\n");

describe("M340 values 拆标准文件", () => {
  it("标准文件名固定 7 个", () => {
    expect(STANDARD_VALUES_FILES).toHaveLength(7);
    expect(STANDARD_VALUES_FILES).toContain("themes.xml");
    expect(STANDARD_VALUES_FILES).toContain("styles.xml");
  });

  it("各类元素归到正确文件", () => {
    expect(fileForElement({ key: "s", text: '<string name="a"/>' })).toBe("strings.xml");
    expect(fileForElement({ key: "c", text: '<color name="a">#fff</color>' })).toBe("colors.xml");
    expect(fileForElement({ key: "d", text: "<dimen name=\"a\">1dp</dimen>" })).toBe("dimens.xml");
    expect(fileForElement({ key: "i", text: "<integer name=\"a\">1</integer>" })).toBe("integers.xml");
    expect(fileForElement({ key: "ar", text: '<string-array name="a"/>' })).toBe("arrays.xml");
    expect(fileForElement({ key: "b", text: "<bool name=\"a\">true</bool>" })).toBe("dimens.xml");
    // Theme* 风格进 themes.xml，普通 Style 进 styles.xml
    expect(fileForElement({ key: "th", text: '<style name="Theme.App" parent="Theme.Material3.Light"/>' })).toBe("themes.xml");
    expect(fileForElement({ key: "st", text: '<style name="App.Widget"/>' })).toBe("styles.xml");
  });

  it("整段片段拆成多文件，空文件不生成", () => {
    const out = splitValuesIntoStandardFiles(FRAG);
    expect(Object.keys(out)).toEqual([
      "values/strings.xml",
      "values/colors.xml",
      "values/dimens.xml",
      "values/integers.xml",
      "values/arrays.xml",
      "values/styles.xml",
      "values/themes.xml",
    ]);
    expect(out["values/colors.xml"]).toContain('name="brand"');
    expect(out["values/strings.xml"]).toContain('name="app_name"');
    expect(out["values/dimens.xml"]).toContain('name="gap"');
    expect(out["values/dimens.xml"]).toContain('name="flag"'); // bool 归 dimens
    expect(out["values/arrays.xml"]).toContain('name="opts"');
    expect(out["values/integers.xml"]).toContain('name="max"');
    // Theme 样式进 themes.xml，普通样式进 styles.xml
    expect(out["values/themes.xml"]).toContain('name="Theme.App"');
    expect(out["values/styles.xml"]).toContain('name="App.Widget"');
    for (const t of Object.values(out)) {
      expect(t).toContain("<resources>");
      expect(t).not.toContain("res_values");
    }
  });

  it("空片段不生成任何文件", () => {
    expect(splitValuesIntoStandardFiles("")).toEqual({});
    expect(splitValuesIntoStandardFiles("<resources></resources>")).toEqual({});
  });
});
