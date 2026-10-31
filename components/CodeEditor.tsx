// components/CodeEditor.tsx — M38：CodeMirror 6 版代码编辑器（替换 textarea 蹭高亮层的老实现）
//
// 为什么要换：老实现每次按键都全量 highlightXml + innerHTML 替换 + React 全量重渲，
// 5000 行 XML 单次按键 20–40ms，手机上直接掉字。CM6 是视口虚拟化（只渲染可见行）+
// 增量解析，几万行也稳，还顺带送括号匹配、自动缩进、折叠、多光标、原生撤销栈。
//
// 对外接口与 XmlCodeEditor 保持一致（value / onChange / errors / focusLine / focusTick /
// onCursorLine / onFormat），外加 lang（xml | java）。外观仍然全部吃 CSS 变量
// （--axv-code-* / --axv-x-*），设置面板里调颜色不用改这里。

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compartment, EditorState, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  crosshairCursor,
  type DecorationSet,
} from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { xml } from "@codemirror/lang-xml";
import { java } from "@codemirror/lang-java";
import type { LintIssue } from "@/lib/xml/lint";
import type { EditorLang } from "@/lib/xml/editor-lang";
import { SYMBOLS } from "./XmlCodeEditor";

export interface CodeEditorProps {
  value: string;
  onChange: (v: string) => void;
  errors?: LintIssue[];
  className?: string;
  focusLine?: number;
  focusTick?: number;
  onCursorLine?: (line: number) => void;
  onFormat?: () => void;
  /** M38：语法（默认 xml） */
  lang?: EditorLang;
  /** M40：缩进宽度（空格数，默认 4） */
  indent?: number;
}

/* ===== 错误行装饰：行底色 + 左侧红条 + 悬停看原因 ===== */
const setErrLines = StateEffect.define<Map<number, string>>();

function buildErrDeco(doc: { lines: number; line(n: number): { from: number } }, m: Map<number, string>) {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  for (const ln of m.keys()) {
    if (ln < 1 || ln > doc.lines) continue;
    ranges.push(
      Decoration.line({
        class: "axv-cm-errline",
        attributes: { title: m.get(ln) || "结构问题" },
      }).range(doc.line(ln).from),
    );
  }
  return Decoration.set(ranges, true);
}

const errLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setErrLines)) next = buildErrDeco(tr.state.doc, e.value);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ===== 主题：全吃 CSS 变量，设置面板改色即时生效 ===== */
const cmTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "var(--axv-code-font-size, 13px)",
    backgroundColor: "var(--axv-code-bg, var(--axv-surface))",
    color: "var(--axv-code-fg, var(--axv-on-surface))",
  },
  ".cm-scroller": {
    fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
    lineHeight: "21px",
    overflow: "auto",
    fontVariantLigatures: "none",
    fontFeatureSettings: '"liga" 0, "calt" 0',
  },
  ".cm-content": {
    padding: "12px 0",
    caretColor: "var(--axv-code-cursor, #24292F)",
  },
  ".cm-line": { paddingLeft: "14px", paddingRight: "14px" },
  ".cm-gutters": {
    backgroundColor: "var(--axv-code-bg, var(--axv-surface-head))",
    color: "var(--axv-on-surface-variant)",
    border: "none",
    borderRight: "1px solid rgba(0, 0, 0, 0.06)",
    fontSize: "calc(var(--axv-code-font-size, 13px) - 1px)",
  },
  ".cm-lineNumbers .cm-gutterElement": {
    padding: "0 8px 0 10px",
    minWidth: "30px",
    textAlign: "right",
  },
  ".cm-activeLine": {
    backgroundColor: "var(--axv-code-cur-bg, rgba(11, 95, 165, 0.08))",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--axv-code-cur-bg, rgba(11, 95, 165, 0.08))",
    color: "var(--axv-on-surface)",
  },
  // M41：选区颜色。注意 CodeMirror 自带主题里有更高优先级的规则：
  //   .cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { background: #D7D4F0 }
  // 所以光写 &.cm-focused .cm-selectionBackground 会被它压住（用户看到的淡紫就是它）。
  // 这里用相同/更高优先级的选择器覆盖，并用 background 简写（对方也是简写）。
  ".cm-selectionLayer .cm-selectionBackground": {
    background: "var(--axv-code-sel-bg, rgba(4, 64, 159, 0.18))",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    background: "var(--axv-code-sel-bg, rgba(4, 64, 159, 0.18))",
  },
  "::selection": {
    backgroundColor: "transparent !important",
  },
  "&.cm-focused ::selection": {
    backgroundColor: "transparent !important",
  },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--axv-code-cursor, #24292F)",
    borderLeftWidth: "1.6px",
  },
  ".cm-errline": {
    backgroundColor: "rgba(220, 38, 38, 0.07)",
    boxShadow: "inset 3px 0 0 rgba(220, 38, 38, 0.55)",
  },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--axv-code-sel-bg, rgba(4, 64, 159, 0.18))",
    outline: "1px solid var(--axv-primary)",
  },
  "&.cm-focused": { outline: "none" },
});

const cmHl = HighlightStyle.define([
  { tag: tags.tagName, color: "var(--axv-x-tag, var(--axv-primary))" },
  { tag: tags.attributeName, color: "var(--axv-x-attr, #953800)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--axv-x-str, var(--axv-ok))" },
  {
    tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment],
    color: "var(--axv-x-comm, var(--axv-on-surface-variant))",
    fontStyle: "italic",
  },
  { tag: [tags.processingInstruction, tags.meta], color: "var(--axv-x-decl, #8250DF)" },
  // Java
  { tag: tags.keyword, color: "var(--axv-x-decl, #8250DF)" },
  { tag: [tags.typeName, tags.className, tags.namespace], color: "var(--axv-x-tag, #0B5FA5)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--axv-x-str, #1A7F37)" },
  { tag: tags.function(tags.variableName), color: "var(--axv-x-attr, #953800)" },
  { tag: [tags.definition(tags.variableName), tags.propertyName], color: "var(--axv-code-fg, inherit)" },
  { tag: tags.operator, color: "var(--axv-code-fg, inherit)" },
  { tag: tags.annotation, color: "var(--axv-x-comm, #6E7781)" },
]);

const fontTheme = EditorView.theme({ "&": { fontSize: "var(--axv-code-font-size, 13px)" } });

function langExt(l: EditorLang) {
  return l === "java" ? java() : xml();
}

export function CodeEditor({
  value,
  onChange,
  errors,
  className,
  focusLine,
  focusTick,
  onCursorLine,
  onFormat,
  lang = "xml",
  indent = 4,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  /** M40：缩进宽度（indentUnit + tabSize）单独一个 compartment，改设置即时生效 */
  const indentComp = useRef(new Compartment());
  /** 回调放进 ref：view 只建一次，避免每次 render 重建 */
  const onChangeRef = useRef(onChange);
  const onCursorLineRef = useRef(onCursorLine);
  onChangeRef.current = onChange;
  onCursorLineRef.current = onCursorLine;

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hitIdx, setHitIdx] = useState(0);
  const findRef = useRef<HTMLInputElement | null>(null);

  const errLines = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of errors || []) {
      if (e.level !== "error") continue;
      if (!m.has(e.line)) m.set(e.line, e.message);
    }
    return m;
  }, [errors]);

  const insertSnippet = useCallback((insert: string, back = 0) => {
    const v = viewRef.current;
    if (!v) return;
    const sel = v.state.selection.main;
    v.dispatch({ changes: { from: sel.from, to: sel.to, insert } });
    const pos = sel.from + insert.length - back;
    v.dispatch({ selection: { anchor: pos } });
    v.focus();
  }, []);

  /* ===== 建视图（只一次） ===== */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        indentOnInput(),
        bracketMatching(),
        indentComp.current.of([
          indentUnit.of(" ".repeat(indent)),
          EditorState.tabSize.of(indent),
        ]),
        syntaxHighlighting(cmHl),
        cmTheme,
        fontTheme,
        errLineField,
        keymap.of([
          {
            key: "Mod-f",
            run: () => {
              setFindOpen(true);
              window.setTimeout(() => findRef.current?.focus(), 0);
              return true;
            },
          },
          // M40：回车 = 换行 + 按语法自动缩进（放在 defaultKeymap 前，保证优先）
          { key: "Enter", run: insertNewlineAndIndent },
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({
          autocapitalize: "off",
          autocorrect: "off",
          spellcheck: "false",
        }),
        langComp.current.of(langExt(lang)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            onCursorLineRef.current?.(u.state.doc.lineAt(head).number);
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== 外部 value 变化（撤销/重做/格式化/切文件）→ 写进编辑器 ===== */
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur === value) return;
    v.dispatch({ changes: { from: 0, to: cur.length, insert: value } });
  }, [value]);

  /* ===== 语法切换 ===== */
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({ effects: langComp.current.reconfigure(langExt(lang)) });
  }, [lang]);

  /* ===== M40：缩进宽度变化（设置面板里改） ===== */
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: indentComp.current.reconfigure([
        indentUnit.of(" ".repeat(indent)),
        EditorState.tabSize.of(indent),
      ]),
    });
  }, [indent]);

  /* ===== 错误行装饰 ===== */
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({ effects: setErrLines.of(errLines) });
  }, [errLines]);

  /* ===== 跳转行（画布点选 / 报错定位） ===== */
  useEffect(() => {
    const v = viewRef.current;
    if (!v || !focusLine) return;
    const n = Math.min(Math.max(1, focusLine), v.state.doc.lines);
    const line = v.state.doc.line(n);
    v.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    v.focus();
    // focusTick 变化才重新跳（同一行二次点击也要生效）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  /* ===== 查找（自带一套，不引 @codemirror/search 面板） ===== */
  const hits = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as { from: number; to: number }[];
    const v = viewRef.current;
    const doc = v ? v.state.doc.toString() : value;
    const low = doc.toLowerCase();
    const out: { from: number; to: number }[] = [];
    let i = 0;
    while (out.length < 500) {
      const p = low.indexOf(q, i);
      if (p < 0) break;
      out.push({ from: p, to: p + q.length });
      i = p + Math.max(1, q.length);
    }
    return out;
  }, [query, value]);

  const gotoHit = useCallback(
    (idx: number) => {
      const v = viewRef.current;
      if (!v || hits.length === 0) return;
      const n = ((idx % hits.length) + hits.length) % hits.length;
      setHitIdx(n);
      const h = hits[n];
      v.dispatch({
        selection: { anchor: h.from, head: h.to },
        effects: EditorView.scrollIntoView(h.from, { y: "center" }),
      });
      v.focus();
    },
    [hits],
  );

  const firstErr = useMemo(() => {
    const list = (errors || []).filter((e) => e.level === "error");
    return list[0] || null;
  }, [errors]);

  return (
    <div className={"axv-code" + (className ? " " + className : "")}>
      <div className="axv-code-body">
        <div className="axv-cm" ref={hostRef} />
        {findOpen ? (
          <div className="axv-find" role="search">
            <input
              ref={findRef}
              className="axv-find-input"
              value={query}
              placeholder="在当前文件里查找"
              aria-label="查找"
              onChange={(e) => {
                setQuery(e.target.value);
                setHitIdx(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  gotoHit(hitIdx + (e.shiftKey ? -1 : 1));
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setFindOpen(false);
                  viewRef.current?.focus();
                }
              }}
            />
            <span className="axv-find-count">
              {hits.length === 0 ? (query.trim() ? "无匹配" : "") : `${hitIdx + 1}/${hits.length}`}
            </span>
            <button
              type="button"
              className="axv-find-btn"
              title="上一个（Shift+Enter）"
              aria-label="上一个"
              disabled={hits.length === 0}
              onClick={() => gotoHit(hitIdx - 1)}
            >
              <span className="msr" aria-hidden="true">keyboard_arrow_up</span>
            </button>
            <button
              type="button"
              className="axv-find-btn"
              title="下一个（Enter）"
              aria-label="下一个"
              disabled={hits.length === 0}
              onClick={() => gotoHit(hitIdx + 1)}
            >
              <span className="msr" aria-hidden="true">keyboard_arrow_down</span>
            </button>
            <button
              type="button"
              className="axv-find-btn"
              title="关闭（Esc）"
              aria-label="关闭查找"
              onClick={() => {
                setFindOpen(false);
                viewRef.current?.focus();
              }}
            >
              <span className="msr" aria-hidden="true">close</span>
            </button>
          </div>
        ) : null}
      </div>

      {firstErr && (
        <div className="axv-code-errbar">
          <span className="axv-err-dot" aria-hidden="true" />
          <span>
            第 {firstErr.line} 行 · {firstErr.message}
            {errors && errors.length > 1 ? `　（共 ${errors.length} 处）` : ""}
          </span>
        </div>
      )}

      <div className="axv-sym-bar" role="toolbar" aria-label="常用符号">
        {onFormat ? (
          <button
            type="button"
            className="axv-sym-btn axv-sym-action"
            title="重排缩进（保留注释）"
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={onFormat}
          >
            <span className="msr" aria-hidden="true">format_align_left</span>
          </button>
        ) : null}
        {SYMBOLS.map((s) => (
          <button
            key={s.label}
            type="button"
            className="axv-sym-btn"
            title={s.title || s.label}
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={() => insertSnippet(s.insert, s.back || 0)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
