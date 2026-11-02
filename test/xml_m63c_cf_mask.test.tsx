// @vitest-environment jsdom
// test/xml_m63c_cf_mask.test.tsx — 颜色选择器改成「全屏蒙版 + 居中弹层」
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ColorField } from "@/components/ColorField";

const flush = async () => {
  await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) root.unmount();
  if (host) host.remove();
  root = null;
  host = null;
});

describe("ColorField 居中弹层", () => {
  it("点色块后浮层带蒙版，居中弹层且没有 x/y 定位", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ColorField value="#3498DB" label="测试颜色" onChange={() => {}} />);
    await flush();

    const swatch = host.querySelector(".axv-cf-swatch") as HTMLButtonElement;
    expect(swatch).not.toBeNull();

    // jsdom 没有 .axv-main，portal 会退回 body
    swatch.click();
    await flush();
    await flush();

    const mask = document.querySelector(".axv-cp-mask") as HTMLElement;
    expect(mask, "浮层必须包一层蒙版").not.toBeNull();
    const pop = mask.querySelector(".axv-cp") as HTMLElement;
    expect(pop).not.toBeNull();

    // 不能再有内联 left/top（旧版按锚点算坐标）
    expect(pop.style.left).toBe("");
    expect(pop.style.top).toBe("");
    // 蒙版点击（点是它本身）关闭
    mask.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await flush();
    expect(document.querySelector(".axv-cp-mask")).toBeNull();
  });
});
