// M185：通用底部抽屉（Problems / 构建日志）组件级测试
// @vitest-environment jsdom
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ProblemsDrawer } from "../components/ProblemsDrawer";

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

const tr = (_k: string, fallback: string) => fallback;

async function click(h: HTMLElement, sel: string, idx = 0) {
  const nodes = h.querySelectorAll<HTMLElement>(sel);
  if (!nodes.length) throw new Error("not found: " + sel);
  nodes[idx].dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flush();
}

describe("M185 底部抽屉", () => {
  it("默认收起：不渲染 body；有问题时把手显示数量", async () => {
    const h = await mount(
      <ProblemsDrawer problems={[{ line: 3, msg: "x" }]} onGotoLine={() => {}} tr={tr} />,
    );
    expect(h.querySelector(".axv-drawer-body")).toBeNull();
    expect(h.querySelector(".axv-drawer-badge")?.textContent).toBe("1");
  });

  it("点把手展开、再点收起", async () => {
    const h = await mount(<ProblemsDrawer problems={[]} onGotoLine={() => {}} tr={tr} />);
    await click(h, ".axv-drawer-bar");
    expect(h.querySelector(".axv-drawer-body")).not.toBeNull();
    await click(h, ".axv-drawer-bar");
    expect(h.querySelector(".axv-drawer-body")).toBeNull();
  });

  it("无问题时展开显示空态，不渲染列表", async () => {
    const h = await mount(<ProblemsDrawer problems={[]} onGotoLine={() => {}} tr={tr} />);
    await click(h, ".axv-drawer-bar");
    expect(h.querySelector(".axv-drawer-empty")?.textContent).toContain("没有检测到问题");
    expect(h.querySelector(".axv-drawer-list")).toBeNull();
  });

  it("点问题行回调行号", async () => {
    const onGotoLine = vi.fn();
    const h = await mount(
      <ProblemsDrawer
        problems={[
          { line: 7, msg: "标签未闭合" },
          { line: 12, msg: "属性拼错" },
        ]}
        onGotoLine={onGotoLine}
        tr={tr}
      />,
    );
    await click(h, ".axv-drawer-bar");
    expect(h.querySelectorAll(".axv-drawer-item").length).toBe(2);
    await click(h, ".axv-drawer-item", 1);
    expect(onGotoLine).toHaveBeenCalledWith(12);
  });

  it("切到构建日志 tab：没有日志时显示空提示，不显示问题列表", async () => {
    const h = await mount(
      <ProblemsDrawer problems={[{ line: 1, msg: "a" }]} onGotoLine={() => {}} tr={tr} />,
    );
    await click(h, ".axv-drawer-bar");
    await click(h, ".axv-drawer-tab", 1);
    expect(h.querySelector(".axv-drawer-empty")).not.toBeNull();
    expect(h.querySelector(".axv-drawer-list")).toBeNull();
  });

  it("M188b：给了 buildLogs 就渲染日志卡片（新在前、失败有标记）", async () => {
    const h = await mount(
      <ProblemsDrawer
        problems={[]}
        onGotoLine={() => {}}
        tr={tr}
        buildLogs={[
          { id: "b", ok: false, stage: "真机渲染（link）", log: "boom", ms: 120 },
          { id: "a", ok: true, stage: "真机渲染", log: "fine", ms: 88 },
        ]}
      />,
    );
    await click(h, ".axv-drawer-bar");
    await click(h, ".axv-drawer-tab", 1);
    const cards = [...h.querySelectorAll(".axv-drawer-logcard")];
    expect(cards.length).toBe(2);
    expect(cards[0].className).toContain("axv-drawer-logcard-err");
    expect(cards[0].textContent).toContain("真机渲染（link）");
    expect(cards[0].textContent).toContain("120ms");
    expect(cards[1].textContent).toContain("88ms");
  });
});
