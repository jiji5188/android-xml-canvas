// test/xml_m183_resource_panel.test.ts — M183 资源面板聚合逻辑
import { describe, expect, it } from "vitest";
import {
  groupValuesByResource,
  iconFileTab,
  primaryVariant,
  splitGroupsByTab,
  valuePreview,
  valuesQualifier,
} from "@/lib/xml/resource-panel";

const V = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">MyApp</string>
  <string name="hello">你好</string>
  <color name="primary">#0B5FA5</color>
  <dimen name="padding">8dp</dimen>
</resources>
`;

const NIGHT = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">MyApp夜间</string>
  <color name="primary">#1E88E5</color>
</resources>
`;

describe("valuesQualifier", () => {
  it("解析限定符目录名", () => {
    expect(valuesQualifier("values")).toBe("");
    expect(valuesQualifier("values-night")).toBe("night");
    expect(valuesQualifier("values-zh-rCN")).toBe("zh-rCN");
    expect(valuesQualifier("values-land")).toBe("land");
  });
});

describe("groupValuesByResource", () => {
  const groups = groupValuesByResource([
    { rel: "app/src/main/res/values/strings.xml", xml: V },
    { rel: "app/src/main/res/values-night/colors.xml", xml: NIGHT },
  ]);

  it("同名资源跨限定符聚成一条", () => {
    const app = groups.find((g) => g.name === "app_name");
    expect(app).toBeDefined();
    expect(app!.variants.length).toBe(2);
    expect(app!.variants.map((v) => v.qualifier).sort()).toEqual(["", "night"]);
  });

  it("只在一个文件里的资源只有一条 variant", () => {
    const hello = groups.find((g) => g.name === "hello");
    expect(hello!.variants.length).toBe(1);
    expect(hello!.kind).toBe("string");
  });

  it("kind 来自解析器的类型（不是 tag）", () => {
    const padding = groups.find((g) => g.name === "padding");
    expect(padding!.kind).toBe("dimen");
  });

  it("坏文件不炸，只跳过", () => {
    const g = groupValuesByResource([{ rel: "res/values/bad.xml", xml: "随便什么不是xml" }]);
    expect(g.length).toBe(0);
  });
});

describe("splitGroupsByTab", () => {
  it("string 进文本、color 进颜色、其余进其他", () => {
    const groups = groupValuesByResource([{ rel: "res/values/a.xml", xml: V }]);
    const { text, color, other } = splitGroupsByTab(groups);
    expect(text.map((g) => g.name).sort()).toEqual(["app_name", "hello"]);
    expect(color.map((g) => g.name)).toEqual(["primary"]);
    expect(other.map((g) => g.name)).toEqual(["padding"]);
  });
});

describe("primaryVariant", () => {
  it("默认优先没有限定符的（values/ 是主文件）", () => {
    const groups = groupValuesByResource([
      { rel: "res/values/a.xml", xml: V },
      { rel: "res/values-night/b.xml", xml: NIGHT },
    ]);
    const primary = groups.find((g) => g.name === "app_name")!;
    const pv = primaryVariant(primary);
    expect(pv.rel).toBe("res/values/a.xml");
  });
});

describe("iconFileTab", () => {
  it("图片与 mipmap/drawable 归图标", () => {
    expect(iconFileTab("res/drawable/a", "ic.png")).toBe("icon");
    expect(iconFileTab("res/mipmap-xhdpi/ic_launcher.png", "")).toBe("icon");
    expect(iconFileTab("res/drawable/b", "ic_star.xml")).toBe("icon");
  });
  it("raw/menu 归其他", () => {
    expect(iconFileTab("res/raw/a", "sound.mp3")).toBe("other");
  });
});

describe("valuePreview", () => {
  it("颜色带回色块，长文本截断", () => {
    expect(valuePreview("#0B5FA5")).toEqual({ text: "#0B5FA5", color: "#0b5fa5" });
    // M183b：8 位是 Android 的 AARRGGBB（FF A 不透明 → rgb）
    expect(valuePreview("#FF0B5FA5").color).toBe("rgb(11, 95, 165)");
    const long = valuePreview("a".repeat(50));
    expect(long.text.endsWith("…")).toBe(true);
  });
});
