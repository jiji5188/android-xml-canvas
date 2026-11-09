// components/CodeEditor.tsx - M38:CodeMirror 6 版代码编辑器(替换 textarea 蹭高亮层的老实现)
//
// 为什么要换:老实现每次按键都全量 highlightXml + innerHTML 替换 + React 全量重渲,
// 5000 行 XML 单次按键 20-40ms,手机上直接掉字。CM6 是视口虚拟化(只渲染可见行)+
// 增量解析,几万行也稳,还顺带送括号匹配、自动缩进、折叠、多光标、原生撤销栈。
//
// 对外接口与 XmlCodeEditor 保持一致(value / onChange / errors / focusLine / focusTick /
// onCursorLine / onFormat),外加 lang(xml | java)。外观仍然全部吃 CSS 变量
// (--axv-code-* / --axv-x-*),设置面板里调颜色不用改这里。

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { diagRanges as calcDiagRanges, type DiagInfo } from "@/lib/xml/diag-deco";
import { codeHint } from "@/lib/xml/diag-hints";
import { Compartment, EditorState, Prec, RangeSet, SelectionRange, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  highlightTrailingWhitespace,
  hoverTooltip,
  keymap,
  gutter,
  GutterMarker,
  lineNumbers,
  rectangularSelection,
  crosshairCursor,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";

import {
  defaultKeymap,
  indentWithTab,
  insertNewlineAndIndent,
} from "@codemirror/commands";
import {
  HighlightStyle,
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { tags } from "@lezer/highlight";
import { autoCloseTags, xml } from "@codemirror/lang-xml";
import { java } from "@codemirror/lang-java";
import type { LintIssue } from "@/lib/xml/lint";
import type { EditorLang } from "@/lib/xml/editor-lang";
import { computeSuggest } from "@/lib/xml/keyword-suggest";
import { computeJavaSuggest, JAVA_SYMBOLS } from "@/lib/xml/java-vocab";
import { KIND_LABEL, KIND_NAME, type SuggestKind } from "@/lib/xml/suggest-kind";
import { estimateSuggestSize, placeSuggest, type Placement } from "@/lib/xml/suggest-position";
import { tokenAt } from "@/lib/xml/ref-token";
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
  /** M179:一键修复(把 errors 里带 fix 的替换掉) */
  onFixAll?: () => void;
  /** M202：修某一条（点问题卡片里的「应用此修复」） */
  onFixOne?: (iss: LintIssue) => void;
  /** M38:语法(默认 xml) */
  lang?: EditorLang;
  /** M40:缩进宽度(空格数,默认 4) */
  indent?: number;
  /** M45:资源名候选(@drawable/xxx 补全用),不传就只用文档里的 token */
  resNames?: string[];
  /** M101:Ctrl/Cmd + 点击资源引用时回调(raw 如 `@string/app_name` / `R.id.btn`) */
  onRefClick?: (raw: string) => void;
  /** M209:悬停提示——父层把光标下的 token（如 R.id.btn / @drawable/ic / 变量名）解析成提示文本，非 null 就弹 tooltip */
  hoverTip?: (raw: string) => string | null;
}

/** M76:在一份文本里找全部匹配(大小写不敏感,上限 500 条,空 query 返回空) */
export function findAllIn(doc: string, query: string): { from: number; to: number }[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
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
}

/** M45:弹窗当前状态 */
interface SugState {
  items: string[];
  sel: number;
  kind: SuggestKind;
  /** M99:与 items 对应的分类(逐条不同) */
  kinds?: SuggestKind[];
  prefix: string;
  placement: Placement;
  width: number;
}

/* ===== 错误行装饰:行底色 + 左侧红条 + 悬停看原因 ===== */
const setErrLines = StateEffect.define<Map<number, string>>();

function buildErrDeco(doc: { lines: number; line(n: number): { from: number } }, m: Map<number, string>) {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  for (const ln of m.keys()) {
    if (ln < 1 || ln > doc.lines) continue;
    ranges.push(
      Decoration.line({
        class: "cm-errline",
        attributes: { title: m.get(ln) || tt("结构问题") },
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

/* ===== M202：AIDE 式精确错误引导 =====
 *  1. 波浪下划线（range mark）圈住出问题的这一段，不再整行飘红
 *  2. 行号槽红/黄点 + 悬停看原因
 *  3. 点一下跳到那一行，底部错误条加「上一条 / 下一条」导航
 *  4. 点错误区域弹问题卡片，带「应用此修复」按钮 */

const setDiags = StateEffect.define<Map<number, DiagInfo>>();

/** M202：把 diags 算成 CodeMirror 装饰（整行标色 / 精确波浪下划线） */
function buildDiagDeco(
  doc: { lines: number; line(n: number): { from: number; to: number } },
  m: Map<number, DiagInfo>,
) {
  const ranges: ReturnType<Decoration["range"]>[] = [];
  for (const r of calcDiagRanges(doc, m)) {
    if (r.from === r.to) continue; // 空范围不画
    if (r.full) {
      // 整行 → 行底色（老行为）
      ranges.push(
        Decoration.line({
          class: r.sev === "error" ? "cm-errline" : "cm-warnline",
          attributes: { title: r.msg },
        }).range(r.from),
      );
    } else {
      // 精确范围 → 波浪下划线
      ranges.push(
        Decoration.mark({
          class: r.sev === "error" ? "cm-diag-err" : "cm-diag-warn",
          attributes: { title: r.msg },
        }).range(r.from, r.to),
      );
    }
  }
  return Decoration.set(ranges, true);
}

const diagField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    let next = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setDiags)) next = buildDiagDeco(tr.state.doc, e.value);
    }
    return next;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/* ===== M209：可修复行的行号槽灯泡（视觉提示）=====
 *  在行号 gutter 左边多一列，凡是带 fix 的行都画一个小灯泡。
 *  点它仍走底部问题卡片的「应用此修复」，这里只做醒目提示。 */
class FixMarker extends GutterMarker {
  elementClass = "cm-fix-slot";
  constructor(public readonly fixable: boolean) {
    super();
  }
  toDOM() {
    const wrap = document.createElement("span");
    wrap.className = "cm-fix-slot";
    if (this.fixable) {
      const b = document.createElement("span");
      b.className = "cm-fix-bulb";
      b.textContent = "💡";
      b.title = tt("此行有可自动修复的问题");
      wrap.appendChild(b);
    }
    return wrap;
  }
  eq(other: FixMarker) {
    return other.fixable === this.fixable;
  }
}

/** M209：给行号 gutter 左边加一列「可修复」槽；哪行可修就画灯泡 */
const fixGutter = gutter({
  class: "cm-fix-gutter",
  markers: (view) => {
    const lines = view.state.doc.lines;
    const marks: GutterMarker[] = [];
    for (let i = 1; i <= lines; i++) {
      const iss = fixIssuesByLineRef.current.get(i);
      marks.push(new FixMarker(!!iss && !!iss.fix));
    }
    const set = RangeSet.of(marks.map((m, i) => m.range(view.state.doc.line(i).from)));
    return set;
  },
});

/** M209：行号 → 该行的可修问题（供 fixGutter 的 markers 读） */
const fixIssuesByLineRef = { current: new Map<number, LintIssue>() };

/* ===== 主题:全吃 CSS 变量,设置面板改色即时生效 ===== */
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
    // M50:背景改由 cmCurLineBg(独立负层)画。
    // 这里必须留透明:内容层背景会盖住选区层(z-index:-2),
    // 用户看到的就是「选了文字但看不见选中颜色」。
    backgroundColor: "transparent",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--axv-code-cur-bg, rgba(11, 95, 165, 0.08))",
    color: "var(--axv-on-surface)",
  },
  // M41:选区颜色。注意 CodeMirror 自带主题里有更高优先级的规则:
  //   .cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground { background: #D7D4F0 }
  // 所以光写 &.cm-focused .cm-selectionBackground 会被它压住(用户看到的淡紫就是它)。
  // 这里用相同/更高优先级的选择器覆盖,并用 background 简写(对方也是简写)。
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
  // M202：精确范围的波浪下划线（AIDE 风格）
  ".cm-diag-err": {
    textDecoration: "underline wavy rgba(220, 38, 38, 0.9)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  ".cm-diag-warn": {
    textDecoration: "underline wavy rgba(217, 119, 6, 0.9)",
    textDecorationSkipInk: "none",
    textUnderlineOffset: "3px",
    cursor: "pointer",
  },
  ".cm-warnline": {
    backgroundColor: "rgba(217, 119, 6, 0.07)",
    boxShadow: "inset 3px 0 0 rgba(217, 119, 6, 0.55)",
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

/* ===== M50:当前行背景独立成层 =====
 * 用户要的三层叠放(自下而上):当前行背景 > 选区背景 > 正文文字。
 * CM6 的选区层是 z-index:-2,而 .cm-activeLine 的 background 属于**内容层**,
 * 内容层永远压在负值层之上 → 行背景必定盖住选区。
 * 解法:行背景不再用行元素的 background,改成 scroller 里的一个绝对定位 div
 * (z-index:-4),文字留在内容层 → 三层自然成立,不需要牺牲文字可读性。
 */
const cmCurLineBg = ViewPlugin.fromClass(
  class {
    dom: HTMLElement;
    view: EditorView;
    key = {};
    constructor(view: EditorView) {
      this.view = view;
      this.dom = document.createElement("div");
      this.dom.className = "cm-curline-hl";
      this.dom.setAttribute("aria-hidden", "true");
      view.scrollDOM.insertBefore(this.dom, view.scrollDOM.firstChild);
      this.sync();
    }
    update(u: ViewUpdate) {
      if (u.selectionSet || u.docChanged || u.viewportChanged || u.geometryChanged) this.sync();
    }
    /** 用 requestMeasure:行块坐标是异步测量的,直接读会拿到旧值(滚动/换行时跳位) */
    sync() {
      this.view.requestMeasure({
        key: this.key,
        read: (v) => {
          const b = v.lineBlockAt(v.state.selection.main.head);
          // 行块坐标是相对内容盒的,但 .cm-content 自己有 padding-top(本项目 12px),
          // 我们的层挂在 scroller 上 → 必须补上这段,否则整块背景会往上偏一行。
          const padTop = parseFloat(getComputedStyle(v.contentDOM).paddingTop) || 0;
          // M90:宽度按「最长行」填(contentDOM 实际宽度 = 最长行),
          // 而不是按可视区宽度(scroller clientWidth)--长行滚动时高亮不能中途断掉。
          // 同时至少铺满可视区(max),否则短文件时右边会缺一截。
          const contentEl = v.contentDOM;
          const contentW = contentEl.offsetLeft + contentEl.offsetWidth;
          const viewW = v.scrollDOM.clientWidth;
          return { top: b.top + padTop, height: b.height, width: Math.max(viewW, contentW) };
        },
        write: (m) => {
          this.dom.style.transform = `translateY(${m.top}px)`;
          this.dom.style.height = `${m.height}px`;
          this.dom.style.width = `${m.width}px`;
        },
      });
    }
    destroy() {
      this.dom.remove();
    }
  },
);

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
  onFixAll,
  onFixOne,
  lang = "xml",
  indent = 4,
  resNames,
  onRefClick,
  hoverTip,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  /** M96:候选列表按语言分流(xml 走标签/属性,java 走关键字/类/方法) */
  const langRef = useRef(lang);
  langRef.current = lang;
  /** M40:缩进宽度(indentUnit + tabSize)单独一个 compartment,改设置即时生效 */
  const indentComp = useRef(new Compartment());
  // M209：显示空白字符开关
  const wsComp = useRef(new Compartment());
  const [showWs, setShowWs] = useState(false);
  /** 回调放进 ref:view 只建一次,避免每次 render 重建 */
  const onChangeRef = useRef(onChange);
  const onCursorLineRef = useRef(onCursorLine);
  const onRefClickRef = useRef(onRefClick);
  const hoverTipRef = useRef(hoverTip);
  onChangeRef.current = onChange;
  /** M202：ref 包装，供 view 创建 effect 使用 */
  const diagClickRef = useRef<((e: MouseEvent) => void) | null>(null);
  onCursorLineRef.current = onCursorLine;
  onRefClickRef.current = onRefClick;
  hoverTipRef.current = hoverTip;
  /** M57:最后一次由编辑器自身发出的文本--父层防抖回灌同一个值时据此跳过,避免"冲掉刚输入的字" */
  const lastEmittedRef = useRef<string | null>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hitIdx, setHitIdx] = useState(0);
  // M209：替换（展开第二行输入 + 替换/全部替换）
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [replaceText, setReplaceText] = useState("");
  const findRef = useRef<HTMLInputElement | null>(null);

  /* ===== M45:输入关键词检索弹窗 ===== */
  const [sug, setSug] = useState<SugState | null>(null);
  const sugRef = useRef<SugState | null>(null);
  const setSugBoth = useCallback((v: SugState | null) => {
    sugRef.current = v;
    setSug(v);
  }, []);
  /** 刚接受过一次(此时不要再弹,否则回车确认后立刻又弹出来) */
  const lastAcceptRef = useRef(0);
  const sugTimer = useRef<number | null>(null);
  /**
   * M98:候选弹窗的「按下→抬起」追踪。
   * 以前 pointerdown 直接确认,结果:
   *   1 手机上想滑列表,一按就把第一个词填进去了;
   *   2 pointerdown 里 preventDefault 把 touch 滚动也一起拦了,列表根本滑不动。
   * 现在:按下只记位置,抬起时「同一项 + 没怎么动 + 没滚动过」才算点击。
   */
  const pressRef = useRef<{ i: number; x: number; y: number; top: number } | null>(null);
  const resNamesRef = useRef<string[] | undefined>(resNames);
  resNamesRef.current = resNames;

  const errLines = useMemo(() => {
    const m = new Map<number, string>();
    for (const e of errors || []) {
      if (e.level !== "error") continue;
      if (!m.has(e.line)) m.set(e.line, e.message);
    }
    return m;
  }, [errors]);

  /* M202：把 errors 转成 Map<line, DiagInfo>（保留 col/len/sev/fix，供精确下划线 + 行号槽 + 问题卡片） */
  const diagMap = useMemo(() => {
    const m = new Map<number, DiagInfo>();
    for (const e of errors || []) {
      const d: DiagInfo = {
        line: e.line,
        sev: e.level,
        msg: e.message,
      };
      if (e.col !== undefined) d.col = e.col;
      if (e.len !== undefined) d.len = e.len;
      if (e.fix) d.fix = e.fix;
      if (e.code) d.code = e.code;
      // 同一行多条：error 优先，其次取第一条
      const prev = m.get(e.line);
      if (!prev || (prev.sev === "warn" && e.level === "error")) {
        m.set(e.line, d);
      }
    }
    return m;
  }, [errors]);

  /* M209：把「哪行可修」喂给行号槽灯泡（fixGutter 的 markers 读它） */
  useEffect(() => {
    const m = new Map<number, LintIssue>();
    for (const e of errors || []) {
      if (e.fix && !m.has(e.line)) m.set(e.line, e);
    }
    fixIssuesByLineRef.current = m;
  }, [errors]);

  const insertSnippet = useCallback((insert: string, back = 0) => {
    const v = viewRef.current;
    if (!v) return;
    const sel = v.state.selection.main;
    const pos = sel.from + insert.length - back;
    // M76:一次 dispatch 完成(两次会变成两步撤销)
    v.dispatch({
      changes: { from: sel.from, to: sel.to, insert },
      selection: { anchor: pos },
      userEvent: "input",
    });
    v.focus();
  }, []);

  /** M76:输入法是否在组合中(此时按键/候选一律让路) */
  const composing = useCallback(() => !!viewRef.current?.composing, []);

  /* ===== M45:算候选 + 算光标坐标 → 定位弹窗 ===== */
  const refreshSuggest = useCallback(() => {
    const v = viewRef.current;
    const body = bodyRef.current;
    if (!v || !body) return;
    // 刚接受过:不再弹(否则回车确认后马上又弹一个)
    if (Date.now() - lastAcceptRef.current < 160) return;

    // M76:组合中不弹(拼音还没落字,弹出来挡住输入法候选条)
    if (v.composing) {
      setSugBoth(null);
      return;
    }
    const sel = v.state.selection.main;
    if (!sel.empty) {
      setSugBoth(null);
      return;
    }
    const head = sel.head;
    const line = v.state.doc.lineAt(head);
    const col = head - line.from + 1;
    const ctx =
      langRef.current === "java"
        ? computeJavaSuggest(v.state.doc.toString(), { line: line.number, col })
        : computeSuggest(v.state.doc.toString(), { line: line.number, col }, resNamesRef.current);
    if (!ctx) {
      setSugBoth(null);
      return;
    }
    // 光标后面还有词字符 → 不弹(免得替掉后面的字)
    const rest = line.text.slice(col - 1);
    if (/^[A-Za-z0-9_.:@#+\/-]/.test(rest)) {
      setSugBoth(null);
      return;
    }

    const coords = v.coordsAtPos(head);
    if (!coords) {
      setSugBoth(null);
      return;
    }
    const rect = body.getBoundingClientRect();
    const size = estimateSuggestSize(ctx.items);
    const placement = placeSuggest(
      {
        left: coords.left - rect.left,
        right: coords.right - rect.left,
        top: coords.top - rect.top,
        bottom: coords.bottom - rect.top,
      },
      size,
      { width: rect.width, height: rect.height },
    );
    setSugBoth({
      items: ctx.items,
      sel: 0,
      kind: ctx.kind,
      kinds: ctx.kinds,
      prefix: ctx.prefix,
      placement,
      width: size.width,
    });
  }, [setSugBoth]);

  /** 防抖:连续打字时不要每个键都算一遍 */
  const scheduleSuggest = useCallback(() => {
    if (sugTimer.current !== null) window.clearTimeout(sugTimer.current);
    sugTimer.current = window.setTimeout(() => {
      sugTimer.current = null;
      refreshSuggest();
    }, 90);
  }, [refreshSuggest]);

  /* ===== M45:接受候选(用 item 替掉光标左边的 prefix) ===== */
  const acceptSuggest = useCallback(
    (idx: number) => {
      const v = viewRef.current;
      const s = sugRef.current;
      if (!v || !s) return;
      const item = s.items[idx];
      if (item === undefined) return;
      const head = v.state.selection.main.head;
      const from = Math.max(0, head - s.prefix.length);
      lastAcceptRef.current = Date.now();
      setSugBoth(null);
      v.dispatch({
        changes: { from, to: head, insert: item },
        selection: { anchor: from + item.length },
        userEvent: "input.complete",
      });
      v.focus();
    },
    [setSugBoth],
  );

  /** 弹窗内上下移动 / 关闭 */
  const moveSel = useCallback(
    (delta: number) => {
      const s = sugRef.current;
      if (!s || s.items.length === 0) return false;
      const n = (s.sel + delta + s.items.length) % s.items.length;
      setSugBoth({ ...s, sel: n });
      return true;
    },
    [setSugBoth],
  );

  /** M98:按下:只记录,不确认
   *  * 保留焦点:不对指针事件 preventDefault -- 一 preventDefault,触屏滑动就被吃掉了
   *  * 用 pressRef 告诉 blur 处理器「现在是在弹窗上按,先别关」
   */
  const onSugDown = useCallback(
    (i: number, e: React.PointerEvent<HTMLDivElement>) => {
      // 鼠标:拦掉默认行为,保住编辑器焦点(鼠标不需要滑列表,滚轮不受影响)
      // 触屏 / 手写笔:不能拦,一拦手势滑动就被吃掉
      if (e.pointerType === "mouse") e.preventDefault();
      const list = (e.currentTarget.parentElement as HTMLElement | null) ?? e.currentTarget;
      pressRef.current = { i, x: e.clientX, y: e.clientY, top: list.scrollTop };
      if (sugRef.current && sugRef.current.sel !== i) setSugBoth({ ...sugRef.current, sel: i });
    },
    [setSugBoth],
  );

  /** M98:抬起:同一项 + 位移 < 10px + 没滚动过 → 才算点击 */
  const onSugUp = useCallback(
    (i: number, e: React.PointerEvent<HTMLDivElement>) => {
      const press = pressRef.current;
      pressRef.current = null;
      if (!press || press.i !== i) return;
      const moved = Math.abs(e.clientX - press.x) + Math.abs(e.clientY - press.y);
      const list = (e.currentTarget.parentElement as HTMLElement | null) ?? e.currentTarget;
      const scrolled = Math.abs(list.scrollTop - press.top) > 2;
      if (moved > 10 || scrolled) return; // 是在滑列表,不是选词
      acceptSuggest(i);
    },
    [acceptSuggest],
  );

  /** M98:取消 / 滑动 / 滚出屏幕 → 丢弃这次按下 */
  const cancelPress = useCallback(() => {
    pressRef.current = null;
  }, []);

  /* ===== 建视图(只一次) ===== */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        // M209：行号左边多一列「可修复」灯泡槽
        fixGutter,
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        // M209：代码折叠（XML 嵌套 / Java 方法体）
        foldGutter(),
        // M209：选中一个词，全文件同名出现处高亮
        highlightSelectionMatches({ minSelectionLength: 2, highlightWordAroundCursor: false }),
        // M209：显示空白字符开关
        wsComp.current.of(
          showWs
            ? [highlightWhitespace(), highlightTrailingWhitespace()]
            : [],
        ),
        // M209：悬停提示——光标落在已知 token（资源/方法/变量）上，父层给提示就弹
        hoverTooltip((view) => {
          const fn = hoverTipRef.current;
          if (!fn) return null;
          const { state } = view;
          const head = state.selection.main.head;
          const line = state.doc.lineAt(head);
          const text = line.text;
          const col = head - line.from;
          // 资源引用：@drawable/xxx | R.type.xxx
          const atRef = text.match(/@\w+\s*\/\s*\w+/g);
          let raw: string | null = null;
          if (atRef) {
            for (const m of atRef) {
              const i = text.indexOf(m);
              if (i <= col && col < i + m.length) {
                raw = m;
                break;
              }
            }
          }
          // R.type.name
          if (!raw) {
            const rRef = text.match(/R\.\w+\.\w+/g);
            if (rRef) {
              for (const m of rRef) {
                const i = text.indexOf(m);
                if (i <= col && col < i + m.length) {
                  raw = m;
                  break;
                }
              }
            }
          }
          // 裸标识符（方法名 / 变量名）
          if (!raw) {
            const idm = /[A-Za-z_]\w*/.exec(text.slice(col).trimStart())?.[0];
            if (idm && idm.length >= 3) raw = idm;
          }
          if (!raw) return null;
          const tip = fn(raw);
          if (!tip) return null;
          return {
            pos: head,
            above: true,
            create() {
              const dom = document.createElement("div");
              dom.className = "axv-hover-tip";
              dom.textContent = tip;
              return { dom };
            },
          };
        }, {hoverTime: 400}),
        // M139:不装 CM6 自带的 history -- 撤销栈统一由 XmlEditor 的 diffHistory 管
        // (原因:外部回灌 value 时 CM6 会把「整篇替换」也当作一步撤销,
        //   和工具栏/画布的撤销互相覆盖,表现为按一次 Ctrl+Z 倒退两步)
        drawSelection(),
        dropCursor(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        cmCurLineBg,
        indentOnInput(),
        bracketMatching(),
        // M76:引号/括号自动配对(之前没有,XML 里写属性得自己敲两遍引号)
        closeBrackets(),
        // M76:打 <TextView 回车时自动补 </TextView>(只对 XML 生效,java 文件里是空操作)
        autoCloseTags,
        indentComp.current.of([
          indentUnit.of(" ".repeat(indent)),
          EditorState.tabSize.of(indent),
        ]),
        syntaxHighlighting(cmHl),
        cmTheme,
        fontTheme,
        errLineField,
        // M202：精确错误装饰（波浪下划线，整行无列号时退回行标色）
        diagField,
        // M45:候选列表开着时抢下方向键/回车/取消,未开时完全透明
        Prec.highest(
          keymap.of([
            {
              key: "ArrowDown",
              run: () => (composing() ? false : moveSel(1)),
            },
            {
              key: "ArrowUp",
              run: () => (composing() ? false : moveSel(-1)),
            },
            {
              key: "Enter",
              run: () => {
                // M76:中文/日文输入法组合中,回车是「确认候选词」,不能拿来接受建议
                if (composing()) return false;
                const s = sugRef.current;
                if (!s) return false;
                acceptSuggest(s.sel);
                return true;
              },
            },
            {
              key: "Tab",
              run: () => {
                if (composing()) return false;
                const s = sugRef.current;
                if (!s) return false;
                acceptSuggest(s.sel);
                return true;
              },
            },
            {
              key: "Escape",
              run: () => {
                if (composing()) return false;
                if (!sugRef.current) return false;
                setSugBoth(null);
                return true;
              },
            },
          ]),
        ),
        keymap.of([
          // M209：折叠快捷键（Mod-Alt-[ / ]）
          ...foldKeymap,
          {
            key: "Mod-f",
            run: () => {
              setFindOpen(true);
              window.setTimeout(() => findRef.current?.focus(), 0);
              return true;
            },
          },
          // M40:回车 = 换行 + 按语法自动缩进(放在 defaultKeymap 前,保证优先)
          { key: "Enter", run: insertNewlineAndIndent },
          // 配对的右括号/右引号要能被 Backspace 一次吃掉
          ...closeBracketsKeymap,
          ...defaultKeymap,
          // M139:historyKeymap 一并去掉,Ctrl+Z / Ctrl+Shift+Z 冒泡到 window 交给 app 撤销栈
          indentWithTab,
        ]),
        EditorView.contentAttributes.of({
          autocapitalize: "off",
          autocorrect: "off",
          spellcheck: "false",
        }),
        langComp.current.of(langExt(lang)),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const s = u.state.doc.toString();
            // M57:记下「本次变更是我自己发出的」,父层回灌同一个 value 时不要回写
            lastEmittedRef.current = s;
            onChangeRef.current(s);
          }
          if (u.selectionSet || u.docChanged) {
            const head = u.state.selection.main.head;
            onCursorLineRef.current?.(u.state.doc.lineAt(head).number);
          }
          // M45:光标/内容变了重算候选(防抖)
          if (u.docChanged || u.selectionSet) scheduleSuggest();
        }),
        // M45:失焦就关(M98:在弹窗上按住时不关,等 pointerup 再决定)
        EditorView.domEventHandlers({
          // M101:Ctrl/Cmd + 点击资源引用 → 跳定义 / 查引用(画布以外最快的一条导航路线)
          mousedown: (e, view) => {
            // M114:刚点过候选词(弹窗已消失)→ 吞掉这次 mousedown,
            // 否则触屏的兼容鼠标事件会落到下面的代码区,把光标跳到点击位置(表现为「选了 a 却跳到 12 行」)
            if (Date.now() - lastAcceptRef.current < 350) {
              e.preventDefault();
              return true;
            }
            if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return false;
            const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
            if (pos == null) return false;
            const t = tokenAt(view.state.doc.toString(), pos);
            if (!t) return false;
            e.preventDefault();
            onRefClickRef.current?.(t.raw);
            return true;
          },
          blur: () => {
            if (pressRef.current) return false;
            setSugBoth(null);
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;
    // M45:滚动就关(光标坐标靠的是当前视口,滚走了就对不上了)
    const onScroll = () => setSugBoth(null);
    view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });
    // M202：点错误区域（cm-diag-err / cm-diag-warn）→ 弹问题卡片（用 ref 避免 hoisting 问题）
    const onClick = (e: MouseEvent) => diagClickRef.current?.(e);
    view.contentDOM.addEventListener("click", onClick);
    return () => {
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.contentDOM.removeEventListener("click", onClick);
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ===== 外部 value 变化(撤销/重做/格式化/切文件)→ 写进编辑器 ===== */
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    // M57:父层现在防抖回灌(打字时 value 可能暂时比文档旧)--
    // 只要是「我自己刚发出去的」就一律跳过,否则会把用户刚输入的字符冲掉
    if (value === lastEmittedRef.current) return;
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

  /* ===== M209：显示空白开关 ===== */
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({
      effects: wsComp.current.reconfigure(
        showWs
          ? [highlightWhitespace(), highlightTrailingWhitespace()]
          : [],
      ),
    });
  }, [showWs]);

  /* ===== M40:缩进宽度变化(设置面板里改) ===== */
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

  /* ===== M202：精确错误装饰（波浪下划线 + 行号槽红/黄点 + 问题卡片） ===== */
  useEffect(() => {
    const v = viewRef.current;
    if (!v) return;
    v.dispatch({ effects: [setErrLines.of(errLines), setDiags.of(diagMap)] });
  }, [errLines, diagMap]);

  /* ===== 跳转行(画布点选 / 报错定位) ===== */
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
    // focusTick 变化才重新跳(同一行二次点击也要生效)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTick]);

  /* ===== 查找(自带一套,不引 @codemirror/search 面板) ===== */
  const hits = useMemo(() => {
    const v = viewRef.current;
    // M76:优先用编辑器里的实时文本 -- 父层 value 有 250ms 防抖,
    // 拿旧文本算出来的偏移去 dispatch,会跳到错的位置(甚至越界)
    return findAllIn(v ? v.state.doc.toString() : value, query);
  }, [query, value]);

  const gotoHit = useCallback(
    (idx: number, focusEditor = false) => {
      const v = viewRef.current;
      if (!v) return;
      const list = findAllIn(v.state.doc.toString(), query);
      if (list.length === 0) {
        setHitIdx(0);
        return;
      }
      const n = ((idx % list.length) + list.length) % list.length;
      setHitIdx(n);
      const h = list[n];
      v.dispatch({
        selection: { anchor: h.from, head: h.to },
        effects: EditorView.scrollIntoView(h.from, { y: "center" }),
      });
      // M76:从查找框/按钮点进来时不要把焦点抢回编辑器 --
      // 抢了之后焦点离开输入框,再按 Enter 就变成正文里换行,而且手机上会弹键盘
      if (focusEditor) v.focus();
    },
    [query],
  );

  const firstErr = useMemo(() => {
    const list = (errors || []).filter((e) => e.level === "error");
    return list[0] || null;
  }, [errors]);

  // M209：替换当前命中（从后往前改偏移才不会错）
  const replaceCurrent = useCallback(() => {
    const v = viewRef.current;
    if (!v || !query.trim()) return;
    const list = findAllIn(v.state.doc.toString(), query);
    if (!list.length) return;
    const n = ((hitIdx % list.length) + list.length) % list.length;
    const h = list[n];
    v.dispatch({
      changes: { from: h.from, to: h.to, insert: replaceText },
      selection: { anchor: h.from + replaceText.length },
      scrollIntoView: true,
    });
    // 替换后重新定位到同一位置的下一个命中
    setHitIdx(n);
  }, [query, replaceText, hitIdx]);

  // M209：全部替换
  const replaceAll = useCallback(() => {
    const v = viewRef.current;
    if (!v || !query.trim()) return;
    const list = findAllIn(v.state.doc.toString(), query);
    if (!list.length) return;
    // 一次 dispatch（单个事务、可一次撤销）
    v.dispatch({
      changes: list.map((h) => ({ from: h.from, to: h.to, insert: replaceText })),
    });
    setHitIdx(0);
  }, [query, replaceText]);

  /** M185b:点错误条跳到对应行(编辑器内部定位) */
  const jumpToLine = useCallback((n: number) => {
    const v = viewRef.current;
    if (!v || !n || n < 1) return;
    const line = v.state.doc.line(Math.min(n, v.state.doc.lines));
    v.dispatch({
      selection: { anchor: line.from, head: line.to },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    v.focus();
  }, []);

  /** M179:可自动修复的问题数量(带 fix 的) */
  const fixCount = useMemo(() => (errors || []).filter((e) => e.fix).length, [errors]);
  const fixTitle = useMemo(() => {
    const list = (errors || []).filter((e) => e.fix).slice(0, 4);
    const head = list.map((e) => e.fix!.label).join("  |  ");
    return fixCount > 4 ? `${head}  ...+${fixCount - 4}` : head;
  }, [errors, fixCount]);

  /* M202：问题卡片 + 上/下一条导航 */
  const [diagIdx, setDiagIdx] = useState(-1); // 当前选中的问题（-1 = 没选，不弹卡片）
  /* M207：只看错误 —— 把 warn 级（风格建议）从错误条/卡片里隐藏，降低误报感知 */
  const [onlyErr, setOnlyErr] = useState(false);
  const shownErrors = useMemo(
    () => (onlyErr ? (errors || []).filter((e) => e.level === "error") : errors || []),
    [errors, onlyErr],
  );
  const curDiag = diagIdx >= 0 && diagIdx < shownErrors.length ? shownErrors[diagIdx] : null;

  /** M202：跳到某条问题（设 diagIdx + 滚到那一行） */
  const gotoDiag = useCallback(
    (idx: number) => {
      if (!errors || !errors.length) return;
      const len = errors.length;
      // 负数（含从 -1 往前）→ 最后一条；否则取模循环
      const n = idx < 0 ? len - 1 : ((idx % len) + len) % len;
      setDiagIdx(n);
      const e = errors[n];
      if (e && e.line) jumpToLine(e.line);
    },
    [errors, jumpToLine],
  );

  /** M202：点错误区域 → 弹问题卡片 */
  const handleDiagClick = useCallback(
    (e: MouseEvent) => {
      // 只有点在 cm-diag-err / cm-diag-warn 上才算
      const target = e.target as HTMLElement;
      const cls = target.className || "";
      if (!cls.includes("cm-diag-err") && !cls.includes("cm-diag-warn")) return;
      // 找对应的 line：从标题或 data 属性读
      const title = target.getAttribute("title") || "";
      const idx = (errors || []).findIndex((x) => x.message === title);
      if (idx >= 0) setDiagIdx(idx);
    },
    [errors],
  );
  /** M202：ref 包装（已在上方声明） */
  diagClickRef.current = (e: MouseEvent) => handleDiagClick(e);

  return (
    <div className={"axv-code" + (className ? " " + className : "")}>
      <div className="axv-code-body" ref={bodyRef}>
        <div className="axv-cm" ref={hostRef} />
        {sug ? (
          <div
            className="axv-sug"
            role="listbox"
            aria-label={tt("关键词提示")}
            style={{
              left: sug.placement.left,
              top: sug.placement.top,
              width: sug.width,
              maxHeight: sug.placement.maxHeight,
            }}
            data-placement={sug.placement.placement}
            // M114:栏住兼容鼠标事件,避免点击透传到下面的代码区
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            // M98:列表自己滚动(手指滑列表不能选中);滚过就不再算点击
            onScroll={cancelPress}
            onPointerCancel={cancelPress}
            onPointerLeave={cancelPress}
          >
            {sug.items.map((it, i) => {
              // M99:每条自带分类,角标单字(声/类/方/变/常/引/属)
              const k = sug.kinds?.[i] ?? sug.kind;
              return (
              <div
                key={it}
                className={"axv-sug-item" + (i === sug.sel ? " sel" : "")}
                role="option"
                aria-selected={i === sug.sel}
                title={it}
                onPointerDown={(e) => onSugDown(i, e)}
                onPointerUp={(e) => onSugUp(i, e)}
                onPointerCancel={cancelPress}
                onMouseEnter={() => {
                  // 触屏按下时也会派 mouseenter,别让它抢掉滚动
                  if (pressRef.current) return;
                  if (sugRef.current && sugRef.current.sel !== i) {
                    setSugBoth({ ...sugRef.current, sel: i });
                  }
                }}
              >
                <span className="axv-sug-text">{it}</span>
                <span className={"axv-sug-kind is-" + k} title={KIND_NAME[k]}>
                  {KIND_LABEL[k]}
                </span>
              </div>
              );
            })}
          </div>
        ) : null}
        {findOpen ? (
          <div className="axv-find" role="search">
            <input
              ref={findRef}
              className="axv-find-input"
              value={query}
              placeholder={tt("在当前文件里查找")}
              aria-label={tt("查找")}
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
              {hits.length === 0
                ? query.trim()
                  ? tt("无匹配")
                  : ""
                : `${Math.min(hitIdx + 1, hits.length)}/${hits.length}`}
            </span>
            <button
              type="button"
              className="axv-find-btn"
              title={tt("上一个(Shift+Enter)")}
              aria-label={tt("上一个")}
              disabled={hits.length === 0}
              onClick={() => gotoHit(hitIdx - 1)}
            >
              <span className="msr" aria-hidden="true">keyboard_arrow_up</span>
            </button>
            <button
              type="button"
              className="axv-find-btn"
              title={tt("下一个(Enter)")}
              aria-label={tt("下一个")}
              disabled={hits.length === 0}
              onClick={() => gotoHit(hitIdx + 1)}
            >
              <span className="msr" aria-hidden="true">keyboard_arrow_down</span>
            </button>
            <button
              type="button"
              className={"axv-find-btn" + (replaceOpen ? " is-on" : "")}
              title={tt("替换")}
              aria-label={tt("替换")}
              aria-pressed={replaceOpen}
              onClick={() => {
                setReplaceOpen((o) => !o);
                setFindOpen(true);
              }}
            >
              <span className="msr" aria-hidden="true">find_replace</span>
            </button>
            <button
              type="button"
              className={"axv-find-btn" + (showWs ? " is-on" : "")}
              title={tt("显示/隐藏空白字符")}
              aria-label={tt("显示/隐藏空白字符")}
              aria-pressed={showWs}
              onClick={() => setShowWs((w) => !w)}
            >
              <span className="msr" aria-hidden="true">format_indent_increase</span>
            </button>
            <button
              type="button"
              className="axv-find-btn"
              title={tt("关闭(Esc)")}
              aria-label={tt("关闭查找")}
              onClick={() => {
                setFindOpen(false);
                setReplaceOpen(false);
                viewRef.current?.focus();
              }}
            >
              <span className="msr" aria-hidden="true">close</span>
            </button>
          </div>
        ) : null}
        {findOpen && replaceOpen ? (
          <div className="axv-find axv-find-rep" role="group" aria-label={tt("替换")}>
            <input
              className="axv-find-input"
              value={replaceText}
              placeholder={tt("替换为")}
              aria-label={tt("替换为")}
              onChange={(e) => setReplaceText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  replaceCurrent();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setReplaceOpen(false);
                  viewRef.current?.focus();
                }
              }}
            />
            <button
              type="button"
              className="axv-find-btn axv-find-repbtn"
              title={tt("替换当前")}
              aria-label={tt("替换当前")}
              disabled={hits.length === 0}
              onClick={replaceCurrent}
            >
              {tt("替换")}
            </button>
            <button
              type="button"
              className="axv-find-btn axv-find-repbtn"
              title={tt("全部替换")}
              aria-label={tt("全部替换")}
              disabled={hits.length === 0}
              onClick={replaceAll}
            >
              {tt("全部")}
            </button>
          </div>
        ) : null}
      </div>

      {(firstErr || fixCount > 0 || (shownErrors && shownErrors.length > 0)) && (
        <div className="axv-diagbar-wrap">
          <div
            className={"axv-code-errbar" + (firstErr ? " axv-errbar-jump" : "")}
            onClick={() => {
              // M202：点错误条 → 打开问题卡片（优先第一条 error，否则第一条）
              if (!shownErrors.length) return;
              const i = firstErr ? shownErrors.findIndex((e) => e === firstErr) : 0;
              gotoDiag(i < 0 ? 0 : i);
            }}
            title={tt("点击查看问题详情")}
            role="button"
            style={
              firstErr
                ? undefined
                : {
                    background: "color-mix(in srgb, var(--axv-warn, #d97706) 14%, var(--axv-surface))",
                    borderTopColor: "var(--axv-warn, #d97706)",
                    color: "var(--axv-on-surface)",
                  }
            }
          >
            <span className="axv-err-dot" aria-hidden="true" style={firstErr ? undefined : { background: "var(--axv-warn, #d97706)" }} />
            <span className="axv-err-text">
              {curDiag
                ? tt("第 {n} 行 · {msg}", { n: curDiag.line, msg: curDiag.message })
                : firstErr
                  ? tt("第 {n} 行 · {msg}", { n: firstErr.line, msg: firstErr.message })
                  : fixCount > 0
                    ? tt("有 {n} 处可自动修复", { n: fixCount })
                    : tt("共 {n} 处问题", { n: shownErrors.length })}
              {shownErrors.length > 1 ? tt(" (共 {n} 处)", { n: shownErrors.length }) : ""}
            </span>
            {/* M202：上/下一条导航 */}
            {shownErrors.length > 1 ? (
              <span className="axv-diag-nav" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="axv-diag-navbtn"
                  title={tt("上一处")}
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onClick={() => gotoDiag(diagIdx - 1)}
                >
                  <span className="msr" aria-hidden="true">keyboard_arrow_up</span>
                </button>
                <span className="axv-diag-count">
                  {diagIdx < 0 ? "—" : Math.min(diagIdx + 1, shownErrors.length)}/{shownErrors.length}
                </span>
                <button
                  type="button"
                  className="axv-diag-navbtn"
                  title={tt("下一处")}
                  onMouseDown={(e) => e.preventDefault()}
                  onTouchStart={(e) => e.preventDefault()}
                  onClick={() => gotoDiag(diagIdx + 1)}
                >
                  <span className="msr" aria-hidden="true">keyboard_arrow_down</span>
                </button>
              </span>
            ) : null}
            {onFixAll && fixCount > 0 ? (
              <button
                type="button"
                className="axv-err-fix"
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => e.preventDefault()}
                onClick={onFixAll}
                title={fixTitle}
              >
                <span className="msr" aria-hidden="true">build</span>
                {tt("修复 {n} 处", { n: fixCount })}
              </button>
            ) : null}
            {/* M207：只看错误（从错误条/卡片里隐藏 warn 级风格建议） */}
            {errors && errors.some((e) => e.level === "warn") ? (
              <button
                type="button"
                className={"axv-errbar-only" + (onlyErr ? " axv-errbar-only-on" : "")}
                title={tt("隐藏「注意」级提示，只看「错误」")}
                onMouseDown={(e) => e.preventDefault()}
                onTouchStart={(e) => e.preventDefault()}
                onClick={() => setOnlyErr((v) => !v)}
              >
                <span className="msr" aria-hidden="true">{onlyErr ? "visibility" : "visibility_off"}</span>
                {tt("只看错误")}
              </button>
            ) : null}
          </div>

          {/* M202：问题卡片（点错误区域或行号槽弹出） */}
          {curDiag ? (() => {
            const hint = codeHint(curDiag.code, curDiag.message);
            // 合并修复：卡片自带 fix 优先，否则用 hint.fix 拼一个
            const mergedFix =
              curDiag.fix ??
              (hint?.fix
                ? { from: hint.fix.from, to: hint.fix.to, label: `${hint.fix.from} → ${hint.fix.to}` }
                : undefined);
            const diagForFix = mergedFix ? { ...curDiag, fix: mergedFix } : curDiag;
            return (
            <div className="axv-diagcard" role="dialog" aria-label={tt("问题详情")}>
              <div className="axv-diagcard-head">
                <span className={"axv-diagcard-sev axv-diagcard-sev-" + (curDiag.level === "error" ? "err" : "warn")}>
                  {curDiag.level === "error" ? tt("错误") : tt("注意")}
                </span>
                <span className="axv-diagcard-title">{curDiag.message}</span>
              </div>
              {hint ? (
                <div className="axv-diagcard-why">
                  <div className="axv-diagcard-whyrow">
                    <span className="axv-diagcard-label">{tt("为什么报")}</span>
                    <span className="axv-diagcard-body">{hint.why}</span>
                  </div>
                  <div className="axv-diagcard-whyrow">
                    <span className="axv-diagcard-label">{tt("怎么改")}</span>
                    <span className="axv-diagcard-body">{hint.how}</span>
                  </div>
                </div>
              ) : null}
              {mergedFix && onFixOne ? (
                <div className="axv-diagcard-actions">
                  <button
                    type="button"
                    className="axv-diagcard-fix"
                    onClick={() => onFixOne(diagForFix)}
                  >
                    <span className="msr" aria-hidden="true">build</span>
                    {tt("应用此修复")}
                  </button>
                </div>
              ) : null}
              <button
                type="button"
                className="axv-diagcard-close"
                onClick={() => setDiagIdx(-1)}
                title={tt("关闭")}
              >
                <span className="msr" aria-hidden="true">close</span>
              </button>
            </div>
            );
          })() : null}
        </div>
      )}

      <div className="axv-sym-bar" role="toolbar" aria-label={tt("常用符号")}>
        {onFormat ? (
          <button
            type="button"
            className="axv-sym-btn axv-sym-action"
            title={tt("重排缩进(保留注释)")}
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={onFormat}
          >
            <span className="msr" aria-hidden="true">format_align_left</span>
          </button>
        ) : null}
        {(lang === "java" ? JAVA_SYMBOLS : SYMBOLS).map((s) => (
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
