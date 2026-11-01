// @vitest-environment jsdom
// test/xml_m25d_project_panel.test.tsx — 项目管理面板（M25d 扁平列表 + 点开即打开）
// M62 起面板里有了筛选输入框（带 hooks），所以改成真渲染（jsdom + createRoot），
// 不再直接调组件函数拿元素树。
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
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

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function mount(p: ProjectPanelProps): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ProjectPanel {...p} />);
  await flush();
  await flush();
  return host;
}

/** 让 React 把状态更新刷到 DOM（jsdom 下用 microtask + timer 双保险） */
async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

/** React 受控 input：必须用原型 value setter 才能触发 onChange */
async function typeInto(input: HTMLInputElement, v: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, v);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await flush();
}

afterEach(() => {
  if (root) root.unmount();
  if (host) host.remove();
  root = null;
  host = null;
});

const cards = (el: HTMLElement): HTMLElement[] =>
  Array.from(el.querySelectorAll<HTMLElement>(".axv-proj-card-btn"));

describe("项目列表（扁平卡片）", () => {
  it("一个项目一张卡片，不再有可展开的箭头", async () => {
    const el = await mount(props());
    expect(cards(el)).toHaveLength(2);
    expect(el.querySelectorAll(".axv-ws-caret")).toHaveLength(0);
  });

  it("卡片优先显示分析出来的 app_name", async () => {
    const meta: Record<string, ProjectMeta> = {
      ShopApp: { name: "商城客户端", iconUrl: undefined, lib: "androidx" },
      TodoApp: { name: "待办清单", iconUrl: undefined, lib: "support" },
    };
    const el = await mount(props({ metaOf: (it) => meta[it.rel] }));
    const names = Array.from(el.querySelectorAll(".axv-ws-item-name")).map((n) => n.textContent);
    expect(names).toContain("商城客户端");
    expect(names).toContain("待办清单");
  });

  it("没分析结果时回落到目录名", async () => {
    const el = await mount(props());
    const names = Array.from(el.querySelectorAll(".axv-ws-item-name")).map((n) => n.textContent);
    expect(names).toEqual(["ShopApp", "TodoApp"]);
  });

  it("点卡片 = 打开该项目", async () => {
    const onOpenProject = vi.fn();
    const p = props({ onOpenProject });
    const el = await mount(p);
    cards(el)[0].click();
    expect(onOpenProject).toHaveBeenCalledWith(p.projects[0]);
  });

  /* M62：筛选框 */
  it("筛选框按名字过滤卡片，清除后恢复", async () => {
    const el = await mount(props({ projects: [dir("ShopApp"), dir("TodoApp"), dir("WeatherApp")] }));
    const input = el.querySelector<HTMLInputElement>(".axv-proj-filter-input");
    expect(input).not.toBeNull();
    expect(cards(el)).toHaveLength(3);

    await typeInto(input!, "app");
    expect(cards(el)).toHaveLength(3); // 三个都含 App

    await typeInto(input!, "todo");
    const left = cards(el);
    expect(left).toHaveLength(1);
    expect(left[0].textContent).toContain("TodoApp");

    // 清除按钮 → 全部回来
    el.querySelector<HTMLButtonElement>(".axv-proj-filter-clear")!.click();
    await flush();
    expect(cards(el)).toHaveLength(3);
  });

  it("筛选无结果时给提示", async () => {
    const el = await mount(props());
    const input = el.querySelector<HTMLInputElement>(".axv-proj-filter-input")!;
    await typeInto(input, "zzz");
    expect(cards(el)).toHaveLength(0);
    expect(el.textContent).toContain("没找到匹配");
  });
});

describe("当前项目 tab", () => {
  it("没有目录源时回落到应用内多文件列表", async () => {
    const el = await mount(props({ tab: "current" }));
    expect(el.textContent).toContain("activity_main.xml");
    const head = el.querySelector(".axv-proj-now-name");
    expect(head?.textContent).toBe("ShopApp");
  });
});
