// test/xml_m178_java_methods.test.ts
// M178：方法名拼错提示（setTxt → setText / findviewbyid → findViewById …）
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { findMethodTypos, suggestMethod, editDistance } from "@/lib/xml/java-methods";
import { lintJava } from "@/lib/xml/java-lint";

describe("editDistance / suggestMethod", () => {
  it("基本距离", () => {
    expect(editDistance("setText", "setText")).toBe(0);
    expect(editDistance("setTxt", "setText")).toBe(1);
    expect(editDistance("", "abc", 3)).toBe(3);
  });

  it("已知方法不提示", () => {
    expect(suggestMethod("setText")).toBeNull();
    expect(suggestMethod("findViewById")).toBeNull();
  });

  it("拼错给建议", () => {
    expect(suggestMethod("setTxt")).toBe("setText");
    expect(suggestMethod("setVisiblity")).toBe("setVisibility");
    expect(suggestMethod("setOnClickListner")).toBe("setOnClickListener");
  });

  it("差太远不给建议（避免误报）", () => {
    expect(suggestMethod("doSomethingCustom")).toBeNull();
    expect(suggestMethod("xyz")).toBeNull();
  });
});

describe("findMethodTypos", () => {
  it("抓 setTxt / setVisiblity，行号正确", () => {
    const src = [
      "public class A {",
      "  void f(TextView t) {",
      "    t.setTxt(\"hi\");",
      "    t.setVisiblity(0);",
      "  }",
      "}",
    ].join("\n");
    const out = findMethodTypos(src);
    expect(out.map((x) => x.suggestion)).toEqual(["setText", "setVisibility"]);
    expect(out[0].line).toBe(3);
    expect(out[1].line).toBe(4);
  });

  it("大小写写错也能认（findviewbyid）", () => {
    const src = `public class A { void f() { View v = findviewbyid(R.id.x); } }`;
    expect(findMethodTypos(src)[0]?.suggestion).toBe("findViewById");
  });

  it("本文件自己声明的方法不报", () => {
    const src = [
      "public class A {",
      "  private void setTxtCustom(TextView t) { }",
      "  void f(TextView t) { setTxtCustom(t); }",
      "}",
    ].join("\n");
    expect(findMethodTypos(src)).toHaveLength(0);
  });

  it("正常代码零误报", () => {
    const src = [
      "public class MainActivity extends AppCompatActivity {",
      "  @Override protected void onCreate(Bundle b) {",
      "    super.onCreate(b);",
      "    setContentView(R.layout.activity_main);",
      "    TextView t = findViewById(R.id.title);",
      "    t.setText(\"hi\");",
      "    t.setVisibility(View.VISIBLE);",
      "    t.setOnClickListener(v -> {",
      "      Toast.makeText(this, \"x\", Toast.LENGTH_SHORT).show();",
      "      startActivity(new Intent(this, Other.class));",
      "    });",
      "    getSharedPreferences(\"p\", 0).edit().putString(\"k\", \"v\").apply();",
      "  }",
      "}",
    ].join("\n");
    expect(findMethodTypos(src)).toHaveLength(0);
  });
});

describe("lintJava 集成", () => {
  it("产生 method 级警告", () => {
    const out = lintJava(`public class A { void f(TextView t) { t.setTxt("a"); } }`, {});
    const hit = out.find((i) => i.code === "method");
    expect(hit?.msg).toContain("setText");
  });

  it("Kotlin 不跑（扩展函数多，容易误报）", () => {
    const out = lintJava(`class A { fun f(t: TextView) { t.setTxt("a") } }`, { isKotlin: true });
    expect(out.some((i) => i.code === "method")).toBe(false);
  });
});
