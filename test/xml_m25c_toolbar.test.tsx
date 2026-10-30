// test/xml_m25c_toolbar.test.tsx — 顶部工具栏（纯展示组件）契约测试
// 目的：M25c 把工具栏从 XmlEditor 抽出来后，锁住「哪些按钮在什么条件下出现」以及回调是否接对。
// 做法：Toolbar 是无副作用函数组件，直接调用得到 React 元素树，遍历 children 找按钮，
//      不用 jsdom / RTL（本项目 React 19 生产构建下 RTL 的 act 探测会失败）。
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import { Toolbar, type ToolbarProps } from "../components/Toolbar";

function props(over: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    isMobile: false,
    leftOpen: true,
    rightOpen: true,
    onOpenLeft: vi.fn(),
    onOpenRight: vi.fn(),
    deviceId: "pixel_5",
    onChangeDevice: vi.fn(),
    scale: 1,
    onScale: vi.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    onOpenFile: vi.fn(),
    onCopyXml: vi.fn(),
    showResZip: false,
    onExportRes: vi.fn(),
    onExportImage: vi.fn(),
    hasRes: false,
    onClearRes: vi.fn(),
    nativeAvailable: false,
    workspaceLabel: "",
    onChangeWorkspace: vi.fn(),
    onRun: vi.fn(),
    onFormat: vi.fn(),
    ...over,
  };
}

type El = { type: unknown; props: Record<string, unknown> };

/** 深度遍历元素树，收集所有带 aria-label 的节点 */
function collect(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) collect(n as ReactNode, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as unknown as El;
  if (el.props && el.props["aria-label"]) out.push(el);
  collect(el.props?.children as ReactNode, out);
  return out;
}

function render(over: Partial<ToolbarProps> = {}) {
  const p = props(over);
  const tree = Toolbar(p) as unknown as El;
  const all = collect(tree as unknown as ReactNode);
  const by = (label: string) => all.find((e) => e.props["aria-label"] === label);
  const labels = all.map((e) => String(e.props["aria-label"]));
  return { p, tree, all, by, labels };
}

describe("Toolbar — 侧栏按钮", () => {
  it("两侧面板都开着时不显示侧滑按钮", () => {
    const { by } = render();
    expect(by("展开左侧面板")).toBeUndefined();
    expect(by("右侧属性面板")).toBeUndefined();
  });

  it("左侧收起后出现「展开左侧面板」，点击触发 onOpenLeft", () => {
    const { by, p } = render({ leftOpen: false });
    const b = by("展开左侧面板");
    expect(b).toBeDefined();
    (b!.props.onClick as () => void)();
    expect(p.onOpenLeft).toHaveBeenCalledTimes(1);
  });

  it("右侧收起后出现「右侧属性面板」，点击触发 onOpenRight", () => {
    const { by, p } = render({ rightOpen: false });
    const b = by("右侧属性面板");
    expect(b).toBeDefined();
    (b!.props.onClick as () => void)();
    expect(p.onOpenRight).toHaveBeenCalledTimes(1);
  });

  it("撤销/重做按 canUndo / canRedo 置灰", () => {
    const a = render({ canUndo: true, canRedo: false });
    expect(a.by("撤销")!.props.disabled).toBe(false);
    expect(a.by("重做")!.props.disabled).toBe(true);

    const b = render({ canUndo: false, canRedo: true });
    expect(b.by("撤销")!.props.disabled).toBe(true);
    expect(b.by("重做")!.props.disabled).toBe(false);
  });
});

describe("Toolbar — res / 原生容器相关按钮的显隐", () => {
  it("无 res 资源时既没有导出 res 包也没有清除 res", () => {
    const { by } = render({ showResZip: false, hasRes: false });
    expect(by("导出 res 包")).toBeUndefined();
    expect(by("清除 res")).toBeUndefined();
  });

  it("有 res 资源时两个按钮都出现，点击各自回调", () => {
    const { by, p } = render({ showResZip: true, hasRes: true });
    (by("导出 res 包")!.props.onClick as () => void)();
    (by("清除 res")!.props.onClick as () => void)();
    expect(p.onExportRes).toHaveBeenCalledTimes(1);
    expect(p.onClearRes).toHaveBeenCalledTimes(1);
  });

  it("只有生成 drawable（showResZip=true 但 hasRes=false）时只显示导出，不显示清除", () => {
    const { by } = render({ showResZip: true, hasRes: false });
    expect(by("导出 res 包")).toBeDefined();
    expect(by("清除 res")).toBeUndefined();
  });

  it("Web 端（非原生容器）不显示「更换保存位置」", () => {
    const { by } = render({ nativeAvailable: false });
    expect(by("更换保存位置")).toBeUndefined();
  });

  it("原生容器显示「更换保存位置」，title 里带当前目录名，点击触发 onChangeWorkspace", () => {
    const { by, p } = render({ nativeAvailable: true, workspaceLabel: "Download/AXV" });
    const b = by("更换保存位置")!;
    expect(String(b.props.title)).toContain("Download/AXV");
    (b.props.onClick as () => void)();
    expect(p.onChangeWorkspace).toHaveBeenCalledTimes(1);
  });

  it("原生容器未设置目录时 title 回落到「默认目录」", () => {
    const { by } = render({ nativeAvailable: true, workspaceLabel: "" });
    expect(String(by("更换保存位置")!.props.title)).toContain("默认目录");
  });
});

describe("Toolbar — 主要动作接线", () => {
  it("保存 / 打开 / 复制 / 导出预览图 / 运行 / 格式化 各自触发对应回调", () => {
    const { by, p } = render();
    for (const label of ["保存", "打开 XML 文件", "复制 XML", "导出预览图", "运行", "格式化"]) {
      const b = by(label);
      expect(b, label).toBeDefined();
      (b!.props.onClick as () => void)();
    }
    expect(p.onSave).toHaveBeenCalledTimes(1);
    expect(p.onOpenFile).toHaveBeenCalledTimes(1);
    expect(p.onCopyXml).toHaveBeenCalledTimes(1);
    expect(p.onExportImage).toHaveBeenCalledTimes(1);
    expect(p.onRun).toHaveBeenCalledTimes(1);
    expect(p.onFormat).toHaveBeenCalledTimes(1);
  });

  it("可撤销时点击撤销/重做触发回调", () => {
    const { by, p } = render({ canUndo: true, canRedo: true });
    (by("撤销")!.props.onClick as () => void)();
    (by("重做")!.props.onClick as () => void)();
    expect(p.onUndo).toHaveBeenCalledTimes(1);
    expect(p.onRedo).toHaveBeenCalledTimes(1);
  });

  it("桌面端工具栏避让两侧面板（left/right 320）", () => {
    const { tree } = render({ leftOpen: true, rightOpen: true });
    const style = tree.props.style as Record<string, unknown>;
    expect(style.left).toBe(320);
    expect(style.right).toBe(320);
  });

  it("只有一侧开着时只避让那一侧", () => {
    const a = render({ leftOpen: true, rightOpen: false });
    expect((a.tree.props.style as Record<string, unknown>).left).toBe(320);
    expect((a.tree.props.style as Record<string, unknown>).right).toBe(0);
  });

  it("移动端不设左右偏移（style 为 undefined）", () => {
    const { tree } = render({ isMobile: true });
    expect(tree.props.style).toBeUndefined();
  });

  it("设备与缩放菜单始终在工具栏里（props 原样透传）", () => {
    const { tree } = render({ deviceId: "pixel_7", scale: 1.2 });
    // ViewSettingsMenu 没有 aria-label，改为在 children 里按 props 特征找它
    const found: Array<Record<string, unknown>> = [];
    const walk = (n: ReactNode) => {
      if (Array.isArray(n)) return n.forEach((c) => walk(c as ReactNode));
      if (!isValidElement(n)) return;
      const el = n as unknown as El;
      const p = el.props as Record<string, unknown>;
      if ("onDevice" in p && "onScale" in p) found.push(p);
      walk(p.children as ReactNode);
    };
    walk(tree as unknown as ReactNode);
    expect(found).toHaveLength(1);
    expect(found[0].deviceId).toBe("pixel_7");
    expect(found[0].scale).toBe(1.2);
  });
});
