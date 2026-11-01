// @vitest-environment jsdom
// M63j：函数列表（.axv-outline-list）点击 → 把行号交给 onJump（XmlEditor 负责跳行 + 手机端收面板）
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { CodeOutline } from "@/components/CodeOutline";
import type { OutlineItem } from "@/lib/xml/java-outline";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
};

const items: OutlineItem[] = [
  { kind: "class", name: "MainActivity", line: 3, depth: 0 },
  { kind: "method", name: "onCreate", line: 12, depth: 1, sig: "(Bundle?)" },
  { kind: "method", name: "doSave", line: 40, depth: 1, sig: "()" },
];

async function mount(onJump: (line: number) => void) {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<CodeOutline items={items} currentLine={20} onJump={onJump} fileName="MainActivity.java" />);
  await flush();
  return root;
}

describe("M63j 函数列表点击跳行", () => {
  it("点方法 → onJump 拿到该方法的行号", async () => {
    const jumped: number[] = [];
    const root = await mount((l) => jumped.push(l));
    const btns = [...document.querySelectorAll(".axv-outline-list .axv-outline-item")] as HTMLElement[];
    expect(btns.length).toBe(2);
    btns[1].click();
    await flush();
    expect(jumped).toEqual([40]);
    root.unmount();
  });

  it("点类名也能跳", async () => {
    const jumped: number[] = [];
    const root = await mount((l) => jumped.push(l));
    const cls = document.querySelector(".axv-outline-list .axv-outline-class") as HTMLElement;
    cls.click();
    await flush();
    expect(jumped).toEqual([3]);
    root.unmount();
  });

  it("光标所在函数高亮（currentLine=20 落在 onCreate 12~40）", async () => {
    const root = await mount(() => {});
    const active = document.querySelector(".axv-outline-item.is-active");
    expect(active?.textContent).toContain("onCreate");
    root.unmount();
  });
});
