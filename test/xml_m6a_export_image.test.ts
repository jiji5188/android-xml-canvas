// test/xml_m6a_export_image.test.ts — M6a 导出预览图（PNG / SVG）纯逻辑
import { describe, it, expect } from "vitest";
import { exportFileName, targetReady, EXPORT_RATIOS, EXPORT_CLASS } from "../lib/xml/export-image";

describe("M6a exportFileName", () => {
  it("PNG 带倍率后缀", () => {
    expect(exportFileName("png", "Phone", 2)).toBe("preview-phone@2x.png");
  });

  it("SVG 不带倍率后缀", () => {
    expect(exportFileName("svg", "Phone", 2)).toBe("preview-phone.svg");
  });

  it("设备名里的空格/括号/中文被压成连字符，且不留首尾连字符", () => {
    expect(exportFileName("png", "Pixel 7 Pro", 1)).toBe("preview-pixel-7-pro@1x.png");
    // 中文被丢掉，但数字会留下（数字是合法文件名字符）
    expect(exportFileName("png", "  小屏 (360×640)  ", 3)).toBe("preview-360-640@3x.png");
  });

  it("设备名全是非法字符时回退 device", () => {
    expect(exportFileName("svg", "★☆", 1)).toBe("preview-device.svg");
  });

  it("倍率只取整数字面量", () => {
    for (const r of EXPORT_RATIOS) {
      expect(exportFileName("png", "x", r)).toBe(`preview-x@${r}x.png`);
    }
    expect(EXPORT_RATIOS).toEqual([1, 2, 3]);
  });
});

describe("M6a targetReady", () => {
  const el = (globalThis as unknown as { document?: Document }).document?.createElement("div");

  it("没元素/没尺寸 = 未就绪", () => {
    expect(targetReady(null)).toBe(false);
    expect(targetReady(undefined)).toBe(false);
    expect(targetReady({ el: null, width: 100, height: 200 })).toBe(false);
  });

  it("有元素且有尺寸才算就绪", () => {
    if (!el) return; // 纯 node 环境跳过
    expect(targetReady({ el, width: 412, height: 892 })).toBe(true);
    expect(targetReady({ el, width: 0, height: 892 })).toBe(false);
  });
});

describe("M6a 导出态类名", () => {
  it("固定为 axv-exporting（CSS 里靠它隐掉选中虚线框/拖拽高亮）", () => {
    expect(EXPORT_CLASS).toBe("axv-exporting");
  });
});
