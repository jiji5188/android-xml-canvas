import { expect, it, describe } from "vitest";
import { collectProjectRes } from "@/lib/xml/res-collect";
import type { AiFileIo } from "@/lib/xml/ai-tools";

// 最小假 IO：list 用项目根相对路径（scanResDirs 候选 "app/src/main/res" 命中），
// read 按文件字典返回。rootLabel 必须实现（res-index 缓存 key 用它）。
function fakeIo(files: Record<string, string>): AiFileIo {
  const resDir = "app/src/main/res";
  return {
    read: async (p: string) =>
      files[p] !== undefined ? { ok: true, text: files[p] } : { ok: false, error: "no" },
    list: async (p: string) => {
      if (p === resDir)
        return {
          ok: true,
          items: [
            { name: "values", kind: "dir" },
            { name: "layout", kind: "dir" },
          ],
        };
      if (p === resDir + "/values")
        return {
          ok: true,
          items: Object.keys(files)
            .filter((f) => f.startsWith("values/"))
            .map((f) => ({ name: f.slice(7), kind: "file" as const })),
        };
      return { ok: true, items: [] };
    },
    rootLabel: () => "fake",
  } as unknown as AiFileIo;
}

// 布局引用 @style/MyTheme → M159 styleInfo 登记 MyTheme，missing 含 style/MyTheme，
// 保证 values/axv_attrs.xml 一定会生成，下面的断言才有意义（不是弱断言）。
const layout =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<TextView xmlns:android="http://schemas.android.com/apk/res/android" ' +
  'android:layout_width="match_parent" android:layout_height="match_parent" ' +
  'android:theme="@style/MyTheme" />';

function runCase(files: Record<string, string>) {
  const io = fakeIo(files);
  const input = Object.entries(files).map(([path, text]) => ({ path, text }));
  return collectProjectRes(io, "app/src/main/res/layout/activity_main.xml", input);
}

describe("M222: android: namespace attrs must not be declared into axv_attrs", () => {
  it("style <item name='android:colorAccent'> is NOT declared (would break aapt2)", async () => {
    const styles =
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
      '<style name="MyTheme" parent="android:Theme.Material.Light">\n' +
      '  <item name="android:colorAccent">#FF0000</item>\n' +
      '  <item name="android:colorPrimary">#00FF00</item>\n' +
      '  <item name="android:navigationBarColor">#000000</item>\n' +
      "</style>\n</resources>";
    const r = await runCase({ "values/styles.xml": styles, "layout/activity_main.xml": layout });
    const attrs = r.files.find((f) => f.path === "values/axv_attrs.xml");
    // 全 android: 的 style 不产生 axv_attrs（或生成了也不能含 android: 前缀）
    expect(attrs?.text ?? "").not.toContain('name="android:');
  });

  it("custom (non-android:) item attrs ARE still declared, android: mixed in is filtered", async () => {
    const styles =
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
      '<style name="MyTheme">\n' +
      '  <item name="myCustomAttr">1</item>\n' +
      '  <item name="android:colorAccent">#FF0000</item>\n' +
      "</style>\n</resources>";
    const r = await runCase({ "values/styles.xml": styles, "layout/activity_main.xml": layout });
    const attrs = r.files.find((f) => f.path === "values/axv_attrs.xml");
    expect(attrs).toBeDefined();
    expect(attrs!.text).toContain('name="myCustomAttr"');
    expect(attrs!.text).not.toContain('name="android:');
  });

  it("android: attrs in <declare-styleable> are also filtered out", async () => {
    const attrsX =
      '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
      '<declare-styleable name="MyView">\n' +
      '  <attr name="myWidth" format="dimension" />\n' +
      '  <attr name="android:paddingLeft" format="dimension" />\n' +
      "</declare-styleable>\n</resources>";
    const r = await runCase({ "values/attrs.xml": attrsX, "layout/activity_main.xml": layout });
    const axv = r.files.find((f) => f.path === "values/axv_attrs.xml");
    // declare-styleable 已定义的 myWidth 走 defs 分支不重声明；android: 前缀一律过滤
    expect(axv?.text ?? "").not.toContain('name="android:');
  });
});
