// test/xml_m2r_device.test.ts — M2r：设备尺寸切换
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import { deviceById, DEVICE_PRESETS } from "../lib/xml/theme";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

describe("M2r 设备尺寸", () => {
  it("CL 根布局的内容区回落值跟随设备尺寸（手机 vs 平板）", () => {
    const { root } = parseLayoutXml(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          xmlns:app="http://schemas.android.com/apk/res-auto"
          android:layout_width="match_parent" android:layout_height="match_parent" />`,
    );
    const phone = buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, { w: 412, h: 892 });
    const tab = buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, { w: 800, h: 1280 });
    // CL 根内容区 = 屏 - 状态栏24 - 导航栏48
    // 手机: 412*2=824px 宽, (892-72)*2=1640px 高
    // 平板: 800*2=1600px 宽, (1280-72)*2=2416px 高
    expect(String(phone.root.style.width)).toBe("824px");
    expect(String(phone.root.style.height)).toBe("1640px");
    expect(String(tab.root.style.width)).toBe("1600px");
    expect(String(tab.root.style.height)).toBe("2416px");
  });

  it("横屏时高度回落值按横屏屏幕内容区（892 宽 412 高 - 状态栏/导航栏）", () => {
    const { root } = parseLayoutXml(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          xmlns:app="http://schemas.android.com/apk/res-auto"
          android:layout_width="match_parent" android:layout_height="match_parent" />`,
    );
    const m = buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, { w: 892, h: 412 });
    // CL 容器内容区高 = 412 - 24 - 48 = 340dp → 680px
    expect(String(m.root.style.height)).toBe("680px");
  });

  it("不传 screen 参数走默认手机竖屏（向后兼容）", () => {
    const { root } = parseLayoutXml(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          xmlns:app="http://schemas.android.com/apk/res-auto"
          android:layout_width="match_parent" android:layout_height="match_parent" />`,
    );
    const m = buildRenderModel(root!, DEFAULT_RESOURCES, 2);
    // 默认手机 412×892
    expect(String(m.root.style.width)).toBe("824px");
    expect(String(m.root.style.height)).toBe("1640px");
  });

  it("deviceById 未知 id 回落手机竖屏", () => {
    expect(deviceById("nope").id).toBe("phone");
    expect(deviceById(undefined).id).toBe("phone");
  });

  it("预设包含横屏/平板且尺寸正确（M2z 已扩充为多机型）", () => {
    expect(DEVICE_PRESETS.length).toBeGreaterThanOrEqual(5);
    expect(deviceById("tablet-10").w).toBe(800);
    expect(deviceById("tablet").w).toBe(600);
    expect(deviceById("phone-892").w).toBe(412);
    expect(deviceById("phone-land").w).toBe(915);
  });
});
