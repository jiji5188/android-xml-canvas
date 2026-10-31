// @vitest-environment jsdom
// M46b：移动模式 + 复制/粘贴（含同名冲突引导改名）
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { LazyTreeInner } from "@/components/ProjectPanel";
import { moveEntry, copyEntry, type FileOpsCtx } from "@/lib/xml/file-ops";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};

/* ---- 原生桥 mock ---- */
type Call = { op: string; a: string; b: string };
let calls: Call[] = [];

function installBridge(itemsByPath: Record<string, string[]> = {}) {
  calls = [];
  const b = {
    saveFile: () => "ok:1",
    getWorkspace: () => "本地",
    pickWorkspace: () => {},
    listDir: (p: string) => {
      const names = itemsByPath[p] || [];
      return JSON.stringify({ ok: true, items: names.map((n) => ({ name: n, kind: "file" })) });
    },
    createEntry: (p: string, isDir: boolean) => {
      calls.push({ op: isDir ? "mkdir" : "create", a: p, b: "" });
      return JSON.stringify({ ok: true });
    },
    renameEntry: (f: string, t: string) => {
      calls.push({ op: "rename", a: f, b: t });
      return JSON.stringify({ ok: true });
    },
    copyEntry: (f: string, t: string) => {
      calls.push({ op: "copy", a: f, b: t });
      return JSON.stringify({ ok: true });
    },
    deleteEntry: (p: string) => {
      calls.push({ op: "delete", a: p, b: "" });
      return JSON.stringify({ ok: true });
    },
  };
  (globalThis as unknown as { window: { AxvNative: unknown } }).window.AxvNative = b;
}

const tree: Record<string, BrowseEntry[]> = {
  "": [
    { kind: "dir", name: "res", rel: "res" },
    { kind: "file", name: "a.xml", rel: "a.xml" },
  ],
  res: [
    { kind: "dir", name: "layout", rel: "res/layout" },
    { kind: "dir", name: "drawable", rel: "res/drawable" },
  ],
  "res/layout": [{ kind: "file", name: "a.xml", rel: "res/layout/a.xml" }],
  "res/drawable": [],
};

function fakeSource(): ProjectSource {
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

function mount(ctx: FileOpsCtx | null) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <LazyTreeInner
      source={fakeSource()}
      rev={0}
      currentFileName=""
      onOpenEntry={() => {}}
      extras={null}
      onOpenDrawable={() => {}}
      onPreviewImage={() => {}}
      fileOps={ctx}
    />,
  );
  return { host, root };
}

async function longPress(row: Element) {
  const r = row.getBoundingClientRect();
  const ev = new MouseEvent("pointerdown", {
    bubbles: true,
    clientX: (r.left || 0) + 20,
    clientY: (r.top || 0) + 10,
    button: 0,
  });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  row.dispatchEvent(ev);
  await new Promise((z) => setTimeout(z, 520));
  await flush();
}

const itemByName = (label: string) =>
  [...document.querySelectorAll(".axv-tfm-item")].find(
    (b) => b.querySelector(".axv-tfm-label")!.textContent === label,
  ) as HTMLButtonElement;

beforeEach(() => {
  installBridge({});
  document.body.innerHTML = "";
});

describe("M46b file-ops：移动/复制支持换名落地", () => {
  const ctx: FileOpsCtx = { backend: "native", root: "/s/proj" };

  it("moveEntry 带 asName → 目标路径用新名", async () => {
    installBridge();
    const r = await moveEntry(ctx, "a.xml", "res/layout", "b.xml");
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual({ op: "rename", a: "/s/proj/a.xml", b: "/s/proj/res/layout/b.xml" });
  });

  it("copyEntry 带 asName → 复制到新名", async () => {
    installBridge();
    const r = await copyEntry(ctx, "res/layout/a.xml", "res/drawable", "c.xml");
    expect(r.ok).toBe(true);
    expect(calls[0]).toEqual({
      op: "copy",
      a: "/s/proj/res/layout/a.xml",
      b: "/s/proj/res/drawable/c.xml",
    });
  });

  it("asName 含 / 直接拒绝", async () => {
    installBridge();
    expect((await copyEntry(ctx, "a.xml", "res", "x/y.xml")).ok).toBe(false);
    expect(calls.length).toBe(0);
  });
});

describe("M46b UI：移动模式", () => {
  it("点「移动」→ 出确定/取消 + 每行拖拽图标", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    await longPress(host.querySelectorAll(".axv-ws-row")[1]);
    itemByName("移动").click();
    await flush();

    expect(document.querySelector(".axv-move-bar")).not.toBeNull();
    const btns = [...document.querySelectorAll(".axv-move-bar .axv-btn")] as HTMLButtonElement[];
    expect(btns.map((b) => b.textContent)).toEqual(["确定", "取消"]);
    // 未选目标 → 确定置灰
    expect(btns[0].disabled).toBe(true);
    // 每行一个拖拽图标
    expect(document.querySelectorAll(".axv-move-handle").length).toBe(
      document.querySelectorAll(".axv-ws-row").length,
    );

    // 取消 → 工具条与图标消失
    btns[1].click();
    await flush();
    expect(document.querySelector(".axv-move-bar")).toBeNull();
    expect(document.querySelectorAll(".axv-move-handle").length).toBe(0);
    root.unmount();
  });

  it("拖拽落到目录 → 确定后调用 renameEntry 移到该目录", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    const rows = host.querySelectorAll(".axv-ws-row");
    await longPress(rows[1]); // a.xml
    itemByName("移动").click();
    await flush();

    // 拖 a.xml 的手柄，落到 res 目录行
    const handle = host.querySelectorAll(".axv-move-handle")[1] as HTMLElement;
    const resRow = host.querySelector('[data-treerel="res"]') as HTMLElement;
    // 让 elementFromPoint 返回 res 行（jsdom 无布局）
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element }).elementFromPoint =
      () => resRow;

    handle.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, pointerId: 7 } as MouseEventInit),
    );
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 30, clientY: 60 }));
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 30, clientY: 60 }));
    await flush();

    const ok = [...document.querySelectorAll(".axv-move-bar .axv-btn")][0] as HTMLButtonElement;
    expect(ok.disabled).toBe(false);
    ok.click();
    await flush();

    expect(calls.some((c) => c.op === "rename" && c.b === "/s/proj/res/a.xml")).toBe(true);
    expect(document.querySelector(".axv-move-bar")).toBeNull();
    root.unmount();
  });
});

describe("M46b UI：复制 / 粘贴", () => {
  it("复制后提示；粘贴到无冲突目录 → 直接 copyEntry", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    await longPress(host.querySelectorAll(".axv-ws-row")[1]); // a.xml
    itemByName("复制").click();
    await flush();
    expect(document.body.textContent).toContain("已复制");

    // 关掉提示
    (document.querySelector(".axv-dlg .axv-btn") as HTMLButtonElement).click();
    await flush();

    // 长按 res → 粘贴（res 里没有 a.xml）
    installBridge({ "/s/proj/res": ["layout", "drawable"] });
    await longPress(host.querySelector('[data-treerel="res"]')!);
    itemByName("粘贴").click();
    await flush();

    expect(calls.some((c) => c.op === "copy" && c.b === "/s/proj/res/a.xml")).toBe(true);
    root.unmount();
  });

  it("目标已同名 → 弹冲突框，改名后按新名粘贴", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    await longPress(host.querySelectorAll(".axv-ws-row")[1]);
    itemByName("复制").click();
    await flush();
    (document.querySelector(".axv-dlg .axv-btn") as HTMLButtonElement).click();
    await flush();

    installBridge({ "/s/proj/res": ["a.xml"] }); // 目标已有同名
    await longPress(host.querySelector('[data-treerel="res"]')!);
    itemByName("粘贴").click();
    await flush();

    const dlg = document.querySelector(".axv-dlg")!;
    expect(dlg.textContent).toContain("同名冲突");
    const input = dlg.querySelector(".axv-dlg-input") as HTMLInputElement;
    expect(input.value).toBe("a(1).xml"); // 预填不冲突的名字
    // React 受控组件：必须走原型上的 value setter 才能被 onChange 收到
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "a_copy.xml");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    (dlg.querySelectorAll(".axv-dlg-actions .axv-btn")[1] as HTMLButtonElement).click();
    await flush();

    expect(calls.some((c) => c.op === "copy" && c.b === "/s/proj/res/a_copy.xml")).toBe(true);
    root.unmount();
  });

  it("没有复制标记时「粘贴」置灰", async () => {
    const { host, root } = mount({ backend: "native", root: "/s/proj" });
    await flush();
    await longPress(host.querySelectorAll(".axv-ws-row")[0]);
    expect(itemByName("粘贴").disabled).toBe(true);
    root.unmount();
  });
});
