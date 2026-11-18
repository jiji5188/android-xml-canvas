import { describe, it, expect } from "vitest";
import { buildJavaAcceptTemplate, JAVA_BLOCK_TEMPLATES, EVENT_OVERRIDES } from "@/lib/xml/java-templates";

/** 把模板结果按光标位置拆成 [前, 后]，方便断言 */
function apply(item: string, kind: Parameters<typeof buildJavaAcceptTemplate>[1], indent = "") {
  const t = buildJavaAcceptTemplate(item, kind, indent);
  if (!t) return null;
  return { text: t.text, before: t.text.slice(0, t.cursor), after: t.text.slice(t.cursor) };
}

describe("M397 语句块模板", () => {
  it("if → 括号内是光标落点，花括号已闭合", () => {
    const r = apply("if", "decl");
    expect(r!.text).toBe("if () {\n    \n}");
    expect(r!.before).toBe("if (");
    expect(r!.after).toBe(") {\n    \n}");
  });

  it("for → 循环头带初值/条件占位", () => {
    const r = apply("for", "decl");
    expect(r!.text).toBe("for (int i = 0; i < ; i++) {\n    \n}");
    expect(r!.before).toBe("for (int i = 0; i < ");
  });

  it("while → 括号内光标", () => {
    const r = apply("while", "decl");
    expect(r!.before).toBe("while (");
    expect(r!.text.endsWith("{\n    \n}")).toBe(true);
  });

  it("switch → 括号内光标 + case/default 骨架", () => {
    const r = apply("switch", "decl");
    expect(r!.text).toContain("case :");
    expect(r!.text).toContain("default:");
    expect(r!.text).toContain("break;");
    expect(r!.before).toBe("switch (");
  });

  it("try → cursor 在 try 体内，catch 已带出", () => {
    const r = apply("try", "decl");
    expect(r!.text).toBe("try {\n    \n} catch (Exception e) {\n    \n}");
    expect(r!.before).toBe("try {\n    ");
  });

  it("do → do{}while(); 骨架", () => {
    const r = apply("do", "decl");
    expect(r!.text).toBe("do {\n    \n} while ();");
  });

  it("缩进跟随当前行（tab 行给 tab，空格行给 4 空格）", () => {
    expect(apply("if", "decl", "\t\t")!.text).toBe("if () {\n\t\t\t\n\t\t}");
    expect(apply("if", "decl", "    ")!.text).toBe("if () {\n        \n    }");
  });

  it("普通关键字（class/public）不生成模板", () => {
    expect(apply("class", "decl")).toBeNull();
    expect(apply("public", "decl")).toBeNull();
  });
});

describe("M397 事件方法模板", () => {
  it("onClick → 整个 @Override 方法，光标在体内", () => {
    const r = apply("onClick", "method");
    expect(r!.text).toBe("@Override\npublic void onClick(View v) {\n    \n}");
    expect(r!.before).toBe("@Override\npublic void onClick(View v) {\n    ");
  });

  it("onCreate → Bundle 参数", () => {
    expect(apply("onCreate", "method")!.text).toContain("public void onCreate(Bundle savedInstanceState) {");
  });

  it("带返回值的回调（onOptionsItemSelected / onLongClick / onTouch）", () => {
    expect(apply("onOptionsItemSelected", "method")!.text).toContain("public boolean onOptionsItemSelected(MenuItem item) {");
    expect(apply("onLongClick", "method")!.text).toContain("public boolean onLongClick(View v) {");
    expect(apply("onTouch", "method")!.text).toContain("public boolean onTouch(View v, MotionEvent event) {");
  });

  it("列表回调参数完整", () => {
    expect(apply("onItemClick", "method")!.text).toContain(
      "public void onItemClick(AdapterView<?> parent, View view, int position, long id) {",
    );
  });

  it("方法在缩进块内 → 首行不带基缩进（插入点已在缩进后），后续行带", () => {
    const r = apply("onClick", "method", "    ");
    // 首行 @Override 前的缩进由编辑器已有文本提供，模板不重复写
    expect(r!.text).toBe("@Override\n    public void onClick(View v) {\n        \n    }");
  });

  it("非事件方法（setText/自定义方法）不展开方法体", () => {
    expect(apply("setText", "method")).toBeNull();
    expect(apply("load", "method")).toBeNull();
  });

  it("非方法/声明类型（var/class/const）不展开", () => {
    expect(apply("onClick", "var")).toBeNull();
    expect(apply("if", "method")).toBeNull();
  });

  it("模板表覆盖抽查：关键回调都存在", () => {
    for (const k of ["onCreate", "onClick", "onResume", "onDestroy", "onItemClick"]) expect(EVENT_OVERRIDES[k]).toBeTruthy();
    for (const k of ["if", "for", "switch", "while", "try"]) expect(JAVA_BLOCK_TEMPLATES[k]).toBeTruthy();
  });
});
