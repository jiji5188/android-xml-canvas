// M427：加依赖冲突检测 + exclude 注入（纯函数）
import { describe, it, expect } from "vitest";
import { findConflictsForNew, addExcludesToGradle, parseGradleDepsDetailed } from "@/lib/xml/gradle-deps";
import type { GradleDep } from "@/lib/xml/gradle-deps";

const dep = (g: string, n: string, v: string): GradleDep => ({
  group: g,
  name: n,
  version: v,
  raw: `implementation '${g}:${n}:${v}'`,
  config: "implementation",
  isAar: false,
});

describe("M427 findConflictsForNew", () => {
  it("无冲突 → 空", () => {
    expect(findConflictsForNew([dep("a", "b", "1")], { group: "c", name: "d", version: "1" })).toEqual([]);
  });
  it("同 group:name 不同版本 → version 冲突（排除旧版本）", () => {
    const cs = findConflictsForNew([dep("g", "lib", "1.0")], { group: "g", name: "lib", version: "2.0" });
    expect(cs).toHaveLength(1);
    expect(cs[0].kind).toBe("version");
    expect(cs[0].existing.version).toBe("1.0");
    expect(cs[0].exclude).toEqual({ group: "g", module: "lib" });
  });
  it("跨 group 同名 → name 冲突", () => {
    const cs = findConflictsForNew([dep("com.a", "widget", "1")], { group: "com.b", name: "widget", version: "2" });
    expect(cs).toHaveLength(1);
    expect(cs[0].kind).toBe("name");
    expect(cs[0].exclude).toEqual({ group: "com.a", module: "widget" });
  });
  it("完全相同坐标（幂等重加）→ 不算冲突", () => {
    expect(findConflictsForNew([dep("g", "n", "1")], { group: "g", name: "n", version: "1" })).toEqual([]);
  });
  it("多条冲突都返回", () => {
    const cs = findConflictsForNew(
      [dep("g", "lib", "1.0"), dep("com.x", "lib", "0.5")],
      { group: "g", name: "lib", version: "2.0" },
    );
    expect(cs).toHaveLength(2);
  });
});

describe("M427 addExcludesToGradle", () => {
  it("groovy：给 implementation 行追加 { exclude } 块", () => {
    const text = "dependencies {\n    implementation 'com.example:lib:1.0'\n}";
    const [out, changed] = addExcludesToGradle(text, { group: "com.example", name: "lib", version: "1.0" }, [{ group: "com.other", module: "lib" }], false);
    expect(changed).toBe(true);
    expect(out).toContain("implementation ('com.example:lib:1.0')"); // M434：统一改写成带括号形式
    expect(out).toContain("exclude group: 'com.other', module: 'lib'");
    expect(out).toMatch(/implementation \('com\.example:lib:1\.0'\)\s*\{/);
  });

  it("kts：implementation( ) 形式追加 exclude(group=, module=)", () => {
    const text = 'dependencies {\n    implementation("com.example:lib:1.0")\n}';
    const [out, changed] = addExcludesToGradle(text, { group: "com.example", name: "lib", version: "1.0" }, [{ group: "com.other", module: "lib" }], true);
    expect(changed).toBe(true);
    expect(out).toContain('implementation("com.example:lib:1.0")');
    expect(out).toContain('exclude(group = "com.other", module = "lib")');
  });

  it("已有 exclude 块且加同样的 exclude → 不变（幂等）", () => {
    const text = "dependencies {\n    implementation 'com.example:lib:1.0' {\n        exclude group: 'x', module: 'y'\n    }\n}";
    const [out, changed] = addExcludesToGradle(text, { group: "com.example", name: "lib", version: "1.0" }, [{ group: "x", module: "y" }], false);
    expect(changed).toBe(false);
    expect(out).toBe(text);
  });

  it("已有 exclude 块 + 新 exclude → 在块内追加", () => {
    const text = "dependencies {\n    implementation 'com.example:lib:1.0' {\n        exclude group: 'x', module: 'y'\n    }\n}";
    const [out, changed] = addExcludesToGradle(text, { group: "com.example", name: "lib", version: "1.0" }, [{ group: "a", module: "b" }], false);
    expect(changed).toBe(true);
    expect(out).toContain("exclude group: 'x', module: 'y'");
    expect(out).toContain("exclude group: 'a', module: 'b'");
  });

  it("目标坐标不在文件里 → 不变", () => {
    const text = "dependencies {\n    implementation 'other:lib:1.0'\n}";
    const [out, changed] = addExcludesToGradle(text, { group: "com.example", name: "lib", version: "1.0" }, [{ group: "a", module: "b" }], false);
    expect(changed).toBe(false);
    expect(out).toBe(text);
  });

  it("多个 exclude 同时追加", () => {
    const text = "dependencies {\n    implementation 'com.example:lib:1.0'\n}";
    const [out, changed] = addExcludesToGradle(
      text,
      { group: "com.example", name: "lib", version: "1.0" },
      [
        { group: "com.a", module: "lib" },
        { group: "com.b", module: "lib" },
      ],
      false,
    );
    expect(changed).toBe(true);
    expect(out).toContain("exclude group: 'com.a', module: 'lib'");
    expect(out).toContain("exclude group: 'com.b', module: 'lib'");
  });
});

describe("M428 解析 build.gradle 的 exclude 块（用户真实样例）", () => {
  const USER_GRADLE = [
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

  it("parseGradleDepsDetailed 把 exclude 块记进 GradleDep.excludes", () => {
    const { deps } = parseGradleDepsDetailed(USER_GRADLE);
    const mat = deps.find((d) => d.name === "material");
    expect(mat).toBeTruthy();
    expect(mat!.excludes).toHaveLength(4);
    expect(mat!.excludes).toContainEqual({ group: "com.android.support", module: "support-compat" });
    expect(mat!.excludes).toContainEqual({ group: "com.android.support", module: "support-v4" });
    // 无 exclude 的 dep 没有该字段
    const pct = deps.find((d) => d.name === "percentlayout");
    expect(pct!.excludes).toBeUndefined();
    // fileTree 行被跳过（不算 maven 坐标）
    expect(deps.some((d) => d.name === "libs")).toBe(false);
  });

  it("给已有 { exclude } 块追加新 exclude（幂等不重复）", () => {
    const [out, changed] = addExcludesToGradle(
      USER_GRADLE,
      { group: "com.google.android.material", name: "material", version: "1.0.0" },
      [{ group: "com.android.support", module: "support-compat" }, { group: "com.android.support", module: "support-media-compat" }],
      false,
    );
    // 已有 support-compat → 不重复；新增 support-media-compat
    expect(changed).toBe(true);
    const compatCount = (out.match(/module: 'support-compat'/g) || []).length;
    expect(compatCount).toBe(1);
    expect(out).toContain("exclude group: 'com.android.support', module: 'support-media-compat'");
  });

  it("无冲突全相同 → 不变", () => {
    const [out, changed] = addExcludesToGradle(
      USER_GRADLE,
      { group: "com.google.android.material", name: "material", version: "1.0.0" },
      [{ group: "com.android.support", module: "support-compat" }],
      false,
    );
    expect(changed).toBe(false);
    expect(out).toBe(USER_GRADLE);
  });
});
