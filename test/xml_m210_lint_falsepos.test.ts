// test/xml_m210_lint_falsepos.test.ts — M210：R.layout/R.id 误报 + 多变量声明误报
import { describe, it, expect } from "vitest";
import { extractJavaSymbols } from "@/lib/xml/java-symbols";
import { collectResEnv } from "@/lib/xml/java-res-env";

describe("M210 多变量单语句声明", () => {
  it("字段 `Type a, b, c;` 三个名字都要收", () => {
    const src = `
class A {
  private TextView tv_key, tv_value, right_ImageView;
}`;
    const sy = extractJavaSymbols(src);
    expect(sy.declared.has("tv_key")).toBe(true);
    expect(sy.declared.has("tv_value")).toBe(true);
    expect(sy.declared.has("right_ImageView")).toBe(true);
  });

  it("带初始化的逗号声明也能收（`int a = 0, b = 1;`）", () => {
    const src = `
class A {
  void f() { int a = 0, b = 1; a = b; }
}`;
    const sy = extractJavaSymbols(src);
    expect(sy.declared.has("a")).toBe(true);
    expect(sy.declared.has("b")).toBe(true);
  });

  it("方法调用参数里的逗号不能被当成声明", () => {
    const src = `
class A {
  void f() { foo(alpha, beta); }
}`;
    const sy = extractJavaSymbols(src);
    expect(sy.declared.has("alpha")).toBe(false);
    expect(sy.declared.has("beta")).toBe(false);
  });
});

describe("M210 跨布局收集 R.id", () => {
  it("layouts 里所有布局的 @+id 都进 ids", () => {
    const env = collectResEnv({
      layouts: {
        "activity_main.xml": `<LinearLayout><TextView android:id="@+id/tv_key"/></LinearLayout>`,
        "layout_item_refund.xml": `<LinearLayout>
          <TextView android:id="@+id/tv_value"/>
          <EditText android:id="@+id/tv_value_EditText"/>
          <ImageView android:id="@+id/right_ImageView"/>
        </LinearLayout>`,
      },
    });
    expect(env.ids).toContain("tv_key");
    expect(env.ids).toContain("tv_value");
    expect(env.ids).toContain("tv_value_EditText");
    expect(env.ids).toContain("right_ImageView");
  });

  it("layouts 的键也要变成 layout 资源名（去扩展名）", () => {
    const env = collectResEnv({ layouts: { "layout_item_refund.xml": "<FrameLayout/>" } });
    expect(env.layout).toContain("layout_item_refund");
  });
});
