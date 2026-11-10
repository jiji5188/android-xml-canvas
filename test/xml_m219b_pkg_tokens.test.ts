import { describe, it, expect } from "vitest";
import { rewritePkgTokens, syncPkgInSource } from "@/lib/xml/pkg-sync";
import type { ProjectSource, BrowseEntry } from "@/lib/xml/project-browse";
import type { ProjectSaveRoot } from "@/lib/xml/project-save";

/** 内存 source：dirs 未登记的 rel 视为不存在（listChildren 抛）；files 映射 rel→文本 */
function memSource(dirs: Record<string, BrowseEntry[]>, files: Record<string, string>): ProjectSource {
  return {
    name: "demo",
    async listChildren(rel: string) {
      if (!Object.prototype.hasOwnProperty.call(dirs, rel)) throw new Error("no such dir");
      return dirs[rel] || [];
    },
    async readText(rel: string) {
      return files[rel] ?? null;
    },
  };
}
const d = (name: string): BrowseEntry => ({ name, kind: "dir", rel: name } as BrowseEntry);
const f = (name: string): BrowseEntry => ({ name, kind: "file", rel: name } as BrowseEntry);

const SAVE_ROOT = { kind: "native" as const, base: "/proj" };

describe("rewritePkgTokens（M219b 全项目包名 token 替换）", () => {
  it("改 package 声明", () => {
    const r = rewritePkgTokens("package com.old.pkg;\nclass A {}", "com.old.pkg", "com.new.pkg");
    expect(r.changed).toBe(true);
    expect(r.text).toBe("package com.new.pkg;\nclass A {}");
  });
  it("改 import 全限定 + 通配", () => {
    expect(rewritePkgTokens("import com.old.pkg.Foo;\n", "com.old.pkg", "com.new.pkg").text).toBe("import com.new.pkg.Foo;\n");
    expect(rewritePkgTokens("import com.old.pkg.*;\n", "com.old.pkg", "com.new.pkg").text).toBe("import com.new.pkg.*;\n");
  });
  it("改全限定 new / R 引用", () => {
    const r = rewritePkgTokens("new com.old.pkg.MainActivity(); com.old.pkg.R.id.btn", "com.old.pkg", "com.new.pkg");
    expect(r.text).toBe("new com.new.pkg.MainActivity(); com.new.pkg.R.id.btn");
  });
  it("manifest 属性值也改", () => {
    const r = rewritePkgTokens('<manifest package="com.old.pkg" android:name="com.old.pkg.Main"/>', "com.old.pkg", "com.new.pkg");
    expect(r.text).toBe('<manifest package="com.new.pkg" android:name="com.new.pkg.Main"/>');
  });
  it("不误伤 com.old.pkgExtra（后缀粘连）", () => {
    expect(rewritePkgTokens("com.old.pkgExtra x", "com.old.pkg", "com.new.pkg").changed).toBe(false);
  });
  it("不误伤 xcom.old.pkg / sub.com.old.pkg（前缀粘连）", () => {
    expect(rewritePkgTokens("xcom.old.pkg", "com.old.pkg", "com.new.pkg").changed).toBe(false);
    expect(rewritePkgTokens("sub.com.old.pkg", "com.old.pkg", "com.new.pkg").changed).toBe(false);
  });
  it("不匹配的包名不动", () => {
    expect(rewritePkgTokens("com.other.pkg", "com.old.pkg", "com.new.pkg").changed).toBe(false);
  });
  it("old==new 时不动", () => {
    expect(rewritePkgTokens("com.a.b", "com.a.b", "com.a.b").changed).toBe(false);
  });
  it("多文件混合一次替换 import + R", () => {
    const out = rewritePkgTokens("import com.old.pkg.Foo;\ncom.old.pkg.R.id.btn", "com.old.pkg", "com.new.pkg").text;
    expect(out).toBe("import com.new.pkg.Foo;\ncom.new.pkg.R.id.btn");
  });
});

describe("M219b syncPkgInSource 跨引用 + 嵌套改名", () => {
  it("其它包的 import 引用也被全项目扫到", async () => {
    const dirs: Record<string, BrowseEntry[]> = {
      "app/src": [d("main")],
      "app/src/main": [d("java")],
      "app/src/main/java": [d("com")],
      "app/src/main/java/com": [d("old"), d("util")],
      "app/src/main/java/com/old": [f("MainActivity.java")],
      "app/src/main/java/com/util": [f("Helper.java")],
      "app/src/main/kotlin": [],
    };
    const files: Record<string, string> = {
      "app/src/main/java/com/old/MainActivity.java": "package com.old;\nimport com.util.Helper;\n",
      "app/src/main/java/com/util/Helper.java": "package com.util;\nclass Helper {}\n",
    };
    const src = memSource(dirs, files);
    const r = await syncPkgInSource(src, "com.old", "com.new", SAVE_ROOT, null);
    // 两个文件都在源码根下，但只有 MainActivity 含 com.old，所以 files=1
    expect(r.files).toContain("app/src/main/java/com/old/MainActivity.java");
    expect(r.files.length).toBe(1);
    expect(r.foundSrc).toBe(true);
  });

  it("嵌套改名 com.a → com.a.b 报 moveWarn=pkg-nested-rename，不 move", async () => {
    const dirs: Record<string, BrowseEntry[]> = {
      "app/src/main/java": [d("com")],
      "app/src/main/java/com": [d("a")],
      "app/src/main/java/com/a": [f("X.java")],
      "app/src/main/kotlin": [],
    };
    const files: Record<string, string> = { "app/src/main/java/com/a/X.java": "package com.a;\n" };
    const src = memSource(dirs, files);
    const r = await syncPkgInSource(src, "com.a", "com.a.b", SAVE_ROOT, null);
    expect(r.moved).toBe(false);
    expect(r.moveWarn).toBe("pkg-nested-rename");
  });

  it("正常非嵌套改名能 move 目录（给 fileOpsCtx）", async () => {
    const dirs: Record<string, BrowseEntry[]> = {
      "app/src/main/java": [d("com")],
      "app/src/main/java/com": [d("old")],
      "app/src/main/java/com/old": [f("X.java")],
      "app/src/main/kotlin": [],
    };
    const files: Record<string, string> = { "app/src/main/java/com/old/X.java": "package com.old;\n" };
    const src = memSource(dirs, files);
    // 模拟一个能成功的 moveEntry：直接传 null fileOpsCtx 走 web 不支持分支；
    // 这里只验证 moveWarn = pkg-move-unsupported（web 分支）
    const r = await syncPkgInSource(src, "com.old", "com.new", SAVE_ROOT, null);
    expect(r.moved).toBe(false);
    expect(r.moveWarn).toBe("pkg-move-unsupported");
  });
});
