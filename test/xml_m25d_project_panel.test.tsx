// @vitest-environment jsdom
// test/xml_m25d_project_panel.test.tsx — 项目管理面板（M25d 扁平列表 + 点开即打开）
// M62 起面板里有了筛选输入框（带 hooks），所以改成真渲染（jsdom + createRoot），
// 不再直接调组件函数拿元素树。
import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ProjectPanel, type ProjectPanelProps } from "../components/ProjectPanel";
import type { WsProject } from "@/lib/xml/workspace";
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

afterEach(() => {
  if (root) root.unmount();
  if (host) host.remove();
  root = null;
  host = null;
});

/* M422：项目列表 tab 已删（左栏只留当前项目结构树，入口页 ProjectHome 承担了项目列表 + 长按菜单）。
   原 M25d「项目列表（扁平卡片）」6 个用例随之移除，只保留下面「当前项目 tab」回落用例。 */

describe("当前项目 tab", () => {
  it("没有目录源时回落到应用内多文件列表", async () => {
    const el = await mount(props({ tab: "current" }));
    expect(el.textContent).toContain("activity_main.xml");
    const head = el.querySelector(".axv-proj-now-name");
    expect(head?.textContent).toBe("ShopApp");
  });
});
