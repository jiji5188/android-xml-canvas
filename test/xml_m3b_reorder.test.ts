// M3b：层级调整（兄弟顺序 = 渲染层次）+ 原文保留
import { describe, expect, it } from "vitest";
import {
  scanElements,
  elementAt,
  splitPath,
  moveSiblingRaw,
  moveBy,
  bringToFront,
  sendToBack,
} from "../lib/xml/reorder";
import { moveSibling } from "../lib/xml/insert";
import { parseLayoutXml } from "../lib/xml/parser";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

const XML = `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <!-- 顶部标题 -->
    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="标题" />

    <!-- 中间内容 -->
    <TextView
        android:id="@+id/body"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="正文" />

    <!-- 底部按钮 -->
    <Button
        android:id="@+id/ok"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="确定" />
</LinearLayout>
`;

/** 取当前 XML 里所有 android:id 出现顺序 */
function idOrder(xml: string): string[] {
  return [...xml.matchAll(/android:id="@\+?id\/([a-z_]+)"/g)].map((m) => m[1]);
}

describe("M3b scanElements", () => {
  it("扫出元素树与层级", () => {
    const root = scanElements(XML)!;
    expect(root.tag).toBe("LinearLayout");
    expect(root.children).toHaveLength(3);
    expect(root.children.map((c) => c.tag)).toEqual(["TextView", "TextView", "Button"]);
  });

  it("自闭合标签识别正确（不会吞掉后面的兄弟）", () => {
    const root = scanElements(XML)!;
    expect(root.children.every((c) => c.selfClosing)).toBe(true);
    // 每个子元素 span 都必须是原文切片，能还原成完整标签
    const third = XML.slice(root.children[2].start, root.children[2].end);
    expect(third).toContain('android:id="@+id/ok"');
    expect(third.endsWith("/>")).toBe(true);
  });

  it("elementAt 按 path 取节点（#0/2 是 Button）", () => {
    const root = scanElements(XML);
    expect(elementAt(root, "#0")?.tag).toBe("LinearLayout");
    expect(elementAt(root, "#0/2")?.tag).toBe("Button");
    expect(elementAt(root, "#0/9")).toBeNull();
  });

  it("splitPath 拆父子", () => {
    expect(splitPath("#0/1/2")).toEqual({ parentPath: "#0/1", index: 2 });
  });
});

describe("M3b 层级调整", () => {
  it("下移一层：title 与 body 换位", () => {
    const r = moveBy(XML, "#0/0", 1);
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/1");
    expect(idOrder(r.xml)).toEqual(["body", "title", "ok"]);
  });

  it("上移一层：ok 提到第二位", () => {
    const r = moveBy(XML, "#0/2", -1);
    expect(r.ok).toBe(true);
    expect(idOrder(r.xml)).toEqual(["title", "ok", "body"]);
  });

  it("置顶：title 移到最上层（兄弟列表末尾）", () => {
    const r = bringToFront(XML, "#0/0");
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/2");
    expect(idOrder(r.xml)).toEqual(["body", "ok", "title"]);
  });

  it("置底：ok 移到最下层（兄弟列表最前）", () => {
    const r = sendToBack(XML, "#0/2");
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/0");
    expect(idOrder(r.xml)).toEqual(["ok", "title", "body"]);
  });

  it("已在顶/底时越界不报错，位置不动", () => {
    const a = moveBy(XML, "#0/0", -1);
    expect(a.ok).toBe(true);
    expect(idOrder(a.xml)).toEqual(["title", "body", "ok"]);
    const b = bringToFront(XML, "#0/2");
    expect(b.ok).toBe(true);
    expect(idOrder(b.xml)).toEqual(["title", "body", "ok"]);
  });

  it("根节点不能移动", () => {
    const r = moveSiblingRaw(XML, "#0", 1);
    expect(r.ok).toBe(false);
    expect(r.xml).toBe(XML);
  });

  it("注释跟着自己的控件一起走（不跑到文件末尾）", () => {
    const r = moveBy(XML, "#0/0", 1);
    expect(r.xml).toContain("<!-- 顶部标题 -->");
    const i = r.xml.indexOf("<!-- 顶部标题 -->");
    const j = r.xml.indexOf('android:id="@+id/title"');
    expect(j).toBeGreaterThan(i);
    // 注释仍在文档中间，而不是被追加到最尾部
    expect(r.xml.trimEnd().endsWith("</LinearLayout>")).toBe(true);
    // 注释总数不丢
    expect((r.xml.match(/<!--/g) || []).length).toBe(3);
  });

  it("移动其余字节一个不动（属性顺序/缩进/命名空间原样保留）", () => {
    const r = moveBy(XML, "#0/1", -1);
    // 根标签原文与结尾原文都完整
    expect(r.xml.startsWith(`<LinearLayout ${A}`)).toBe(true);
    expect(r.xml.endsWith("</LinearLayout>\n")).toBe(true);
    // 每个控件块原文逐字节相同（只换了顺序）
    const blocks = XML.match(/<TextView[\s\S]*?\/>/g)!;
    for (const b of blocks) expect(r.xml).toContain(b);
  });

  it("移动后 XML 仍能正常解析，层级也对", () => {
    const r = bringToFront(XML, "#0/0");
    const { root, issues } = parseLayoutXml(r.xml);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    expect(root!.children.map((c) => c.attrs.id)).toEqual(["@+id/body", "@+id/ok", "@+id/title"]);
  });

  it("嵌套：只动同一父级下的兄弟，不跨层", () => {
    const nested = `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="0dp">
        <View android:id="@+id/a" android:layout_width="1dp" android:layout_height="1dp" />
        <View android:id="@+id/b" android:layout_width="1dp" android:layout_height="1dp" />
    </FrameLayout>
</LinearLayout>`;
    const r = bringToFront(nested, "#0/0/0");
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/0/1");
    const ia = r.xml.indexOf('@+id/a');
    const ib = r.xml.indexOf('@+id/b');
    expect(ib).toBeLessThan(ia);
    // 外层结构没动
    expect(r.xml).toContain("<FrameLayout");
  });

  it("moveSibling 旧入口走同一套逻辑（返回 newPath）", () => {
    const r = moveSibling(XML, "#0/0", 2);
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/2");
    expect(idOrder(r.xml)).toEqual(["body", "ok", "title"]);
  });
});
