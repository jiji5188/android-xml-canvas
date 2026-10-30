// test/xml_m25g_left_rail.test.tsx — 左侧图标条 + 标题栏契约测试
// 做法同 m25c：直接调用函数组件，遍历元素树找 aria-label / data-rail-index，不依赖 jsdom。
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { LeftRail, type LeftRailProps, type LeftView } from "../components/LeftRail";

type El = { type: unknown; props: Record<string, unknown> };

const tr = (key: string, fallback: string) => fallback;

function props(over: Partial<LeftRailProps> = {}): LeftRailProps {
  return {
    tr,
    view: "parts",
    open: false,
    onPick: vi.fn(),
    onClose: vi.fn(),
    children: null,
    ...over,
  };
}

function collect(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) collect(n as ReactNode, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as unknown as El;
  out.push(el);
  collect(el.props?.children as ReactNode, out);
  return out;
}

function render(over: Partial<LeftRailProps> = {}) {
  const p = props(over);
  const tree = LeftRail(p) as unknown as El;
  const all = collect(tree as unknown as ReactNode);
  const rail = all.filter((e) => typeof e.props["data-rail-index"] === "number");
  const by = (label: string) => all.find((e) => e.props["aria-label"] === label);
  return { p, tree, all, rail, by };
}

describe("LeftRail — 图标条", () => {
  it("7 个入口：组件/图层/AI/已生成资源/项目管理/设置/关于", () => {
    const { rail } = render();
    const labels = rail.map((e) => String(e.props["aria-label"]));
    expect(labels).toEqual(["组件", "图层", "AI 助手", "已生成资源", "项目管理", "设置", "关于"]);
  });

  it("只有当前视图高亮（on + aria-pressed + data-fill）", () => {
    const { rail } = render({ view: "layers" });
    const on = rail.filter((e) => e.props["aria-pressed"] === true);
    expect(on).toHaveLength(1);
    expect(on[0].props["aria-label"]).toBe("图层");
    expect(String(on[0].props.className)).toContain(" on");
    const icon = collect(on[0].props.children as ReactNode).find((e) =>
      String(e.props.className).includes("msr"),
    );
    expect(icon?.props["data-fill"]).toBe("1");
  });

  it("点击图标回调 onPick(视图)", () => {
    const { rail, p } = render();
    const onClick = rail[2].props.onClick as () => void;
    onClick();
    expect(p.onPick).toHaveBeenCalledWith("ai");
  });

  it("code 视图也能定位标题（不崩）", () => {
    const { all } = render({ view: "code" });
    const title = all.find((e) => String(e.props.className) === "axv-rail-title");
    expect(title?.props.children).toBe("XML 代码");
  });
});

describe("LeftRail — 容器与标题栏", () => {
  it("open 时 aside 带 axv-open", () => {
    expect(String(render({ open: true }).tree.props.className)).toContain("axv-open");
    expect(String(render({ open: false }).tree.props.className)).not.toContain("axv-open");
  });

  it("标题跟随视图", () => {
    const title = (v: LeftView) =>
      render({ view: v }).all.find((e) => String(e.props.className) === "axv-rail-title")?.props
        .children;
    expect(title("parts")).toBe("组件");
    expect(title("res")).toBe("项目管理");
    expect(title("about")).toBe("关于");
  });

  it("关闭按钮触发 onClose", () => {
    const { by, p } = render();
    (by("关闭面板")?.props.onClick as () => void)();
    expect(p.onClose).toHaveBeenCalled();
  });

  it("children 原样渲染进 rail-body", () => {
    const { all } = render({ children: <div data-testid="x" /> });
    expect(all.some((e) => e.props["data-testid"] === "x")).toBe(true);
  });
});
