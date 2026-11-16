import { test, expect, describe, beforeEach } from "vitest";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { clearResIndex } from "@/lib/xml/res-index";

beforeEach(() => { clearResIndex(); });

type Io = {
  list: (rel: string) => Promise<{ ok: boolean; items?: string[] } | null>;
  read: (rel: string) => Promise<{ ok: boolean; text?: string } | null>;
  rootLabel: () => string;
};

// M318b：缺 @color/@string 的占位值要「可见」——color 用 #FFCCCCCC 灰（不是全透明），
// string 用资源名占位（不是空），否则缺资源时按钮/文字渲染成全透明，用户误以为「控件少了」。
describe("M318b collectProjectRes 缺资源占位值可见", () => {
  test("缺 @color 生成可见灰占位（非透明）", async () => {
    const layout = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" android:background="@color/card_bg"><Button android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="@string/button_ok" android:background="@color/primary" android:textColor="@color/white"/></LinearLayout>`;
    const res = await collectProjectRes(
      {
        list: async (p: string) => {
          if (p === "res" || p.endsWith("/res")) return { ok: true, items: [{ kind: "dir", name: "values" }, { kind: "dir", name: "layout" }] };
          if (p.endsWith("/values")) return { ok: true, items: [] }; // values 空 → 全缺
          return { ok: false, items: [] };
        },
        read: async () => ({ ok: false }),
        rootLabel: () => "test1",
      } as any, // io：res 目录存在但 values 全空 → 缺资源走占位
      null, // docRel
      [{ path: "res/layout/linear_layout.xml", text: layout }]
    );
    // 应该生成 axv_stub.xml，且 color 占位是可见灰
    const stub = res.files.find((f) => f.path === "values/axv_stub.xml");
    expect(stub).toBeTruthy();
    expect(stub!.text).toContain('<color name="card_bg">#FFCCCCCC</color>');
    expect(stub!.text).toContain('<color name="primary">#FFCCCCCC</color>');
    expect(stub!.text).toContain('<color name="white">#FFCCCCCC</color>');
    // 不再是全透明 #00000000
    expect(stub!.text).not.toContain('#00000000');
    // string 占位文本 = 资源名（可见，看得出是缺的）
    expect(stub!.text).toContain('<string name="button_ok">button_ok</string>');
    // stubbed 记了这些 key
    expect(res.stubbed).toContain("color/card_bg");
    expect(res.missing).not.toContain("color/card_bg"); // 占位后不再算 missing
  });

  test("项目里已定义的 color 不被占位覆盖", async () => {
    const layout = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" android:background="@color/card_bg" android:textColor="@color/ghost"/>`;
    const colorsXml = `<resources><color name="card_bg">#FF123456</color></resources>`;
    const io: any = {
      list: async (p: string) => {
        if (p === "res" || p.endsWith("/res")) return { ok: true, items: [{ kind: "dir", name: "values" }, { kind: "dir", name: "layout" }] };
        if (p.endsWith("/values")) return { ok: true, items: [{ kind: "file", name: "colors.xml" }] };
        return { ok: false, items: [] };
      },
      read: async (rel: string) => (rel.includes("colors") ? { ok: true, text: colorsXml } : { ok: false }),
      rootLabel: () => "test2",
    };
    const res = await collectProjectRes(io, null, [{ path: "res/layout/linear_layout.xml", text: layout }]);
    // card_bg 有定义 → 不在 stub；ghost 缺 → 占位
    const stub = res.files.find((f) => f.path === "values/axv_stub.xml");
    expect(stub!.text).not.toContain('name="card_bg"'); // 已定义，不占位
    expect(stub!.text).toContain('name="ghost"'); // 缺，占位
  });
});
