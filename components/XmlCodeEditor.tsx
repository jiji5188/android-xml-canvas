// components/XmlCodeEditor.tsx — 带语法高亮 + 行号 + 错误行标注的 XML 编辑器
// 实现：透明文字的 textarea 叠在高亮后的 <pre> 上，滚动/尺寸完全同步。
// 不引第三方编辑器，保持零依赖、体积小。

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LintIssue } from "@/lib/xml/lint";

/** 行高（必须与 xml-canvas.css 里 .axv-code-hl/.axv-ln 的 line-height 一致） */
const CODE_LINE_HEIGHT = 21;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 把 XML 源码切成带 class 的 span（前缀 x- 避免与 M3E 样式冲突） */
export function highlightXml(src: string): string {
  const out: string[] = [];
  let i = 0;
  const push = (cls: string | null, text: string) => {
    out.push(cls ? `<span class="x-${cls}">${esc(text)}</span>` : esc(text));
  };

  while (i < src.length) {
    // 注释
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i);
      const end = e === -1 ? src.length : e + 3;
      push("c", src.slice(i, end));
      i = end;
      continue;
    }
    // XML 声明 / PI
    if (src.startsWith("<?", i)) {
      const e = src.indexOf("?>", i);
      const end = e === -1 ? src.length : e + 2;
      push("m", src.slice(i, end));
      i = end;
      continue;
    }
    if (src[i] === "<") {
      const m = /^<\/?([A-Za-z_][\w.:-]*)/.exec(src.slice(i));
      if (m) {
        push("p", m[0]);
        i += m[0].length;
        // 属性区
        while (i < src.length && src[i] !== ">") {
          const am = /^([A-Za-z_][\w.:-]*)(\s*=\s*)("[^"]*"|'[^']*')?/.exec(src.slice(i));
          if (am) {
            push("a", am[1]);
            if (am[2]) push(null, am[2]);
            if (am[3]) push("s", am[3]);
            i += am[0].length;
          } else {
            push("p", src[i]);
            i++;
          }
        }
        if (src[i] === ">") {
          push("p", ">");
          i++;
        }
        continue;
      }
    }
    // 普通文本
    const j = src.indexOf("<", i);
    // M22：indexOf 返回 i 时（如 "<<<" 不构成合法标签名）必须至少吃一个字符，
    // 否则 i 不前进 → 死循环 → out 无限增长 → RangeError: Invalid array length
    let end = j === -1 ? src.length : j;
    if (end <= i) end = i + 1;
    push(null, src.slice(i, end));
    i = end;
  }
  return out.join("");
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 结构检查结果（带行号），有错的行会在行号栏和正文里标红 */
  errors?: LintIssue[];
  /** 外层容器的额外类名 */
  className?: string;
  /** M2s：跳转到指定行（改变时滚动并选中该行） */
  focusLine?: number;
  /** 与 focusLine 配合的自增序号（同一行二次跳转也能生效） */
  focusTick?: number;
  /** M2y：光标所在行（1 基）变化时回调，用于代码 → 画布反跳选中对应节点 */
  onCursorLine?: (line: number) => void;
}

function lineFromCursor(ta: HTMLTextAreaElement): number {
  // 键盘移动光标后读选区起点；无选区时按当前行估算
  const before = ta.value.slice(0, ta.selectionStart ?? 0);
  return before.split("\n").length;
}

function lineFromEvent(ta: HTMLTextAreaElement, x: number, y: number): number {
  // 点击：用几何估算（与 CODE_LINE_HEIGHT 一致的行高）
  const rect = ta.getBoundingClientRect();
  const relY = y - rect.top + ta.scrollTop;
  return Math.max(1, Math.floor(relY / CODE_LINE_HEIGHT) + 1);
}

/** M30：常用符号/片段快捷插入（手机上打 < > " @ 和 @drawable/ 太痛苦） */
export const SYMBOLS: { label: string; insert: string; back?: number; title?: string }[] = [
  { label: "<", insert: "<", title: "小于号（开标签）" },
  { label: ">", insert: ">", title: "大于号（闭合标签）" },
  { label: "</", insert: "</", title: "闭标签开头" },
  { label: "/>", insert: "/>", title: "自闭合" },
  { label: "=", insert: "=", title: "等号" },
  { label: '""', insert: '""', back: 1, title: "双引号（光标落在中间）" },
  { label: "@", insert: "@", title: "资源引用" },
  { label: "#", insert: "#", title: "颜色值" },
  { label: ":", insert: ":", title: "命名空间分隔" },
  { label: "?attr/", insert: "?attr/", title: "主题属性引用" },
  { label: "&", insert: "&amp;", title: "转义的 &" },
  { label: "<!-- -->", insert: "<!--  -->", back: 4, title: "注释" },
  { label: "@+id/", insert: "@+id/", title: "新建 id" },
  { label: "@drawable/", insert: "@drawable/", title: "引用 drawable" },
  { label: "@string/", insert: "@string/", title: "引用字符串" },
  { label: "@color/", insert: "@color/", title: "引用颜色" },
  { label: "@dimen/", insert: "@dimen/", title: "引用尺寸" },
  { label: "match_parent", insert: "match_parent", title: "填满父容器" },
  { label: "wrap_content", insert: "wrap_content", title: "包裹内容" },
  { label: "dp", insert: "dp", title: "密度无关像素" },
  { label: "sp", insert: "sp", title: "字体尺寸单位" },
];

export function XmlCodeEditor({ value, onChange, errors, className, focusLine, focusTick, onCursorLine }: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutRef = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);

  // M6e：Ctrl/Cmd+F 查找
  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hitIdx, setHitIdx] = useState(0);
  const findRef = useRef<HTMLInputElement | null>(null);

  const sync = useCallback(() => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
    // 行号栏 / 错误色带跟随纵向滚动
    if (gutRef.current) gutRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
    if (bandRef.current) bandRef.current.style.transform = `translateY(${-ta.scrollTop}px)`;
  }, []);

  const lines = useMemo(() => {
    try {
      return value.split("\n").length;
    } catch {
      return 1;
    }
  }, [value]);

  /** M22：高亮 HTML 兜底 —— 畸形/超长 XML 也不许把编辑器搞崩 */
  const hlHtml = useMemo(() => {
    try {
      return highlightXml(value);
    } catch (e) {
      console.error("[axv] XML 高亮失败，退回纯文本", e);
      return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    }
  }, [value]);
  const errLines = useMemo(() => {
    const set = new Map<number, string>();
    for (const e of errors || []) {
      // M22：行号必须落在文件实际行范围内，坏数据直接跳过（否则色带/行号会画到负数坐标）
      if (!Number.isFinite(e.line) || e.line < 1 || e.line > lines) continue;
      if (!set.has(e.line)) set.set(e.line, e.message);
    }
    return set;
  }, [errors, lines]);
  const firstErr = errors && errors.length > 0 ? errors[0] : null;

  // M2t：wrap_content 等估算不参与；M6e：查找命中列表（不区分大小写，不重叠）
  const hits = useMemo(() => {
    const q = query.trim();
    if (!q) return [] as number[];
    const out: number[] = [];
    const hay = value.toLowerCase();
    const needle = q.toLowerCase();
    let at = hay.indexOf(needle);
    while (at !== -1) {
      out.push(at);
      at = hay.indexOf(needle, at + Math.max(1, needle.length));
      if (out.length > 5000) break;
    }
    return out;
  }, [value, query]);

  /** 跳到第 i 个命中：选中 + 滚到可视区（留 4 行余量） */
  const gotoHit = useCallback(
    (i: number) => {
      const ta = taRef.current;
      if (!ta || hits.length === 0) return;
      const idx = ((i % hits.length) + hits.length) % hits.length;
      const start = hits[idx];
      const end = start + query.trim().length;
      const line = value.slice(0, start).split("\n").length;
      ta.focus();
      ta.setSelectionRange(start, end);
      ta.scrollTop = Math.max(0, (line - 1) * CODE_LINE_HEIGHT - CODE_LINE_HEIGHT * 4);
      setHitIdx(idx);
    },
    [hits, query, value],
  );

  /** 打开查找条时：把光标处的词带进去（有选区的话） */
  const openFind = useCallback(() => {
    const ta = taRef.current;
    const sel = ta ? value.slice(ta.selectionStart ?? 0, ta.selectionEnd ?? 0) : "";
    if (sel && !sel.includes("\n") && sel.length <= 60) setQuery(sel);
    setFindOpen(true);
    window.setTimeout(() => findRef.current?.select(), 0);
  }, [value]);

  // query 变了：从第一个命中开始
  useEffect(() => {
    if (hits.length > 0) gotoHit(0);
    else setHitIdx(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  useEffect(() => {
    if (!focusLine || focusLine < 1) return;
    const ta = taRef.current;
    if (!ta) return;
    const lines = value.split("\n");
    let start = 0;
    for (let i = 0; i < focusLine - 1; i++) start += (lines[i]?.length ?? 0) + 1;
    const end = start + (lines[focusLine - 1]?.length ?? 0);
    ta.scrollTop = Math.max(0, (focusLine - 1) * CODE_LINE_HEIGHT - CODE_LINE_HEIGHT * 4);
    ta.focus();
    ta.setSelectionRange(start, end);
  }, [focusLine, focusTick, value]);

  /** M30：把符号/片段插到光标处（有选区则替换选区；back = 光标回退几个字符） */
  const insertSymbol = useCallback(
    (text: string, back = 0) => {
      const ta = taRef.current;
      if (!ta) return;
      const s = ta.selectionStart ?? 0;
      const e = ta.selectionEnd ?? 0;
      ta.focus();
      try {
        ta.setRangeText(text, s, e, "end");
      } catch {
        // 极旧内核没有 setRangeText：退化成拼接
        const next = value.slice(0, s) + text + value.slice(e);
        onChange(next);
        return;
      }
      const pos = Math.max(0, s + text.length - back);
      ta.setSelectionRange(pos, pos);
      onChange(ta.value);
    },
    [onChange, value],
  );

  return (
    <div className={"axv-code" + (className ? " " + className : "")}>
      <div className="axv-code-body">
        <div className="axv-gutter" aria-hidden="true">
          <div className="axv-gutter-inner" ref={gutRef}>
            {Array.from({ length: lines }, (_, i) => (
              <div
                key={i}
                className={"axv-ln" + (errLines.has(i + 1) ? " axv-ln-err" : "")}
                title={errLines.get(i + 1)}
              >
                {i + 1}
              </div>
            ))}
          </div>
        </div>
        <div className="axv-code-wrap">
          <pre className="axv-code-hl" ref={preRef} aria-hidden="true">
            <code
              className="axv-code-code"
              dangerouslySetInnerHTML={{ __html: hlHtml }}
            />
          </pre>
          <div className="axv-code-bands" ref={bandRef} aria-hidden="true">
            {[...errLines.keys()].map((ln) => (
              <div
                key={ln}
                className="axv-code-band"
                style={{ top: (ln - 1) * CODE_LINE_HEIGHT }}
              />
            ))}
          </div>
          <textarea
            className="axv-code-ta"
            ref={taRef}
            value={value}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            onChange={(e) => onChange(e.target.value)}
            onScroll={sync}
            onClick={(e) => onCursorLine?.(lineFromEvent(e.currentTarget, e.clientX, e.clientY))}
            onKeyUp={(e) => onCursorLine?.(lineFromCursor(e.currentTarget))}
            onKeyDown={(e) => {
              // M6e：Ctrl/Cmd+F 在编辑器内直接打开查找
              if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
                e.preventDefault();
                openFind();
                return;
              }
              onCursorLine?.(lineFromCursor(e.currentTarget));
            }}
          />
          {findOpen ? (
            <div className="axv-find" role="search">
              <input
                ref={findRef}
                className="axv-find-input"
                value={query}
                placeholder="在 XML 里查找"
                aria-label="查找"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    gotoHit(hitIdx + (e.shiftKey ? -1 : 1));
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setFindOpen(false);
                    taRef.current?.focus();
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
                  taRef.current?.focus();
                }}
              >
                <span className="msr" aria-hidden="true">close</span>
              </button>
            </div>
          ) : null}
        </div>
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
      {/* M30：常用符号快捷条（横向滑，不抢编辑器焦点） */}
      <div className="axv-sym-bar" role="toolbar" aria-label="常用符号">
        {SYMBOLS.map((s) => (
          <button
            key={s.label}
            type="button"
            className="axv-sym-btn"
            title={s.title || s.label}
            // 按下事件就拦：否则 textarea 先失焦、光标位置丢了
            onMouseDown={(e) => e.preventDefault()}
            onTouchStart={(e) => e.preventDefault()}
            onClick={() => insertSymbol(s.insert, s.back ?? 0)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
