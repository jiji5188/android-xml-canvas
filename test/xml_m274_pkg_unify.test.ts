import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ProjectSource, BrowseEntry } from "../lib/xml/project-browse";

const writes = new Map<string, string>();

vi.mock("../lib/xml/project-save", async (orig) => {
  const actual = await (orig as () => Promise<Record<string, unknown>>)();
  return {
    ...actual,
    saveProjectFile: async (_root: unknown, rel: string, text: string) => {
      writes.set(rel.replace(/\\/g, "/"), text);
      return true;
    },
  };
});

import {
  extractPackageDecl,
  dedupeImports,
  rewritePkgMap,
  detectPkgState,
  suggestOldPkgs,
  planPkgRename,
  unifyPackageTo,
} from "../lib/xml/pkg-rename";

/** 内存版 ProjectSource：files 是 rel → 内容；目录由路径前缀推导 */
function fakeSource(files: Record<string, string>): ProjectSource {
  const dirs = new Set<string>([""]);
  for (const rel of Object.keys(files)) {
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join("/"));
  }
  return {
    name: "demo",
    async listChildren(rel: string): Promise<BrowseEntry[]> {
      const prefix = rel ? rel + "/" : "";
      const out: BrowseEntry[] = [];
      const seen = new Set<string>();
      for (const p of [...dirs, ...Object.keys(files)]) {
        if (rel && !p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest) continue;
        const seg = rest.split("/")[0];
        if (seen.has(seg)) continue;
        seen.add(seg);
        const isDir = dirs.has(prefix + seg);
        out.push({ name: seg, kind: isDir ? "dir" : "file", rel: prefix + seg } as BrowseEntry);
      }
      return out;
    },
    async readText(rel: string) {
      return files[rel] ?? null;
    },
  };
}

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.momo.ReturnSystem3">
  <application android:name="com.momo.ReturnSystem3.App">
    <activity android:name="com.momo.ReturnSystem.MainActivity" />
  </application>
</manifest>`;

const GRADLE = `android {
    namespace 'com.momo.ReturnSystem2'
    defaultConfig { applicationId "com.momo.ReturnSystem2" }
}`;

function baseFiles(): Record<string, string> {
  return {
    "app/build.gradle": GRADLE,
    "app/src/main/AndroidManifest.xml": MANIFEST,
    "app/src/main/java/com/momo/ReturnSystem/MainActivity.java":
      "package com.momo.ReturnSystem;\n\nimport com.momo.ReturnSystem2.util.Helper;\n\npublic class MainActivity { Helper h; }\n",
    "app/src/main/java/com/momo/ReturnSystem/Helper.java":
      "package com.momo.ReturnSystem;\n\npublic class Helper {}\n",
    "app/src/main/java/com/momo/ReturnSystem2/TableAdapter.java":
      "package com.momo.ReturnSystem2;\n\nimport com.momo.ReturnSystem.R;\n\npublic class TableAdapter { int id = R.id.x; }\n",
    "app/src/main/java/com/momo/ReturnSystem2/util/Helper.java":
      "package com.momo.ReturnSystem2.util;\n\npublic class Helper {}\n",
    "app/src/main/java/com/momo/ReturnSystem3/App.java":
      "package com.momo.ReturnSystem3;\n\npublic class App {}\n",
  };
}

beforeEach(() => {
  writes.clear();
});

describe("extractPackageDecl", () => {
  it("Java / Kotlin 都能抠出来", () => {
    expect(extractPackageDecl("package com.a.b;\nclass X{}")).toBe("com.a.b");
    expect(extractPackageDecl("// hi\npackage com.a.b\nclass X")).toBe("com.a.b");
  });
  it("没有声明 → null", () => {
    expect(extractPackageDecl("class X {}")).toBeNull();
    expect(extractPackageDecl("")).toBeNull();
  });
});

describe("dedupeImports", () => {
  it("重复 import 只留一条", () => {
    const t = "package a;\nimport x.R;\nimport x.R;\nimport y.Z;\nclass C{}";
    expect(dedupeImports(t)).toBe("package a;\nimport x.R;\nimport y.Z;\nclass C{}");
  });
});

describe("rewritePkgMap", () => {
  it("单个旧包名全量替换", () => {
    const r = rewritePkgMap("package com.a;\nimport com.a.R;\nclass C{ com.a.D d; }", { "com.a": "com.b" });
    expect(r.changed).toBe(true);
    expect(r.text).toBe("package com.b;\nimport com.b.R;\nclass C{ com.b.D d; }");
  });

  it("长名优先：ReturnSystem2 不被 ReturnSystem 吃掉", () => {
    const doc = "package com.momo.ReturnSystem2;\nimport com.momo.ReturnSystem.R;";
    const r = rewritePkgMap(doc, {
      "com.momo.ReturnSystem2": "com.momo.X",
      "com.momo.ReturnSystem": "com.momo.X",
    });
    expect(r.text).toBe("package com.momo.X;\nimport com.momo.X.R;");
  });

  it("不误伤前缀相同的别的包（com.a 不碰 com.ab / com.a2）", () => {
    const doc = "import com.ab.Y;\nimport com.a2.Z;";
    const r = rewritePkgMap(doc, { "com.a": "com.b" });
    expect(r.changed).toBe(false);
    expect(r.text).toBe(doc);
  });

  it("子包保层次：旧包前缀换掉，.util 留下", () => {
    const r = rewritePkgMap("package com.a.util;\nclass C{}", { "com.a": "com.b" });
    expect(r.text).toBe("package com.b.util;\nclass C{}");
  });

  it("改名后 import 并重 → 去重", () => {
    const doc = "import com.old.R;\nimport com.new.R;\nclass C{}";
    const r = rewritePkgMap(doc, { "com.old": "com.new" });
    expect(r.text).toBe("import com.new.R;\nclass C{}");
  });
});

describe("detectPkgState", () => {
  it("识别三个共存包名 + manifest + gradle", async () => {
    const st = await detectPkgState(fakeSource(baseFiles()));
    expect(st.consistent).toBe(false);
    expect(st.sourcePkgs.map((s) => s.pkg).sort()).toEqual([
      "com.momo.ReturnSystem",
      "com.momo.ReturnSystem2",
      "com.momo.ReturnSystem2.util",
      "com.momo.ReturnSystem3",
    ]);
    expect(st.dominant).toBe("com.momo.ReturnSystem");
    expect(st.manifestPkg).toBe("com.momo.ReturnSystem3");
    expect(st.gradlePkg).toBe("com.momo.ReturnSystem2");
    expect(st.all).toContain("com.momo.ReturnSystem2.util");
  });

  it("只有一个包名 → consistent", async () => {
    const files = {
      "app/src/main/java/com/a/Main.java": "package com.a;\nclass Main{}",
    };
    const st = await detectPkgState(fakeSource(files));
    expect(st.consistent).toBe(true);
    expect(st.all).toEqual(["com.a"]);
  });

  it("suggestOldPkgs 排除目标与子包（避免子包被拍平）", async () => {
    const st = await detectPkgState(fakeSource(baseFiles()));
    const olds = suggestOldPkgs(st, "com.momo.ReturnSystem3");
    expect(olds).toContain("com.momo.ReturnSystem");
    expect(olds).not.toContain("com.momo.ReturnSystem3");
    expect(olds).not.toContain("com.momo.ReturnSystem2.util");
  });

  it("M402 目标就是父包时：子包不是残留，roots 为空（不再误报/拍平）", async () => {
    const files: Record<string, string> = {
      "app/build.gradle": `android {\n    namespace 'com.momo.ReturnSystem'\n    defaultConfig { applicationId "com.momo.ReturnSystem" }\n}`,
      "app/src/main/java/com/momo/ReturnSystem/MainActivity.java": "package com.momo.ReturnSystem;\nclass Main{}",
      "app/src/main/java/com/momo/ReturnSystem/data/Repo.java": "package com.momo.ReturnSystem.data;\nclass Repo{}",
      "app/src/main/java/com/momo/ReturnSystem/Utlis/Str.java": "package com.momo.ReturnSystem.Utlis;\nclass Str{}",
    };
    const st = await detectPkgState(fakeSource(files));
    const plan = planPkgRename(st, "com.momo.ReturnSystem");
    expect(plan.roots).toEqual([]);
    expect(plan.ancestors).toEqual([]);
    expect(suggestOldPkgs(st, "com.momo.ReturnSystem")).toEqual([]);
  });

  it("M402 真改根包名时只映射根包，子包层次保留（old.data → new.data）", async () => {
    const files: Record<string, string> = {
      "app/build.gradle": GRADLE,
      "app/src/main/java/com/momo/ReturnSystem/Main.java": "package com.momo.ReturnSystem;\nclass Main{}",
      "app/src/main/java/com/momo/ReturnSystem/data/Repo.java":
        "package com.momo.ReturnSystem.data;\nimport com.momo.ReturnSystem.R;\nclass Repo{}",
    };
    const src = fakeSource(files);
    const st = await detectPkgState(src);
    const olds = suggestOldPkgs(st, "com.new.App");
    // 根包折叠：ReturnSystem2.util 被父包 ReturnSystem2 覆盖；.data 被根包 ReturnSystem 覆盖
    expect(olds).toEqual(["com.momo.ReturnSystem", "com.momo.ReturnSystem2"]);
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "com.new.App", olds);
    expect(res.ok).toBe(true);
    const repo = writes.get("app/src/main/java/com/momo/ReturnSystem/data/Repo.java")!;
    expect(repo).toContain("package com.new.App.data;");
    expect(repo).toContain("import com.new.App.R;");
    expect(repo).not.toContain("package com.new.App;");
  });

  it("M402 目标是现有包的子包：祖先不自动改，告警 pkg-ancestor-skipped", async () => {
    const files: Record<string, string> = {
      "app/src/main/java/com/momo/ReturnSystem/Main.java": "package com.momo.ReturnSystem;\nclass Main{}",
    };
    const src = fakeSource(files);
    const st = await detectPkgState(src);
    const plan = planPkgRename(st, "com.momo.ReturnSystem.data");
    expect(plan.roots).toEqual([]);
    expect(plan.ancestors).toEqual(["com.momo.ReturnSystem"]);
    // 直接传给 unify（调用方失误场景）也不得套两层
    const res = await unifyPackageTo(
      src, { kind: "native", base: "/tmp/x" }, null, "com.momo.ReturnSystem.data",
      ["com.momo.ReturnSystem", "com.momo.ReturnSystem.data"],
    );
    expect(res.warnings.some((w) => w.startsWith("pkg-ancestor-skipped:"))).toBe(true);
    expect(writes.size).toBe(0);
  });

  it("M402 unify 内部再守卫：调用方误传目标子包也不拍平", async () => {
    const files: Record<string, string> = {
      "app/src/main/java/com/momo/Old/Main.java": "package com.momo.Old;\nclass Main{}",
      "app/src/main/java/com/momo/Old/data/Repo.java": "package com.momo.Old.data;\nclass Repo{}",
    };
    const src = fakeSource(files);
    const res = await unifyPackageTo(
      src, { kind: "native", base: "/tmp/x" }, null, "com.momo.Old",
      ["com.momo.Old", "com.momo.Old.data"], // 调用方误把子包也传进来
    );
    expect(res.files).toEqual([]);
    expect(writes.size).toBe(0);
  });
});

describe("unifyPackageTo", () => {
  it("源码 / manifest / gradle 全改到目标包名", async () => {
    const src = fakeSource(baseFiles());
    const st = await detectPkgState(src);
    const olds = suggestOldPkgs(st, "com.momo.ReturnSystem3");
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "com.momo.ReturnSystem3", olds);

    expect(res.ok).toBe(true);
    // 源码
    const main = writes.get("app/src/main/java/com/momo/ReturnSystem/MainActivity.java")!;
    expect(main).toContain("package com.momo.ReturnSystem3;");
    expect(main).toContain("import com.momo.ReturnSystem3.util.Helper;");
    const ta = writes.get("app/src/main/java/com/momo/ReturnSystem2/TableAdapter.java")!;
    expect(ta).toContain("package com.momo.ReturnSystem3;");
    expect(ta).toContain("import com.momo.ReturnSystem3.R;");
    // manifest 两个引用都改齐
    const man = writes.get("app/src/main/AndroidManifest.xml")!;
    expect(man).toContain('package="com.momo.ReturnSystem3"');
    expect(man).toContain('android:name="com.momo.ReturnSystem3.MainActivity"');
    expect(man).not.toContain("com.momo.ReturnSystem.");
    // gradle（setGradlePackage 统一用双引号）
    const g = writes.get("app/build.gradle")!;
    expect(g).toContain('namespace "com.momo.ReturnSystem3"');
    expect(g).toContain('applicationId "com.momo.ReturnSystem3"');
    // 没有 fileOps → 明确告警不静默
    expect(res.warnings).toContain("pkg-move-unsupported");
    expect(res.movedDirs).toEqual([]);
  });

  it("目标就是唯一包名时什么都不改", async () => {
    const files = { "app/src/main/java/com/a/Main.java": "package com.a;\nclass Main{}" };
    const src = fakeSource(files);
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "com.a", []);
    expect(res.files).toEqual([]);
    expect(writes.size).toBe(0);
  });

  it("空目标 → ok=false 且不写任何东西", async () => {
    const src = fakeSource(baseFiles());
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "  ", ["com.momo.ReturnSystem"]);
    expect(res.ok).toBe(false);
    expect(writes.size).toBe(0);
  });
});

describe("unifyPackageTo M280（res 类名引用 + assets 硬编码提示）", () => {
  function resFiles(): Record<string, string> {
    return {
      "app/build.gradle": GRADLE,
      "app/src/main/AndroidManifest.xml": MANIFEST,
      "app/src/main/java/com/momo/ReturnSystem/MainActivity.java":
        "package com.momo.ReturnSystem;\n\nclass MainActivity {}\n",
      "app/src/main/res/layout/toolbar.xml":
        `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">\n  <com.momo.ReturnSystem.view.BottomBar android:id="@+id/bb"/>\n  <com.momo.ReturnSystem2.fragments.HomeFragment/>\n</LinearLayout>\n`,
      "assets/config.json": '{"pkg": "com.momo.ReturnSystem", "name": "x"}',
    };
  }

  it("res xml 里自定义 View/Fragment 全限定类名被替换进 resClassRefs", async () => {
    const src = fakeSource(resFiles());
    const st = await detectPkgState(src);
    const olds = suggestOldPkgs(st, "com.momo.ReturnSystem3");
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "com.momo.ReturnSystem3", olds);
    const xml = writes.get("app/src/main/res/layout/toolbar.xml")!;
    expect(xml).toContain("com.momo.ReturnSystem3.view.BottomBar");
    expect(xml).toContain("com.momo.ReturnSystem3.fragments.HomeFragment");
    expect(res.resClassRefs).toContain("app/src/main/res/layout/toolbar.xml");
  });

  it("assets 硬编码旧包名只列提示、不自动改", async () => {
    const src = fakeSource(resFiles());
    const st = await detectPkgState(src);
    const olds = suggestOldPkgs(st, "com.momo.ReturnSystem3");
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "com.momo.ReturnSystem3", olds);
    expect(res.assetsHints).toContain("assets/config.json");
    // assets 本身没被写（不在 writes 里）
    expect(writes.has("assets/config.json")).toBe(false);
  });
});

describe("unifyPackageTo M282（gradle 同步不再被静默跳过）", () => {
  it("map 空（源码已是新包名）仍同步 gradle", async () => {
    const files: Record<string, string> = {
      "app/build.gradle": GRADLE,
      "app/src/main/java/com/a/Main.java": "package com.a;\nclass Main{}",
    };
    const src = fakeSource(files);
    // 目标 com.a 已是源码包名 → map 空；但 gradle 是 com.momo.ReturnSystem2 → 仍要改到 com.a
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "com.a", []);
    expect(res.gradles).toContain("app/build.gradle");
    const g = writes.get("app/build.gradle")!;
    expect(g).toContain('namespace "com.a"');
    expect(g).toContain('applicationId "com.a"');
  });

  it("没找到 build.gradle → 明确告警 gradle-not-found", async () => {
    const files: Record<string, string> = {
      "app/src/main/java/com/a/Main.java": "package com.a;\nclass Main{}",
    };
    const src = fakeSource(files);
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "com.b", ["com.a"]);
    expect(res.warnings).toContain("gradle-not-found");
  });

  it("gradle 里没有 namespace/applicationId → 告警 gradle-unsupported", async () => {
    const files: Record<string, string> = {
      "app/build.gradle": "plugins { id 'com.android.application' }\nandroid { compileSdk 35 }",
      "app/src/main/java/com/a/Main.java": "package com.a;\nclass Main{}",
    };
    const src = fakeSource(files);
    const res = await unifyPackageTo(src, { kind: "native", base: "/tmp/x" }, null, "com.b", ["com.a"]);
    expect(res.warnings.some((w) => w.startsWith("gradle-unsupported:"))).toBe(true);
    expect(res.gradles).toEqual([]);
  });
});
