// test/xml_m2m_phone_chrome.test.ts — M2m：预览框模拟手机状态栏 + 导航栏
// 以及「根布局 match_parent 必须填满内容区」的尺寸契约
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { parseRgb, luminance, readableOn, SCREEN_DP, STATUS_BAR_DP, NAV_BAR_DP, phoneBodyDp, PHONE_FG_DARK, PHONE_FG_LIGHT } from "../lib/xml/theme";

describe("M2m 手机外壳尺寸契约", () => {
  it("屏高 = 状态栏 + 内容区 + 导航栏（根布局 match_parent 正好填满内容区）", () => {
    const body = phoneBodyDp();
    expect(STATUS_BAR_DP + body + NAV_BAR_DP).toBe(SCREEN_DP.h);
    // 892 - 24 - 48 = 820dp
    expect(body).toBe(820);
  });

  it("内容区高度必须小于总高，且大于 0", () => {
    expect(phoneBodyDp()).toBeGreaterThan(0);
    expect(phoneBodyDp()).toBeLessThan(SCREEN_DP.h);
  });

  it("状态栏按 Android 默认 24dp、导航栏 48dp", () => {
    expect(STATUS_BAR_DP).toBe(24);
    expect(NAV_BAR_DP).toBe(48);
  });

  it("屏幕是 412x892dp", () => {
    expect(SCREEN_DP).toEqual({ w: 412, h: 892 });
  });
});

describe("M2m 状态栏/导航栏配色反色", () => {
  it("解析 #rrggbb / #rgb / rgb() / rgba()", () => {
    expect(parseRgb("#FFFFFF")).toEqual([255, 255, 255]);
    expect(parseRgb("#fff")).toEqual([255, 255, 255]);
    expect(parseRgb("#1B1B1F")).toEqual([27, 27, 31]);
    expect(parseRgb("rgb(18, 52, 86)")).toEqual([18, 52, 86]);
    expect(parseRgb("rgba(18,52,86,0.5)")).toEqual([18, 52, 86]);
  });

  it("非纯色（渐变/引用/空）返回 null", () => {
    expect(parseRgb("linear-gradient(#fff, #000)")).toBeNull();
    expect(parseRgb("@color/bg")).toBeNull();
    expect(parseRgb("")).toBeNull();
  });

  it("亮度：白 1 / 黑 0", () => {
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
    expect(luminance([0, 0, 0])).toBe(0);
  });

  it("浅底 → 深色文字；深底 → 浅色文字", () => {
    expect(readableOn("#FFFFFF").fg).toBe(PHONE_FG_DARK);
    expect(readableOn("#F5F4F7").fg).toBe(PHONE_FG_DARK);
    expect(readableOn("#121212").fg).toBe(PHONE_FG_LIGHT);
    expect(readableOn("#1B1B1F").fg).toBe(PHONE_FG_LIGHT);
    expect(readableOn("#6750A4").fg).toBe(PHONE_FG_LIGHT);
  });

  it("无背景时回落白底深字（不抛异常）", () => {
    expect(readableOn("")).toEqual({ bg: "#FFFFFF", fg: PHONE_FG_DARK });
    expect(readableOn("@color/bg").fg).toBe(PHONE_FG_DARK);
  });

  it("bg 原样返回，供外壳背景使用", () => {
    expect(readableOn("#123456").bg).toBe("#123456");
  });
});

describe("M2m 根布局必须填满内容区", () => {
  const XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:layout_marginStart="12dp"
    android:layout_marginTop="8dp"
    android:orientation="vertical">
  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:text="hi" />
</LinearLayout>`;

  it("根节点 match_parent → 100%，且忽略 layout_margin（不会留边）", () => {
    const { root } = parseLayoutXml(XML);
    const model = buildRenderModel(root!, {} as never, 2);
    expect(model.root.style.width).toBe("100%");
    expect(model.root.style.height).toBe("100%");
    expect(model.root.style.marginTop).toBeUndefined();
    expect(model.root.style.marginLeft).toBeUndefined();
    expect(model.root.style.marginRight).toBeUndefined();
    expect(model.root.style.marginBottom).toBeUndefined();
  });

  it("子节点的 layout_margin 不受影响", () => {
    const { root } = parseLayoutXml(XML);
    const model = buildRenderModel(root!, {} as never, 2);
    expect(model.root.children[0].style.marginLeft).toBe("32px"); // 16dp @2x
  });
});
