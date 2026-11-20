// @vitest-environment node
// M441：复制/粘贴菜单定位 —— 不挡当前行
import { describe, expect, it } from "vitest";
import { placeCtxMenu, estimateCtxMenuHeight } from "@/lib/xml/ctx-menu-position";

describe("M441 placeCtxMenu", () => {
  const H = 600; // 容器高度
  const menuH = estimateCtxMenuHeight(5); // 5 项

  it("默认放当前行上方（上方空间够时）", () => {
    const r = placeCtxMenu({ top: 300, bottom: 322 }, menuH, H);
    expect(r.side).toBe("above");
    expect(r.top).toBe(300 - 6 - menuH);
    // 不盖当前行
    expect(r.top + menuH).toBeLessThanOrEqual(300 - 6);
  });

  it("上方放不下 → 放当前行下方", () => {
    const r = placeCtxMenu({ top: 20, bottom: 42 }, menuH, H);
    // 上方 20-6-4=10 < menuH(183) → 下方
    expect(r.side).toBe("below");
    expect(r.top).toBe(42 + 6);
    // 不盖当前行
    expect(r.top).toBeGreaterThanOrEqual(42 + 6);
  });

  it("两边都放不下 → 选空间大的一边并夹住（可能压边，但离当前行远）", () => {
    // 当前行 250~272，菜单 400 高，容器 600 → 上 240 / 下 318 都不够 → 选下方空间大
    const r = placeCtxMenu({ top: 250, bottom: 272 }, 400, 600);
    expect(r.side).toBe("below");
    // top = 272+6=278 越界 → 夹到 600-4-400=196
    expect(r.top).toBe(196);
    // 上方空间更大则选上方
    const r2 = placeCtxMenu({ top: 100, bottom: 122 }, 400, 600);
    // 上 90 / 下 478 ≥400 → 下方够 → below
    expect(r2.side).toBe("below");
    const r3 = placeCtxMenu({ top: 500, bottom: 522 }, 400, 600);
    // 上 490 ≥400 → above；top=500-6-400=94
    expect(r3.side).toBe("above");
    expect(r3.top).toBe(94);
  });

  it("top 永远在容器内", () => {
    for (const top of [0, 10, 300, 595]) {
      const r = placeCtxMenu({ top, bottom: top + 22 }, menuH, H);
      expect(r.top).toBeGreaterThanOrEqual(4);
      expect(r.top + menuH).toBeLessThanOrEqual(H - 4 + 0.01);
    }
  });

  it("estimateCtxMenuHeight：行数 × 35 + 8，最低 1 行", () => {
    expect(estimateCtxMenuHeight(5)).toBe(5 * 35 + 8);
    expect(estimateCtxMenuHeight(0)).toBe(35 + 8);
  });
});
