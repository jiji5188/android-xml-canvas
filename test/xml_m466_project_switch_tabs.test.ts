// M466：切项目后清除上一项目残留的文件 tabs（Project.files）
// 用户报：切换项目后，页面还留着上一个项目的已打开文件 tab，容易误导。
// 修：activateProject / openWsProject（file 分支）/ applySampleProject / applyBlankTemplate
//   在切换/载入时把 project.files 清成空（新主布局随后由 loadEntry 补进来）。
// 沿用 M459 的源码扫描测试风格（不挂 React，轻且稳）。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");

function bodyOf(file: string, startMarker: string, endMarker = "\n  );"): string {
  const s = fs.readFileSync(path.join(root, file), "utf8");
  const i = s.indexOf(startMarker);
  if (i < 0) throw new Error(`marker not found: ${startMarker} in ${file}`);
  const j = s.indexOf(endMarker, i + startMarker.length);
  return s.slice(i, j > 0 ? j : s.length);
}

describe("M466 切项目清文件 tabs", () => {
  it("activateProject 切项目时清空 project.files（避免旧项目 tab 残留）", () => {
    const b = bodyOf("components/use-xml-project-fns.ts", "const activateProject");
    expect(b).toContain('files: [], activeId: ""');
    // 重置在 loadEntry 之前（保证新主布局 addFile 时拿到的是空 files）
    const resetIdx = b.indexOf("files: [], activeId: \"\"");
    const loadIdx = b.indexOf("loadEntry(opened.source");
    expect(resetIdx).toBeGreaterThan(-1);
    expect(loadIdx).toBeGreaterThan(resetIdx);
  });

  it("openWsProject 的 file 分支打开单文件时也清残留 tabs", () => {
    const b = bodyOf("components/use-xml-project-fns.ts", "const openWsProject");
    expect(b).toContain("files: [], activeId: \"\"");
  });

  it("applySampleProject 载入示例项目时清残留 tabs", () => {
    const b = bodyOf("components/use-xml-project-fns.ts", "const applySampleProject");
    expect(b).toContain("files: [], activeId: \"\"");
  });

  it("applyBlankTemplate 套空白模板时清残留 tabs", () => {
    const b = bodyOf("components/use-xml-project-fns.ts", "const applyBlankTemplate");
    expect(b).toContain("files: [], activeId: \"\"");
  });

  it("createNewProject 用 createProject 全新建（files 天然只含 activity_main），无需额外清", () => {
    const b = bodyOf("components/use-project-create.ts", "const createNewProject", "\n      [D,");
    expect(b).toContain("createProject(name");
    // 确认它没有沿用旧 p.files（是全量替换不是 append）
    expect(b).not.toMatch(/files:\s*\[.*\.\.\./);
  });
});
