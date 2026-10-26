// test/xml_m2h_open_validate.test.ts — M2h：打开 xml 文件的前置校验逻辑（复用 parseLayoutXml）
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";

describe("M2h 打开 xml 文件可解析性预检（openProject 用）", () => {
  it("合法布局 xml → root 非空", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="hi" />
</FrameLayout>`;
    const { root } = parseLayoutXml(xml);
    expect(root).not.toBeNull();
    expect(root!.tag).toBe("FrameLayout");
  });

  it("空字符串 → root 为 null（应被拒载）", () => {
    const { root } = parseLayoutXml("");
    expect(root).toBeNull();
  });

  it("纯文本（非 xml）→ root 为 null", () => {
    const { root } = parseLayoutXml("hello world");
    expect(root).toBeNull();
  });

  it("不完整标签（缺 >）→ 解析器容错为自闭合，不报错（root 非空，可渲染）", () => {
    // 注：本项目的 parser 对「缺 > 的结尾」做容错——把未闭合标签当自闭合处理，
    //  不报 error，root 仍可解析。这是有意设计（避免用户敲一半就红一片）。
    const { root, issues } = parseLayoutXml(`<View android:layout_width="wrap_content"`);
    expect(root).not.toBeNull();
    expect(root!.tag).toBe("View");
    // 不产生 error 级 issue（容错行为）
    expect(issues.filter((i) => i.level === "error")).toHaveLength(0);
  });

  it("合法 xml 但根不是布局容器（如 <resources>）→ root 非空，但语义上是 values 文件", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <string name="app_name">MyApp</string>
</resources>`;
    const { root } = parseLayoutXml(xml);
    // 解析器层面不区分 layout 和 values，都当元素解析 → root 非空
    expect(root).not.toBeNull();
    expect(root!.tag).toBe("resources");
  });
});
