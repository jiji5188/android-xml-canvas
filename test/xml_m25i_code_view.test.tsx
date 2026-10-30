// test/xml_m25i_code_view.test.tsx — XML 代码视图契约测试（M25i 从 XmlEditor 抽出）
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { XmlCodeView, type XmlCodeViewProps } from "../components/XmlCodeView";
import { XmlCodeEditor } from "../components/XmlCodeEditor";

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
    onSample: vi.fn(),
    fileSelect: null,
    onOpenFile: vi.fn(),
    onSave: vi.fn(),
    onExportRes: vi.fn(),
    onRun: vi.fn(),
    hasRes: true,
    nativeAvailable: true,
    workspaceLabel: "/sdcard/AxvWorkspace",
    onChooseWorkspace: vi.fn(),
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
  const btn = (label: string) =>
    all.find((e) => e.type === "button" && String(e.props.children).trim() === label);
  return { p, tree, all, btn };
}

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
    const ed = all.find((e) => e.type === XmlCodeEditor);
    expect(ed?.props.value).toBe("<LinearLayout/>");
    expect(ed?.props.focusLine).toBe(3);
    expect(ed?.props.focusTick).toBe(2);
    expect(Array.isArray(ed?.props.errors)).toBe(true);
    expect(ed?.props.className).toBe("axv-code-fill");
  });
});

describe("XmlCodeView — 工具栏", () => {
  it("基础按钮齐全：格式化/打开/保存/res 包/运行/存至", () => {
    const { btn } = render();
    for (const label of ["格式化", "打开", "保存", "res 包", "▶ 运行", "存至"]) {
      expect(btn(label), label).toBeTruthy();
    }
  });

  it("没有 res 时不显示 res 包；APK 外不显示存至", () => {
    const { btn } = render({ hasRes: false, nativeAvailable: false });
    expect(btn("res 包")).toBeUndefined();
    expect(btn("存至")).toBeUndefined();
  });

  it("按钮回调接到了对应 props", () => {
    const { btn, p } = render();
    (btn("格式化")?.props.onClick as () => void)();
    (btn("打开")?.props.onClick as () => void)();
    (btn("保存")?.props.onClick as () => void)();
    (btn("res 包")?.props.onClick as () => void)();
    (btn("▶ 运行")?.props.onClick as () => void)();
    (btn("存至")?.props.onClick as () => void)();
    expect(p.onFormat).toHaveBeenCalled();
    expect(p.onOpenFile).toHaveBeenCalled();
    expect(p.onSave).toHaveBeenCalled();
    expect(p.onExportRes).toHaveBeenCalled();
    expect(p.onRun).toHaveBeenCalled();
    expect(p.onChooseWorkspace).toHaveBeenCalled();
  });

  it("存至的 title 带工作目录", () => {
    const { btn } = render();
    expect(btn("存至")?.props.title).toBe("保存位置：/sdcard/AxvWorkspace");
    const { btn: b2 } = render({ workspaceLabel: "" });
    expect(b2("存至")?.props.title).toBe("保存位置：默认目录");
  });

  it("示例下拉：两个分组，选值透传（空白带 blank: 前缀）", () => {
    const { all, p } = render();
    const sel = all.find((e) => e.type === "select");
    expect(sel).toBeTruthy();
    const groups = collect(sel?.props.children as ReactNode).filter((e) => e.type === "optgroup");
    expect(groups.map((g) => g.props.label)).toEqual(["完整示例（带资源）", "新建（空白）"]);
    const opts = collect(sel?.props.children as ReactNode).filter((e) => e.type === "option");
    expect(opts[0].props.value).toBe("");
    expect(opts.some((o) => String(o.props.value).startsWith("blank:"))).toBe(true);
    (sel?.props.onChange as (e: unknown) => void)({ target: { value: "blank:empty" } });
    expect(p.onSample).toHaveBeenCalledWith("blank:empty");
    // 选空值不触发
    vi.mocked(p.onSample).mockClear();
    (sel?.props.onChange as (e: unknown) => void)({ target: { value: "" } });
    expect(p.onSample).not.toHaveBeenCalled();
  });

  it("fileSelect 作为插槽渲染进去", () => {
    const { all } = render({ fileSelect: <select data-slot="files" /> });
    expect(all.some((e) => e.props["data-slot"] === "files")).toBe(true);
  });
});
