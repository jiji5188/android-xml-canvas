// @vitest-environment node
// M341：values 下所有 xml（colors/styles/themes/strings/dimens/...）的资源 name 全局唯一检查
// 同文件内不能重名，跨文件也不能重名（Android aapt2 会报 duplicate resource）。
// 纯逻辑：parseValues 拿到每个文件的 name 列表，跨文件求重名集合。
import { describe, expect, it } from "vitest";
import { parseValues } from "../lib/xml/values-edit";

function namesOf(xml: string): string[] {
  return parseValues(xml).items.map((i) => i.name).filter(Boolean);
}

describe("M341 values 跨文件 name 全局唯一", () => {
  it("单文件内 name 不重名 → 无冲突", () => {
    const xml = `<resources>
      <string name="a">1</string>
      <string name="b">2</string>
    </resources>`;
    const names = namesOf(xml);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup).toEqual([]);
  });

  it("单文件内重名 → 检出冲突", () => {
    const xml = `<resources>
      <string name="a">1</string>
      <string name="a">2</string>
    </resources>`;
    const names = namesOf(xml);
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup).toContain("a");
  });

  it("跨文件重名 → 检出冲突（colors.xml 和 themes.xml 都有 colorPrimary）", () => {
    const files = [
      { path: "values/colors.xml", xml: `<resources><color name="colorPrimary">#FF0000</color></resources>` },
      { path: "values/themes.xml", xml: `<resources><style name="Theme.MyApp"><item name="colorPrimary">@color/colorPrimary</item></style></resources>` },
    ];
    // 模拟：把所有文件的 name 收一起（style 的 name + item 的 name）
    const allNames = files.map((f) => namesOf(f.xml)).flat();
    const dup = allNames.filter((n, i) => allNames.indexOf(n) !== i);
    expect(dup).toContain("colorPrimary");
  });

  it("parent 指向的 name 在 system/framework 里（不在项目 values 里）不算冲突", () => {
    // parent="Theme.Material3.Light.NoActionBar" 是系统主题，项目里没有同名 resource，合法
    const xml = `<resources><style name="Theme.MyApp" parent="Theme.Material3.Light.NoActionBar"></style></resources>`;
    const names = namesOf(xml);
    expect(names).toContain("Theme.MyApp");
    // 系统 parent 名不在项目 names 里，不应被当冲突
    const dup = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dup).toEqual([]);
  });
});
