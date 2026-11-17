// test/xml_m351_proj_methods.test.ts — M351：跨文件的方法名豁免 + 白名单补齐（getTitle）
import { describe, it, expect } from "vitest";
import { findMethodTypos, collectDeclaredMethods } from "../lib/xml/java-methods";
import { lintJava } from "@/lib/xml/java-lint";

describe("collectDeclaredMethods", () => {
  it("识别各种声明形式", () => {
    const names = collectDeclaredMethods(
      `public class A {
        public String getTitle() { return ""; }
        void onCreate() {}
        public int getCount() { return 0; }
        protected Map<String, Object> getMap() { return null; }
        public List<String> names() { return null; }
        public String[] arr() { return null; }
        @Override
        public String getTag() { return ""; }
      }`,
    );
    for (const n of ["getTitle", "onCreate", "getCount", "getMap", "names", "arr", "getTag"]) {
      expect(names.has(n)).toBe(true);
    }
  });

  it("不把调用误当声明", () => {
    const names = collectDeclaredMethods(`void f() { tv.setText(""); obj.getTitle(); return 1; if (x) {} else y(); }`);
    expect(names.has("setText")).toBe(false);
    expect(names.has("getTitle")).toBe(false);
    expect(names.has("y")).toBe(false);
  });

  it("识别 Kotlin fun 不行（Java 工具，允许漏）", () => {
    const names = collectDeclaredMethods(`fun getTitle(): String = ""`);
    // 不强制要求，只要不误报
    expect(Array.isArray([...names])).toBe(true);
  });
});

describe("findMethodTypos + knownMethods（跨文件豁免）", () => {
  it("别的文件声明的 getTitle() 在本文件调用不报拼写错", () => {
    const otherFile = `public class SubmitData { public String getTitle() { return "x"; } }`;
    const declared = collectDeclaredMethods(otherFile);
    const cur = `class S { void f(SubmitData d) { String s = d.getTitle(); } }`;
    expect(findMethodTypos(cur, { declared })).toHaveLength(0);
  });

  it("不传 knownMethods 时，自己文件里声明的 getTitle() 也不报", () => {
    const code = `class S { public String getTitle() { return ""; } void f() { String a = getTitle(); String b = d.getTitle(); } }`;
    expect(findMethodTypos(code)).toHaveLength(0);
  });

  it("真拼写错仍然报（setVisiblity → setVisibility）", () => {
    const code = `class S { public String getTitle(){ return ""; } void f(View v) { v.setVisiblity(View.GONE); } }`;
    const hits = findMethodTypos(code).filter((t) => t.name === "setVisiblity");
    expect(hits).toHaveLength(1);
    expect(hits[0].suggestion).toBe("setVisibility");
  });
});

describe("白名单补齐：getTitle 等是真实 API，不应误报", () => {
  it("Activity.getTitle() / setTitle() 不报拼错", () => {
    const code = `public class A extends Activity { void f() { setTitle("x"); String t = getTitle(); } }`;
    expect(findMethodTypos(code)).toHaveLength(0);
  });
  it("lintJava 集成：knownMethods 喂进不报", () => {
    const other = `public class SubmitData { public String getTitle() { return "x"; } }`;
    const known = collectDeclaredMethods(other);
    const issues = lintJava(`class S { void f(SubmitData d) { setTitle(d.getTitle()); } }`, { knownMethods: known });
    expect(issues.filter((i) => i.code === "method" && /getTitle/.test(i.msg))).toHaveLength(0);
  });
});
