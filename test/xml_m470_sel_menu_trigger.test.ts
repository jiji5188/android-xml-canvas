// M470：代码编辑区「复制/粘贴」菜单只在「选完文本 + 松手」后弹
//
// 用户 2026-11-21 22:51：以前长按 450ms 就弹，正选文本时菜单盖住正文。
// 这里锁住判定矩阵 + 源码层不再有 450ms 计时弹菜单的旧写法。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { SEL_MENU_AFTER_UP_MS, SEL_MENU_SETTLE_MS, shouldOpenSelMenu } from "@/lib/xml/code-sel-menu";

const ok = {
  selectionEmpty: false,
  pointerDown: false,
  menuOpen: false,
  suppressed: false,
};

describe("M470 shouldOpenSelMenu 判定矩阵", () => {
  it("选好文本 + 已松手 + 无菜单 + 非程序选区 → 弹", () => {
    expect(shouldOpenSelMenu(ok)).toBe(true);
  });

  it("没有选区 → 一律不弹（粘贴走系统原生菜单）", () => {
    expect(shouldOpenSelMenu({ ...ok, selectionEmpty: true })).toBe(false);
  });

  it("手指还按着（拖选中）→ 不弹", () => {
    expect(shouldOpenSelMenu({ ...ok, pointerDown: true })).toBe(false);
  });

  it("菜单已经开着 → 不重复弹", () => {
    expect(shouldOpenSelMenu({ ...ok, menuOpen: true })).toBe(false);
  });

  it("程序自己改的选区（全选等）→ 本次不弹", () => {
    expect(shouldOpenSelMenu({ ...ok, suppressed: true })).toBe(false);
  });

  it("延迟参数合理：松手后量坐标要短，选区稳定判定要充分", () => {
    expect(SEL_MENU_AFTER_UP_MS).toBeGreaterThan(0);
    expect(SEL_MENU_AFTER_UP_MS).toBeLessThan(SEL_MENU_SETTLE_MS);
    expect(SEL_MENU_SETTLE_MS).toBeGreaterThanOrEqual(300);
    expect(SEL_MENU_SETTLE_MS).toBeLessThanOrEqual(500);
  });
});

describe("M470 CodeEditor 触发逻辑（源码护栏）", () => {
  const SRC = readFileSync(path.join(process.cwd(), "components/CodeEditor.tsx"), "utf8");

  it("不再有「pointerdown 起 450ms 就弹菜单」的旧写法", () => {
    expect(SRC).not.toContain("longPressTimer");
    expect(SRC).not.toMatch(/\}, 450\);/);
  });

  it("走 selectionchange 兜底 + 抬起后判定", () => {
    expect(SRC).toContain('document.addEventListener("selectionchange"');
    expect(SRC).toContain("SEL_MENU_SETTLE_MS");
    expect(SRC).toContain("SEL_MENU_AFTER_UP_MS");
    expect(SRC).toContain("openCtxMenuAtSelection");
  });

  it("「全选」会抑制本次 selectionchange 触发的菜单", () => {
    expect(SRC).toContain("selMenuSuppressed.current = true");
  });
});
