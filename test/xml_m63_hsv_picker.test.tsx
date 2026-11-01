// @vitest-environment jsdom
// test/xml_m63_hsv_picker.test.tsx — M63：HSV 取色器（替换原生取色）
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { HsvPicker } from "@/components/HsvPicker";
import { hsvPanelBackground, hsvToRgb, rgbToHsv, rgbToHsvKeepHue } from "@/lib/xml/hsv";
import { parseColor, toArgbHex } from "@/lib/xml/color-argb";

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

async function mount(ui: React.ReactNode): Promise<HTMLDivElement> {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(ui);
  await flush();
  await flush();
  return host;
}

describe("hsv 转换", () => {
  it("hsvToRgb 六段色相都对", () => {
    expect(hsvToRgb(0, 1, 1)).toEqual({ r: 255, g: 0, b: 0 });
    expect(hsvToRgb(60, 1, 1)).toEqual({ r: 255, g: 255, b: 0 });
    expect(hsvToRgb(120, 1, 1)).toEqual({ r: 0, g: 255, b: 0 });
    expect(hsvToRgb(180, 1, 1)).toEqual({ r: 0, g: 255, b: 255 });
    expect(hsvToRgb(240, 1, 1)).toEqual({ r: 0, g: 0, b: 255 });
    expect(hsvToRgb(300, 1, 1)).toEqual({ r: 255, g: 0, b: 255 });
    // 黑 / 白 / 灰
    expect(hsvToRgb(200, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(hsvToRgb(200, 0, 1)).toEqual({ r: 255, g: 255, b: 255 });
  });

  it("rgbToHsv 往返一致", () => {
    for (const c of [
      { r: 52, g: 152, b: 219 },
      { r: 231, g: 76, b: 60 },
      { r: 46, g: 204, b: 113 },
    ]) {
      const hsv = rgbToHsv(c.r, c.g, c.b);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(back).toEqual(c);
    }
  });

  it("灰色保留原色相（拖到白/黑时色相不跳回 0）", () => {
    expect(rgbToHsv(128, 128, 128).s).toBe(0);
    expect(rgbToHsvKeepHue(128, 128, 128, 275).h).toBe(275);
  });

  it("面板背景是纯 CSS 渐变（不用 canvas 逐像素）", () => {
    const bg = hsvPanelBackground(0);
    expect(bg).toContain("hsl(0 100% 50%)");
    expect(bg).toContain("linear-gradient");
    // 360 归一化
    expect(hsvPanelBackground(720)).toContain("hsl(0 100% 50%)");
    expect(hsvPanelBackground(-60)).toContain("hsl(300 100% 50%)");
  });
});

describe("HsvPicker 交互", () => {
  it("点面板（pointerdown）按位置算 S/V 并回调", async () => {
    const onChange = vi.fn();
    const el = await mount(
      <HsvPicker rgba={{ r: 52, g: 152, b: 219, a: 1 }} label="测试" onChange={onChange} />,
    );
    const panel = el.querySelector(".axv-hsv-panel") as HTMLElement;
    expect(panel).not.toBeNull();

    // jsdom 里 getBoundingClientRect 全是 0，手动塞一个 200×100 的矩形
    panel.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 }) as DOMRect;

    panel.dispatchEvent(new MouseEvent("pointerdown", { clientX: 200, clientY: 0, bubbles: true }));
    await flush();
    expect(onChange).toHaveBeenCalled();
    const first = onChange.mock.calls[0][0] as { r: number; g: number; b: number; a: number };
    // 右上角 = S1 V1 = 纯色（色相用初始 200 附近），alpha 保持 1
    expect(first.a).toBe(1);
    expect(Math.max(first.r, first.g, first.b)).toBeGreaterThan(200);
  });

  it("色相滑杆改变色相", async () => {
    const onChange = vi.fn();
    const el = await mount(
      <HsvPicker rgba={{ r: 255, g: 0, b: 0, a: 1 }} label="测试" onChange={onChange} />,
    );
    const hue = el.querySelector(".axv-hsv-hue") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(hue, "120");
    hue.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    const out = onChange.mock.calls.at(-1)?.[0] as { r: number; g: number; b: number };
    expect(out.g).toBe(255);
    expect(out.r).toBe(0);
  });

  it("ARGB 输入框容错 6 位 / 8 位，并保留 alpha", async () => {
    const onChange = vi.fn();
    const el = await mount(
      <HsvPicker rgba={{ r: 0, g: 0, b: 0, a: 0.5 }} label="测试" onChange={onChange} />,
    );
    const hex = el.querySelector(".axv-hsv-hex") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

    setter?.call(hex, "#3498DB"); // 6 位：当 RGB，alpha 保留 0.5
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    let out = onChange.mock.calls.at(-1)?.[0] as { r: number; g: number; b: number; a: number };
    expect([out.r, out.g, out.b]).toEqual([52, 152, 219]);
    expect(out.a).toBeCloseTo(0.5, 2);

    setter?.call(hex, "#80FF0000"); // 8 位 = AARRGGBB（Android 习惯）
    hex.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    out = onChange.mock.calls.at(-1)?.[0] as { r: number; g: number; b: number; a: number };
    expect([out.r, out.g, out.b]).toEqual([255, 0, 0]);
    expect(out.a).toBeCloseTo(0.5, 1);
  });

  it("预设色保留当前 alpha，点「完成」回调 onDone", async () => {
    const onChange = vi.fn();
    const onDone = vi.fn();
    const el = await mount(
      <HsvPicker
        rgba={{ r: 0, g: 0, b: 0, a: 0.3 }}
        label="测试"
        onChange={onChange}
        onDone={onDone}
      />,
    );
    (el.querySelectorAll(".axv-hsv-preset")[2] as HTMLButtonElement).click();
    await flush();
    const out = onChange.mock.calls.at(-1)?.[0] as { a: number };
    expect(out.a).toBeCloseTo(0.3, 2);

    (el.querySelector(".axv-hsv-ok") as HTMLButtonElement).click();
    expect(onDone).toHaveBeenCalled();
  });

  it("允许透明时点「透明」把 alpha 设 0", async () => {
    const onChange = vi.fn();
    const el = await mount(
      <HsvPicker
        rgba={{ r: 10, g: 20, b: 30, a: 1 }}
        label="测试"
        allowTransparent
        onChange={onChange}
      />,
    );
    const trans = Array.from(el.querySelectorAll(".axv-hsv-btn")).find((b) =>
      (b.textContent || "").includes("透明"),
    ) as HTMLButtonElement;
    trans.click();
    await flush();
    const out = onChange.mock.calls.at(-1)?.[0] as { a: number; r: number };
    expect(out.a).toBe(0);
    expect(out.r).toBe(10);
  });

  it("ARGB 输出仍是 #AARRGGBB（安卓习惯）", () => {
    expect(toArgbHex({ r: 255, g: 0, b: 0, a: 0.5 })).toBe("#80FF0000");
    expect(parseColor("#80FF0000")?.a).toBeCloseTo(0.5, 1);
  });
});
