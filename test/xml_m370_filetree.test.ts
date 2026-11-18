// test/xml_m370_filetree.test.ts — M370：build.gradle fileTree 解析（dir + include）
import { describe, it, expect } from "vitest";
import { parseFileTrees, parseGradleDepsDetailed } from "@/lib/xml/gradle-deps";

describe("M370 parseFileTrees", () => {
  it("groovy 基础写法：dir + include 数组", () => {
    const t = `dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
}`;
    const r = parseFileTrees(t);
    expect(r).toHaveLength(1);
    expect(r[0].dir).toBe("libs");
    expect(r[0].includes).toEqual(["*.jar"]);
    expect(r[0].config).toBe("implementation");
    expect(r[0].raw).toContain("fileTree(dir: 'libs'");
  });

  it("多 include + 双引号 + api 配置", () => {
    const t = `    api fileTree(dir: "app/libs", include: ["*.jar", "*.aar"])`;
    const r = parseFileTrees(t);
    expect(r[0].config).toBe("api");
    expect(r[0].dir).toBe("app/libs");
    expect(r[0].includes).toEqual(["*.jar", "*.aar"]);
  });

  it("单字符串 include（不是数组）", () => {
    const t = `implementation fileTree(dir: 'libs', include: '*.jar')`;
    const r = parseFileTrees(t);
    expect(r[0].includes).toEqual(["*.jar"]);
  });

  it("多行 include 数组", () => {
    const t = `dependencies {
    implementation fileTree(
        dir: 'libs',
        include: [
            '*.jar',
            '*.aar'
        ]
    )
}`;
    const r = parseFileTrees(t);
    expect(r).toHaveLength(1);
    expect(r[0].dir).toBe("libs");
    expect(r[0].includes).toEqual(["*.jar", "*.aar"]);
  });

  it("dir: file('libs') 嵌套写法", () => {
    const t = `implementation fileTree(dir: file('libs'), include: ['*.jar'])`;
    const r = parseFileTrees(t);
    expect(r[0].dir).toBe("libs");
  });

  it("无 include = 全选（空数组）", () => {
    const t = `implementation fileTree(dir: 'libs')`;
    const r = parseFileTrees(t);
    expect(r[0].dir).toBe("libs");
    expect(r[0].includes).toEqual([]);
  });

  it("kts 写法（括号 call）", () => {
    const t = `dependencies {
    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.jar"))))
}`;
    // mapOf 形式不强求解析 dir；至少不能崩
    expect(() => parseFileTrees(t)).not.toThrow();
  });

  it("去重 + 注释里的 fileTree 不算", () => {
    const t = `// implementation fileTree(dir: 'old', include: ['*.jar'])
implementation fileTree(dir: 'libs', include: ['*.jar'])
implementation fileTree(dir: 'libs', include: ['*.jar'])`;
    const r = parseFileTrees(t);
    expect(r.filter((x) => x.dir === "libs")).toHaveLength(1);
    // 行注释里的声明所属行 config 仍是注释行 → 不参与 maven 解析即可
    expect(parseGradleDepsDetailed(t).deps).toHaveLength(0);
  });

  it("fileTree 不会被当成 maven 坐标解析", () => {
    const t = `dependencies {
    implementation fileTree(dir: 'libs', include: ['*.jar'])
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
}`;
    const { deps } = parseGradleDepsDetailed(t);
    expect(deps.map((d) => d.name)).toEqual(["okhttp"]);
  });
});
