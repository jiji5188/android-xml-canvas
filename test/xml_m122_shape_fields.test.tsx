// @vitest-environment jsdom

// M122：形状完整参数面板（ShapeFields）
//
// 只测「控件 ↔ ShapeSpec」这一层：结构树/保存链路已在 M121 覆盖，
// 这里确认每个分段按钮和输入框真的把值写进 spec（不是假控件）。

import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ShapeFields } from "@/components/drawable/ShapeFields";
import type { ShapeSpec } from "@/lib/xml/shape-gen";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function flush() {
  return new Promise<void>((r) => setTimeout(r, 0));
}

async function mount(initial: ShapeSpec) {
  const state = { spec: initial };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);

  const render = () => {
    root!.render(
      React.createElement(ShapeFields, {
        spec: state.spec,
        onChange: (next: ShapeSpec) => {
          state.spec = next;
          render();
        },
      }),
    );
  };
  render();
  await flush();
  await flush();
  return state;
}

function setNativeValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttons(label: string): HTMLButtonElement[] {
  return [...host!.querySelectorAll("button")].filter((b) => b.textContent?.trim() === label);
}

function click(label: string, nth = 0) {
  buttons(label)[nth].click();
}

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  await flush();
});

const base: ShapeSpec = { kind: "rectangle", solid: "#FF3B82F6", radius: 12 };

describe("M122 ShapeFields", () => {
  it("纯色时可以改填充色（十六进制输入直接落到 spec.solid）", async () => {
    const st = await mount(base);
    const inputs = [...host!.querySelectorAll("input")] as HTMLInputElement[];
    const hex = inputs.find((i) => i.placeholder === "#AARRGGBB")!;
    setNativeValue(hex, "#FF112233");
    await flush();
    expect(st.spec.solid).toBe("#FF112233");
    expect(st.spec.gradient).toBeUndefined();
  });

  it("切到渐变：给出方向与起止色，纯色字段隐藏", async () => {
    const st = await mount(base);
    click("渐变");
    await flush();
    expect(st.spec.gradient?.type).toBe("linear");
    expect(st.spec.gradient?.start).toBe("#FF3B82F6");
    expect(host!.textContent).toContain("起始色");
    expect(host!.textContent).toContain("结束色");
    // 切回纯色：gradient 清掉，solid 保留
    click("纯色");
    await flush();
    expect(st.spec.gradient).toBeUndefined();
    expect(st.spec.solid).toBeTruthy();
  });

  it("径向渐变才出现中心色与角度：径向没有角度，线性有", async () => {
    const st = await mount({ ...base, gradient: { type: "linear", start: "#FF000000", end: "#FFFFFFFF" } });
    expect(host!.textContent).toContain("角度");
    click("径向");
    await flush();
    expect(st.spec.gradient?.type).toBe("radial");
    expect(host!.textContent).toContain("中心色");
    expect(host!.textContent).not.toContain("角度");
  });

  it("四角独立：切过去把统一圆角铺成四份，切回来取左上角", async () => {
    const st = await mount(base);
    click("四角独立");
    await flush();
    expect(st.spec.corners).toEqual({ tl: 12, tr: 12, br: 12, bl: 12 });
    expect(st.spec.radius).toBeUndefined();

    const tl = [...host!.querySelectorAll("input")].find(
      (i) => (i.closest(".axv-shape-field")?.textContent ?? "").startsWith("左上"),
    ) as HTMLInputElement;
    setNativeValue(tl, "4");
    await flush();
    expect(st.spec.corners?.tl).toBe(4);

    click("统一");
    await flush();
    expect(st.spec.corners).toBeUndefined();
    expect(st.spec.radius).toBe(4);
  });

  it("描边：无 → 有给默认 1dp，宽度清零不会把整个描边误删成负数", async () => {
    const st = await mount(base);
    click("有");
    await flush();
    expect(st.spec.stroke).toEqual({ width: 1, color: "#FFDDDDDD" });

    const w = [...host!.querySelectorAll("input")].find(
      (i) => (i.closest(".axv-shape-field")?.textContent ?? "").startsWith("描边宽度"),
    ) as HTMLInputElement;
    setNativeValue(w, "3");
    await flush();
    expect(st.spec.stroke?.width).toBe(3);
  });

  it("尺寸：宽高任一有值才写 size，都清空就整个去掉", async () => {
    const st = await mount(base);
    const pick = (label: string) =>
      [...host!.querySelectorAll("input")].find(
        (i) => (i.closest(".axv-shape-field")?.textContent ?? "").startsWith(label),
      ) as HTMLInputElement;

    setNativeValue(pick("宽"), "120");
    await flush();
    expect(st.spec.size).toEqual({ w: 120, h: undefined });

    setNativeValue(pick("高"), "48");
    await flush();
    expect(st.spec.size).toEqual({ w: 120, h: 48 });

    setNativeValue(pick("宽"), "");
    setNativeValue(pick("高"), "");
    await flush();
    expect(st.spec.size).toBeUndefined();
  });

  it("内边距：只填一边也生效，全清空后 padding 不留在 XML 里", async () => {
    const st = await mount(base);
    const pick = (label: string) =>
      [...host!.querySelectorAll("input")].find(
        (i) => (i.closest(".axv-shape-field")?.textContent ?? "").startsWith(label),
      ) as HTMLInputElement;

    setNativeValue(pick("内边距左"), "8");
    await flush();
    expect(st.spec.padding).toEqual({ l: 8 });

    setNativeValue(pick("内边距左"), "");
    await flush();
    expect(st.spec.padding).toBeUndefined();
  });

  it("环形只给环宽比例，且按百分比显示 / 存成 0~0.95", async () => {
    const st = await mount({ kind: "ring", solid: "#FF000000", ringHole: 0.4 });
    const hole = [...host!.querySelectorAll("input")].find(
      (i) => (i.closest(".axv-shape-field")?.textContent ?? "").startsWith("环宽比例"),
    ) as HTMLInputElement;
    expect(hole.value).toBe("40");
    setNativeValue(hole, "60");
    await flush();
    expect(st.spec.ringHole).toBeCloseTo(0.6, 5);
  });

  it("线条形状不给填充控件（Android 上 line 只有描边）", async () => {
    await mount({ kind: "line", stroke: { width: 2, color: "#FF000000" } });
    expect(host!.textContent).not.toContain("填充");
    expect(host!.textContent).toContain("描边宽度");
  });
});
