// M430：项目库逐条增删改 —— 数据层纯函数
import { describe, it, expect } from "vitest";
import {
  removeImplementation,
  updateImplementation,
  removeExcludeFromDep,
  addExcludesToGradle,
  applyConflictExcludes,
  insertFileTree,
  updateFileTree,
  removeFileTree,
  parseFileTrees,
  parseGradleDepsDetailed,
  type ConflictForNew,
} from "@/lib/xml/gradle-deps";

const USER = [
  "dependencies {",
  "    implementation 'androidx.percentlayout:percentlayout:1.0.0'",
  "    implementation 'androidx.appcompat:appcompat:1.0.0'",
  "\timplementation ('com.google.android.material:material:1.0.0') {",
  "        exclude group: 'com.android.support', module: 'support-compat'",
  "        exclude group: 'com.android.support', module: 'support-core-ui'",
  "        exclude group: 'com.android.support', module: 'support-fragment'",
  "        exclude group: 'com.android.support', module: 'support-v4'",
  "    }",
  "    implementation 'net.sourceforge.jexcelapi:jxl:2.6.12'",
  "    implementation fileTree(dir: 'libs', include: ['*.jar'])",
  "}",
].join("\n");

describe("M433b addExcludesToGradle 单行依赖必须把 { 补在行尾", () => {
  it("groovy：单行依赖 → 行尾加 { ，不留裸块", () => {
    const [out, ok] = addExcludesToGradle(USER, { group: "androidx.appcompat", name: "appcompat", version: "1.0.0" }, [{ group: "androidx", module: "core" }], false);
    expect(ok).toBe(true);
    const lines = out.split("\n");
    const appIdx = lines.findIndex((l) => l.includes("appcompat:1.0.0"));
    // 依赖行本身必须以 { 结尾
    expect(lines[appIdx].trim().endsWith("{")).toBe(true);
    // 紧跟 exclude，再收 }，中间不能有裸的 "{" 独立行
    expect(lines[appIdx + 1].trim()).toBe("exclude group: 'androidx', module: 'core'");
    expect(lines[appIdx + 2].trim()).toBe("}");
    expect(lines.some((l) => l.trim() === "{")).toBe(false);
    // 括号平衡
    expect((out.match(/\{/g) || []).length).toBe((out.match(/\}/g) || []).length);
    // 仍能被 parser 读出 exclude
    const dep = parseGradleDepsDetailed(out).deps.find((d) => d.name === "appcompat");
    expect(dep?.excludes).toEqual([{ group: "androidx", module: "core" }]);
  });

  it("kts：单行依赖 → 行尾加 { 且 kts 语法", () => {
    const src = ["dependencies {", '    implementation("androidx.appcompat:appcompat:1.0.0")', "}"].join("\n");
    const [out, ok] = addExcludesToGradle(src, { group: "androidx.appcompat", name: "appcompat", version: "1.0.0" }, [{ group: "androidx", module: "core" }], true);
    expect(ok).toBe(true);
    expect(out).toContain('implementation("androidx.appcompat:appcompat:1.0.0") {');
    expect(out).toContain('exclude(group = "androidx", module = "core")');
    expect((out.match(/\{/g) || []).length).toBe((out.match(/\}/g) || []).length);
  });

  it("已有同行 { 块 → 只补 exclude，不加第二层括号", () => {
    const src = [
      "dependencies {",
      "    implementation('com.x:y:1.0.0') {",
      "    }",
      "}",
    ].join("\n");
    const [out, ok] = addExcludesToGradle(src, { group: "com.x", name: "y", version: "1.0.0" }, [{ group: "a", module: "b" }], false);
    expect(ok).toBe(true);
    expect((out.match(/implementation/g) || []).length).toBe(1);
    expect(out).toContain("exclude group: 'a', module: 'b'");
    expect((out.match(/\{/g) || []).length).toBe((out.match(/\}/g) || []).length);
  });

  it("重复调用幂等：同 exclude 不重复写", () => {
    const first = addExcludesToGradle(USER, { group: "androidx.appcompat", name: "appcompat", version: "1.0.0" }, [{ group: "androidx", module: "core" }], false)[0];
    const [second, ok2] = addExcludesToGradle(first, { group: "androidx.appcompat", name: "appcompat", version: "1.0.0" }, [{ group: "androidx", module: "core" }], false);
    expect(ok2).toBe(false);
    expect((second.match(/exclude group/g) || []).length).toBe(5);
  });
});

describe("M433b applyConflictExcludes：冲突处理落在新依赖上，不自我排除", () => {
  it("跨 group 同名 → 新依赖行尾开 { 块，exclude 旧 group:module；旧行不动", () => {
    const src = [
      "dependencies {",
      "    implementation 'com.android.support:support-compat:28.0.0'",
      "    implementation 'androidx.appcompat:appcompat:1.7.0'",
      "}",
    ].join("\n");
    const conflicts: ConflictForNew[] = [
      {
        kind: "name",
        newCoord: "androidx.appcompat:appcompat:1.7.0",
        existing: { group: "com.android.support", name: "support-compat", version: "28.0.0" } as never,
        exclude: { group: "com.android.support", module: "support-compat" },
        why: "cross group same artifact",
      },
    ];
    const [out, changed] = applyConflictExcludes(src, { group: "androidx.appcompat", name: "appcompat", version: "1.7.0" }, conflicts, false);
    expect(changed).toBe(1);
    const lines = out.split("\n");
    const oldIdx = lines.findIndex((l) => l.includes("support-compat:28.0.0"));
    expect(lines[oldIdx].trim()).toBe("implementation 'com.android.support:support-compat:28.0.0'");
    const newIdx = lines.findIndex((l) => l.includes("appcompat:1.7.0"));
    expect(lines[newIdx].trim().endsWith("{")).toBe(true);
    expect(lines[newIdx + 1].trim()).toBe("exclude group: 'com.android.support', module: 'support-compat'");
    expect((out.match(/\{/g) || []).length).toBe((out.match(/\}/g) || []).length);
    // 解析后：新依赖带 exclude，旧依赖不变
    const deps = parseGradleDepsDetailed(out).deps;
    const newDep = deps.find((d) => d.name === "appcompat" && d.version === "1.7.0")!;
    expect(newDep.excludes).toEqual([{ group: "com.android.support", module: "support-compat" }]);
  });

  it("同 group:name 多版本 → 删旧坐标行（exclude 自己没意义）", () => {
    const src = [
      "dependencies {",
      "    implementation 'androidx.appcompat:appcompat:1.0.0'",
      "    implementation 'androidx.appcompat:appcompat:1.7.0'",
      "}",
    ].join("\n");
    const conflicts: ConflictForNew[] = [
      {
        kind: "version",
        newCoord: "androidx.appcompat:appcompat:1.7.0",
        existing: { group: "androidx.appcompat", name: "appcompat", version: "1.0.0" } as never,
        exclude: { group: "androidx.appcompat", module: "appcompat" },
        why: "same artifact different version",
      },
    ];
    const [out, changed] = applyConflictExcludes(src, { group: "androidx.appcompat", name: "appcompat", version: "1.7.0" }, conflicts, false);
    expect(changed).toBe(1);
    expect(out).not.toContain("appcompat:1.0.0");
    expect(out).toContain("appcompat:1.7.0");
    // 新版行不带 exclude 块
    const lines = out.split("\n");
    const newIdx = lines.findIndex((l) => l.includes("appcompat:1.7.0"));
    expect(lines[newIdx].trim()).toBe("implementation 'androidx.appcompat:appcompat:1.7.0'");
  });

  it("无冲突 → 文本原样", () => {
    const src = ["dependencies {", "    implementation 'a:b:1.0'", "}"].join("\n");
    const [out, changed] = applyConflictExcludes(src, { group: "a", name: "b", version: "1.0" }, [], false);
    expect(changed).toBe(0);
    expect(out).toBe(src);
  });
});

describe("M430 removeImplementation 整块删", () => {
  it("单行依赖 → 只删那一行", () => {
    const [out, ok] = removeImplementation(USER, "net.sourceforge.jexcelapi:jxl:2.6.12");
    expect(ok).toBe(true);
    expect(out).not.toContain("jxl");
    expect(out).toContain("appcompat");
  });

  it("带 { exclude } 块的依赖 → 连块一起删，不留孤立括号", () => {
    const [out, ok] = removeImplementation(USER, "com.google.android.material:material:1.0.0");
    expect(ok).toBe(true);
    expect(out).not.toContain("material");
    expect(out).not.toContain("exclude");
    expect(out).not.toContain("support-compat");
    // 括号平衡
    const open = (out.match(/\{/g) || []).length;
    const close = (out.match(/\}/g) || []).length;
    expect(open).toBe(close);
    // 其它依赖没受影响
    expect(out).toContain("percentlayout");
    expect(out).toContain("jxl");
    expect(out).toContain("fileTree");
  });

  it("kts 形式也能整块删", () => {
    const kts = [
      "dependencies {",
      '    implementation("com.example:lib:1.0") {',
      '        exclude(group = "com.a", module = "b")',
      "    }",
      '    implementation("com.example:other:2.0")',
      "}",
    ].join("\n");
    const [out, ok] = removeImplementation(kts, "com.example:lib:1.0");
    expect(ok).toBe(true);
    expect(out).not.toContain("com.example:lib");
    expect(out).not.toContain("exclude");
    expect(out).toContain("com.example:other:2.0");
  });

  it("不存在的坐标 → 不变", () => {
    const [out, ok] = removeImplementation(USER, "no.such:dep:9.9");
    expect(ok).toBe(false);
    expect(out).toBe(USER);
  });
});

describe("M430 updateImplementation 改坐标保块", () => {
  it("改版本号，exclude 块原样保留", () => {
    const [out, ok] = updateImplementation(
      USER,
      "com.google.android.material:material:1.0.0",
      { group: "com.google.android.material", name: "material", version: "1.12.0" },
      false,
    );
    expect(ok).toBe(true);
    expect(out).toContain("com.google.android.material:material:1.12.0");
    expect(out).not.toContain("material:1.0.0");
    // 4 条 exclude 全在
    expect((out.match(/exclude group/g) || []).length).toBe(4);
    expect(out).toContain("support-v4");
  });

  it("改配置类型 implementation → api", () => {
    const [out, ok] = updateImplementation(
      USER,
      "androidx.appcompat:appcompat:1.0.0",
      { group: "androidx.appcompat", name: "appcompat", version: "1.0.0", config: "api" },
      false,
    );
    expect(ok).toBe(true);
    expect(out).toContain("api 'androidx.appcompat:appcompat:1.0.0'");
  });

  it("完全相同 → 不变", () => {
    const [out, ok] = updateImplementation(
      USER,
      "net.sourceforge.jexcelapi:jxl:2.6.12",
      { group: "net.sourceforge.jexcelapi", name: "jxl", version: "2.6.12" },
      false,
    );
    expect(ok).toBe(false);
    expect(out).toBe(USER);
  });

  it("改完仍能被 parser 正确读出（含 exclude）", () => {
    const [out] = updateImplementation(
      USER,
      "com.google.android.material:material:1.0.0",
      { group: "com.google.android.material", name: "material", version: "1.12.0" },
      false,
    );
    const { deps } = parseGradleDepsDetailed(out);
    const mat = deps.find((d) => d.name === "material");
    expect(mat!.version).toBe("1.12.0");
    expect(mat!.excludes).toHaveLength(4);
  });
});

describe("M430 removeExcludeFromDep 删单条", () => {
  const T = { group: "com.google.android.material", name: "material", version: "1.0.0" };

  it("删一条，其余 3 条保留", () => {
    const [out, ok] = removeExcludeFromDep(USER, T, { group: "com.android.support", module: "support-v4" }, false);
    expect(ok).toBe(true);
    expect(out).not.toContain("module: 'support-v4'");
    expect((out.match(/exclude group/g) || []).length).toBe(3);
  });

  it("删最后一条 → 连 { } 壳一起收掉", () => {
    const one = [
      "dependencies {",
      "\timplementation ('com.google.android.material:material:1.0.0') {",
      "        exclude group: 'com.android.support', module: 'support-compat'",
      "    }",
      "    implementation 'net.sourceforge.jexcelapi:jxl:2.6.12'",
      "}",
    ].join("\n");
    const [out, ok] = removeExcludeFromDep(one, T, { group: "com.android.support", module: "support-compat" }, false);
    expect(ok).toBe(true);
    expect(out).not.toContain("exclude");
    // 块壳已收（material 那行不再带 {），且括号仍平衡
    const matLine = out.split("\n").find((l) => l.includes("material:1.0.0"))!;
    expect(matLine).not.toContain("{");
    expect((out.match(/\{/g) || []).length).toBe((out.match(/\}/g) || []).length);
    expect(out).toContain("com.google.android.material:material:1.0.0");
    expect(out).toContain("jxl");
  });

  it("删不存在的 exclude → 不变", () => {
    const [out, ok] = removeExcludeFromDep(USER, T, { group: "x", module: "y" }, false);
    expect(ok).toBe(false);
    expect(out).toBe(USER);
  });
});

describe("M430 fileTree 增删改", () => {
  it("insertFileTree：已有同名 dir+include → 判定已存在", () => {
    const [, existed] = insertFileTree(USER, { dir: "libs", includes: ["*.jar"] }, false);
    expect(existed).toBe(true);
  });

  it("insertFileTree：新目录 → 插进 dependencies 块", () => {
    const [out, existed] = insertFileTree(USER, { dir: "app/libs", includes: ["*.jar", "*.aar"] }, false);
    expect(existed).toBe(false);
    expect(out).toContain("implementation fileTree(dir: 'app/libs', include: ['*.jar', '*.aar'])");
    const fts = parseFileTrees(out);
    expect(fts.map((f) => f.dir)).toContain("app/libs");
    expect(fts).toHaveLength(2);
  });

  it("insertFileTree：完全没有 dependencies 块 → 自动建", () => {
    const bare = "plugins { id 'com.android.application' }\n";
    const [out, existed] = insertFileTree(bare, { dir: "libs", includes: ["*.jar"] }, false);
    expect(existed).toBe(false);
    expect(out).toContain("dependencies {");
    expect(out).toContain("implementation fileTree(dir: 'libs', include: ['*.jar'])");
    expect(parseFileTrees(out)).toHaveLength(1);
  });

  it("updateFileTree：改 dir 和 include", () => {
    const [out, ok] = updateFileTree(USER, "libs", { dir: "app/libs", includes: ["*.jar", "*.aar"] }, false);
    expect(ok).toBe(true);
    expect(out).toContain("dir: 'app/libs'");
    expect(out).toContain("include: ['*.jar', '*.aar']");
    expect(parseFileTrees(out)[0].dir).toBe("app/libs");
    expect(parseFileTrees(out)[0].includes).toEqual(["*.jar", "*.aar"]);
  });

  it("removeFileTree：删掉整行，别的不动", () => {
    const [out, ok] = removeFileTree(USER, "libs");
    expect(ok).toBe(true);
    expect(out).not.toContain("fileTree");
    expect(out).toContain("material");
    expect(out).toContain("jxl");
    expect(parseFileTrees(out)).toHaveLength(0);
  });

  it("removeFileTree：kts mapOf 写法也认", () => {
    const kts = [
      "dependencies {",
      '    implementation(fileTree(mapOf("dir" to "libs", "include" to listOf("*.jar"))))',
      "}",
    ].join("\n");
    const [out] = removeFileTree(kts, "libs");
    expect(out).not.toContain("fileTree");
  });
});
