// @vitest-environment jsdom
// M444：防回归 —— 代码块纵向标记线的装饰必须是合法的零长度 line 装饰。
// 事故：M442 把 line 装饰写成 .range(L.from, L.to)（双点），CodeMirror 抛
//   "Line decoration ranges must be zero-length" → 每次输入事务失败 → 用户「输入不了文字」。
import { describe, expect, it } from "vitest";
import { EditorState, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet } from "@codemirror/view";
import { buildBlockGuidesDeco } from "@/components/CodeEditor";

const CODE = [
  "public class M {",
  "    void f() {",
  "        if (x) {",
  "            a();",
  "        }",
  "    }",
  "}",
].join("\n");

function mkField() {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
      if (!tr.docChanged) return deco;
      return buildBlockGuidesDeco(tr.state.doc);
    },
  });
}

describe("M444 代码块标记线装饰合法性", () => {
  it("构建装饰不抛错", () => {
    const field = mkField();
    const state = EditorState.create({ doc: CODE, extensions: [field] });
    expect(() => state.field(field)).not.toThrow();
  });

  it("键入时 dispatch 不抛错（输入链路可用）", () => {
    const field = mkField();
    const state = EditorState.create({ doc: CODE, extensions: [field] });
    expect(() =>
      state.update({ changes: { from: CODE.length, insert: " " } }),
    ).not.toThrow();
  });

  it("文件有多层嵌套块时仍不抛错，且装饰数 > 0", () => {
    const field = mkField();
    const state = EditorState.create({ doc: CODE, extensions: [field] });
    const tr = state.update({ changes: { from: 0, insert: "\n" } });
    const set = tr.state.field(field);
    expect(set.size).toBeGreaterThan(0);
  });

  it("所有装饰都是零长度（line 装饰硬性要求）", () => {
    const field = mkField();
    const state = EditorState.create({ doc: CODE, extensions: [field] });
    const tr = state.update({ changes: { from: 0, insert: " " } });
    const set = tr.state.field(field);
    const bad: string[] = [];
    const iter = set.iter();
    while (iter.value) {
      if (iter.to !== iter.from) bad.push(`${iter.from}-${iter.to}`);
      iter.next();
    }
    expect(bad).toEqual([]);
  });
});
