// components/XmlCodeEditor.tsx — 带语法高亮 + 行号 + 错误行标注的 XML 编辑器
// 实现：透明文字的 textarea 叠在高亮后的 <pre> 上，滚动/尺寸完全同步。
// 不引第三方编辑器，保持零依赖、体积小。

"use client";

import { useCallback, useMemo, useRef } from "react";
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
    const end = j === -1 ? src.length : j;
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
}

export function XmlCodeEditor({ value, onChange, errors, className }: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const gutRef = useRef<HTMLDivElement | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);

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

  const lines = useMemo(() => value.split("\n").length, [value]);
  const errLines = useMemo(() => {
    const set = new Map<number, string>();
    for (const e of errors || []) if (!set.has(e.line)) set.set(e.line, e.message);
    return set;
  }, [errors]);
  const firstErr = errors && errors.length > 0 ? errors[0] : null;

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
              dangerouslySetInnerHTML={{ __html: highlightXml(value) }}
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
          />
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
    </div>
  );
}
