// test/xml_m203_lint_sym.test.ts — M203：lintJava 接入"未声明标识符"规则
import { describe, it, expect } from "vitest";
import { lintJava } from "@/lib/xml/java-lint";

describe("lintJava sym 规则 (M203)", () => {
  it("用户原句：dsdxvbb==lhh4; 被抓成 error", () => {
    const src = `public SubmitData(String title, String action, List<String> data, boolean isRt){
        this.title=title;
        this.action=action;
        this.isResult=isRt;
        dsdxvbb==lhh4;
        this.listArr=data;
    }`;
    const iss = lintJava(src);
    const sym = iss.filter((i) => i.code === "sym");
    expect(sym.length).toBeGreaterThan(0);
    const names = sym.map((i) => i.msg.match(/用了 (\w+)/)?.[1]).filter(Boolean);
    expect(names).toContain("dsdxvbb");
    expect(names).toContain("lhh4");
    // M207：置信度分级——猜不到近似声明时降级为 warn（不拿"可能是我漏识别"冒充编译错）
    expect(sym.every((i) => i.sev === "error" || i.sev === "warn")).toBe(true);
  });

  it("正常构造器不报 sym", () => {
    const src = `public SubmitData(String title, String action){
        this.title=title;
        this.action=action;
    }`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "sym")).toHaveLength(0);
  });

  it("this.xxx 字段引用不报", () => {
    const src = `class A {
    int n;
    void f(){ n = 3; }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "sym")).toHaveLength(0);
  });

  it("方法调用 / 属性访问的接收者不误报（宽松）", () => {
    const src = `void f(Context ctx){
    ctx.getAssets();
}`;
    const iss = lintJava(src);
    // ctx 是参数，getAssets 是方法调用 → 不报
    expect(iss.filter((i) => i.code === "sym")).toHaveLength(0);
  });
});
