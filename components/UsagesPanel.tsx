// components/UsagesPanel.tsx — M366 step21：资源引用浮层（从 XmlEditor.tsx JSX 抽出）
//
// 原 XmlEditor.tsx 里 2317-2376 的 M68（C3）「资源引用列表」整块。
// 纯展示 + 三个回调；数据/状态仍由壳（use-code-nav）持有。
"use client";

import type { UsageHit } from "@/lib/xml/ai-usages";
import type { ProjectSource, BrowseEntry } from "@/lib/xml/project-browse";

export interface UsesPanelData {
  title: string;
  hits: UsageHit[];
  files: number;
  truncated: boolean;
  loading: boolean;
}

export interface UsagesPanelProps {
  usesPanel: UsesPanelData | null;
  setUsesPanel: (v: UsesPanelData | null) => void;
  tt: (s: string, v?: Record<string, string>) => string;
  activeProjectRef: { current: { source?: ProjectSource | null } | null };
  setWsMsg: (s: string) => void;
  openRel: string | null;
  jumpToCodeLine: (line: number) => void;
  loadEntry: (source: ProjectSource, entry: BrowseEntry) => Promise<void>;
}

export function UsagesPanel({
  usesPanel, setUsesPanel, tt, activeProjectRef, setWsMsg, openRel, jumpToCodeLine, loadEntry,
}: UsagesPanelProps) {
  if (!usesPanel) return null;
  return (
    <div
      className="axv-uses-mask"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) setUsesPanel(null);
      }}
    >
      <div className="axv-uses-card">
        <div className="axv-uses-head">
          <span className="axv-uses-title">{tt("{title} 的引用", { title: usesPanel.title })}</span>
          <span className="axv-uses-count">
            {usesPanel.loading
              ? tt("扫描中…")
              : tt("{n} 处 · 扫了 {files} 个文件{mode}", { n: String(usesPanel.hits.length), files: String(usesPanel.files), mode: usesPanel.truncated ? tt("（已截断）") : "" })}
          </span>
          <span style={{ flex: 1 }} />
          <button className="axv-uses-x" aria-label={tt("关闭")} onClick={() => setUsesPanel(null)}>
            ✕
          </button>
        </div>
        <div className="axv-uses-list">
          {!usesPanel.loading && usesPanel.hits.length === 0 ? (
            <div className="axv-uses-empty">{tt("没找到引用（可能只在别的模块或依赖库里）")}</div>
          ) : null}
          {usesPanel.hits.map((h) => (
            <button
              key={`${h.rel}:${h.line}`}
              className="axv-uses-row"
              title={`${h.rel}:${h.line}`}
              onClick={() => {
                setUsesPanel(null);
                const src = activeProjectRef.current?.source;
                if (!src) {
                  setWsMsg(`${h.rel}:${h.line}`);
                  return;
                }
                if (openRel === h.rel) {
                  jumpToCodeLine(h.line);
                  return;
                }
                void loadEntry(src, {
                  kind: "file",
                  name: h.rel.split("/").pop() || h.rel,
                  rel: h.rel,
                }).then(() => jumpToCodeLine(h.line));
              }}
            >
              <span className="axv-uses-file">{h.rel}</span>
              <span className="axv-uses-line">L{h.line}</span>
              <span className="axv-uses-snip">{h.text}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
