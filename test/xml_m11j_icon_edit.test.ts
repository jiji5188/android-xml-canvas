import { describe, it, expect } from "vitest";
import { buildVectorXml, parseVectorModel, nextRotation } from "../lib/xml/vector-edit";
import { vectorToSvg, parseVectorXml } from "../lib/xml/vector-svg";

const SRC = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#1D1B20"
        android:pathData="M12 2 L22 20 H2 Z"/>
</vector>`;

describe("M11j vector-edit：图标可编辑模型", () => {
  it("解析出尺寸 / 视口 / 单条路径", () => {
    const m = parseVectorModel(SRC)!;
    expect(m).toBeTruthy();
    expect(m.w).toBe(24);
    expect(m.h).toBe(24);
    expect(m.vw).toBe(24);
    expect(m.vh).toBe(24);
    expect(m.paths).toHaveLength(1);
    expect(m.paths[0].fill).toBe("#1D1B20");
    expect(m.paths[0].d).toBe("M12 2 L22 20 H2 Z");
    expect(m.group.rotation).toBe(0);
  });

  it("改尺寸 / 颜色后重新序列化，可再次解析回同样的值", () => {
    const m = parseVectorModel(SRC)!;
    const next = { ...m, w: 32, h: 32, paths: [{ ...m.paths[0], fill: "#04409F" }] };
    const xml = buildVectorXml(next, "ic_test");
    expect(xml).toContain('android:width="32dp"');
    expect(xml).toContain('android:fillColor="#04409F"');
    const back = parseVectorModel(xml)!;
    expect(back.w).toBe(32);
    expect(back.paths[0].fill).toBe("#04409F");
    expect(back.paths[0].d).toBe("M12 2 L22 20 H2 Z");
  });

  it("恒等变换不写 group；有旋转/镜像才写，并带 pivot", () => {
    const m = parseVectorModel(SRC)!;
    expect(buildVectorXml(m)).not.toContain("<group");

    const rotated = { ...m, group: { ...m.group, rotation: 90 } };
    const xml = buildVectorXml(rotated);
    expect(xml).toContain("<group");
    expect(xml).toContain('android:rotation="90"');
    expect(xml).toContain('android:pivotX="12"');
    expect(xml).toContain("</group>");
    expect(parseVectorModel(xml)!.group.rotation).toBe(90);
  });

  it("镜像写 scaleX=-1 / scaleY=-1", () => {
    const m = parseVectorModel(SRC)!;
    const xml = buildVectorXml({ ...m, group: { ...m.group, scaleX: -1 } });
    expect(xml).toContain('android:scaleX="-1"');
    expect(parseVectorModel(xml)!.group.scaleX).toBe(-1);
  });

  it("多路径按顺序保留，fillAlpha 只在 <1 时写出", () => {
    const m = parseVectorModel(SRC)!;
    const xml = buildVectorXml({
      ...m,
      paths: [
        { d: "M0 0h24v24H0z", fill: "#111111", alpha: 0.5 },
        { d: "M2 2h20v20H2z", fill: "#222222" },
      ],
    });
    const back = parseVectorModel(xml)!;
    expect(back.paths).toHaveLength(2);
    expect(back.paths[0].alpha).toBeCloseTo(0.5);
    expect(back.paths[1].alpha).toBeUndefined();
    expect(xml.match(/fillAlpha/g)).toHaveLength(1);
  });

  it("nextRotation 按 90° 循环", () => {
    expect(nextRotation(0)).toBe(90);
    expect(nextRotation(270)).toBe(0);
    expect(nextRotation(180)).toBe(270);
  });
});

describe("M11j vector-svg：渲染带 group 的图标", () => {
  it("无 group 时 SVG 里没有 <g>", () => {
    const svg = vectorToSvg(SRC)!;
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<g transform");
  });

  it("有旋转时包一层 <g transform>，viewBox 不变", () => {
    const m = parseVectorModel(SRC)!;
    const xml = buildVectorXml({ ...m, group: { ...m.group, rotation: 90 } });
    const svg = vectorToSvg(xml)!;
    expect(svg).toContain("<g transform=");
    expect(svg).toContain("rotate(90)");
    expect(svg).toContain('viewBox="0 0 24 24"');
  });

  it("镜像时 SVG 的 scale 带负号", () => {
    const m = parseVectorModel(SRC)!;
    const xml = buildVectorXml({ ...m, group: { ...m.group, scaleX: -1 } });
    expect(vectorToSvg(xml)!).toContain("scale(-1 1)");
  });

  it("老文件（无 group）解析行为不变", () => {
    const spec = parseVectorXml(SRC)!;
    expect(spec.group).toBeUndefined();
    expect(spec.paths[0].fill).toBe("#1D1B20");
  });
});
