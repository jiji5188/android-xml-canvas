// test/xml_m28_attr_filter.test.tsx — 属性面板：搜索框 + 只看已修改（M28）
// AttrPanel 有 hooks，函数组件直调会炸（useState 需要 dispatcher）→ 用 renderToStaticMarkup。

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttrPanel, type AttrPanelProps } from "../components/AttrPanel";
import type { ResolvedNode } from "@/lib/xml/types";

function node(attrs: Record<string, string> = {}): ResolvedNode {
  return {
    path: "0/0",
    tag: "TextView",
    rawAttrs: {
      "android:id": "@+id/title",
      "android:layout_width": "match_parent",
      "android:layout_height": "wrap_content",
      "android:textSize": "16sp",
      ...attrs,
    },
  } as unknown as ResolvedNode;
}

function html(over: Partial<AttrPanelProps> = {}): string {
  const p: AttrPanelProps = {
    node: node(),
    onCommit: () => {},
    onRemove: () => {},
    onAddAttr: () => {},
    ...over,
  } as unknown as AttrPanelProps;
  return renderToStaticMarkup(<AttrPanel {...p} />);
}

describe("属性面板过滤条", () => {
  it("有属性时渲染搜索框 + 只看已修改按钮", () => {
    const out = html();
    expect(out).toContain("axv-attr-filter-input");
    expect(out).toContain("只看已修改");
    expect(out).toContain("过滤 4 个属性");
  });

  it("默认显示全部属性行", () => {
    const out = html();
    const rows = out.match(/class="axv-attr-row"/g) ?? [];
    expect(rows.length).toBe(4);
    expect(out).toContain("textSize");
    expect(out).toContain("layout_width");
  });

  it("没有属性时显示空态且不渲染过滤条", () => {
    const n = node();
    (n as unknown as { rawAttrs: Record<string, string> }).rawAttrs = {};
    const out = html({ node: n } as Partial<AttrPanelProps>);
    expect(out).toContain("该节点还没有属性");
    expect(out).not.toContain("axv-attr-filter-input");
  });
});
