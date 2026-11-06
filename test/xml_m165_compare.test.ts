// test/xml_m165_compare.test.ts — M165 并排对比
// @vitest-environment node

import { describe, it, expect } from "vitest";
import { deviceById } from "../lib/xml/theme";

import { buildCompareModels, COMPARE_DEFAULTS, COMPARE_POOL } from "../lib/xml/compare";
const SIMPLE = {
  tag: "LinearLayout",
  attrs: { layout_width: "match_parent", layout_height: "match_parent" },
  children: [
    { tag: "TextView", attrs: { layout_width: "wrap_content", layout_height: "wrap_content", text: "Hi" }, children: [] },
  ],
};

const RES = {
  palette: {
    primary: "#2196F3",
    background: "#FFFFFF",
    textPrimary: "#212121",
    fromProject: false,
  },
} as never;

describe("M165 buildCompareModels", () => {
  it("默认 4 台设备都能建出模型", () => {
    const entries = buildCompareModels(SIMPLE, RES, undefined, "appcompat", COMPARE_DEFAULTS);
    expect(entries).toHaveLength(4);
    for (const e of entries) {
      expect(e.model).toBeTruthy();
      expect(e.err).toBeUndefined();
    }
  });

  it("不同设备建出的模型都成立，设备尺寸各自不同", () => {
    const entries = buildCompareModels(SIMPLE, RES, undefined, "appcompat", ["small", "tablet"]);
    expect(entries[0].device.w).toBeLessThan(entries[1].device.w);
    expect(entries[0].model!.root).toBeTruthy();
    expect(entries[1].model!.root).toBeTruthy();
    // match_parent 根在两边都是 100%（屏宽差异体现在外层壳上，不在节点 style 里）
    const st = (i: number) =>
      (entries[i].model!.root as unknown as { style?: { width?: string } }).style?.width;
    expect(st(0)).toBe("100%");
    expect(st(1)).toBe("100%");
  });

  it("池子里的设备 id 都能在 deviceById 里找到", () => {
    for (const id of COMPARE_POOL) {
      expect(deviceById(id).id).toBe(id);
    }
  });

  it("解析不出的 root 返回 err 不抛", () => {
    const entries = buildCompareModels(null, RES, undefined, "appcompat", ["phone"]);
    expect(entries[0].model).toBeNull();
    expect(entries[0].err).toBeTruthy();
  });
});
