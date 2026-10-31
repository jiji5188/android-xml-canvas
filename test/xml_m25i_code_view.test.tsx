// test/xml_m25i_code_view.test.tsx — XML 代码视图契约测试（M25i 抽出，M30b 去掉底部工具条）
//
// M30b：底部 .axv-mob-xml-tools 整条删除（顶部工具栏已有 打开/保存/res 包/运行/存至），
//       格式化按钮挪进编辑器内的符号快捷条最前方，所以这里只剩「编辑器 + onFormat 转发」。
// 注意：XmlCodeEditor 带 hooks，不能像 XmlCodeView 那样直接当函数调，用 renderToStaticMarkup。
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { XmlCodeView, type XmlCodeViewProps } from "../components/XmlCodeView";
import { XmlCodeEditor, SYMBOLS } from "../components/XmlCodeEditor";
import { CodeEditor } from "../components/CodeEditor";

type El = { type: unknown; props: Record<string, any> };

function props(over: Partial<XmlCodeViewProps> = {}): XmlCodeViewProps {
  return {
    open: true,
    isMobile: false,
    leftOpen: false,
    rightOpen: false,
    value: "<LinearLayout/>",
    onChange: vi.fn(),
    errors: [],
    focusLine: 3,
    focusTick: 2,
    onCursorLine: vi.fn(),
    onFormat: vi.fn(),
    ...over,
  };
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

function render(over: Partial<XmlCodeViewProps> = {}) {
  const p = props(over);
  const tree = XmlCodeView(p) as unknown as El | null;
  const all = tree ? collect(tree as unknown as ReactNode) : [];
  return { p, tree, all };
}

describe("XmlCodeEditor — M30 常用符号快捷条", () => {
  it("SYMBOLS 数据完整：label/insert 齐全，特殊符号带 back", () => {
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(20);
    for (const s of SYMBOLS) {
      expect(s.label).toBeTruthy();
      expect(s.insert).toBeTruthy();
    }
    const empty = SYMBOLS.find((s) => s.label === '""');
    expect(empty?.back).toBe(1);
    expect(SYMBOLS.find((s) => s.label === "&")?.insert).toBe("&amp;");
  });

  it("M30b：给了 onFormat 就把「格式化」放在符号条最前面", () => {
    const html = renderToStaticMarkup(
      <XmlCodeEditor value="<A/>" onChange={() => {}} onFormat={() => {}} />,
    );
    const bar = html.indexOf('class="axv-sym-bar"');
    expect(bar).toBeGreaterThan(-1);
    const fmt = html.indexOf("axv-sym-action");
    expect(fmt).toBeGreaterThan(bar);
    const firstSym = html.indexOf("axv-sym-btn", bar + 20);
    // 第一个 axv-sym-btn 就是格式化按钮
    expect(html.slice(firstSym, firstSym + 40)).toContain("axv-sym-action");
    expect(html).toContain("格式化");
  });

  it("不给 onFormat 时符号条里没有格式化按钮", () => {
    const html = renderToStaticMarkup(<XmlCodeEditor value="<A/>" onChange={() => {}} />);
    expect(html).toContain("axv-sym-bar");
    expect(html).not.toContain("axv-sym-action");
  });
});

describe("XmlCodeView — 显隐与位置", () => {
  it("open=false 时完全不渲染", () => {
    expect(render({ open: false }).tree).toBeNull();
  });

  it("桌面端按两侧面板宽度避让", () => {
    const closed = render({ leftOpen: false, rightOpen: false }).tree as El;
    expect(closed.props.style.left).toBe(16);
    expect(closed.props.style.right).toBe(16);
    const both = render({ leftOpen: true, rightOpen: true }).tree as El;
    expect(both.props.style.left).toBe(336);
    expect(both.props.style.right).toBe(336);
  });

  it("移动端不写内联位置（走 CSS）", () => {
    expect((render({ isMobile: true }).tree as El).props.style).toBeUndefined();
  });

  it("编辑器拿到 value / 焦点行 / 错误", () => {
    const { all } = render();
    const ed = all.find((e) => e.type === CodeEditor);
    expect(ed?.props.value).toBe("<LinearLayout/>");
    expect(ed?.props.focusLine).toBe(3);
    expect(ed?.props.focusTick).toBe(2);
    expect(Array.isArray(ed?.props.errors)).toBe(true);
    expect(ed?.props.className).toBe("axv-code-fill");
  });

  it("onFormat 透传给编辑器（格式化按钮在符号条里）", () => {
    const { p, all } = render();
    const ed = all.find((e) => e.type === CodeEditor);
    expect(ed?.props.onFormat).toBe(p.onFormat);
  });
});

describe("XmlCodeView — M30b 底部工具条已移除", () => {
  it("不再渲染 .axv-mob-xml-tools 和任何按钮", () => {
    const { all } = render();
    const cls = (e: El) => String(e.props.className ?? "");
    expect(all.find((e) => cls(e).includes("axv-mob-xml-tools"))).toBeUndefined();
    expect(all.find((e) => e.type === "button")).toBeUndefined();
    expect(all.find((e) => e.type === "select")).toBeUndefined();
  });

  it("只有一层容器 + 编辑器两个元素", () => {
    const { all } = render();
    expect(all.length).toBe(2);
    expect(String((all[0] as El).props.className)).toBe("axv-mob-xml");
  });
});
