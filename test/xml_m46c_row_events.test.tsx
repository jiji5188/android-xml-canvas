// @vitest-environment jsdom
// M46c：① 浮层挂到 .axv-main 下 ② 点击/长按绑在 .axv-ws-row ③ 粘贴后清掉复制标记
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { LazyTreeInner } from "@/components/ProjectPanel";
import type { FileOpsCtx } from "@/lib/xml/file-ops";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};

type Call = { op: string; a: string; b: string };
let calls: Call[] = [];

function installBridge() {
  calls = [];
  const b = {
    saveFile: () => "ok:1",
    getWorkspace: () => "本地",
    pickWorkspace: () => {},
    listDir: (p: string) => {
      // 根层只有 res / a.xml；res 里空（粘贴 p.xml 不冲突）
      const names = p === "/s/proj" ? ["res", "a.xml"] : [];
      return JSON.stringify({ ok: true, items: names.map((n) => ({ name: n, kind: "file" })) });
    },
    createEntry: () => JSON.stringify({ ok: true }),
    renameEntry: (f: string, t: string) => {
      calls.push({ op: "rename", a: f, b: t });
      return JSON.stringify({ ok: true });
    },
    copyEntry: (f: string, t: string) => {
      calls.push({ op: "copy", a: f, b: t });
      return JSON.stringify({ ok: true });
    },
    deleteEntry: () => JSON.stringify({ ok: true }),
  };
  (globalThis as unknown as { window: { AxvNative: unknown } }).window.AxvNative = b;
}

const tree: Record<string, BrowseEntry[]> = {
  "": [
    { kind: "dir", name: "res", rel: "res" },
    { kind: "file", name: "a.xml", rel: "a.xml" },
  ],
  res: [{ kind: "file", name: "p.xml", rel: "res/p.xml" }],
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

const ctx: FileOpsCtx = { backend: "native", root: "/s/proj" };

const mounted: ReturnType<typeof createRoot>[] = [];

function mount(onOpenEntry: (e: BrowseEntry) => void = () => {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push(root);
  root.render(
    <LazyTreeInner
      source={fakeSource()}
      rev={0}
      currentFileName=""
      onOpenEntry={onOpenEntry}
      extras={null}
      onOpenDrawable={() => {}}
      onPreviewImage={() => {}}
      fileOps={ctx}
    />,
  );
  return { host, root };
}

async function longPress(row: Element) {
  const ev = new MouseEvent("pointerdown", { bubbles: true, clientX: 20, clientY: 30, button: 0 });
  Object.defineProperty(ev, "pointerType", { value: "mouse" });
  row.dispatchEvent(ev);
  await new Promise((z) => setTimeout(z, 520));
  await flush();
}

const itemByName = (label: string) =>
  [...document.querySelectorAll(".axv-tfm-item")].find(
    (b) => b.querySelector(".axv-tfm-label")!.textContent === label,
  ) as HTMLButtonElement;

const rows = () => [...document.querySelectorAll(".axv-ws-row")];

beforeEach(() => {
  // 先卸载上一个用例的树，否则清空 body 后 React 再往里插会抛 NOT_FOUND_ERR
  while (mounted.length) mounted.pop()!.unmount();
  installBridge();
  document.body.innerHTML = "";
});

describe("M46c 浮层挂载位置", () => {
  it("页面上有 .axv-main 时，菜单与弹窗都挂在它下面", async () => {
    const main = document.createElement("div");
    main.className = "axv-main";
    document.body.appendChild(main);

    const { host } = mount();
    await flush();
    await longPress(rows()[1]); // a.xml

    const menu = document.querySelector(".axv-tfm-mask");
    expect(menu).not.toBeNull();
    expect(menu!.parentElement).toBe(main);
    // 没留在树容器里
    expect(host.querySelector(".axv-tfm-mask")).toBeNull();

    // 弹窗同样挂过去
    itemByName("重命名").click();
    await flush();
    const dlg = document.querySelector(".axv-dlg");
    expect(dlg).not.toBeNull();
    expect(dlg!.closest(".axv-main")).toBe(main);
  });

  it("没有 .axv-main 时退回 body（不报错）", async () => {
    const { host } = mount();
    await flush();
    await longPress(rows()[1]);
    expect(document.querySelector(".axv-tfm-mask")!.parentElement).toBe(document.body);
    expect(host).toBeTruthy();
  });
});

describe("M46c 行级点击", () => {
  it("点 .axv-ws-row 空白处也能打开文件（不依赖内部按钮）", async () => {
    const opened: string[] = [];
    mount((e) => opened.push(e.rel));
    await flush();
    const row = rows()[1] as HTMLElement;
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(opened).toEqual(["a.xml"]);
  });

  it("点内部的 .axv-ws-item 按钮（冒泡到行）也只打开一次", async () => {
    const opened: string[] = [];
    const { host } = mount((e) => opened.push(e.rel));
    await flush();
    (host.querySelectorAll(".axv-ws-item")[1] as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true }),
    );
    await flush();
    expect(opened).toEqual(["a.xml"]);
  });

  it("长按弹菜单后松手，不会顺带把文件打开", async () => {
    const opened: string[] = [];
    mount((e) => opened.push(e.rel));
    await flush();
    const row = rows()[1] as HTMLElement;
    await longPress(row);
    // 手机 WebView 长按后会补发一次 click
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(opened).toEqual([]);
    // 只吞掉这一次，之后的点击恢复正常
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(opened).toEqual(["a.xml"]);
  });
});

describe("M46c 粘贴标记", () => {
  it("有复制标记才启用粘贴；粘贴完成后标记清除、菜单里粘贴重新置灰", async () => {
    mount();
    await flush();

    // 没复制过 → 粘贴置灰
    await longPress(rows()[0]); // res 目录
    expect(itemByName("粘贴").disabled).toBe(true);
    itemByName("复制").click(); // 复制 res
    await flush();
    // 「已复制」提示框关掉
    (document.querySelector(".axv-dlg .axv-dlg-actions .axv-btn") as HTMLButtonElement).click();
    await flush();

    // 再长按 → 粘贴可用
    await longPress(rows()[0]);
    expect(itemByName("粘贴").disabled).toBe(false);
    itemByName("粘贴").click();
    await flush();
    // 目录粘到自己里面 → 被拦住，不会调 copyEntry
    expect(calls.some((c) => c.op === "copy")).toBe(false);
    (document.querySelector(".axv-dlg .axv-dlg-actions .axv-btn") as HTMLButtonElement).click();
    await flush();

    // 换正常一下：复制 a.xml → 粘到 res 里
    await longPress(rows()[1]);
    itemByName("复制").click();
    await flush();
    (document.querySelector(".axv-dlg .axv-dlg-actions .axv-btn") as HTMLButtonElement).click();
    await flush();
    await longPress(rows()[0]);
    expect(itemByName("粘贴").disabled).toBe(false);
    itemByName("粘贴").click();
    await flush();
    expect(calls.some((c) => c.op === "copy" && c.b === "/s/proj/res/a.xml")).toBe(true);

    // 关掉「已粘贴」提示
    (document.querySelector(".axv-dlg .axv-dlg-actions .axv-btn") as HTMLButtonElement).click();
    await flush();

    // 标记已清 → 粘贴又变灰
    await longPress(rows()[0]);
    expect(itemByName("粘贴").disabled).toBe(true);
  });
});
