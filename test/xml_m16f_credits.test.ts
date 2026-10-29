import fs from "node:fs";
import { describe, it, expect } from "vitest";
import { CREDITS, UPSTREAM, PROJECT_NAME } from "../lib/xml/credits";

describe("M16f 致谢与项目命名", () => {
  it("项目名已改为「Android 可视化 UI 编辑器」", () => {
    expect(PROJECT_NAME).toBe("Android 可视化 UI 编辑器");
  });

  it("上游来源写清楚：M3E Canvas / lnkiai / MIT / 有仓库地址", () => {
    expect(UPSTREAM.name).toBe("M3E Canvas");
    expect(UPSTREAM.by).toBe("lnkiai");
    expect(UPSTREAM.license).toBe("MIT");
    expect(UPSTREAM.url).toContain("github.com/lnkiai/m3e-canvas");
    expect(UPSTREAM.role.length).toBeGreaterThan(20);
  });

  it("致谢列表每条都有仓库链接和许可证，且不重复", () => {
    const names = new Set<string>();
    for (const c of CREDITS) {
      expect(c.name).toBeTruthy();
      expect(c.url).toMatch(/^https?:\/\//);
      expect(c.license).toBeTruthy();
      expect(c.role.length).toBeGreaterThan(4);
      expect(names.has(c.name)).toBe(false);
      names.add(c.name);
    }
    expect(CREDITS.length).toBeGreaterThanOrEqual(10);
  });

  it("README 里有致谢小节，并且写明了上游", () => {
    const md = fs.readFileSync("README.md", "utf8");
    expect(md).toContain("## 致谢 / Acknowledgements");
    expect(md).toContain("M3E Canvas");
    expect(md).toContain("Android 可视化 UI 编辑器");
    // 每条致谢都在 README 里出现（两份口径一致）
    for (const c of CREDITS) expect(md, c.name).toContain(c.name);
  });

  it("站点标题 / PWA manifest / APK 名称都换成新名字", () => {
    const layout = fs.readFileSync("app/layout.tsx", "utf8");
    expect(layout).toContain("Android 可视化 UI 编辑器");
    const mf = JSON.parse(fs.readFileSync("app/manifest.webmanifest", "utf8")) as { name: string };
    expect(mf.name).toBe("Android 可视化 UI 编辑器");
    const strings = fs.readFileSync("apk/res/values/strings.xml", "utf8");
    expect(strings).toContain("Android可视化UI编辑器");
  });
});
