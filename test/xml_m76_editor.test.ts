// test/xml_m76_editor.test.ts — M76：代码编辑器查找偏移 + 按文件重挂
//
// 1) 查找原来用父层 value（有 250ms 防抖）算偏移，再往实时文档里 dispatch：
//    打字期间点「下一个」会跳到错位置。现在偏移一律从编辑器实时文本算。
// 2) CodeEditor 之前不随文件重挂，CM6 的 history() 会跨文件 ——
//    在 A 文件按 Ctrl+Z 能把 B 文件的内容撤回来。XmlCodeView 现在给 key。
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findAllIn } from "@/components/CodeEditor";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("M76 findAllIn", () => {
  it("大小写不敏感，返回原文偏移", () => {
    const doc = "<TextView android:text='Hi'/>\n<textview/>";
    const hits = findAllIn(doc, "textview");
    expect(hits).toHaveLength(2);
    expect(doc.slice(hits[0].from, hits[0].to)).toBe("TextView");
    expect(doc.slice(hits[1].from, hits[1].to)).toBe("textview");
  });

  it("空 query / 纯空格返回空（不会每字符都匹配）", () => {
    expect(findAllIn("abc", "")).toEqual([]);
    expect(findAllIn("abc", "   ")).toEqual([]);
  });

  it("重叠字符串不会死循环（aaa 查 aa）", () => {
    const hits = findAllIn("aaaa", "aa");
    expect(hits.map((h) => h.from)).toEqual([0, 2]);
  });

  it("超过 500 条就截断（大文件防卡）", () => {
    const hits = findAllIn("x".repeat(2000), "x");
    expect(hits).toHaveLength(500);
  });

  it("中文/引号能正常匹配", () => {
    const hits = findAllIn('<string name="a">你好世界</string>', "你好");
    expect(hits).toHaveLength(1);
    expect(hits[0].to).toBe(hits[0].from + 2);
  });
});

describe("M76 源码护栏", () => {
  it("查找偏移来自实时文档（gotoHit 里读 state.doc）", () => {
    const src = read("components/CodeEditor.tsx");
    expect(src).toContain("const list = findAllIn(v.state.doc.toString(), query);");
    expect(src).not.toContain("if (!v || hits.length === 0) return;");
  });

  it("CodeEditor 按 fileKey 重挂（撤销栈不跨文件）", () => {
    const src = read("components/XmlCodeView.tsx");
    expect(src).toContain('key={props.fileKey || "code"}');
  });

  it("输入法组合中不抢 Enter/Tab/方向键，也不弹候选", () => {
    const src = read("components/CodeEditor.tsx");
    expect(src).toContain("if (composing()) return false;");
    expect(src).toContain("const composing = useCallback(() => !!viewRef.current?.composing, []);");
    expect(src).toContain("if (v.composing) {");
  });

  it("引号/括号自动配对 + XML 标签自动闭合都挂上了", () => {
    const src = read("components/CodeEditor.tsx");
    expect(src).toContain("closeBrackets(),");
    expect(src).toContain("...closeBracketsKeymap,");
    expect(src).toContain("autoCloseTags,");
  });
});
