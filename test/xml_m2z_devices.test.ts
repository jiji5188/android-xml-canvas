// M2z：设备预设完善（机型/密度/圆角/分组）
import { describe, expect, it } from "vitest";
import { DEVICE_PRESETS, deviceById, deviceGroups } from "../lib/xml/theme";

describe("M2z 设备预设", () => {
  it("至少覆盖手机/横屏/平板/其他四类", () => {
    const groups = deviceGroups().map((g) => g.group);
    expect(groups).toContain("手机");
    expect(groups).toContain("横屏");
    expect(groups).toContain("平板");
    expect(groups).toContain("其他");
  });

  it("每个预设都有唯一 id、正尺寸、限定符提示", () => {
    const ids = new Set<string>();
    for (const d of DEVICE_PRESETS) {
      expect(ids.has(d.id)).toBe(false);
      ids.add(d.id);
      expect(d.w).toBeGreaterThan(0);
      expect(d.h).toBeGreaterThan(0);
      expect(d.hint.length).toBeGreaterThan(0);
    }
  });

  it("横屏预设宽 > 高，竖屏预设高 > 宽", () => {
    for (const d of DEVICE_PRESETS) {
      if (/land/.test(d.id)) expect(d.w).toBeGreaterThan(d.h);
      else if (d.group === "手机" || d.group === "平板") expect(d.h).toBeGreaterThan(d.w);
    }
  });

  it("未知 id 回落手机竖屏（保持向后兼容）", () => {
    expect(deviceById(undefined).id).toBe("phone");
    expect(deviceById("nope").id).toBe("phone");
    expect(deviceById("phone").id).toBe("phone");
  });

  it("已知 id 取到对应尺寸", () => {
    expect(deviceById("tablet").w).toBe(600);
    expect(deviceById("small").w).toBe(360);
    expect(deviceById("phone-land").w).toBeGreaterThan(deviceById("phone-land").h);
  });

  it("分组函数覆盖全部预设且不重不漏", () => {
    const flat = deviceGroups().flatMap((g) => g.items);
    expect(flat.length).toBe(DEVICE_PRESETS.length);
  });

  it("圆角要么未设要么为非负数；密度要么未设要么合理", () => {
    for (const d of DEVICE_PRESETS) {
      if (d.radius !== undefined) expect(d.radius).toBeGreaterThanOrEqual(0);
      if (d.dpi !== undefined) {
        expect(d.dpi).toBeGreaterThanOrEqual(120);
        expect(d.dpi).toBeLessThanOrEqual(640);
      }
    }
  });

  it("手表是正方形且圆角接近半边长（圆形表盘）", () => {
    const watch = deviceById("watch");
    expect(watch.w).toBe(watch.h);
    expect(watch.radius).toBeGreaterThanOrEqual(watch.w / 2 - 1);
  });
});
