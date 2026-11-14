import { describe, it, expect } from "vitest";
import { importForType, buildImportInsertMany, JAVA_IMPORTS } from "../lib/xml/java-vocab";

describe("importForType (M273)", () => {
  it("常见 Android 类给完整路径", () => {
    expect(importForType("TextView")).toBe("android.widget.TextView");
    expect(importForType("View")).toBe("android.view.View");
    expect(importForType("Toast")).toBe("android.widget.Toast");
    expect(importForType("Intent")).toBe("android.content.Intent");
    expect(importForType("Handler")).toBe("android.os.Handler");
  });

  it("java.lang / 未知类型 → null", () => {
    expect(importForType("String")).toBeNull();
    expect(importForType("Object")).toBeNull();
    expect(importForType("Whatever")).toBeNull();
  });

  it("歧义类（support/androidx 两派）故意不收", () => {
    expect(importForType("AppCompatActivity")).toBeNull();
    expect(importForType("Fragment")).toBeNull();
    expect(importForType("RecyclerView")).toBeNull();
    expect(importForType("ConstraintLayout")).toBeNull();
  });

  it("表内值都是合法全限定名", () => {
    for (const [k, v] of Object.entries(JAVA_IMPORTS)) {
      expect(v.endsWith("." + k)).toBe(true);
      expect(v.split(".").length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("buildImportInsertMany (M273)", () => {
  it("有 package + import → 插在最后一个 import 之后", () => {
    const doc = "package a.b;\n\nimport java.util.List;\n\nclass X {}\n";
    const r = buildImportInsertMany(doc, ["android.widget.TextView"]);
    expect(r).not.toBeNull();
    expect(r!.text).toBe("import android.widget.TextView;\n");
    const head = doc.slice(0, r!.pos);
    expect(head).toContain("import java.util.List;\n");
  });

  it("只有 package 没 import → 插在 package 之后", () => {
    const doc = "package a.b;\n\nclass X {}\n";
    const r = buildImportInsertMany(doc, ["android.widget.TextView"]);
    expect(r!.pos).toBe("package a.b;\n".length);
    expect(r!.text).toBe("import android.widget.TextView;\n");
  });

  it("啥都没有 → 插在文件开头", () => {
    const doc = "class X {}\n";
    const r = buildImportInsertMany(doc, ["android.view.View"]);
    expect(r!.pos).toBe(0);
    expect(r!.text).toBe("import android.view.View;\n");
  });

  it("已经 import 过 → null", () => {
    const doc = "import android.widget.TextView;\nclass X {}\n";
    expect(buildImportInsertMany(doc, ["android.widget.TextView"])).toBeNull();
  });

  it("通配 import 覆盖 → null", () => {
    const doc = "import android.widget.*;\nclass X {}\n";
    expect(buildImportInsertMany(doc, ["android.widget.TextView"])).toBeNull();
  });

  it("同名类已有别的包 → 跳过（不插）", () => {
    const doc = "import a.b.Button;\nclass X {}\n";
    expect(buildImportInsertMany(doc, ["android.widget.Button"])).toBeNull();
  });

  it("多个类一次插入，去重", () => {
    const doc = "package p;\nclass X {}\n";
    const r = buildImportInsertMany(doc, [
      "android.view.View",
      "android.widget.Toast",
      "android.view.View",
    ]);
    expect(r!.text).toBe("import android.view.View;\nimport android.widget.Toast;\n");
  });

  it("空数组 → null", () => {
    expect(buildImportInsertMany("class X {}", [])).toBeNull();
  });
});
