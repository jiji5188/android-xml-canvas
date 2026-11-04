// M121：schema 属性行 + 树行（组件级）
// @vitest-environment jsdom
import { describe, expect, it, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import { AttrRows } from "@/components/drawable/AttrRows";
import { TreeRows } from "@/components/drawable/TreeRows";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    root.unmount();
    await flush();
  }
  host?.remove();
  root = null;
  host = null;
});

async function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(el);
  await flush();
  return host;
}

const byText = (h: HTMLElement, text: string) =>
  Array.from(h.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === text);

const shape = (color: string): DrawableNode => ({ t: "shape", spec: { kind: "rectangle", solid: color } });

/** React 受控输入：直接赋 value 不会走 onChange，必须走原型上的原生 setter */
function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("M121 AttrRows：按 schema 渲染并写回", () => {
  it("形状类型用分段按钮，点了写回 spec.kind", async () => {
    let cur: DrawableNode = shape("#FF112233");
    const h = await mount(
      <AttrRows
        node={cur}
        onChange={(n) => {
          cur = n;
        }}
      />,
    );
    expect(byText(h, "矩形")).toBeTruthy();
    byText(h, "椭圆")!.click();
    await flush();
    expect(cur.t).toBe("shape");
    if (cur.t === "shape") expect(cur.spec.kind).toBe("oval");
  });

  it("颜色文本输入直接改节点颜色", async () => {
    let cur: DrawableNode = { t: "ripple", color: "#33FFFFFF", content: shape("#FF000000") };
    const h = await mount(
      <AttrRows
        node={cur}
        onChange={(n) => {
          cur = n;
        }}
      />,
    );
    const input = h.querySelector<HTMLInputElement>(".axv-attr-color .axv-attr-input")!;
    expect(input.value).toBe("#33FFFFFF");
    typeInto(input, "#4400FF00");
    await flush();
    if (cur.t === "ripple") expect(cur.color).toBe("#4400FF00");
  });

  it("dp 属性输入数字自动补 dp，清空表示去掉", async () => {
    let cur: DrawableNode = { t: "inset", left: 8, top: 0, right: 0, bottom: 0, node: shape("#FF000000") };
    const h = await mount(
      <AttrRows
        node={cur}
        onChange={(n) => {
          cur = n;
        }}
      />,
    );
    const nums = Array.from(h.querySelectorAll<HTMLInputElement>(".axv-attr-num .axv-attr-input"));
    expect(nums.length).toBe(4);
    expect(nums[0].value).toBe("8"); // 显示时剥掉单位
    typeInto(nums[1], "12");
    await flush();
    if (cur.t === "inset") expect(cur.top).toBe(12);
  });

  it("没有可编辑属性的节点给出提示，不硬塞假控件", async () => {
    const h = await mount(<AttrRows node={{ t: "layer", items: [] }} onChange={() => {}} />);
    expect(h.querySelector(".axv-shape-hint")?.textContent).toContain("没有可调参数");
    expect(h.querySelector("input")).toBeNull();
  });
});

describe("M121 TreeRows：面包屑 + 子节点 + 添加菜单", () => {
  const layer: DrawableNode = {
    t: "layer",
    items: [
      { key: "a", node: shape("#FF000001") },
      { key: "b", node: shape("#FF000002") },
    ],
  };

  it("层用「第 N 层」称呼，界面不出现 item", async () => {
    const h = await mount(
      <TreeRows root={layer} path={[]} onSelect={() => {}} onChange={() => {}} />,
    );
    const rows = Array.from(h.querySelectorAll(".axv-layer-row"));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain("第 1 层");
    expect(rows[1].textContent).toContain("第 2 层");
    expect(h.textContent).not.toContain("item");
  });

  it("点＋形状会新增一层，且仍停在当前层", async () => {
    let next: DrawableNode = layer;
    let picked: number[] = [];
    const h = await mount(
      <TreeRows
        root={layer}
        path={[]}
        onSelect={(p) => {
          picked = p;
        }}
        onChange={(n) => {
          next = n;
        }}
      />,
    );
    byText(h, "＋形状")!.click();
    await flush();
    expect(next.t).toBe("layer");
    if (next.t === "layer") expect(next.items.length).toBe(3);
    // 不自动钻进去：列表会变成新层的子节点，看起来像刚加的层消失了
    expect(picked).toEqual([]);
  });

  it("上移/删除操作落到树上", async () => {
    let next: DrawableNode = layer;
    const h = await mount(
      <TreeRows root={layer} path={[]} onSelect={() => {}} onChange={(n) => (next = n)} />,
    );
    const down = Array.from(h.querySelectorAll<HTMLButtonElement>(".axv-layer-op")).filter(
      (b) => b.textContent === "↑",
    );
    down[1].click();
    await flush();
    if (next.t === "layer") {
      expect((next.items[0].node as { spec: { solid: string } }).spec.solid).toBe("#FF000002");
    }

    const del = Array.from(h.querySelectorAll<HTMLButtonElement>(".axv-layer-op.is-danger"));
    del[0].click();
    await flush();
    if (next.t === "layer") expect(next.items.length).toBe(1);
  });

  it("面包屑显示当前位置，能点回根", async () => {
    let picked: number[] | null = null;
    const h = await mount(
      <TreeRows
        root={layer}
        path={[1]}
        onSelect={(p) => {
          picked = p;
        }}
        onChange={() => {}}
      />,
    );
    const crumbs = Array.from(h.querySelectorAll<HTMLButtonElement>(".axv-tree-crumb"));
    expect(crumbs[0].textContent).toBe("图层叠加");
    expect(crumbs[1].textContent).toContain("第 2 层");
    crumbs[0].click();
    await flush();
    expect(picked).toEqual([]);
  });

  it("ripple 满了之后藏掉添加区并给提示", async () => {
    const ripple: DrawableNode = {
      t: "ripple",
      content: shape("#FF000000"),
      mask: shape("#FFFFFFFF"),
    };
    const h = await mount(<TreeRows root={ripple} path={[]} onSelect={() => {}} onChange={() => {}} />);
    expect(h.querySelector(".axv-tree-add-list")).toBeNull();
    expect(h.textContent).toContain("放满了");
  });

  it("inset 的子节点叫「内容」且不能加第二个", async () => {
    const inset: DrawableNode = { t: "inset", left: 1, top: 1, right: 1, bottom: 1, node: shape("#FF000000") };
    const h = await mount(<TreeRows root={inset} path={[]} onSelect={() => {}} onChange={() => {}} />);
    expect(h.querySelector(".axv-layer-name")?.textContent).toBe("内容");
    expect(h.querySelector(".axv-tree-add-list")).toBeNull();
  });
});
