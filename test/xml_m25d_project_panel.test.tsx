// test/xml_m25d_project_panel.test.tsx — 项目管理面板（M25d 扁平列表 + 点开即打开）
// 同 m25c：不走 jsdom/RTL，直接调组件函数拿元素树遍历（本项目 React 19 act 探测会失败）。
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import { ProjectPanel, type ProjectPanelProps } from "../components/ProjectPanel";
import type { WsProject } from "@/lib/xml/workspace";
import type { ProjectMeta } from "@/lib/xml/project-browse";
import { createProject } from "@/lib/xml/multi-file";

const dir = (rel: string): WsProject => ({ name: rel, kind: "dir", rel, layoutCount: 0 });

function props(over: Partial<ProjectPanelProps> = {}): ProjectPanelProps {
  return {
    tr: (_k, f) => f,
    tab: "projects",
    onTab: vi.fn(),
    wsState: { mode: "web", label: "Demo", custom: true, permission: "granted" } as never,
    wsBusy: false,
    wsMsg: "",
    projects: [dir("ShopApp"), dir("TodoApp")],
    metaOf: () => undefined,
    onOpenProject: vi.fn(),
    onRefresh: vi.fn(),
    onOpenDir: vi.fn(),
    onRequestAllFiles: vi.fn(),
    projectName: "ShopApp",
    projectSource: null,
    projectRev: 0,
    currentFileName: "activity_main.xml",
    onOpenEntry: vi.fn(),
    onRefreshProject: vi.fn(),
    onNewProject: vi.fn(),
    appProject: createProject("Demo", { name: "activity_main.xml", xml: "<a/>" }),
    onSelectFile: vi.fn(),
    resExtras: null,
    onOpenDrawable: vi.fn(),
    onPreviewImage: vi.fn(),
    ...over,
  };
}

type El = { type: unknown; props: Record<string, unknown> };

function collect(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) collect(n as ReactNode, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as unknown as El;
  out.push(el);
  const kids = (el.props as { children?: ReactNode }).children;
  if (kids !== undefined) collect(kids, out);
  return out;
}

const cls = (el: El): string => String((el.props as { className?: string }).className ?? "");
const text = (el: El): string => {
  const kids = (el.props as { children?: ReactNode }).children;
  const flat = (n: ReactNode): string => {
    if (n === null || n === undefined || typeof n === "boolean") return "";
    if (typeof n === "string" || typeof n === "number") return String(n);
    if (Array.isArray(n)) return n.map(flat).join("");
    if (isValidElement(n)) return flat((n.props as { children?: ReactNode }).children);
    return "";
  };
  return flat(kids);
};

describe("项目列表（扁平卡片）", () => {
  it("一个项目一张卡片，不再有可展开的箭头", () => {
    const els = collect(ProjectPanel(props()));
    const cards = els.filter((e) => cls(e).includes("axv-proj-card-btn"));
    expect(cards).toHaveLength(2);
    // 列表区不该出现折叠箭头按钮
    const carets = els.filter((e) => e.type === "button" && cls(e).includes("axv-ws-caret"));
    expect(carets).toHaveLength(0);
  });

  it("卡片优先显示分析出来的 app_name", () => {
    const meta: Record<string, ProjectMeta> = {
      ShopApp: { name: "商城客户端", iconUrl: "blob:x" },
      TodoApp: { name: "待办清单" },
    };
    const els = collect(ProjectPanel(props({ metaOf: (p) => meta[p.rel] })));
    const names = els.filter((e) => cls(e).includes("axv-ws-item-name")).map(text);
    expect(names).toContain("商城客户端");
    expect(names).toContain("待办清单");
    // 有 iconUrl 的渲染 img
    const imgs = els.filter((e) => e.type === "img");
    expect(imgs).toHaveLength(1);
  });

  it("没分析结果时回落到目录名", () => {
    const els = collect(ProjectPanel(props()));
    const names = els.filter((e) => cls(e).includes("axv-ws-item-name")).map(text);
    expect(names).toEqual(["ShopApp", "TodoApp"]);
  });

  it("点卡片 = 打开该项目", () => {
    const onOpenProject = vi.fn();
    const p = props({ onOpenProject });
    const els = collect(ProjectPanel(p));
    const card = els.find((e) => cls(e).includes("axv-proj-card-btn")) as El;
    (card.props as { onClick: () => void }).onClick();
    expect(onOpenProject).toHaveBeenCalledWith(p.projects[0]);
  });
});

describe("当前项目 tab", () => {
  it("没有目录源时回落到应用内多文件列表", () => {
    const els = collect(ProjectPanel(props({ tab: "current" })));
    const names = els.filter((e) => cls(e).includes("axv-ws-item-name")).map(text);
    expect(names.join("|")).toContain("activity_main.xml");
    // 项目名显示在头部
    const head = els.filter((e) => cls(e).includes("axv-proj-now-name")).map(text);
    expect(head).toEqual(["ShopApp"]);
  });
});
