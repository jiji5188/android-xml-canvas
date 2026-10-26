// components/XmlCodeEditor.tsx — 带语法高亮的 XML 编辑器
// 实现：透明文字的 textarea 叠在高亮后的 <pre> 上，滚动/尺寸完全同步。
// 不引第三方编辑器，保持零依赖、体积小。

"use client";

import { useCallback, useRef } from "react";

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
  /** 外层容器的额外类名 */
  className?: string;
}

export function XmlCodeEditor({ value, onChange, className }: Props) {
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);

  const sync = useCallback(() => {
    const ta = taRef.current;
    const pre = preRef.current;
    if (!ta || !pre) return;
    pre.scrollTop = ta.scrollTop;
    pre.scrollLeft = ta.scrollLeft;
  }, []);

  return (
    <div className={"axv-code" + (className ? " " + className : "")}>
      <pre className="axv-code-hl" ref={preRef} aria-hidden="true">
        <code dangerouslySetInnerHTML={{ __html: highlightXml(value) + "\n" }} />
      </pre>
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
  );
}
