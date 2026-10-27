// M3d：跨父级移动（拖拽排序：移到上层/下层/兄弟层）
import { describe, expect, it } from "vitest";
import { moveNodeRaw, remapPathAfterRemoval, scanElements, elementAt } from "../lib/xml/reorder";
import { parseLayoutXml, findNode } from "../lib/xml/parser";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

/** 外层竖排：一个 TextView + 一个 FrameLayout（内含 a/b） */
const XML = `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <!-- 标题 -->
    <TextView
        android:id="@+id/title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="标题" />

    <FrameLayout
        android:id="@+id/box"
        android:layout_width="match_parent"
        android:layout_height="200dp">

        <View
            android:id="@+id/a"
            android:layout_width="10dp"
            android:layout_height="10dp" />

        <View
            android:id="@+id/b"
            android:layout_width="10dp"
            android:layout_height="10dp" />
    </FrameLayout>
</LinearLayout>
`;

const idOrder = (xml: string) => [...xml.matchAll(/android:id="@\+?id\/([a-z_]+)"/g)].map((m) => m[1]);

describe("M3d remapPathAfterRemoval", () => {
  it("后面的兄弟下标 -1", () => {
    expect(remapPathAfterRemoval("#0/2", "#0/1")).toBe("#0/1");
    expect(remapPathAfterRemoval("#0/1", "#0/1")).toBeNull();
    expect(remapPathAfterRemoval("#0/0", "#0/1")).toBe("#0/0");
  });
  it("深层路径也按最近的祖先重映射", () => {
    expect(remapPathAfterRemoval("#0/2/0", "#0/1")).toBe("#0/1/0");
    expect(remapPathAfterRemoval("#0/1/0", "#0/1")).toBeNull();
  });
});

describe("M3d moveNodeRaw 跨父级", () => {
  it("拖进容器：title 成为 FrameLayout 的子控件（移到子组件层）", () => {
    // 父级 #0/0 是原 FrameLayout；删掉 title 后它变成 #0/0
    const r = moveNodeRaw(XML, "#0/0", { parentPath: "#0/1", index: 2 });
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/0/2");
    const { root } = parseLayoutXml(r.xml);
    const box = findNode(root!, "#0/0")!;
    expect(box.tag).toBe("FrameLayout");
    expect(box.children.map((c) => c.attrs.id)).toEqual(["@+id/a", "@+id/b", "@+id/title"]);
  });

  it("拖出容器：a 提到 FrameLayout 外面，成为兄弟层", () => {
    const r = moveNodeRaw(XML, "#0/1/0", { parentPath: "#0", index: 0 });
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/0");
    expect(idOrder(r.xml)).toEqual(["a", "title", "box", "b"]);
    const { root } = parseLayoutXml(r.xml);
    expect(findNode(root!, "#0/0")!.attrs.id).toBe("@+id/a");
  });

  it("移到容器内指定位置（插到第一个子项前）", () => {
    const r = moveNodeRaw(XML, "#0/0", { parentPath: "#0/1", index: 0 });
    expect(r.ok).toBe(true);
    const { root } = parseLayoutXml(r.xml);
    const box = findNode(root!, "#0/0")!;
    expect(box.children.map((c) => c.attrs.id)).toEqual(["@+id/title", "@+id/a", "@+id/b"]);
  });

  it("同父级拖动 = 纯重排（不会走删除再插入）", () => {
    const r = moveNodeRaw(XML, "#0/0", { parentPath: "#0", index: 2 });
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/1");
    expect(idOrder(r.xml)).toEqual(["box", "a", "b", "title"]);
  });

  it("不能移动到自己内部（循环引用护栏）", () => {
    const r = moveNodeRaw(XML, "#0/1", { parentPath: "#0/1/0", index: 0 });
    expect(r.ok).toBe(false);
    expect(r.xml).toBe(XML);
    expect(r.issues[0].message).toContain("内部");
  });

  it("根节点不能移动", () => {
    const r = moveNodeRaw(XML, "#0", { parentPath: "#0", index: 0 });
    expect(r.ok).toBe(false);
  });

  it("单 child 容器已满时拒绝（maxChildren 校验）", () => {
    const r = moveNodeRaw(XML, "#0/0", { parentPath: "#0/1", index: 1, maxChildren: 2 });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain("已满");
  });

  it("注释跟着控件一起搬走（不留在原地）", () => {
    const r = moveNodeRaw(XML, "#0/1/0", { parentPath: "#0", index: 0 });
    expect(r.ok).toBe(true);
    // 注释仍属于 title，a 上面没有多余注释
    const i = r.xml.indexOf("<!-- 标题 -->");
    const t = r.xml.indexOf('@+id/title');
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(t);
    expect((r.xml.match(/<!--/g) || []).length).toBe(1);
  });

  it("跨层后缩进按目标层级重排", () => {
    const r = moveNodeRaw(XML, "#0/1/0", { parentPath: "#0", index: 0 });
    // a 现在是根的子项，缩进应为 4 空格；内部属性缩进 8 空格
    expect(r.xml).toMatch(/\n {4}<View\n {8}android:id="@\+id\/a"/);
  });

  it("移动后不留空行残骸", () => {
    const r = moveNodeRaw(XML, "#0/1/1", { parentPath: "#0", index: 1 });
    expect(r.ok).toBe(true);
    // 不允许出现连续两个空行
    expect(/\n[ \t]*\n[ \t]*\n/.test(r.xml)).toBe(false);
  });

  it("移动后仍能解析且没有 error 级问题", () => {
    const r = moveNodeRaw(XML, "#0/0", { parentPath: "#0/1", index: 1 });
    const { issues } = parseLayoutXml(r.xml);
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
    // 元素树结构正确
    const el = elementAt(scanElements(r.xml), "#0/0");
    expect(el?.tag).toBe("FrameLayout");
  });

  it("源节点块原文逐字节保留（只整体平移缩进）", () => {
    const r = moveNodeRaw(XML, "#0/0", { parentPath: "#0/1", index: 2 });
    // 原块缩进 4，封入 FrameLayout（子项 8）后整体 +4 → 属性行 12 空格
    expect(r.xml).toContain('android:id="@+id/title"\n            android:layout_width="wrap_content"');
    // 属性顺序、取值与其他行完全没改
    expect(r.xml).toContain('android:text="标题" />');
  });
});
