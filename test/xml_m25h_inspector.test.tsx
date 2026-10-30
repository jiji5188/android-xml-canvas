// test/xml_m25h_inspector.test.tsx — 右侧属性面板契约测试（M25h 从 XmlEditor 抽出）
// 做法同 m25c/m25g：函数组件直接调用，遍历元素树断言；不依赖 jsdom。
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { Inspector, type InspectorProps } from "../components/Inspector";
import { AttrPanel } from "../components/AttrPanel";
import { ConstraintPanel } from "../components/ConstraintPanel";
import type { ResolvedNode } from "../lib/xml/types";

type El = { type: unknown; props: Record<string, any> };

function node(over: Partial<ResolvedNode> = {}): ResolvedNode {
  return {
    path: "0/1",
    tag: "TextView",
    rawAttrs: { "android:text": "Hi" },
    ...over,
  } as unknown as ResolvedNode;
}

function props(over: Partial<InspectorProps> = {}): InspectorProps {
  return {
    open: false,
    onClose: vi.fn(),
    node: node(),
    chain: [{ tag: "LinearLayout", path: "0" }],
    isChildOfCL: false,
    clSiblings: [],
    onCommitMany: vi.fn(),
    onAutoConstrain: vi.fn(),
    onClearConstraints: vi.fn(),
    onSelectPath: vi.fn(),
    onCommitAttr: vi.fn(),
    onRemoveAttr: vi.fn(),
    onAddAttr: vi.fn(),
    onDeleteNode: vi.fn(),
    resExtras: null,
    iconNames: ["ic_a"],
    generatedXml: { ic_a: "<vector/>" },
    ...over,
  };
}

/** 把子树里的文本全部拼起来（包含直接字符串子节点） */
function flatText(n: ReactNode): string {
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map((c) => flatText(c as ReactNode)).join("");
  if (!isValidElement(n)) return "";
  return flatText((n as unknown as El).props?.children as ReactNode);
}

function collect(n: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(n)) {
    for (const c of n) collect(c as ReactNode, out);
    return out;
  }
  if (!isValidElement(n)) return out;
  const el = n as unknown as El;
  out.push(el);
  collect(el.props?.children as ReactNode, out);
  return out;
}

function render(over: Partial<InspectorProps> = {}) {
  const p = props(over);
  const tree = Inspector(p) as unknown as El;
  const all = collect(tree as unknown as ReactNode);
  const texts = all.map((e) => (typeof e.props.children === "string" ? e.props.children : "")).join("|");
  return { p, tree, all, texts };
}

describe("Inspector — 容器", () => {
  it("open 决定 axv-open", () => {
    expect(String(render({ open: true }).tree.props.className)).toContain("axv-open");
    expect(String(render({ open: false }).tree.props.className)).not.toContain("axv-open");
  });

  it("关闭按钮回调 onClose", () => {
    const { all, p } = render({ open: true });
    const btn = all.find((e) => e.props["aria-label"] === "关闭面板");
    (btn?.props.onClick as () => void)();
    expect(p.onClose).toHaveBeenCalled();
  });
});

describe("Inspector — 内容", () => {
  it("没选中节点 → 空态提示，不渲染 AttrPanel", () => {
    const { all, texts } = render({ node: null });
    expect(texts).toContain("在画布或图层树上点任意控件查看并编辑属性");
    expect(all.some((e) => e.type === AttrPanel)).toBe(false);
  });

  it("选中节点 → 渲染 AttrPanel，并带上链/图标名/生成资源", () => {
    const { all } = render();
    const attr = all.find((e) => e.type === AttrPanel);
    expect(attr).toBeTruthy();
    expect(attr?.props.chain).toEqual([{ tag: "LinearLayout", path: "0" }]);
    expect(attr?.props.iconNames).toEqual(["ic_a"]);
    expect(attr?.props.generatedXml).toEqual({ ic_a: "<vector/>" });
  });

  it("删除节点回调用的是当前节点 path", () => {
    const { all, p } = render({ node: node({ path: "0/2/1" }) });
    const attr = all.find((e) => e.type === AttrPanel);
    (attr?.props.onDeleteNode as () => void)();
    expect(p.onDeleteNode).toHaveBeenCalledWith("0/2/1");
  });

  it("include 展开的节点显示只读提示", () => {
    const { all } = render({ node: node({ sourceFile: "layout/part_header.xml" }) });
    const box = all.find((e) => String(e.props.className) === "axv-include-readonly");
    expect(box).toBeTruthy();
    const flat = flatText(box?.props.children as ReactNode);
    expect(flat).toContain("layout/part_header.xml");
    expect(flat).toContain("include 展开，只读");
  });

  it("普通节点不显示只读提示", () => {
    const { all } = render();
    expect(all.some((e) => String(e.props.className) === "axv-include-readonly")).toBe(false);
  });

  it("ConstraintLayout 子控件才出约束面板", () => {
    const off = render({ isChildOfCL: false });
    expect(off.all.some((e) => e.type === ConstraintPanel)).toBe(false);
    const on = render({ isChildOfCL: true, clSiblings: [{ path: "0", tag: "Button", id: "btn" } as any] });
    const cp = on.all.find((e) => e.type === ConstraintPanel);
    expect(cp).toBeTruthy();
    expect(cp?.props.siblings).toHaveLength(1);
  });

  it("约束面板回调直连（不做包装）", () => {
    const { all, p } = render({ isChildOfCL: true });
    const cp = all.find((e) => e.type === ConstraintPanel);
    (cp?.props.onAuto as () => void)();
    (cp?.props.onClear as () => void)();
    expect(p.onAutoConstrain).toHaveBeenCalled();
    expect(p.onClearConstraints).toHaveBeenCalled();
  });
});
