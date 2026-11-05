// test/xml_m139_undo_owner.test.ts — 撤销栈与代码编辑器不再打架（M139）
//
// 背景：CodeEditor 装了 CM6 自带 history() + historyKeymap，而 XmlEditor 另有一套 diffHistory。
// ① Ctrl+Z 在代码区里两边都响应 → 一次按键倒退两步；
// ② 外部回灌 value（撤销/格式化）在 CM6 里是「整篇替换」，也成一步撤销 → 再把 app 的撤销撤掉；
// ③ app 侧 flushTextTimer 只是取消定时器，500ms 合并窗口内按 Ctrl+Z 会把刚敲的那段直接吞掉。
// 现在：CM6 不装 history，撤销权归 app；app 撤销前先把未入栈的输入提交。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  diffHistoryInit,
  diffHistoryCommit,
  diffHistoryUndo,
  diffHistoryCurrent,
} from "../lib/xml/history";

const root = path.resolve(__dirname, "..");
const codeEditor = fs.readFileSync(path.join(root, "components/CodeEditor.tsx"), "utf8");
const xmlEditor = fs.readFileSync(path.join(root, "components/XmlEditor.tsx"), "utf8");

describe("M139 CM6 不再自带撤销栈", () => {
  it("没有 history() 扩展", () => {
    expect(codeEditor).not.toMatch(/^\s*history\(\),/m);
  });

  it("没有 historyKeymap 绑定（Ctrl+Z 冒泡给 app）", () => {
    expect(codeEditor).not.toMatch(/\.\.\.historyKeymap/);
    expect(codeEditor).not.toMatch(/import\s*\{[^}]*\bhistory\b[^}]*\}\s*from\s*"@codemirror\/commands"/);
  });

  it("默认键位、括号补全这些还得留着", () => {
    expect(codeEditor).toContain("defaultKeymap");
    expect(codeEditor).toContain("closeBracketsKeymap");
    expect(codeEditor).toContain("indentWithTab");
  });
});

describe("M139 app 撤销前先提交未入栈的输入", () => {
  it("定义了 commitPendingText 并比较 histRef.cur", () => {
    expect(xmlEditor).toContain("const commitPendingText");
    const i = xmlEditor.indexOf("const commitPendingText");
    const body = xmlEditor.slice(i, i + 360);
    expect(body).toContain("liveXmlRef.current");
    expect(body).toContain("histRef.current.cur");
    expect(body).toContain("commitHistory(pending)");
  });

  it("undo 和 redo 都先调它，再动 diffHistory", () => {
    for (const fn of ["const undo = () => {", "const redo = () => {"]) {
      const i = xmlEditor.indexOf(fn);
      expect(i).toBeGreaterThan(-1);
      const body = xmlEditor.slice(i, i + 420);
      const pending = body.indexOf("commitPendingText()");
      const move = body.indexOf(fn.includes("undo") ? "diffHistoryUndo" : "diffHistoryRedo");
      expect(pending).toBeGreaterThan(-1);
      expect(move).toBeGreaterThan(pending);
    }
  });
});

describe("M139 底层语义：先提交再撤销 = 回到输入前", () => {
  const BASE = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android" />`;

  it("输入后立刻撤销 → 回到输入前（不是回到更早）", () => {
    let h = diffHistoryInit(BASE);
    // 模拟「刚敲完还没到 500ms 就按 Ctrl+Z」：pending = 新文本，未入栈
    const pending = BASE.replace(" />", ">\n    <View />\n</LinearLayout>");
    expect(diffHistoryCanUndoNow(h)).toBe(false);

    // commitPendingText 的行为
    h = diffHistoryCommit(h, pending);
    const r = diffHistoryUndo(h);
    expect(diffHistoryCurrent(r.next)).toBe(BASE);
  });

  it("连续两次撤销各退一步（不会一次退两步）", () => {
    let h = diffHistoryInit(BASE);
    const a = BASE.replace("/>", "/>");
    const b = `<FrameLayout />`;
    const c = `<RelativeLayout />`;
    h = diffHistoryCommit(h, [a, b, c][0]);
    h = diffHistoryCommit(h, b);
    h = diffHistoryCommit(h, c);

    const r1 = diffHistoryUndo(h);
    expect(diffHistoryCurrent(r1.next)).toBe(b);
    const r2 = diffHistoryUndo(r1.next);
    expect(diffHistoryCurrent(r2.next)).toBe(a);
  });
});

/** 只是让测试意图直白一点：初态没有可撤销步 */
function diffHistoryCanUndoNow(h: ReturnType<typeof diffHistoryInit>): boolean {
  return h.undo.length > 0;
}
