// test/xml_m278_resource_refs.test.ts — M278/P2：资源引用预检查
import { describe, it, expect } from "vitest";
import { buildResNameIndex, collectResourceRefs, missingResourceRefs, collectExternalImports, missingLibPackages } from "@/lib/xml/resource-refs";

describe("collectResourceRefs", () => {
  it("扫出 R.drawable.ic_arrow_back / R.id.btn / R.raw.audio", () => {
    const refs = collectResourceRefs("int a=R.drawable.ic_arrow_back; b=R.id.btn; c=R.raw.audio;");
    expect(refs).toEqual([
      { type: "drawable", name: "ic_arrow_back" },
      { type: "id", name: "btn" },
      { type: "raw", name: "audio" },
    ]);
  });
  it("跳过 R.class / R.string（string 是 int 类型常量名，非资源类型过滤）", () => {
    // 注意：string 类型是资源类型，不该跳过；这里测的是 R.class 不被当成资源
    const refs = collectResourceRefs("Class<?> c = R.class;");
    expect(refs).toHaveLength(0);
  });
});

describe("buildResNameIndex", () => {
  it("drawable/layout 目录 + values string/color 都建出来", () => {
    const idx = buildResNameIndex(
      ["drawable/ic_arrow_back.png", "drawable/ic_search.png", "layout/main.xml"],
      { "values/strings.xml": '<resources><string name="app_name">X</string><color name="primary">#fff</color></resources>' },
    );
    expect(idx.get("drawable")!.has("ic_arrow_back")).toBe(true);
    expect(idx.get("drawable")!.has("ic_search")).toBe(true);
    expect(idx.get("layout")!.has("main")).toBe(true);
    expect(idx.get("string")!.has("app_name")).toBe(true);
    expect(idx.get("color")!.has("primary")).toBe(true);
  });
});

describe("missingResourceRefs", () => {
  it("引用的资源在 res 里 → 不报；不在 → 列出", () => {
    const idx = buildResNameIndex(["drawable/ic_arrow_back.png"], undefined);
    const missing = missingResourceRefs(
      ["int a=R.drawable.ic_arrow_back; int b=R.drawable.ic_missing; int c=R.id.not_exists;"],
      idx,
    );
    const names = missing.map((m) => m.type + "/" + m.name);
    expect(names).toContain("drawable/ic_missing");
    expect(names).toContain("id/not_exists");
    expect(names).not.toContain("drawable/ic_arrow_back");
  });
  it("混淆资源名（raw/aje 等）也检测得出", () => {
    const idx = buildResNameIndex([], undefined); // 空 res
    const missing = missingResourceRefs(["int x=R.raw.qr_d; int y=R.id.aje;"], idx);
    expect(missing.map((m) => m.type + "/" + m.name)).toContain("raw/qr_d");
  });
});

describe("collectExternalImports / missingLibPackages", () => {
  it("抓出 jxl / com.google，过滤 android/androidx/java/org.json/org.w3c", () => {
    const imp = collectExternalImports([
      "import jxl.Workbook;\nimport com.google.gson.Gson;\nimport android.os.Bundle;\nimport androidx.core.content.ContextCompat;\nimport java.io.File;\nimport org.json.JSONObject;\nimport org.w3c.dom.Node;",
    ]);
    expect(imp).toContain("jxl");
    expect(imp).toContain("com.google");
    expect(imp).not.toContain("android");
    expect(imp).not.toContain("java");
    expect(imp.filter(x => x.startsWith("org.json") || x.startsWith("org.w3c"))).toEqual([]);
  });
  it("项目自己的包（com.momo）不算外部依赖", () => {
    const imp = collectExternalImports(["import com.momo.ReturnSystem3.R; import com.momo.ReturnSystem3.TableAdapter;"], ["com.momo"]);
    expect(imp).toEqual([]);
  });
  it("libs 里有 google/jxl 的 jar → 不算缺；libs 空 → 全缺", () => {
    expect(missingLibPackages(["com.google", "jxl"], ["libs/google-gson.jar", "libs/jxl-2.6.jar"])).toEqual([]);
    const miss = missingLibPackages(["com.google", "jxl"], []);
    expect(miss).toContain("com.google");
    expect(miss).toContain("jxl");
  });
});
