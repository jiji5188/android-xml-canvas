// test/xml_m183c_values_merge.test.ts — M183c：values 片段合并去重
//
// 用户报的 bug：colors.xml + strings.xml 本来是两份小文件，代码编辑器里却出现三千多条
// 重复的颜色/文字配置。根因是 resExtras.valuesXml 采用「字符串拼接」式合并，
// 每次载入项目资源（打开一个文件就触发 quick + full 两轮）就再叠一份，
// 而导出/保存资源时 wrapValues() 会把这份累积文本写回项目 values/res_values.xml。
// 这里锁死三件事：
//   1) 合并按 kind/name 去重且幂等（跑多少次都一样）
//   2) wrapValues 落地前也去重（最后一道防线）
//   3) mergeProjectExtras 不再让 valuesXml/counts 越滚越大

import { describe, expect, it } from "vitest";
import {
  dedupeValuesFragment,
  mergeValuesFragments,
  splitValueElements,
  valuesKeys,
} from "@/lib/xml/values-merge";
import { mergeProjectExtras } from "@/lib/xml/project-res";
import { buildResBundle } from "@/lib/xml/bundle";
import type { ResourceExtras } from "@/lib/xml/resdir";

const COLORS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="brand">#0B5FA5</color>
    <color name="accent">#FF5722</color>
</resources>`;

const STRINGS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">MyApp</string>
    <string name="hello">你好</string>
</resources>`;

function extras(valuesXml: string): ResourceExtras {
  return {
    drawables: {},
    drawableXml: {},
    styles: {},
    layouts: {},
    vectorNames: [],
    valuesXml,
    sourceFiles: [],
    counts: { images: 0, vectors: 0, values: 0, styles: 0, shapes: 0 },
  };
}

describe("splitValueElements", () => {
  it("拆出 string/color，忽略 xml 声明与 resources 包裹", () => {
    const els = splitValueElements(COLORS);
    expect(els.map((e) => e.key)).toEqual(["color/brand", "color/accent"]);
    expect(els[0].text).toContain("brand");
  });

  it("多行元素能整段取出（含内部子标签）", () => {
    const src = `<resources>
  <style name="AppTheme" parent="Theme.Material">
    <item name="colorPrimary">@color/brand</item>
  </style>
</resources>`;
    const els = splitValueElements(src);
    expect(els).toHaveLength(1);
    expect(els[0].key).toBe("style/AppTheme");
    expect(els[0].text).toContain("colorPrimary");
  });

  it("注释不会混进元素里", () => {
    const src = "<resources>\n<!-- <color name=\"ghost\">#000</color> -->\n<color name=\"real\">#fff</color>\n</resources>";
    expect(valuesKeys(src)).toEqual(new Set(["color/real"]));
  });
});

describe("mergeValuesFragments", () => {
  it("两份不同文件合并后键齐全", () => {
    const merged = mergeValuesFragments(COLORS, STRINGS);
    expect(valuesKeys(merged)).toEqual(
      new Set(["color/brand", "color/accent", "string/app_name", "string/hello"]),
    );
  });

  it("反复合并同一份不再增长（幂等，这是本次 bug 的核心）", () => {
    let v = mergeValuesFragments(COLORS, STRINGS);
    const once = v;
    for (let i = 0; i < 50; i++) v = mergeValuesFragments(v, mergeValuesFragments(COLORS, STRINGS));
    expect(v).toBe(once);
    expect(valuesKeys(v).size).toBe(4);
  });

  it("同名资源以 b 为准", () => {
    const a = '<resources><color name="brand">#111111</color></resources>';
    const b = '<resources><color name="brand">#222222</color></resources>';
    const merged = mergeValuesFragments(a, b);
    expect(merged).toContain("#222222");
    expect(merged).not.toContain("#111111");
    expect(valuesKeys(merged).size).toBe(1);
  });
});

describe("dedupeValuesFragment", () => {
  it("文件里同名定义多份时只留最后一份", () => {
    const bloat = [COLORS, STRINGS, COLORS, STRINGS, COLORS].join("\n");
    const out = dedupeValuesFragment(bloat);
    expect(valuesKeys(out).size).toBe(4);
    expect(out.match(/name="brand"/g)).toHaveLength(1);
    expect(out.match(/name="hello"/g)).toHaveLength(1);
  });
});

describe("mergeProjectExtras", () => {
  it("valuesXml 不随合并次数膨胀，counts.values 是真实键数", () => {
    let cur = mergeProjectExtras(null, extras(mergeValuesFragments(COLORS, STRINGS)))!;
    const first = cur.valuesXml;
    for (let i = 0; i < 20; i++) {
      cur = mergeProjectExtras(cur, extras(mergeValuesFragments(COLORS, STRINGS)))!;
      cur = mergeProjectExtras(cur, extras(mergeValuesFragments(COLORS, STRINGS)))!;
    }
    expect(cur.valuesXml).toBe(first);
    expect(cur.counts.values).toBe(4);
    expect(cur.valuesXml.length).toBeLessThan(first.length * 2);
  });

  it("新增资源能合并进来", () => {
    const a = mergeProjectExtras(null, extras(COLORS))!;
    const b = mergeProjectExtras(a, extras('<resources><string name="later">x</string></resources>'))!;
    expect(valuesKeys(b.valuesXml)).toEqual(
      new Set(["color/brand", "color/accent", "string/later"]),
    );
    expect(b.counts.values).toBe(3);
  });
});

describe("buildResBundle / wrapValues", () => {
  it("导出时即使 valuesXml 有重复也不写重复定义", () => {
    const bloat = [COLORS, STRINGS, COLORS, STRINGS].join("\n");
    const entries = buildResBundle({
      layoutXml: '<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout/>',
      extras: extras(bloat),
    });
    const values = entries.find((e) => e.path === "values/res_values.xml");
    expect(values).toBeTruthy();
    const text = values!.text ?? "";
    expect(text.match(/name="brand"/g)).toHaveLength(1);
    expect(text.match(/name="app_name"/g)).toHaveLength(1);
    // 包一层 resources，且没嵌套
    expect(text.match(/<resources>/g)).toHaveLength(1);
  });
});
