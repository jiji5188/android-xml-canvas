// test/xml_m101_ref_token.test.ts —— M101：光标下的资源引用识别
import { describe, expect, it } from "vitest";
import { refAction, refKey, scanRefTokens, tokenAt } from "@/lib/xml/ref-token";

describe("M101 scanRefTokens", () => {
  it("认出 XML 引用 / id / 框架资源", () => {
    const text = [
      '<TextView android:text="@string/app_name"',
      '  android:background="@drawable/bg_card"',
      '  android:id="@+id/btn_ok"',
      '  android:contentDescription="@android:string/ok" />',
    ].join("\n");
    const toks = scanRefTokens(text);
    expect(toks.map((t) => t.raw)).toEqual([
      "@string/app_name",
      "@drawable/bg_card",
      "@+id/btn_ok",
      "@android:string/ok",
    ]);
    expect(toks.map((t) => t.form)).toEqual([
      "xml-ref",
      "xml-ref",
      "xml-id",
      "xml-framework",
    ]);
  });

  it("@id/x（不带加号）也算 id", () => {
    const [t] = scanRefTokens('<Button android:layout_toEndOf="@id/btn_ok" />');
    expect(t.form).toBe("xml-id");
    expect(t.type).toBe("id");
    expect(t.name).toBe("btn_ok");
  });

  it("代码里的 R.type.name", () => {
    const toks = scanRefTokens("setContentView(R.layout.activity_main);\nint id = R.id.btn_ok;");
    expect(toks.map((t) => [t.type, t.name])).toEqual([
      ["layout", "activity_main"],
      ["id", "btn_ok"],
    ]);
    expect(toks.every((t) => t.form === "code-ref")).toBe(true);
  });

  it("带包名的三方资源不算框架资源", () => {
    const [t] = scanRefTokens('android:text="@com.lib:string/title"');
    expect(t.form).toBe("xml-ref");
    expect(t.packageName).toBe("com.lib");
  });

  it("不会把普通文本当引用", () => {
    expect(scanRefTokens("android:text=\"登录\"")).toEqual([]);
    expect(scanRefTokens("// 注释里写 @string/x 也算引用")).toHaveLength(1);
  });
});

describe("M101 tokenAt", () => {
  const text = '<TextView android:text="@string/app_name" android:id="@+id/btn" />';

  it("偏移落在引用中间 → 命中", () => {
    const at = text.indexOf("@string/app_name") + 3;
    const t = tokenAt(text, at);
    expect(t?.raw).toBe("@string/app_name");
    expect(t?.name).toBe("app_name");
  });

  it("光标停在结尾（end 边界）也算命中", () => {
    const end = text.indexOf("@string/app_name") + "@string/app_name".length;
    expect(tokenAt(text, end)?.name).toBe("app_name");
  });

  it("偏移落在引号之间的普通文字 → null", () => {
    const at = text.indexOf("android:text=") + 4;
    expect(tokenAt(text, at)).toBeNull();
  });

  it("越界偏移不抛异常", () => {
    expect(tokenAt(text, -5)).toBeNull();
    expect(tokenAt(text, text.length + 10)).toBeNull();
  });
});

describe("M101 refAction", () => {
  it("普通引用 → 跳定义", () => {
    const t = tokenAt('<x a="@string/app_name"/>', 8)!;
    expect(refAction(t)).toEqual({
      kind: "definition",
      type: "string",
      name: "app_name",
      refValue: "@string/app_name",
    });
  });

  it("id → 查引用", () => {
    const t = tokenAt('<x a="@+id/btn"/>', 8)!;
    expect(refAction(t)).toEqual({ kind: "usages", type: "id", name: "btn", refValue: "@id/btn" });
  });

  it("R.layout.x → 跳定义；@android:x → none", () => {
    expect(refAction(tokenAt("R.layout.main", 2)!)).toMatchObject({ kind: "definition", type: "layout" });
    expect(refAction(tokenAt('a="@android:string/ok"', 8)!)).toEqual({
      kind: "none",
      reason: "framework",
    });
  });

  it("refKey 统一成 type/name", () => {
    expect(refKey({ type: "string", name: "app_name" })).toBe("string/app_name");
  });
});
