// @vitest-environment jsdom
// M46：结构树长按菜单 / 新建 / 重命名 / 删除 的 UI 级验证
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { LazyTreeInner } from "@/components/ProjectPanel";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";
import type { FileOpsCtx } from "@/lib/xml/file-ops";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};

function fakeSource(tree: Record<string, BrowseEntry[]>): ProjectSource {
  return {
    name: "proj",
    async listChildren(rel: string) {
      return tree[rel] ?? [];
    },
    async readText() {
      return null;
    },
  };
}

const tree: Record<string, BrowseEntry[]> = {
  "": [
    { kind: "dir", name: "res", rel: "res" },
    { kind: "file", name: "activity_main.xml", rel: "activity_main.xml" },
  ],
  res: [{ kind: "dir", name: "layout", rel: "res/layout" }],
  "res/layout": [{ kind: "file", name: "detail.xml", rel: "res/layout/detail.xml" }],
};

function mount(fileOps: FileOpsCtx | null) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <LazyTreeInner
      source={fakeSource(tree)}
      rev={0}
      currentFileName=""
      onOpenEntry={() => {}}
      extras={null}
      onOpenDrawable={() => {}}
      onPreviewImage={() => {}}
      fileOps={fileOps}
    />,
  );
  return { host, root };
}

async function longPress(row: Element) {
  const r = row.getBoundingClientRect();
  // jsdom 无 PointerEvent：用 MouseEvent 冒充，手补 pointerType
  const ev = new MouseEvent("pointerdown", {
    bubbles: true,
    clientX: (r.left || 0) + 20,
    clientY: (r.top || 0) + 10,
    button: 0,
  });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  Object.defineProperty(ev, "isPrimary", { value: true });
  row.dispatchEvent(ev);
  await new Promise((z) => setTimeout(z, 520));
  await flush();
}

describe("M46 结构树长按菜单", () => {
  it("没有 fileOps 时长按不弹菜单", async () => {
    const { host, root } = mount(null);
    await flush();
    const row = host.querySelector(".axv-ws-row")!;
    await longPress(row);
    expect(document.querySelector(".axv-tfm")).toBeNull();
    root.unmount();
  });

  it("有 fileOps 时长按弹出菜单（6 项）", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    const row = host.querySelector(".axv-ws-row")!;
    await longPress(row);
    const menu = document.querySelector(".axv-tfm");
    expect(menu).not.toBeNull();
    const items = [...menu!.querySelectorAll(".axv-tfm-item")].map((b) => b.querySelector(".axv-tfm-label")!.textContent);
    expect(items).toEqual(["新建", "重命名", "移动", "复制", "粘贴", "删除"]);
    root.unmount();
  });

  it("web 后端：重命名/删除置灰，新建可点", async () => {
    const { host, root } = mount({ backend: "web", root: {} });
    await flush();
    await longPress(host.querySelector(".axv-ws-row")!);
    const items = [...document.querySelectorAll(".axv-tfm-item")] as HTMLButtonElement[];
    const byLabel = (t: string) => items.find((b) => b.querySelector(".axv-tfm-label")!.textContent === t)!;
    expect(byLabel("新建").disabled).toBe(false);
    expect(byLabel("重命名").disabled).toBe(true);
    expect(byLabel("删除").disabled).toBe(true);
    root.unmount();
  });

  it("点「新建」→ 弹新建对话框，含文件夹复选框", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    await longPress(host.querySelectorAll(".axv-ws-row")[1]); // 文件行
    const btn = [...document.querySelectorAll(".axv-tfm-item")][0] as HTMLButtonElement;
    btn.click();
    await flush();
    const dlg = document.querySelector(".axv-dlg");
    expect(dlg).not.toBeNull();
    expect(dlg!.querySelector(".axv-dlg-title")!.textContent).toBe("新建");
    expect(dlg!.querySelector('input[type="checkbox"]')).not.toBeNull();
    root.unmount();
  });

  it("点「删除」→ 弹确认框（含不可撤销提示）", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    await longPress(host.querySelectorAll(".axv-ws-row")[0]);
    const del = [...document.querySelectorAll(".axv-tfm-item")].find(
      (b) => b.querySelector(".axv-tfm-label")!.textContent === "删除",
    ) as HTMLButtonElement;
    del.click();
    await flush();
    const dlg = document.querySelector(".axv-dlg")!;
    expect(dlg.querySelector(".axv-dlg-title")!.textContent).toBe("删除");
    expect(dlg.textContent).toContain("不可撤销");
    root.unmount();
  });

  it("长按目录节点 → 新建对话框出现「目录内」单选项", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    await longPress(host.querySelectorAll(".axv-ws-row")[0]); // res 目录
    ([...document.querySelectorAll(".axv-tfm-item")][0] as HTMLButtonElement).click();
    await flush();
    const dlg = document.querySelector(".axv-dlg")!;
    const radios = dlg.querySelectorAll('input[type="radio"]');
    expect(radios.length).toBe(2);
    expect(dlg.textContent).toContain("同层");
    root.unmount();
  });
});
