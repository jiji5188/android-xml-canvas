// test/xml_m353_pager_typo.test.ts — M353：setCurrentItem 不应被当成 getCurrentItem 的拼写错
// 真机误报：用户写 ViewPager2.setCurrentItem(...) 被提示「改成 getCurrentItem()」。
// 两层修法：① setCurrentItem 进已知白名单（真·标准 API）；② fallback 补 M208 动词门槛
//（归一化后只差开头 get/set 的不再配），保证即使没进白名单也不会误报。
import { describe, expect, it } from "vitest";
import { findMethodTypos, suggestMethod, KNOWN_METHODS } from "@/lib/xml/java-methods";

describe("M353 setCurrentItem 误报", () => {
  it("setCurrentItem 在已知白名单里（标准 ViewPager2 方法）", () => {
    expect(KNOWN_METHODS).toContain("setCurrentItem");
    expect(KNOWN_METHODS).toContain("getCurrentItem");
    // 成对方法都在 → 白名单完整，不会把 setCurrentItem 当未知
    expect(KNOWN_METHODS).toContain("setOffscreenPageLimit");
  });

  it("suggestMethod('setCurrentItem') 不配成 getCurrentItem", () => {
    // 它本身已知 → suggestMethod 直接返回 null
    expect(suggestMethod("setCurrentItem")).toBeNull();
  });

  it("代码里调用 setCurrentItem( 不报拼写错（fallback 动词门槛生效）", () => {
    const code = `public void go(int i) {
  pager.setCurrentItem(i, true);
  pager.setCurrentTab(0);
  pager.setOffscreenPageLimit(1);
}`;
    const typos = findMethodTypos(code, {});
    const flagged = typos.filter((t) => /setCurrentItem|setCurrentTab|setOffscreenPageLimit/.test(t.name));
    expect(flagged.length).toBe(0);
    expect(typos).toEqual([]);
  });

  it("对照组：真拼写错（getCurrentIem 缺 m）仍能被查出来", () => {
    // getCurrentIem → getCurrentItem（真漏了一个 m，编辑距离 1，非 get/set 动词差）应报
    const code = `void f(){ pager.getCurrentIem(); }`;
    const typos = findMethodTypos(code, {});
    expect(typos.length).toBeGreaterThan(0);
    expect(typos[0].suggestion).toBe("getCurrentItem");
  });
});
