import { describe, it, expect } from "vitest";
import {
  autofixJavaSources,
  autofixImports,
  autofixRCase,
  typeCandidates,
} from "../lib/xml/java-autofix";
import { buildResNameIndex } from "../lib/xml/resource-refs";

describe("typeCandidates M287", () => {
  it("捞出被当类型用的大写标识符", () => {
    const c = `public void f() {
      TextView tv = findViewById(R.id.tv);
      List<String> items = new ArrayList<>();
      Toast.makeText(this, "x", Toast.LENGTH_SHORT).show();
      class Inner {}
    }`;
    const got = new Set(typeCandidates(c));
    expect(got.has("TextView")).toBe(true);
    expect(got.has("List")).toBe(true);
    expect(got.has("ArrayList")).toBe(true);
    expect(got.has("Toast")).toBe(true);
    expect(got.has("Inner")).toBe(false); // 声明，不算「使用」
  });
});

describe("autofixImports M287", () => {
  it("补 android.widget 的 import", () => {
    const code = `public class A {
void f() {
TextView tv = new TextView(ctx);
Toast.makeText(this, "hi", Toast.LENGTH_SHORT).show();
}
}`;
    const r = autofixImports(code, {});
    expect(r.fixes.length).toBe(1);
    expect(r.code).toContain("import android.widget.TextView;");
    expect(r.code).toContain("import android.widget.Toast;");
    // 插在最前面（无 package/import 时）
    expect(r.code.startsWith("import android.widget")).toBe(true);
  });

  it("已有 import 不重复补", () => {
    const code = `package a;
import android.widget.TextView;
public class A { void f() { TextView t = new TextView(null); } }`;
    const r = autofixImports(code, {});
    expect(r.fixes).toEqual([]);
    expect(r.code).toBe(code);
  });

  it("androidx 类也补（AppCompatActivity）", () => {
    const code = `public class M extends AppCompatActivity {
@Override public void onCreate(Bundle b) { super.onCreate(b); setContentView(R.id.x); }
}`;
    const r = autofixImports(code, {
      resIndex: buildResNameIndex(["values/strings.xml"], { "values/strings.xml": '<resources><string name="x">hi</string></resources>' }),
    });
    expect(r.fixes.length).toBeGreaterThan(0);
    expect(r.code).toContain("import androidx.appcompat.app.AppCompatActivity;");
    expect(r.code).toContain("import android.os.Bundle;");
  });

  it("项目内声明的类不补", () => {
    const code = `public class M extends MyFragment { }`;
    const r = autofixImports(code, { projectTypes: new Set(["MyFragment"]) });
    expect(r.fixes).toEqual([]);
  });

  it("R.Id 大小写 + 补 import 同时做", () => {
    const resIndex = buildResNameIndex(["values/strings.xml"], {
      "values/strings.xml": '<resources><string name="greet">hi</string></resources>',
    });
    const code = `public class M extends AppCompatActivity {
public void f() {
String s = getString(R.String.greet);
Toast.makeText(this, s, 0).show();
}
}`;
    const r = autofixJavaSources([{ path: "M.java", code }], { resIndex, pkg: "a.b" });
    expect(r.reports.length).toBe(1);
    const fixed = r.sources[0].code;
    expect(fixed).toContain("R.string.greet");
    expect(fixed).not.toContain("R.String.greet");
    expect(fixed).toContain("import androidx.appcompat.app.AppCompatActivity;");
    expect(fixed).toContain("import android.widget.Toast;");
  });
});

describe("autofixRCase M287", () => {
  it("只改小写资源真实存在的", () => {
    const idx = buildResNameIndex([], {
      "values/strings.xml": '<resources><string name="ok">1</string></resources>',
    });
    const r = autofixRCase(`R.String.ok R.Layout.no R.Color.ok`, idx);
    expect(r.code).toContain("R.string.ok");
    expect(r.code).not.toContain("R.layout.no"); // layout 类型里没 no
    expect(r.fixes.length).toBeGreaterThan(0);
  });

  it("没有 resIndex 时原样返回", () => {
    const r = autofixRCase(`R.String.x`, null);
    expect(r.code).toBe(`R.String.x`);
    expect(r.fixes).toEqual([]);
  });
});
