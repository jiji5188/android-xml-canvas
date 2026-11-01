// @vitest-environment jsdom
// M65：属性值是资源引用（@string/@color/...）时出现「跳到定义」按钮
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { AttrPanel } from "@/components/AttrPanel";
import type { ResolvedNode } from "@/lib/xml/types";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

const node = (attrs: Record<string, string>) =>
  ({
    tag: "TextView",
    attrs,
    rawAttrs: attrs,
    path: "0",
    bounds: { x: 0, y: 0, w: 100, h: 40 },
    children: [],
    text: "hello",
    resolved: {},
  }) as unknown as ResolvedNode;

async function mount(attrs: Record<string, string>, onOpenRef?: (v: string) => void) {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <AttrPanel node={node(attrs)} onCommit={() => {}} onRemove={() => {}} onAddAttr={() => {}} onOpenRef={onOpenRef} />,
  );
  await flush();
  return root;
}

describe("M65 资源引用跳转按钮", () => {
  it("@string/text 的行上有跳转按钮，点了带原值回调", async () => {
    const onOpenRef = vi.fn();
    const root = await mount({ "android:text": "@string/app_name" }, onOpenRef);
    const btn = [...document.querySelectorAll(".axv-attr-jump")] as HTMLButtonElement[];
    expect(btn.length).toBe(1);
    btn[0].click();
    expect(onOpenRef).toHaveBeenCalledWith("@string/app_name");
    root.unmount();
  });

  it("@+id / 普通文本 / 16dp 都不出现跳转按钮", async () => {
    const root = await mount({ "android:id": "@+id/btn", "android:text": "确定", "android:padding": "16dp" }, vi.fn());
    expect(document.querySelectorAll(".axv-attr-jump").length).toBe(0);
    root.unmount();
  });

  it("没传 onOpenRef（只读场景）时不渲染按钮", async () => {
    const root = await mount({ "android:text": "@string/app_name" });
    expect(document.querySelectorAll(".axv-attr-jump").length).toBe(0);
    root.unmount();
  });
});
