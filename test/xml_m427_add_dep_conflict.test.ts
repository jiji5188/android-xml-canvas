// M427：加依赖冲突检测 + exclude 注入（纯函数）
import { describe, it, expect } from "vitest";
import { findConflictsForNew, addExcludesToGradle } from "@/lib/xml/gradle-deps";
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
    expect(out).toContain("implementation 'com.example:lib:1.0'");
    expect(out).toContain("exclude group: 'com.other', module: 'lib'");
    expect(out).toMatch(/implementation 'com\.example:lib:1\.0'\s*\{/);
  });

  it("kts：implementation( ) 形式追加 exclude(group=, module=)", () => {
    const text = 'dependencies {\n    implementation("com.example:lib:1.0")\n}';
    const [out, changed] = addExcludesToGradle(text, { group: "com.example", name: "lib", version: "1.0" }, [{ group: "com.other", module: "lib" }], true);
    expect(changed).toBe(true);
    expect(out).toContain('implementation("com.example:lib:1.0")');
    expect(out).toContain('exclude(group = "com.other", module = "lib")');
  });

  it("已有 exclude 块 → 不重复追加", () => {
    const text = "dependencies {\n    implementation 'com.example:lib:1.0' {\n        exclude group: 'x', module: 'y'\n    }\n}";
    const [out, changed] = addExcludesToGradle(text, { group: "com.example", name: "lib", version: "1.0" }, [{ group: "a", module: "b" }], false);
    expect(changed).toBe(false);
    expect(out).toBe(text);
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
