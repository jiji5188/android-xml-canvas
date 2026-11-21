// M471：粘贴功能在 Android WebView 上读不到剪贴板内容（clipboard-read 权限被挡）
//
// 用户 2026-11-22 02:03 反馈：「粘贴功能没有获取到粘贴板内容」
// 旧 ctxPaste 只走 navigator.clipboard.readText()，且 catch 后静默 closeCtxMenu() →
// WebView 上权限被挡就永远粘不进来，用户毫无提示。
// 修：三级降级 ① Clipboard API ② 临时 textarea + execCommand("paste")（系统剪贴板）
//     ③ 全失败 → 提示「粘贴失败」（不再静默）
//
// 锁住源码特征（粘贴行为本身依赖真实 WebView，jsdom 模拟不了权限，这里只锁实现不回归）：
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = readFileSync(path.join(ROOT, "components/CodeEditor.tsx"), "utf8");
const I18N = readFileSync(path.join(ROOT, "lib/i18n-src.ts"), "utf8");
const CSS = readFileSync(path.join(ROOT, "components/xml-canvas/05-code-editor.css"), "utf8");

describe("M471 粘贴三级降级 + 失败不再静默", () => {
  it("② 有系统剪贴板兜底（临时 textarea + execCommand(\"paste\")）", () => {
    expect(SRC).toContain('document.execCommand("paste")');
    expect(SRC).toContain("pasteFallbackRef");
    // 焦点必须真正落在 textarea 上才触发（防止贴到别处）
    expect(SRC).toContain("document.activeElement === fa");
  });

  it("③ 全失败提示「粘贴失败」，且该键有 i18n 译文", () => {
    expect(SRC).toContain('tt("粘贴失败")');
    expect(I18N).toContain('"粘贴失败"');
    expect(CSS).toContain(".axv-code-pastenote");
  });

  it("① 仍优先走 Clipboard API（桌面/已授权环境体验最好）", () => {
    expect(SRC).toContain("navigator.clipboard.readText()");
    // readText 必须在 execCommand 之前（降级顺序）
    const i1 = SRC.indexOf("navigator.clipboard.readText()");
    const i2 = SRC.indexOf('document.execCommand("paste")');
    expect(i1).toBeGreaterThan(-1);
    expect(i2).toBeGreaterThan(i1);
  });

  it("旧的「失败静默 closeCtxMenu」写法在 ctxPaste 里不再出现", () => {
    // 旧实现：catch { closeCtxMenu(); return; } 直接吞掉
    expect(SRC).not.toContain(
      `try {\n      text = await navigator.clipboard.readText();\n    } catch {\n      closeCtxMenu();\n      return;\n    }`,
    );
  });
});
