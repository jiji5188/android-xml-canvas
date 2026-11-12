// M52：M50 给设置面板加的「折叠」规则必须只作用于设置面板，
// 否则复用 .axv-set-group 的「编辑图标」「关于」两个子页面内容会被整块隐藏（已出过事故）。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("M52 折叠规则作用域", () => {
  it("display:none 的折叠规则只作用于 .axv-settings 内部", () => {
    const css = read("components/xml-canvas.css");
    const hits = css
      .split("\n")
      .filter((l) => l.includes(":not(.open) > *:not(.axv-set-label)"))
      .map((l) => l.trim());
    expect(hits.length).toBeGreaterThan(0);
    for (const line of hits) expect(line.startsWith(".axv-settings ")).toBe(true);
  });

  it("设置面板根节点带 axv-settings 类", () => {
    expect(read("components/SettingsPanel.tsx")).toContain('className="axv-rail-scroll axv-settings"');
  });

  it("IconCanvasEditor / AboutPanel 用 axv-set-group 但不在 .axv-settings 里 → 不会被折叠", () => {
    for (const f of ["components/IconCanvasEditor.tsx", "components/AboutPanel.tsx"]) {
      const src = read(f);
      expect(src).toContain("axv-set-group");
      expect(src).not.toContain("axv-settings");
    }
  });
});
