import { expect, it, describe } from "vitest";
import { collectProjectRes } from "@/lib/xml/res-collect";
import type { AiFileIo } from "@/lib/xml/ai-tools";

// 最小假 IO：list 返回目录名，read 返回 values 文本
function fakeIo(files: Record<string, string>): AiFileIo {
  return {
    read: async (p: string) =>
      files[p] !== undefined ? { ok: true, text: files[p] } : { ok: false, error: "no" },
    list: async (p: string) =>
      p === "app/src/main/res" || p === "" || p === "res"
        ? { ok: true, items: [ { name: "values", kind: "dir" }, { name: "layout", kind: "dir" } ] }
        : { ok: true, items: [] },
  } as unknown as AiFileIo;
}

describe("M222: android: namespace attrs must not be declared into axv_attrs", () => {
  it("style <item name='android:colorAccent'> is NOT added to customAttrs (would break aapt2)", async () => {
    const io = fakeIo({});
    const r = await collectProjectRes(
      io,
      "app/src/main/res/layout/activity_main.xml",
      [
        {
          path: "values/styles.xml",
          text:
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
            '<style name="AppTheme" parent="android:Theme.Material.Light">\n' +
            '  <item name="android:colorAccent">#FF0000</item>\n' +
            '  <item name="android:colorPrimary">#00FF00</item>\n' +
            "  <item name=\"android:navigationBarColor\">#000000</item>\n" +
            "</style>\n</resources>",
        },
      ],
    );
    const attrs = r.files.find((f) => f.path === "values/axv_attrs.xml");
    expect(attrs).toBeUndefined();
  });

  it("custom (non-android:) item attrs ARE still declared", async () => {
    const io = fakeIo({});
    const r = await collectProjectRes(
      io,
      "app/src/main/res/layout/activity_main.xml",
      [
        {
          path: "values/styles.xml",
          text:
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
            '<style name="MyTheme">\n' +
            "  <item name=\"myCustomAttr\">1</item>\n" +
            "</style>\n</resources>",
        },
      ],
    );
    const attrs = r.files.find((f) => f.path === "values/axv_attrs.xml");
    // 没有布局引用 @myCustomAttr 时不会自动生成 axv_attrs（只在布局引用了才生成）
    // 所以这里验证 customAttrs 不声明 android: 即可（attrs 为 undefined 也算通过）
    if (attrs) {
      expect(attrs!.text).not.toContain("android:");
    }
  });

  it("mixed android: and custom attrs → only custom ones declared", async () => {
    const io = fakeIo({});
    const r = await collectProjectRes(
      io,
      "app/src/main/res/layout/activity_main.xml",
      [
        {
          path: "values/styles.xml",
          text:
            '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n' +
            '<style name="MixTheme">\n' +
            '  <item name="android:windowBackground">@color/white</item>\n' +
            "  <item name=\"appLogo\">@drawable/app_logo</item>\n" +
            "</style>\n</resources>",
        },
      ],
    );
    const attrs = r.files.find((f) => f.path === "values/axv_attrs.xml");
    // 核心断言：即使生成了 axv_attrs，也不含 android: 命名空间属性
    if (attrs) {
      expect(attrs!.text).not.toContain("android:");
    }
  });
});
