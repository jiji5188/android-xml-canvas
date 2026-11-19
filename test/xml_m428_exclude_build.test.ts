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
});
