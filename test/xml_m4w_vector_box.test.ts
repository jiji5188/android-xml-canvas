import { describe, expect, it } from "vitest";
import {
  isVectorOffCanvas,
  normalizeVectorBox,
  repairGeneratedVectors,
} from "../lib/xml/icon-vectors";

// M4w：旧版 getIconVector 用 getPath(0,0,24)，opentype 的 y 轴向下且基线在 0，
// 字形整体落在负 y 区 → 浏览器 mask 时被裁掉 → 图标「生成了但是空白」。
// 下面按当时真实存进 localStorage 的 ic_home 形态造数据（y ∈ [-21, -2]，全在视口上方）
const OLD_HOME = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#1D1B20"
        android:pathData="M 23.52 -3 L 0.48 -3 Q -0.7 -3 -1.55 -3.71 Q -2.4 -4.42 -2.4 -5.4 L -2.4 -12.8 Q -2.4 -13.28 -2.18 -13.73 L 2.54 -16.9 Q 2.93 -17.24 3.44 -17.42 L 4.56 -17.6 L 4.8 -18.8 L 5.22 -19.65 L 6.24 -20 Q 6.86 -20 7.26 -19.65 L 7.68 -18.8 L 19.46 -18.6 Q 20.04 -18.6 20.56 -18.42 L 25.58 -14.48 Q 25.97 -14.16 26.18 -13.73 L 26.4 -12.8 L 26.4 -5.4 Q 26.4 -4.42 25.55 -3.71 L 23.52 -3"/>
</vector>`;

const GOOD_VECTOR = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#1D1B20"
        android:pathData="M12 2 L22 22 L2 22 Z"/>
</vector>`;

const SHAPE = `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#006EFF"/>
    <corners android:radius="6dp"/>
</shape>`;

function allY(xml: string): number[] {
  const ys: number[] = [];
  const re = /pathData="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const tokens = m[1].match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    let parity = 0;
    for (const t of tokens) {
      if (/^[A-Za-z]$/.test(t)) {
        parity = 0;
        continue;
      }
      if (parity % 2 === 1) ys.push(parseFloat(t));
      parity++;
    }
  }
  return ys;
}

describe("M4w vector 视口归一", () => {
  it("识别 y 全在负区的旧图标为 off-canvas", () => {
    expect(isVectorOffCanvas(OLD_HOME)).toBe(true);
    expect(allY(OLD_HOME).every((y) => y <= 0.5)).toBe(true);
  });

  it("正常落在视口内的 vector 不算 off-canvas", () => {
    expect(isVectorOffCanvas(GOOD_VECTOR)).toBe(false);
  });

  it("shape 资源（没有 pathData）不当成 vector 处理", () => {
    expect(isVectorOffCanvas(SHAPE)).toBe(false);
    expect(normalizeVectorBox(SHAPE).changed).toBe(false);
  });

  it("旧图标归一后所有 y 落回 0–24（画得出来了）", () => {
    const r = normalizeVectorBox(OLD_HOME);
    expect(r.changed).toBe(true);
    const ys = allY(r.xml);
    expect(ys.length).toBeGreaterThan(0);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...ys)).toBeLessThanOrEqual(24);
  });

  it("归一后 x 也落在 0–24，且保持 24 视口声明不变", () => {
    const r = normalizeVectorBox(OLD_HOME);
    const re = /pathData="([^"]*)"/g;
    const m = re.exec(r.xml)!;
    const tokens = m[1].match(/[A-Za-z]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
    const xs: number[] = [];
    let parity = 0;
    for (const t of tokens) {
      if (/^[A-Za-z]$/.test(t)) {
        parity = 0;
        continue;
      }
      if (parity % 2 === 0) xs.push(parseFloat(t));
      parity++;
    }
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(24);
    expect(r.xml).toContain('android:viewportHeight="24"');
  });

  it("归一只是平移缩放，命令序列与命令数量不变", () => {
    const before = (OLD_HOME.match(/[A-Za-z]/g) ?? []).filter((c) => !/^[a-z]/.test(c) || c === "a");
    const r = normalizeVectorBox(OLD_HOME);
    const pathBefore = /pathData="([^"]*)"/.exec(OLD_HOME)![1];
    const pathAfter = /pathData="([^"]*)"/.exec(r.xml)![1];
    const cmdBefore = pathBefore.match(/[A-Za-z]/g) ?? [];
    const cmdAfter = pathAfter.match(/[A-Za-z]/g) ?? [];
    expect(cmdAfter).toEqual(cmdBefore);
    expect(before.length).toBeGreaterThan(0);
  });

  it("幂等：修过一次的再修不改动", () => {
    const once = normalizeVectorBox(OLD_HOME);
    const twice = normalizeVectorBox(once.xml);
    expect(twice.changed).toBe(false);
    expect(twice.xml).toBe(once.xml);
  });

  it("repairGeneratedVectors 只动 vector，shape 原样保留", () => {
    const r = repairGeneratedVectors({ ic_home: OLD_HOME, bg_card: SHAPE });
    expect(r.repaired).toEqual(["ic_home"]);
    expect(r.map.bg_card).toBe(SHAPE);
    expect(r.map.ic_home).not.toBe(OLD_HOME);
  });

  it("repairGeneratedVectors 对正常图标零改动", () => {
    const r = repairGeneratedVectors({ ic_ok: GOOD_VECTOR });
    expect(r.repaired).toEqual([]);
    expect(r.map.ic_ok).toBe(GOOD_VECTOR);
  });

  it("负数浮点坐标不会因为格式化成 NaN", () => {
    const r = normalizeVectorBox(OLD_HOME);
    expect(r.xml).not.toContain("NaN");
    expect(r.xml).not.toContain("undefined");
  });
});
