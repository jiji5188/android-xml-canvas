// M382：编译前检查——gradle 声明的依赖必须有本地实体（设备端没有 maven）
import { describe, it, expect } from "vitest";
import { missingGradleEntities, formatMissingList } from "../lib/xml/pre-build-check";

describe("M382 missingGradleEntities", () => {
  const gradle = [
    "dependencies {",
    "  implementation fileTree(dir: 'libs', include: ['*.jar', '*.aar'])",
    "  implementation 'androidx.appcompat:appcompat:1.0.0'",
    "  implementation 'com.google.android.material:material:1.0.0'",
    "  implementation 'androidx.cardview:cardview:1.0.0'",
    "  api 'jxl:jxl:2.6.12'",
    "}",
  ].join("\n");

  it("实体齐全 → 无缺失", () => {
    const libs = [
      "app/src/main/libs/appcompat-1.0.0.aar",
      "libs/material-1.0.0.aar",
      "shared/cardview-1.0.0.aar",
      "app/libs/jxl-2.6.12.jar",
    ];
    expect(missingGradleEntities(gradle, libs)).toEqual([]);
  });

  it("缺 cardview 实体 → 只报它（这正是 2026-11-18 真实事故）", () => {
    const libs = ["app/src/main/libs/appcompat-1.0.0.aar", "libs/material-1.0.0.aar"];
    const r = missingGradleEntities(gradle, libs);
    expect(r.map((x) => x.coord)).toContain("androidx.cardview:cardview:1.0.0");
    expect(r.find((x) => x.coord.includes("cardview"))?.fname).toBe("cardview-1.0.0.aar");
  });

  it("版本对不上的宽松匹配：有 appcompat.aar（不带版本）也不误报", () => {
    const libs = ["app/src/main/libs/appcompat.aar"];
    const g = "dependencies { implementation 'androidx.appcompat:appcompat:1.0.0' }";
    expect(missingGradleEntities(g, libs)).toEqual([]);
  });

  it("fileTree 不在检查范围（本地目录声明，坐标才查）", () => {
    const g = "dependencies { implementation fileTree(dir: 'libs', include: ['*.aar']) }";
    expect(missingGradleEntities(g, [])).toEqual([]);
  });

  it("gradle 为空 / 解析失败 → 空数组，绝不抛", () => {
    expect(missingGradleEntities(null, [])).toEqual([]);
    expect(missingGradleEntities("", [])).toEqual([]);
    expect(missingGradleEntities("dependencies { implementation 'a:b' }", [])).toEqual([]);
  });

  it("同坐标重复声明只报一次", () => {
    const g = `dependencies { implementation 'a:b:1.0'\nimplementation 'a:b:1.0' }`;
    expect(missingGradleEntities(g, []).length).toBe(1);
  });
});

describe("M382 formatMissingList", () => {
  it("截断 + 计数", () => {
    const r = formatMissingList(["mipmap/app", "mipmap/app_round", "drawable/x"], 2);
    expect(r.shown).toBe("mipmap/app、mipmap/app_round");
    expect(r.more).toBe(1);
  });
  it("空列表", () => {
    expect(formatMissingList([], 12)).toEqual({ shown: "", more: 0 });
  });
});
