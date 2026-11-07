// test/xml_m179_java_fix.test.ts
// M179：Java 检查结果带「一键修复」信息（资源引用拼错 / 方法名拼错）
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { lintJava, nearestName } from "@/lib/xml/java-lint";

describe("nearestName", () => {
  it("拼错一个字母能找回原名", () => {
    expect(nearestName("titel", ["title", "go", "list"])).toBe("title");
  });

  it("大小写/下划线差异也能找回（btnOk → btn_ok）", () => {
    expect(nearestName("btnOk", ["btn_ok", "tvName"])).toBe("btn_ok");
  });

  it("差太远就不乱猜", () => {
    expect(nearestName("zzzzz", ["title", "go"])).toBe(null);
  });

  it("完全相等返回 null（没得修）", () => {
    expect(nearestName("title", ["title"])).toBe(null);
  });

  it("两个候选一样近时不猜", () => {
    // cat 与 bat/hat 距离都是 1 → 平票，不修
    expect(nearestName("cat", ["bat", "hat"])).toBe(null);
  });
});

describe("lintJava 输出的 fix 信息", () => {
  const ids = ["title", "go", "btn_ok"];

  it("R.id 拼错 → 带 from/to", () => {
    const src = `public class A { void f() { View v = findViewById(R.id.titel); } }`;
    const hit = lintJava(src, { ids }).find((i) => i.code === "rid");
    expect(hit?.fix).toEqual({ from: "R.id.titel", to: "R.id.title" });
    expect(hit?.msg).toContain("是不是想写 title");
  });

  it("R.id 完全没近似项 → 没有 fix（只报不改）", () => {
    const src = `public class A { void f() { View v = findViewById(R.id.zzzzz); } }`;
    const hit = lintJava(src, { ids }).find((i) => i.code === "rid");
    expect(hit).toBeTruthy();
    expect(hit?.fix).toBeUndefined();
  });

  it("R.layout 拼错 → 带 from/to", () => {
    const src = `public class A { void f() { setContentView(R.layout.activity_mian); } }`;
    const hit = lintJava(src, { res: { layout: ["activity_main"] } }).find((i) => i.code === "rtype");
    expect(hit?.fix).toEqual({ from: "R.layout.activity_mian", to: "R.layout.activity_main" });
  });

  it("R.string 拼错 → 带 from/to", () => {
    const src = `public class A { void f() { String s = getString(R.string.app_nam); } }`;
    const hit = lintJava(src, { res: { string: ["app_name", "other_one"] } }).find((i) => i.code === "rtype");
    expect(hit?.fix).toEqual({ from: "R.string.app_nam", to: "R.string.app_name" });
  });

  it("方法名拼错 → 带 from/to", () => {
    const src = `public class A { void f(TextView tv) { tv.setTxt("hi"); } }`;
    const hit = lintJava(src, {}).find((i) => i.code === "method");
    expect(hit?.fix).toEqual({ from: "setTxt", to: "setText" });
  });
});
