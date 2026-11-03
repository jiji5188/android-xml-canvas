// M100：返回键接线的源码护栏（Node 环境，用 fs 读源码）
//
// 单独成文件的原因：jsdom 环境里 vite 会把 node:fs / node:path externalize 掉，
// 在 .tsx（jsdom）里读源码会报 "default.resolve is not a function"。

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(__dirname, "..");
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), "utf8");

describe("M100 返回键接线", () => {
  const xmlEditor = read("components/XmlEditor.tsx");
  const activity = read("apk/src/com/jiji/axv/MainActivity.java");

  it("XmlEditor 给主要浮层都挂了 useBackGuard", () => {
    const targets = [
      "setLeftOpen(false)",
      "setSaveAsOpen(false)",
      "setNewProjOpen(false)",
      "setImgExportOpen(false)",
      "setAddModalOpen(false)",
      "setExportOpen(false)",
      "setEditingTheme(null)",
      "setResIcon(null)",
      "setResShape(null)",
    ];
    for (const t of targets) {
      expect(xmlEditor, `缺少 ${t} 的返回处理`).toContain(t);
    }
    // 至少 9 个浮层挂了钩子；新加浮层忘了挂会被这里提醒
    const n = (xmlEditor.match(/useBackGuard\(/g) || []).length;
    expect(n).toBeGreaterThanOrEqual(9);
  });

  it("XmlEditor 挂载时安装 JS 桥，卸载时清栈", () => {
    expect(xmlEditor).toContain("installBackBridge()");
    expect(xmlEditor).toContain("resetBackStack()");
  });

  it("MainActivity 返回键先问 JS，再 goBack，最后才 finish", () => {
    expect(activity).toContain("__axvHandleBack");
    expect(activity).toContain("backAsking");
    const jsIdx = activity.indexOf("__axvHandleBack");
    const goBackIdx = activity.indexOf("web.goBack()", jsIdx);
    const finishIdx = activity.indexOf("finish();", goBackIdx);
    expect(goBackIdx).toBeGreaterThan(jsIdx);
    expect(finishIdx).toBeGreaterThan(goBackIdx);
  });
});
