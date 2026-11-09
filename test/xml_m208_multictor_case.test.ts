// test/xml_m208_multictor_case.test.ts — M208：多构造器参数 / getMessage 白名单 / 大小写不误报普通变量
import { describe, it, expect } from "vitest";
import { lintJava } from "@/lib/xml/java-lint";
import { extractJavaSymbols } from "@/lib/xml/java-symbols";
import { suggestMethod } from "@/lib/xml/java-methods";

const MULTI_CTOR = `public class DataManager {
    private Context context;
    private String action;
    private int pageSize;

    public DataManager(Context context) {
        this.context = context.getApplicationContext();
    }

    public DataManager(Context context, String action, String direction, int pagesize) {
        this.context = context.getApplicationContext();
        this.setAction(action);
        this.setDirection(direction);
        this.pageSize = pagesize;
    }

    public void setAction(String a) { this.action = a; }
    public void setDirection(String d) { }
}`;

describe("M208 多构造器：第二个构造器的参数也要算已声明", () => {
  it("extractJavaSymbols 收集全部构造器参数", () => {
    const sy = extractJavaSymbols(MULTI_CTOR);
    expect(sy.declared.has("pagesize")).toBe(true);
    expect(sy.declared.has("direction")).toBe(true);
  });

  it("pagesize 不再报 sym", () => {
    const iss = lintJava(MULTI_CTOR);
    const sym = iss.filter((i) => i.code === "sym");
    expect(sym.some((i) => i.msg.includes("pagesize"))).toBe(false);
  });
});

describe("M208 getMessage 是标准库，不报拼写错", () => {
  it("getMessage() 不报 method", () => {
    const src = `class A {
    void f(Exception e) {
        String m = e.getMessage();
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "method")).toHaveLength(0);
  });

  it("suggestMethod 不会把 getMessage 建议成 setMessage", () => {
    expect(suggestMethod("getMessage")).toBeNull();
  });

  it("真拼错仍能建议：setTxt → setText", () => {
    expect(suggestMethod("setTxt")).toBe("setText");
  });
});

describe("M208 大小写规则不能误报已声明的普通变量", () => {
  it("变量名叫 error 不报「error → Error」", () => {
    const src = `class A {
    void f() {
        String error = "x";
        String s = error + "y";
    }
}`;
    const iss = lintJava(src);
    const cs = iss.filter((i) => i.code === "case");
    expect(cs.some((i) => i.msg.includes("error → Error"))).toBe(false);
  });

  it("真大小写写错仍报：string 当类型用", () => {
    const src = `class A {
    void f() {
        string name = "x";
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "case").length).toBeGreaterThan(0);
  });
});

describe("M208 带注解/泛型的参数与字段都算已声明", () => {
  it("@NonNull String jsonString 参数不报 sym", () => {
    const src = `class A {
    void f(@NonNull String jsonString) {
        int n = jsonString.length();
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "sym").some((i) => i.msg.includes("jsonString"))).toBe(false);
  });

  it("Map<String,Object> 字段名不报 sym", () => {
    const src = `class A {
    private Map<String, Object> cache;
    void f() {
        int n = cache.size();
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "sym").some((i) => i.msg.includes("cache"))).toBe(false);
  });
});
