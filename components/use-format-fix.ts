// components/use-format-fix.ts — M366 step16（路线 2 拆解）：一键格式化 / 一键修复域
//
// 从 XmlEditor.tsx 抽出（原 ~1200-1243 区域）：doFormat（重排缩进，保留注释，可撤销）/
// doFixAll（把 lints 里所有能修的就地整词替换）。
//
// deps-getter + 延迟 Proxy（与 use-canvas-ops.ts 同款）。纯 lib 直接 import。
"use client";

import { useEffect, useMemo, useRef } from "react";
import { t as tt } from "@/lib/i18n-src";
import { formatXml } from "@/lib/xml/format";
import { formatJava } from "@/lib/xml/java-format";
import { applyFixToLine } from "@/lib/xml/xml-res-check";
import { isJavaLikePath } from "@/lib/xml/java-outline";

export interface FormatFixDeps {
  flushXml: () => void;
  currentXml: () => string;
  isJavaLikePath?: (p: string) => boolean; // 允许壳直接传或这里 import（这里已 import）
  openRel: string | null;
  editorTheme: { indent?: number };
  setXmlAndTrack: (next: string, mergeKey?: string) => void;
  lints: Array<{ line: number; fix?: { from: string; to: string } }>;
  setExportNote: (v: string) => void;
}

export interface FormatFixResult {
  doFormat: () => void;
  doFixAll: () => void;
}

export function useFormatFix(getDeps: () => FormatFixDeps): FormatFixResult {
  const depsRef = useRef<FormatFixDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as FormatFixDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** 一键格式化：重排缩进，保留注释，可撤销 */
  const doFormat = () => {
    D.flushXml();
    const cur = D.currentXml();
    let next: string;
    if (isJavaLikePath(D.openRel || "")) {
      next = formatJava(cur, { indent: D.editorTheme.indent || 4 });
    } else {
      next = formatXml(cur, 2);
    }
    if (next !== cur) D.setXmlAndTrack(next);
  };

  /** M179：一键修复：把 lints 里所有能修的（资源引用拼错/方法名拼错）就地替换。 */
  const doFixAll = () => {
    D.flushXml();
    const cur = D.currentXml();
    const lines = cur.split("\n");
    const done = new Set<string>();
    let fixed = 0;
    for (const iss of D.lints) {
      const fx = iss.fix;
      if (!fx) continue;
      const key = `${iss.line}|${fx.from}|${fx.to}`;
      if (done.has(key)) continue;
      done.add(key);
      const idx = Math.max(0, Math.min(iss.line - 1, lines.length - 1));
      const L = lines[idx];
      if (L === undefined) continue;
      const r = applyFixToLine(L, fx.from, fx.to);
      if (!r.count) continue;
      lines[idx] = r.text;
      fixed += r.count;
    }
    if (!fixed) return;
    D.setXmlAndTrack(lines.join("\n"));
    D.setExportNote(tt("已修复 {n} 处（可撤销）", { n: fixed }));
    window.setTimeout(() => D.setExportNote(""), 2400);
  };

  return { doFormat, doFixAll };
}
