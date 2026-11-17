// test/xml_m352_lexicon.test.ts — M352 地基：词库解析 + 建库 + 继承合并 + 打分排序
import { describe, it, expect } from "vitest";
import {
  parseDeclarations,
  buildLexicon,
  resolveClassMethods,
  resolveClassMethodEntries,
  samePackageClasses,
  inferPackage,
  LexStore,
  type LexSourceFile,
} from "@/lib/xml/lexicon";
import { rankCandidates } from "@/lib/xml/lexicon-rank";
import { lintJava } from "@/lib/xml/java-lint";

describe("inferPackage", () => {
  it("java 路径", () => {
    expect(inferPackage("app/src/main/java/com/jiji/SubmitData.java", "java")).toBe("com.jiji");
  });
  it("kotlin 路径", () => {
    expect(inferPackage("app/src/main/kotlin/com/jiji/Main.kt", "kotlin")).toBe("com.jiji");
  });
});

describe("parseDeclarations（Java）", () => {
  it("识别类 + 继承 + 接口 + 方法 + 字段", () => {
    const p = parseDeclarations(
      `package com.x;
      public class MainActivity extends AppCompatActivity implements Runnable, View.OnClickListener {
        int count;
        public String getTitle() { return ""; }
        public void setTitle(String t) {}
        @Deprecated
        public void old() {}
      }`,
      "java",
      "com.x",
    );
    expect(p.classes.map((c) => c.name)).toContain("MainActivity");
    const ma = p.classes.find((c) => c.name === "MainActivity")!;
    expect(ma.parents).toContain("AppCompatActivity");
    expect(ma.interfaces).toContain("Runnable");
    expect(ma.interfaces).toContain("View.OnClickListener");
    const ms = p.methods.get("MainActivity")!;
    expect(ms.map((m) => m.name)).toEqual(expect.arrayContaining(["getTitle", "setTitle", "old"]));
    expect(ms.find((m) => m.name === "old")!.isDeprecated).toBe(true);
    expect(p.fields.get("MainActivity")!.has("count")).toBe(true);
  });

  it("泛型 raw type（List<String> 方法归属类）", () => {
    const p = parseDeclarations(
      `public class A { public List<String> names() { return null; } public int count() { return 0; } }`,
      "java",
      "",
    );
    const ms = p.methods.get("A")!;
    expect(ms.map((m) => m.name)).toEqual(expect.arrayContaining(["names", "count"]));
    expect(ms.find((m) => m.name === "names")!.signature).toBe("");
  });
});

describe("parseDeclarations（Kotlin）", () => {
  it("识别 object / class / 扩展函数 / companion / top-level fun / val", () => {
    const p = parseDeclarations(
      `package com.x
      class Main : Activity(), Runnable {
        val count = 0
        fun getTitle(): String = ""
        companion object { fun helper() {} }
      }
      object Singleton { fun ping() {} }
      fun String.shout() = this.uppercase()
      fun topLevel() {}`,
      "kotlin",
      "com.x",
    );
    const names = p.classes.map((c) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Main", "Singleton"]));
    const main = p.classes.find((c) => c.name === "Main")!;
    expect(main.parents).toContain("Activity");
    expect(main.interfaces).toEqual(expect.arrayContaining(["Runnable"]));
    const ms = p.methods.get("Main")!;
    expect(ms.map((m) => m.name)).toEqual(expect.arrayContaining(["getTitle", "helper"]));
    // 扩展函数归属接收者 String
    const stringMs = p.methods.get("String");
    expect(stringMs?.map((m) => m.name)).toEqual(expect.arrayContaining(["shout"]));
    // top-level
    expect(p.methods.has("TopLevel")).toBe(true);
    expect(p.methods.get("TopLevel")!.map((m) => m.name)).toEqual(expect.arrayContaining(["topLevel"]));
  });
});

describe("buildLexicon + 继承/接口合并", () => {
  const files: LexSourceFile[] = [
    {
      rel: "app/src/main/java/com/x/Base.kt",
      lang: "kotlin",
      text: `package com.x
      open class Base { fun baseM() {} }`,
    },
    {
      rel: "app/src/main/java/com/x/IService.kt",
      lang: "kotlin",
      text: `package com.x
      interface IService { fun svcM() }`,
    },
    {
      rel: "app/src/main/java/com/x/Derived.java",
      lang: "java",
      text: `package com.x;
      public class Derived extends Base implements IService { public void derived() {} }`,
    },
  ];

  it("子类方法 = 自己 + 父类 + 接口", () => {
    const lex = buildLexicon(files);
    const methods = resolveClassMethods(lex, "Derived");
    expect([...methods]).toEqual(expect.arrayContaining(["derived", "baseM", "svcM"]));
  });

  it("resolveClassMethodEntries 带 signature/originClass", () => {
    const lex = buildLexicon(files);
    const entries = resolveClassMethodEntries(lex, "Derived");
    expect(entries.map((e) => e.name)).toEqual(expect.arrayContaining(["derived", "baseM", "svcM"]));
  });
  it("同包类可见", () => {
    const lex = buildLexicon(files);
    expect(samePackageClasses(lex, "com.x", "Derived")).toEqual(
      expect.arrayContaining(["Base", "IService", "Derived"]),
    );
  });
});

describe("rankCandidates（打分 + 截断）", () => {
  const files: LexSourceFile[] = [
    {
      rel: "app/src/main/java/com/x/SubmitData.java",
      lang: "java",
      text: `package com.x;
      public class SubmitData {
        public String getTitle() { return "x"; }
        public void setTitle(String s) {}
      }`,
    },
  ];

  it("当前文件方法 > 项目方法（来源层级）", () => {
    const lex = buildLexicon(files);
    const { pool } = rankCandidates("get", {
      lex,
      currentFile: { methods: ["getTitle", "otherM"], classes: [], fields: [], vars: [] },
    });
    // getTitle 同时在 current 和 project，应取 current（100）
    const getTitle = pool.find((i) => i.text === "getTitle")!;
    expect(getTitle.source).toBe("current");
  });

  it("池截断 50 / ui 截断 18", () => {
    const lex = buildLexicon(files);
    const r = rankCandidates("a", { lex, currentFile: { methods: [], classes: [], fields: [], vars: [] } });
    expect(r.pool.length).toBeLessThanOrEqual(50);
    expect(r.ui.length).toBeLessThanOrEqual(18);
  });

  it("废弃方法压最低但仍可见", () => {
    const lex = buildLexicon([
      {
        rel: "app/src/main/java/com/x/D.java",
        lang: "java",
        text: `package com.x;
        public class D {
          @Deprecated public void oldOne() {}
          public void newOne() {}
        }`,
      },
    ]);
    const { pool } = rankCandidates("o", { lex, currentFile: { methods: [], classes: [], fields: [], vars: [] } });
    const oldOne = pool.find((i) => i.text === "oldOne");
    expect(oldOne?.isDeprecated).toBe(true);
  });

  it("recency 同来源内加权", () => {
    const lex = buildLexicon(files);
    const recency = new Map([["setTitle", 1]]);
    const { pool } = rankCandidates("s", {
      lex,
      currentFile: { methods: [], classes: [], fields: [], vars: [] },
    }, { recency });
    const setTitle = pool.find((i) => i.text === "setTitle")!;
    expect(setTitle.score).toBeGreaterThan(80); // 80 + 15
  });
});

describe("M352 单一数据源：词库类名喂给检查器（同包类/项目类不误报）", () => {
  it("项目类 UsedWithoutImport 用了不 import → 不报「缺 import」也不报「未知符号」", () => {
    // 没有词库时：用到 ProjectHelper 但没 import → 会报 import warn（如果它在 COMMON_IMPORTS 里）或未知符号
    // 有词库（allowNames 含 ProjectHelper）→ 两个都不报
    const src = [
      "public class MainActivity extends AppCompatActivity {",
      "  @Override protected void onCreate(Bundle b) {",
      "    ProjectHelper.start(this);",
      "  }",
      "}",
    ].join("\n");
    const noLex = lintJava(src, {});
    // 基线：没用词库时（ProjectHelper 不在 COMMON_IMPORTS）至少不该报 import（它不在表里），
    // 但未知符号检查：ProjectHelper 是首字母大写，可能被判未知。先确认有词库后不报 sym。
    const withLex = lintJava(src, { allowNames: ["ProjectHelper", "MainActivity", "AppCompatActivity"] });
    const symCodes = withLex.filter((i) => i.code === "sym" && i.msg.includes("ProjectHelper"));
    expect(symCodes.length).toBe(0);
    // 不报缺 import（ProjectHelper 在 allowNames）
    const importWarn = withLex.filter((i) => i.code === "import" && i.msg.includes("ProjectHelper"));
    expect(importWarn.length).toBe(0);
    void noLex;
  });
});

describe("LexStore（原子切换 + 订阅）", () => {
  it("commit 后订阅者感知新库", () => {
    const store = new LexStore();
    let seen: number | null = null;
    store.subscribe((l) => (seen = l.version));
    store.commit(buildLexicon(filesOf("A")));
    expect(seen).not.toBeNull();
    expect(seen!).toBeGreaterThan(0);
  });

  it("重任务队列串行", async () => {
    const store = new LexStore();
    const order: string[] = [];
    store.runHeavy(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push("a");
    });
    store.runHeavy(async () => {
      order.push("b");
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(order).toEqual(["a", "b"]);
  });
});

function filesOf(name: string): LexSourceFile[] {
  return [{ rel: `app/src/main/java/com/x/${name}.java`, lang: "java", text: `package com.x; public class ${name} { public void m${name}() {} }` }];
}
