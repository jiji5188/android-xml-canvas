// test/xml_m70_java_lint.test.ts — M70（C2）：Java/Kotlin 轻量静态检查
//
// 只做「明显会编译不过」的本地检查，绝不冒充编译器：
// 括号/引号平衡、R.id.xxx 是否真实存在、常见类缺 import、@Override 位置。
// 输出永远带「未编译验证」声明。
import { describe, expect, it } from "vitest";
import { formatJavaLint, lintJava } from "@/lib/xml/java-lint";
import { collectIds } from "@/lib/xml/ai-usages";
import { AI_TOOL_NAMES, runTool, validateToolCall } from "@/lib/xml/ai-tools";
import type { AiFileIo } from "@/lib/xml/ai-tools";

const codes = (src: string, opts = {}) => lintJava(src, opts).map((i) => i.code);

describe("M70 括号与引号", () => {
  it("正常代码没告警", () => {
    const src = `package a;
public class A {
    void f() {
        if (true) { int x = 1; }
    }
}`;
    expect(lintJava(src)).toEqual([]);
  });

  it("缺右花括号 → error，行号指向开括号", () => {
    const src = `public class A {\n    void f() {\n        int x = 1;\n}`;
    const issues = lintJava(src);
    expect(issues[0].code).toBe("brace");
    expect(issues[0].sev).toBe("error");
    expect(issues[0].line).toBe(1);
    expect(issues[0].msg).toContain("没有闭合");
  });

  it("多一个右括号 → error", () => {
    const issues = lintJava(`public class A { void f() { } } }`);
    expect(issues.some((i) => i.code === "brace" && i.msg.includes("多余"))).toBe(true);
  });

  it("括号类型错配 → error", () => {
    const issues = lintJava(`public class A { void f(] { } }`);
    expect(issues.some((i) => i.code === "brace" && i.msg.includes("不配对"))).toBe(true);
  });

  it("字符串没闭合 → 只报 quote，不再堆一串括号错", () => {
    const src = `public class A {\n    String s = "abc;\n}`;
    const issues = lintJava(src);
    expect(issues.length).toBe(1);
    expect(issues[0].code).toBe("quote");
    expect(issues[0].line).toBe(2);
  });

  it("注释和字符串里的括号不算结构", () => {
    const src = `public class A {\n    // { ( [\n    String s = "}  ]  )";\n    /* { */\n}`;
    expect(codes(src)).not.toContain("brace");
  });
});

describe("M70 R.id 校验", () => {
  const src = `public class A {
    void f() {
        findViewById(R.id.btn_ok);
        setTitle(R.id.btn_typo);
    }
}`;

  it("给 ids 时，不存在的 id 报 warn", () => {
    const issues = lintJava(src, { ids: ["btn_ok"] });
    const rid = issues.filter((i) => i.code === "rid");
    expect(rid.length).toBe(1);
    expect(rid[0].msg).toContain("btn_typo");
    expect(rid[0].sev).toBe("warn");
    expect(rid[0].line).toBe(4);
  });

  it("同一个错 id 重复出现只报一次", () => {
    const many = `class A { void f(){ a(R.id.nope); b(R.id.nope); } }`;
    expect(lintJava(many, { ids: ["ok"] }).filter((i) => i.code === "rid").length).toBe(1);
  });

  it("不传 ids 就不查（避免空项目全红）", () => {
    expect(lintJava(src).filter((i) => i.code === "rid")).toEqual([]);
  });
});

describe("M70 缺 import 与 @Override", () => {
  it("用了 Intent 但没 import → warn", () => {
    const src = `package a;\npublic class A { void f() { Intent it = new Intent(); } }`;
    const issues = lintJava(src).filter((i) => i.code === "import");
    expect(issues.length).toBe(1);
    expect(issues[0].msg).toContain("android.content.Intent");
  });

  it("已 import 或同包类不再提示", () => {
    const src = `package a;\nimport android.content.Intent;\npublic class A { void f() { Intent it = new Intent(); } }`;
    expect(lintJava(src).filter((i) => i.code === "import")).toEqual([]);
    const same = `package android.content;\npublic class A { void f() { Intent it = new Intent(); } }`;
    expect(lintJava(same).filter((i) => i.code === "import")).toEqual([]);
  });

  it("@Override 后面没有方法声明 → warn", () => {
    const src = `public class A {\n    @Override\n    int x = 1;\n}`;
    const issues = lintJava(src).filter((i) => i.code === "override");
    expect(issues.length).toBe(1);
    expect(issues[0].line).toBe(2);
  });

  it("正常 @Override 不提示；Kotlin 跳过这条", () => {
    const ok = `public class A {\n    @Override\n    public String toString() { return ""; }\n}`;
    expect(lintJava(ok).filter((i) => i.code === "override")).toEqual([]);
    const kt = `class A {\n    @Override\n    val x = 1\n}`;
    expect(lintJava(kt, { isKotlin: true }).filter((i) => i.code === "override")).toEqual([]);
  });
});

describe("M70 文案", () => {
  it("没问题是也说清未编译验证", () => {
    const text = formatJavaLint([]);
    expect(text).toContain("未编译验证");
  });

  it("有问题时按行列出，并带错误/注意计数", () => {
    const issues = lintJava(`public class A { void f() { String s = "x; } }`);
    const text = formatJavaLint(issues, "MainActivity.java ");
    expect(text).toContain("MainActivity.java");
    expect(text).toMatch(/查出 \d+ 个错误、\d+ 个可疑点/);
    expect(text).toContain("L1");
  });
});

describe("M70 接入 check_java 工具", () => {
  const files: Record<string, string> = {
    "app/src/main/res/layout/a.xml": `<Button android:id="@+id/btn_ok" />`,
    "app/src/main/java/com/demo/MainActivity.java": `package com.demo;
public class MainActivity {
    void f() {
        findViewById(R.id.btn_ok);
        findViewById(R.id.btn_missing);
    }
}
`,
    "app/src/main/java/com/demo/Broken.java": `package com.demo;
public class Broken {
    void f() {
        if (true) {
    }
}
`,
  };
  const dirs: Record<string, string[]> = {};
  for (const rel of Object.keys(files)) {
    const parts = rel.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts.slice(0, i + 1).join("/");
      const child = i + 1 < parts.length - 1 ? `${d}/${parts[i + 1]}` : rel;
      dirs[d] = dirs[d] || [];
      if (!dirs[d].includes(child)) dirs[d].push(child);
    }
  }
  dirs[""] = Array.from(new Set(Object.keys(files).map((r) => r.split("/")[0])));
  const io: AiFileIo = {
    rootLabel: () => "/proj",
    async list(rel) {
      const items = dirs[rel];
      if (!items) return { ok: false, error: "没有这个目录" };
      return {
        ok: true,
        items: items.map((rel2) => ({
          kind: files[rel2] !== undefined ? ("file" as const) : ("dir" as const),
          name: rel2.split("/").pop() || rel2,
          rel: rel2,
        })),
      };
    },
    async read(rel) {
      const t = files[rel];
      return t === undefined ? { ok: false, error: "没有这个文件" } : { ok: true, text: t };
    },
    async write() {
      return { ok: true };
    },
  };

  it("check_java 在工具名单里", () => {
    expect(AI_TOOL_NAMES).toContain("check_java");
  });

  it("只接受 java/kt/kts", () => {
    expect(validateToolCall({ tool: "check_java" })).toContain("args.path");
    expect(validateToolCall({ tool: "check_java", path: "a.xml" })).toContain("只支持");
    expect(validateToolCall({ tool: "check_java", path: "A.java" })).toBeNull();
  });

  it("跑工具会读到项目 id 并报出拼错的 R.id", async () => {
    const out = await runTool({ tool: "check_java", path: "app/src/main/java/com/demo/MainActivity.java" }, io);
    expect(out).toContain("btn_missing");
    expect(out).toContain("未编译验证");
    expect(out).not.toContain("btn_ok 在项目布局里不存在");
  });

  it("括号不配会被拦下", async () => {
    const out = await runTool({ tool: "check_java", path: "app/src/main/java/com/demo/Broken.java" }, io);
    expect(out).toContain("错误");
    expect(out).toContain("没有闭合");
  });

  it("文件不存在时报人话错误", async () => {
    const out = await runTool({ tool: "check_java", path: "app/src/main/java/com/demo/Nope.java" }, io);
    expect(out).toContain("错误");
  });

  it("collectIds 从 layout 收集 id 并缓存", async () => {
    const ids = await collectIds(io);
    expect(Array.from(ids)).toEqual(["btn_ok"]);
    const again = await collectIds(io);
    expect(again).toBe(ids); // WeakMap 缓存，同一 Promise
  });
});
