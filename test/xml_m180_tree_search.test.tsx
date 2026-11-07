// @vitest-environment jsdom
// M180：项目树搜索 + res 同类限定符目录折叠 + 图标文件「填入选中控件」
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { LazyTreeInner } from "@/components/ProjectPanel";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";

const flush = async () => {
  for (let i = 0; i < 14; i++) await new Promise((r) => setTimeout(r, 10));
};

/** React 受控 input：必须走原生 setter，否则 value tracker 会把 input 事件吃掉 */
const typeInto = (el: HTMLInputElement, v: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const RES = "app/src/main/res";
const tree: Record<string, BrowseEntry[]> = {
  "": [{ kind: "dir", name: "app", rel: "app" }],
  app: [{ kind: "dir", name: "src", rel: "app/src" }],
  "app/src": [{ kind: "dir", name: "main", rel: "app/src/main" }],
  "app/src/main": [{ kind: "dir", name: "res", rel: RES }],
  [RES]: [
    { kind: "dir", name: "drawable-mdpi", rel: `${RES}/drawable-mdpi` },
    { kind: "dir", name: "drawable-night", rel: `${RES}/drawable-night` },
    { kind: "dir", name: "layout", rel: `${RES}/layout` },
    { kind: "dir", name: "values", rel: `${RES}/values` },
  ],
  [`${RES}/drawable-mdpi`]: [{ kind: "file", name: "ic_star.xml", rel: `${RES}/drawable-mdpi/ic_star.xml` }],
  [`${RES}/drawable-night`]: [{ kind: "file", name: "ic_moon.xml", rel: `${RES}/drawable-night/ic_moon.xml` }],
  [`${RES}/layout`]: [{ kind: "file", name: "activity_main.xml", rel: `${RES}/layout/activity_main.xml` }],
  [`${RES}/values`]: [{ kind: "file", name: "strings.xml", rel: `${RES}/values/strings.xml` }],
};

const texts: Record<string, string> = {
  [`${RES}/drawable-mdpi/ic_star.xml`]: "<vector/>",
};

function fakeSource(): ProjectSource {
  return {
    name: "proj",
    async listChildren(rel: string) {
      return tree[rel] ?? [];
    },
    async readText(rel: string) {
      return texts[rel] ?? null;
    },
  };
}

const mounted: ReturnType<typeof createRoot>[] = [];

function mount(
  opts: {
    onOpen?: (e: BrowseEntry) => void;
    onFillIconAttr?: (attr: string, name: string, xml: string) => void;
    onRenameResource?: (rel: string, name: string) => Promise<{ ok: boolean; msg: string }>;
  } = {},
) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push(root);
  root.render(
    <LazyTreeInner
      source={fakeSource()}
      rev={0}
      currentFileName=""
      currentRel={null}
      storeKey="m180"
      onOpenEntry={opts.onOpen ?? (() => {})}
      extras={null}
      onOpenDrawable={() => {}}
      onPreviewImage={() => {}}
      onFillIconAttr={opts.onFillIconAttr}
      onRenameResource={opts.onRenameResource}
    />,
  );
  return { host, root };
}

const rowOf = (rel: string) => document.querySelector(`li[data-treerel="${rel}"]`) as HTMLElement | null;
const click = (el: Element | null) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

beforeEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("M180 搜索", () => {
  it("输入关键词 → 扫全项目并只列命中文件；点一条能打开", async () => {
    const opened: string[] = [];
    mount({ onOpen: (e) => opened.push(e.rel) });
    await flush();
    const input = document.querySelector(".axv-proj-filter-input") as HTMLInputElement;
    expect(input).not.toBeNull();
    typeInto(input, "ic_");
    await flush();
    await flush();

    const names = [...document.querySelectorAll(".axv-proj-tree > li[data-treerel] .axv-ws-item-name")].map((n) => n.textContent);
    expect(names).toEqual(expect.arrayContaining(["ic_star.xml", "ic_moon.xml"]));
    expect(names).not.toContain("activity_main.xml");

    const hit = document.querySelector(`li[data-treerel="${RES}/drawable-night/ic_moon.xml"]`);
    click(hit!.querySelector(".axv-ws-item"));
    await flush();
    expect(opened).toEqual([`${RES}/drawable-night/ic_moon.xml`]);
  });

  it("搜不到时给提示", async () => {
    mount();
    await flush();
    const input = document.querySelector(".axv-proj-filter-input") as HTMLInputElement;
    typeInto(input, "zzzz");
    await flush();
    await flush();
    expect(document.body.textContent).toContain("没找到匹配");
  });
});

describe("M180 res 目录按类型折叠", () => {
  it("drawable-mdpi + drawable-night 折成一行 drawable/ (2)，点开才看到真实目录", async () => {
    mount();
    await flush();
    // 逐层展开到 res，再展开 res
    for (const rel of ["app", "app/src", "app/src/main", RES]) {
      click(rowOf(rel));
      await flush();
    }
    await flush();

    // 折叠行：没有真实 rel，靠文本判断
    const groupRow = [...document.querySelectorAll(".axv-proj-tree .axv-ws-row")].find(
      (r) => (r.querySelector(".axv-ws-item-name")?.textContent || "").startsWith("drawable/"),
    );
    expect(groupRow).toBeTruthy();
    expect(groupRow!.textContent).toContain("(2)");
    // 真实限定符目录还没出现
    expect(rowOf(`${RES}/drawable-mdpi`)).toBeNull();

    click(groupRow!.querySelector(".axv-ws-item"));
    await flush();

    expect(rowOf(`${RES}/drawable-mdpi`)).not.toBeNull();
    expect(rowOf(`${RES}/drawable-night`)).not.toBeNull();
  });

  it("单目录（layout/values）不折叠", async () => {
    mount();
    await flush();
    for (const rel of ["app", "app/src", "app/src/main", RES]) {
      click(rowOf(rel));
      await flush();
    }
    await flush();
    expect(rowOf(`${RES}/layout`)).not.toBeNull();
    expect(rowOf(`${RES}/values`)).not.toBeNull();
  });
});

describe("M180 填入选中控件", () => {
  it("drawable 文件长按菜单里有「填入选中控件」，点击后回调带 xml 正文", async () => {
    const filled: Array<[string, string, string]> = [];
    mount({ onFillIconAttr: (a, n, x) => filled.push([a, n, x]) });
    await flush();
    for (const rel of ["app", "app/src", "app/src/main", RES]) {
      click(rowOf(rel));
      await flush();
    }
    await flush();
    // 展开折叠组
    const groupRow = [...document.querySelectorAll(".axv-proj-tree .axv-ws-row")].find(
      (r) => (r.querySelector(".axv-ws-item-name")?.textContent || "").startsWith("drawable/"),
    );
    click(groupRow!.querySelector(".axv-ws-item"));
    await flush();
    click(rowOf(`${RES}/drawable-mdpi`));
    await flush();

    const fileRow = rowOf(`${RES}/drawable-mdpi/ic_star.xml`);
    expect(fileRow).not.toBeNull();
    // 右键直接弹菜单（jsdom 下 contextmenu 走同一条路）
    fileRow!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    await flush();
    const menu = document.querySelector(".axv-tfm");
    expect(menu).not.toBeNull();
    const fillBtn = [...menu!.querySelectorAll(".axv-tfm-item")].find((b) =>
      (b.textContent || "").includes("填入选中控件"),
    );
    expect(fillBtn).toBeTruthy();
    click(fillBtn!);
    await flush();
    await flush();
    expect(filled.length).toBe(1);
    expect(filled[0][0]).toBe("src");
    expect(filled[0][1]).toBe("ic_star");
    expect(filled[0][2]).toContain("<vector");
  });
});
