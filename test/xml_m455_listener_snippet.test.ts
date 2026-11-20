import { describe, it, expect } from "vitest";
import { buildJavaAcceptTemplate, LISTENER_SETTERS } from "@/lib/xml/java-templates";

function apply(item: string, kind: Parameters<typeof buildJavaAcceptTemplate>[1], indent = "") {
  const t = buildJavaAcceptTemplate(item, kind, indent);
  if (!t) return null;
  return { text: t.text, before: t.text.slice(0, t.cursor), after: t.text.slice(t.cursor), tpl: t };
}

describe("M455 监听器 setter 展开成整个匿名类", () => {
  it("setOnClickListener → new View.OnClickListener(){@Override onClick(View v)}", () => {
    const r = apply("setOnClickListener", "method");
    expect(r).toBeTruthy();
    expect(r!.text).toBe(
      "setOnClickListener(new View.OnClickListener() {\n" +
        "    @Override\n" +
        "    public void onClick(View v) {\n" +
        "        \n" +
        "    }\n" +
        "});",
    );
    // 光标落在 onClick 体内
    expect(r!.before.endsWith("public void onClick(View v) {\n        ")).toBe(true);
    expect(r!.after).toBe("\n    }\n});");
    expect(r!.tpl.consumeTrailingParen).toBe(true);
  });

  it("已有缩进时整体跟随（首行不重复缩进）", () => {
    const r = apply("setOnClickListener", "method", "    ");
    expect(r!.text.startsWith("setOnClickListener(new View.OnClickListener() {\n        @Override\n        public void onClick(View v) {\n            \n        }\n    });")).toBe(true);
  });

  it("setOnItemClickListener → onItemClick(AdapterView<?> ...) 参数", () => {
    const r = apply("setOnItemClickListener", "method");
    expect(r!.text).toContain("setOnItemClickListener(new AdapterView.OnItemClickListener() {");
    expect(r!.text).toContain("public void onItemClick(AdapterView<?> parent, View view, int position, long id) {");
  });

  it("setOnItemSelectedListener → 两个方法都带出（onItemSelected + onNothingSelected）", () => {
    const r = apply("setOnItemSelectedListener", "method");
    expect(r!.text).toContain("public void onItemSelected(AdapterView<?> parent, View view, int position, long id) {");
    expect(r!.text).toContain("public void onNothingSelected(AdapterView<?> parent) {");
    // 光标只在第一个方法体里
    expect(r!.before).toContain("onItemSelected");
    expect(r!.before).not.toContain("onNothingSelected");
  });

  it("addTextChangedListener → TextWatcher 三个方法", () => {
    const r = apply("addTextChangedListener", "method");
    expect(r!.text).toContain("addTextChangedListener(new TextWatcher() {");
    expect(r!.text).toContain("beforeTextChanged(CharSequence s, int start, int count, int after)");
    expect(r!.text).toContain("onTextChanged(CharSequence s, int start, int before, int count)");
    expect(r!.text).toContain("afterTextChanged(Editable s)");
  });

  it("boolean 返回类型：onLongClick / onTouch / onEditorAction", () => {
    expect(apply("setOnLongClickListener", "method")!.text).toContain("public boolean onLongClick(View v) {");
    expect(apply("setOnTouchListener", "method")!.text).toContain("public boolean onTouch(View v, MotionEvent event) {");
    expect(apply("setOnEditorActionListener", "method")!.text).toContain(
      "public boolean onEditorAction(TextView v, int actionId, KeyEvent event) {",
    );
  });

  it("表完整性：至少 20 个监听器 setter", () => {
    expect(Object.keys(LISTENER_SETTERS).length).toBeGreaterThanOrEqual(20);
  });

  it("非监听器方法不受影响（setText 不展开）", () => {
    expect(apply("setText", "method")).toBeNull();
    // M397 原有行为保持：事件回调名 onClick 单独打还是展开方法体
    const r = apply("onClick", "method");
    expect(r!.text).toContain("@Override\npublic void onClick(View v) {");
  });
});
