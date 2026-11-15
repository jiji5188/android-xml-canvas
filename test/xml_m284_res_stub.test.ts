import { describe, it, expect } from "vitest";
import { stubMissingRefs, buildResNameIndex, missingResourceRefs } from "../lib/xml/resource-refs";

const rf = (path: string, text: string) => ({ path, text });

describe("stubMissingRefs M284", () => {
  it("id 缺失 → 生成 values/axv_stub_ids.xml", () => {
    const files = [rf("layout/activity_main.xml", '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" />')];
    const r = stubMissingRefs(files, [{ type: "id", name: "bit" }, { type: "id", name: "tv_hello" }]);
    expect(r.stubbed.sort()).toEqual(["id/bit", "id/tv_hello"]);
    const v = r.files.find((f) => f.path === "values/axv_stub_ids.xml");
    expect(v?.text).toContain('<item type="id" name="bit" />');
    expect(v?.text).toContain('<item type="id" name="tv_hello" />');
  });

  it("布局里已用 @+id/ 声明的 id 不重复补（否则 aapt2 报重复定义）", () => {
    const files = [rf("layout/activity_main.xml", '<TextView android:id="@+id/tv_hello" />')];
    const r = stubMissingRefs(files, [{ type: "id", name: "tv_hello" }, { type: "id", name: "bit" }]);
    expect(r.stubbed).toEqual(["id/bit"]);
    expect(r.skipped).toEqual(["id/tv_hello"]);
  });

  it("string/dimen/color/drawable/layout 都能补", () => {
    const r = stubMissingRefs([], [
      { type: "string", name: "app_name" },
      { type: "dimen", name: "pad" },
      { type: "color", name: "red" },
      { type: "drawable", name: "bg" },
      { type: "layout", name: "other" },
    ].map((x) => ({ type: x.type, name: x.name })));
    const v = r.files.find((f) => f.path === "values/axv_stub_ids.xml")!;
    expect(v.text).toContain('<string name="app_name" />');
    expect(v.text).toContain('<dimen name="pad">0dp</dimen>');
    expect(v.text).toContain('<color name="red">#00000000</color>');
    expect(r.files.some((f) => f.path === "drawable/bg.xml")).toBe(true);
    expect(r.files.some((f) => f.path === "layout/other.xml")).toBe(true);
  });

  it("端到端：预检查 + 补占位后，再次预检查应干净", () => {
    const files = [rf("layout/activity_main.xml", "<FrameLayout />")];
    const code = ["class A { void f(){ int a = R.id.bit; int b = R.id.tv_hello; } }"];
    const idx0 = buildResNameIndex(files.map((f) => f.path), {});
    const miss = missingResourceRefs(code, idx0);
    expect(miss.map((m) => m.type + "/" + m.name).sort()).toEqual(["id/bit", "id/tv_hello"]);

    const stub = stubMissingRefs(files, miss);
    const valuesTexts: Record<string, string> = {};
    for (const f of stub.files) if (/\.xml$/i.test(f.path)) valuesTexts[f.path] = f.text;
    const idx1 = buildResNameIndex(stub.files.map((f) => f.path), valuesTexts);
    expect(missingResourceRefs(code, idx1)).toEqual([]);
  });
});
