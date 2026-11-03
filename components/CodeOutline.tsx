// components/CodeOutline.tsx — M61：Java/Kotlin 函数列表（右侧面板）
//
// 目的：手机上翻几千行代码找方法是灾难。这里给「类 → 方法」目录，
//       点一项 → 代码编辑器直接跳到那一行（复用 CodeEditor 的 focusLine/focusTick）。
// 纯展示 + 回调，解析在 lib/xml/java-outline.ts。

import { useMemo, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import type { OutlineItem } from "@/lib/xml/java-outline";

export interface CodeOutlineProps {
  items: OutlineItem[];
  /** 当前光标行（用来高亮「你在这儿」） */
  currentLine?: number;
  onJump: (line: number) => void;
  /** 文件名，显示在顶部 */
  fileName?: string;
}

export function CodeOutline({ items, currentLine = 0, onJump, fileName }: CodeOutlineProps) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return items;
    return items.filter((it) => it.name.toLowerCase().includes(k));
  }, [items, q]);

  const methods = items.filter((it) => it.kind === "method").length;

  return (
    <div className="axv-outline">
      <div className="axv-outline-bar">
        <input
          className="axv-outline-search"
          value={q}
          placeholder={tt("搜索函数名")}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="axv-outline-count" title={fileName}>
          {tt("{n} 个函数", { n: methods })}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="axv-attr-hint">
          {items.length === 0 ? tt("没识别到函数（文件可能还没保存或语法不完整）") : tt("没有匹配的函数")}
        </div>
      ) : (
        <ul className="axv-outline-list">
          {shown.map((it) => {
            const active =
              currentLine > 0 &&
              it.kind === "method" &&
              currentLine >= it.line &&
              currentLine < nextBoundary(shown, it);
            return (
              <li key={it.kind + ":" + it.line + ":" + it.name}>
                {it.kind === "class" ? (
                  <button
                    type="button"
                    className="axv-outline-class"
                    style={{ paddingLeft: 8 + Math.min(it.depth, 3) * 10 }}
                    onClick={() => onJump(it.line)}
                    title={tt("跳到第 {n} 行", { n: it.line })}
                  >
                    <span className="msr" aria-hidden="true">
                      {it.depth === 0 ? "folder_special" : "widgets"}
                    </span>
                    <span className="axv-outline-name">{it.name}</span>
                    <span className="axv-outline-line">L{it.line}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className={"axv-outline-item" + (active ? " is-active" : "")}
                    style={{ paddingLeft: 14 + Math.min(Math.max(it.depth - 1, 0), 3) * 10 }}
                    onClick={() => onJump(it.line)}
                    title={tt("跳到第 {n} 行", { n: it.line })}
                  >
                    <span className="axv-outline-name">{it.name}</span>
                    {it.sig ? <span className="axv-outline-sig">{it.sig}</span> : null}
                    <span className="axv-outline-line">L{it.line}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** 找下一个声明的行号（用于判断光标落在哪个函数体内） */
function nextBoundary(list: OutlineItem[], cur: OutlineItem): number {
  for (const it of list) {
    if (it.line > cur.line) return it.line;
  }
  return Number.MAX_SAFE_INTEGER;
}
