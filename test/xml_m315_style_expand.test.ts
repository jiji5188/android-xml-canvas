import { describe, it, expect } from "vitest";
import { parseValues, setItemValue } from "../lib/xml/values-edit";

const THEMES = `<resources>
  <style name="Theme.MyApp" parent="Theme.Material3.DayNight.NoActionBar">
    <item name="colorPrimary">@color/primary</item>
    <item name="colorPrimaryDark">@color/primary_dark</item>
    <item name="colorAccent">@color/accent</item>
  </style>
</resources>`;

describe("M315 style 容器展开（修 themes.xml 视图乱码）", () => {
  it("style 展开成逐行 item，不再把整块 XML 当 value", () => {
    const d = parseValues(THEMES);
    expect(d.ok).toBe(true);
    const byName = Object.fromEntries(d.items.map((i) => [i.name, i]));
    expect(byName["colorPrimary"].value).toBe("@color/primary");
    expect(byName["colorPrimaryDark"].value).toBe("@color/primary_dark");
    expect(byName["colorAccent"].value).toBe("@color/accent");
    // 容器本身一行分组标题（value 空、不可改值）
    expect(byName["Theme.MyApp"].value).toBe("");
    expect(byName["Theme.MyApp"].valueFrom).toBe(-1);
    // 没有任何一行的 value 里含 <item 乱码
    for (const i of d.items) expect(i.value).not.toContain("<item");
  });

  it("改嵌套 item 的值能正确回写，其它 item 不受影响", () => {
    const d = parseValues(THEMES);
    const cp = d.items.find((i) => i.name === "colorPrimary")!;
    expect(cp.valueFrom).toBeGreaterThan(-1);
    const out = setItemValue(THEMES, cp, "@color/newprimary");
    expect(out).toContain('<item name="colorPrimary">@color/newprimary</item>');
    expect(out).toContain('<item name="colorAccent">@color/accent</item>');
  });

  it("分组标题行改值无效（valueFrom=-1 不破坏文件）", () => {
    const d = parseValues(THEMES);
    const grp = d.items.find((i) => i.name === "Theme.MyApp")!;
    expect(setItemValue(THEMES, grp, "boom")).toBe(THEMES);
  });
});
