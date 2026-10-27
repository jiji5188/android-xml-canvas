// test/xml_m2c_dnd.test.ts — 拖放落位判定 + 精确插入 + 代码高亮（M2c）
import { describe, it, expect } from "vitest";
import { isContainerTag, insertAt, insertChild, insertSiblingAfter } from "../lib/xml/insert";
import { highlightXml } from "../components/XmlCodeEditor";

const BASE = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">
    <TextView android:id="@+id/t1" android:text="A" />
    <View android:id="@+id/v1" />
    <Button android:id="@+id/b1" android:text="B" />
</LinearLayout>`;

const TEXT = `<TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="new" />`;

describe("isContainerTag — 拖放落位判定", () => {
  it("常见容器返回 true", () => {
    for (const t of ["LinearLayout", "FrameLayout", "RelativeLayout", "ScrollView", "CardView", "RadioGroup"]) {
      expect(isContainerTag(t), t).toBe(true);
    }
  });

  it("全限定类名取尾段后仍能识别", () => {
    expect(isContainerTag("androidx.constraintlayout.widget.ConstraintLayout")).toBe(true);
    expect(isContainerTag("androidx.appcompat.widget.LinearLayoutCompat")).toBe(true);
  });

  it("叶子控件返回 false", () => {
    for (const t of ["TextView", "Button", "ImageView", "Switch", "View"]) {
      expect(isContainerTag(t), t).toBe(false);
    }
  });

  it("View 本身不是 ViewGroup，不能当容器（用户铁律）", () => {
    expect(isContainerTag("View")).toBe(false);
    expect(isContainerTag("android.view.View")).toBe(false);
  });
});

describe("insertAt — 精确落位", () => {
  it("插到指定索引并重排后续 path", () => {
    const r = insertAt(BASE, "#0", 1, TEXT, "文本");
    expect(r.ok).toBe(true);
    expect(r.insertedPath).toBe("#0/1");
    // 新节点在索引 1 处，原 [0]=t1、[1]=v1、[2]=b1 → 现在 t1、new、v1、b1
    const iNew = r.xml.indexOf('android:text="new"');
    const iV1 = r.xml.indexOf("@+id/v1");
    const iB1 = r.xml.indexOf("@+id/b1");
    expect(iNew).toBeGreaterThan(r.xml.indexOf("@+id/t1"));
    expect(iNew).toBeLessThan(iV1);
    expect(iV1).toBeLessThan(iB1);
  });

  it("索引越界自动夹到末尾", () => {
    const r = insertAt(BASE, "#0", 99, TEXT, "文本");
    expect(r.ok).toBe(true);
    expect(r.insertedPath).toBe("#0/3");
    expect(r.xml.trimEnd().endsWith("</LinearLayout>")).toBe(true);
  });

  it("父节点不存在时返回 ok=false 且不改 XML", () => {
    const r = insertAt(BASE, "#0/9/9", 0, TEXT, "文本");
    expect(r.ok).toBe(false);
    expect(r.xml).toBe(BASE);
    expect(r.issues.length).toBeGreaterThan(0);
  });

  it("保留 <?xml 声明与既有兄弟节点", () => {
    const r = insertAt(BASE, "#0", 0, TEXT, "文本");
    expect(r.xml.startsWith("<?xml")).toBe(true);
    expect((r.xml.match(/<Button/g) || []).length).toBe(1);
    expect(r.xml).toContain("@+id/t1");
  });
});

describe("insertChild / insertSiblingAfter — 既有行为回归", () => {
  it("insertChild 追加到父末尾", () => {
    const r = insertChild(BASE, "#0", TEXT, "文本");
    expect(r.ok).toBe(true);
    expect(r.insertedPath).toBe("#0/3");
  });

  it("insertSiblingAfter 插在目标之后", () => {
    const r = insertSiblingAfter(BASE, "#0/0", TEXT, "文本");
    expect(r.ok).toBe(true);
    expect(r.insertedPath).toBe("#0/1");
    expect(r.xml.indexOf('android:text="new"')).toBeLessThan(r.xml.indexOf("@+id/v1"));
  });

  it("深层节点：插到真正的父级（不是根）且 path 只有单个 #", () => {
    const deep = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">\n  <LinearLayout android:id="@+id/inner" android:layout_width="match_parent" android:layout_height="wrap_content">\n    <TextView android:id="@+id/leaf" android:text="L" />\n  </LinearLayout>\n</LinearLayout>`;
    const r = insertSiblingAfter(deep, "#0/0/0", TEXT, "文本");
    expect(r.ok).toBe(true);
    expect(r.insertedPath).toBe("#0/0/1");
    expect(r.insertedPath?.startsWith("##")).toBe(false);
    // 新节点必须落在 inner 内（在 </LinearLayout> 闭合之前）
    const iNew = r.xml.indexOf('android:text="new"');
    const iLeaf = r.xml.indexOf("@+id/leaf");
    expect(iNew).toBeGreaterThan(iLeaf);
  });
});

describe("highlightXml — 代码高亮分词", () => {
  const html = highlightXml(BASE);

  it("标签 / 属性名 / 属性值 有各自 class", () => {
    expect(html).toContain('class="x-p"');
    expect(html).toContain('class="x-a"');
    expect(html).toContain('class="x-s"');
  });

  it("xml 声明单独着色", () => {
    expect(html).toContain('class="x-m"');
  });

  it("转义 < > & 防止注入", () => {
    const h = highlightXml(`<TextView android:text="a &lt; b &amp; c" />`);
    expect(h).not.toContain("<TextView");
    expect(h).toContain("&lt;");
  });

  it("不含未闭合标签（输出可安全放进 dangerouslySetInnerHTML）", () => {
    const opens = (html.match(/<span /g) || []).length;
    const closes = (html.match(/<\/span>/g) || []).length;
    expect(opens).toBe(closes);
  });
});
