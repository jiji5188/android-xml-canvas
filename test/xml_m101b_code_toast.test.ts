// test/xml_m101b_code_toast.test.ts —— M101：代码面板里的 toast（Ctrl+点击的反馈要看得见）
//
// 背景：exportNote 原本只由 CanvasStage 渲染（`.axv-toast.axv-sb-camera-note`），
// 而 CanvasStage 只在画布 tab 存在 → 代码面板里 flashNote 等于石沉大海。
// 同时 flashNote 的定时器没有取消机制，连点两次引用时旧定时器会把新提示提前抹掉。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const editor = fs.readFileSync(path.join(root, "components/XmlEditor.tsx"), "utf8");
const css = fs.readFileSync(path.join(root, "components/xml-canvas.css"), "utf8");

describe("M101b 代码面板 toast", () => {
  it("CSS 里有 .axv-code-toast（fixed 定位，不依赖画布）", () => {
    expect(css).toMatch(/\.axv-code-toast\s*\{/);
    const block = css.slice(css.indexOf(".axv-code-toast"));
    expect(block.slice(0, 260)).toMatch(/position:\s*fixed/);
  });

  it("XmlEditor 在代码 tab 渲染该 toast", () => {
    expect(editor).toContain("axv-toast axv-code-toast");
    // 只在代码/values tab 显示，画布 tab 继续用状态条那套，避免重复
    expect(editor).toMatch(/mobileTab === "xml" \|\| mobileTab === "values"/);
  });

  it("flashNote 会取消上一个定时器（连续提示不被旧定时器抹掉）", () => {
    expect(editor).toContain("noteTimerRef");
    const i = editor.indexOf("const flashNote");
    const body = editor.slice(i, i + 320);
    expect(body).toContain("window.clearTimeout(noteTimerRef.current)");
  });
});
