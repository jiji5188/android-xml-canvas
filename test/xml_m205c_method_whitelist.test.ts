// test/xml_m205c_method_whitelist.test.ts — M205c：org.json 等方法白名单 + 动词不同不报
import { describe, it, expect } from "vitest";
import { findMethodTypos, suggestMethod } from "@/lib/xml/java-methods";
import { lintJava } from "@/lib/xml/java-lint";

describe("M205c org.json / 常用 API 不误报", () => {
  it("json.optLong(...) 不报拼写错", () => {
    const code = `class A {
    void f(String saved) {
        JSONObject json = new JSONObject(saved);
        long lastActive = json.optLong("lastActivityTime", 0);
    }
}`;
    const bad = findMethodTypos(code).filter((t) => t.name === "optLong");
    expect(bad).toHaveLength(0);
  });

  it("optString / optInt / getJSONObject / has 都不报", () => {
    const code = `class A {
    void f(JSONObject o) {
        String s = o.optString("a");
        int i = o.optInt("b");
        JSONObject sub = o.getJSONObject("c");
        boolean h = o.has("d");
    }
}`;
    expect(findMethodTypos(code)).toHaveLength(0);
  });

  it("parseLong / valueOf / substring 等标准库方法不报", () => {
    const code = `class A {
    void f(String x) {
        long v = Long.parseLong(x);
        int i = Integer.parseInt(x);
        String t = x.substring(1).trim().toUpperCase();
    }
}`;
    expect(findMethodTypos(code)).toHaveLength(0);
  });

  it("真正的拼写错仍然报（setTxt → setText）", () => {
    const code = `class A { void f() { tv.setTxt("x"); } }`;
    const hits = findMethodTypos(code);
    const h = hits.find((t) => t.name === "setTxt");
    expect(h).toBeTruthy();
    expect(h!.suggestion).toBe("setText");
  });

  it("setVisiblity → setVisibility 仍然报", () => {
    const code = `class A { void f() { v.setVisiblity(0); } }`;
    const h = findMethodTypos(code).find((t) => t.name === "setVisiblity");
    expect(h).toBeTruthy();
    expect(h!.suggestion).toBe("setVisibility");
  });

  it("动词完全不同不给建议（suggestMethod 前置 2 字符保护）", () => {
    expect(suggestMethod("optLong", 2)).toBe(null);
    expect(suggestMethod("plotLong", 2)).toBe(null);
  });

  it("lintJava 对整段 JSON 代码不报 method", () => {
    const code = `class A {
    void f(String saved) {
        JSONObject json = new JSONObject(saved);
        long t = json.optLong("lastActivityTime", 0);
        String s = json.optString("name", "");
    }
}`;
    const iss = lintJava(code);
    expect(iss.filter((i) => i.code === "method")).toHaveLength(0);
  });
});
