// M428：build.gradle exclude 配置在构建侧生效 —— 命中 exclude.module 的库文件不进 classpath
import { describe, it, expect } from "vitest";
import { applyExcludes } from "@/lib/xml/project-libs";
import { parseGradleDepsDetailed } from "@/lib/xml/gradle-deps";
import type { ProjectLib } from "@/lib/xml/project-libs";

const lib = (rel: string): ProjectLib => ({ rel, base64: "x" });

describe("M428 applyExcludes", () => {
  it("空 excludes → 原样返回", () => {
    const libs = [lib("app/libs/material-1.0.0.aar")];
    const r = applyExcludes(libs, []);
    expect(r.kept).toBe(libs);
    expect(r.dropped).toEqual([]);
  });

  it("命中 module（artifact 基名）→ 剔掉", () => {
    const libs = [
      lib("app/libs/material-1.0.0.aar"),
      lib("app/libs/support-compat-28.0.0.jar"),
      lib("app/libs/support-v4-28.0.0.jar"),
      lib("app/libs/jxl-2.6.12.jar"),
    ];
    const r = applyExcludes(libs, [
      { group: "com.android.support", module: "support-compat" },
      { group: "com.android.support", module: "support-v4" },
    ]);
    expect(r.kept.map((x) => x.rel)).toEqual([
      "app/libs/material-1.0.0.aar",
      "app/libs/jxl-2.6.12.jar",
    ]);
    expect(r.dropped.map((d) => d.name)).toEqual(["support-compat-28.0.0.jar", "support-v4-28.0.0.jar"]);
    expect(r.dropped[0].by).toBe("com.android.support:support-compat");
  });

  it("用户真实样例：parse material 的 4 条 exclude → support-* 全剔", () => {
    const gradle = [
      "dependencies {",
      "    implementation 'androidx.percentlayout:percentlayout:1.0.0'",
      "    implementation 'androidx.appcompat:appcompat:1.0.0'",
      "    implementation ('com.google.android.material:material:1.0.0') {",
      "        exclude group: 'com.android.support', module: 'support-compat'",
      "        exclude group: 'com.android.support', module: 'support-core-ui'",
      "        exclude group: 'com.android.support', module: 'support-fragment'",
      "        exclude group: 'com.android.support', module: 'support-v4'",
      "    }",
      "    implementation 'net.sourceforge.jexcelapi:jxl:2.6.12'",
      "    implementation fileTree(dir: 'libs', include: ['*.jar'])",
      "}",
    ].join("\n");
    const { deps } = parseGradleDepsDetailed(gradle);
    const excludes = deps.flatMap((d) => d.excludes ?? []);
    expect(excludes).toHaveLength(4);
    const libs = [
      lib("app/libs/support-compat-28.0.0.jar"),
      lib("app/libs/support-core-ui-28.0.0.jar"),
      lib("app/libs/support-fragment-27.1.1.jar"),
      lib("app/libs/support-v4-28.0.0.jar"),
      lib("app/libs/material-1.0.0.aar"),
      lib("app/libs/jxl.jar"),
    ];
    const r = applyExcludes(libs, excludes);
    expect(r.kept.map((x) => x.rel)).toEqual([
      "app/libs/material-1.0.0.aar",
      "app/libs/jxl.jar",
    ]);
    expect(r.dropped).toHaveLength(4);
  });

  it("无版本段的文件名也能匹配基名", () => {
    const libs = [lib("app/libs/support-v4.jar")];
    const r = applyExcludes(libs, [{ group: "com.android.support", module: "support-v4" }]);
    expect(r.kept).toHaveLength(0);
    expect(r.dropped).toHaveLength(1);
  });

  it("M435：直接声明的依赖永不被 exclude（Gradle 语义：exclude 只排传递依赖）", () => {
    // 真实事故：material 的 exclude appcompat + 项目直接声明 appcompat → appcompat 必须保留，
    //  否则 appcompat 资源全缺（Animation.AppCompat.Dialog / TextAppearance.AppCompat not found）
    const libs = [
      lib("app/libs/appcompat-1.7.0.aar"),
      lib("app/libs/material-1.12.0.aar"),
      lib("app/libs/support-compat-28.0.0.jar"),
    ];
    const excludes = [
      { group: "androidx.appcompat", module: "appcompat" },
      { group: "com.android.support", module: "support-compat" },
    ];
    const directNames = new Set(["appcompat", "material"]);
    const r = applyExcludes(libs, excludes, directNames);
    // appcompat 直接声明 → 保住；support-compat 未直接声明 → 剔掉
    expect(r.kept.map((x) => x.rel)).toEqual([
      "app/libs/appcompat-1.7.0.aar",
      "app/libs/material-1.12.0.aar",
    ]);
    expect(r.dropped.map((d) => d.name)).toEqual(["support-compat-28.0.0.jar"]);
  });
});
