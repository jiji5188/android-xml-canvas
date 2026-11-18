// components/DebugRunPanel.tsx — M405：编辑器下方「调试日志」面板
// 显示调试运行的 stdout / stderr / 返回值 / 异常，可清空、可点「再跑一次」。

import { memo, useState } from "react";
import type { DebugRunResult } from "@/lib/xml/debug-run";
import { t as tt } from "@/lib/i18n-src";

interface Props {
  result: DebugRunResult | null;
  busy: boolean;
  canDebug: boolean;
  entryClass?: string;
  entryMethod?: string;
  onRerun?: () => void;
  onClose?: () => void;
}

function DebugRunPanelInner({ result, busy, canDebug, onRerun, onClose }: Props) {
  const [tab, setTab] = useState<"out" | "ret" | "err">("out");

  const lines = (s?: string) => (s ? s.replace(/\r\n/g, "\n") : "");

  const renderBlock = (text: string, color?: string) => (
    <pre
      style={{
        margin: 0,
        padding: 10,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
        fontSize: 12.5,
        lineHeight: 1.5,
        color: color || "var(--ink)",
        minHeight: 60,
      }}
    >
      {text || <span style={{ opacity: 0.45 }}>{tt("（无输出）")}</span>}
    </pre>
  );

  return (
    <div
      style={{
        borderTop: "1px solid var(--line)",
        background: "var(--panel, #fff)",
        display: "flex",
        flexDirection: "column",
        maxHeight: 320,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px",
          borderBottom: "1px solid var(--line)",
          fontSize: 12.5,
          fontWeight: 600,
        }}
      >
        <span style={{ color: "var(--accent, #2563eb)" }}>▶</span>
        <span>{tt("调试日志")}</span>
        {busy && <span style={{ opacity: 0.5, fontWeight: 400 }}>{tt("运行中…")}</span>}
        {result && !busy && (
          <span style={{ opacity: 0.6, fontWeight: 400 }}>
            {result.ok ? tt("成功") : tt("失败")} · {result.ms ?? 0}ms
          </span>
        )}
        <span style={{ flex: 1 }} />
        {canDebug && (
          <button
            className="axv-btn axv-btn-ghost"
            style={{ fontSize: 11.5, padding: "2px 8px" }}
            onClick={onRerun}
            disabled={busy}
          >
            {tt("再跑一次")}
          </button>
        )}
        <button
          className="axv-btn axv-btn-ghost"
          style={{ fontSize: 11.5, padding: "2px 8px" }}
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* tab：输出 / 返回值 / 报错 */}
      <div style={{ display: "flex", gap: 4, padding: "6px 10px 0" }}>
        {(
          [
            ["out", tt("输出")],
            ["ret", tt("返回值")],
            ["err", tt("报错")],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            className="axv-btn axv-btn-ghost"
            style={{
              fontSize: 11.5,
              padding: "2px 8px",
              border: "none",
              background: tab === k ? "var(--accent-soft, #e8f0fe)" : "transparent",
              color: tab === k ? "var(--accent, #2563eb)" : "var(--ink)",
            }}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {!result && !busy && <div style={{ padding: 12, opacity: 0.5, fontSize: 12.5 }}>{tt("点「运行」执行 main/debug，结果会显示在这里。")}</div>}
        {busy && <div style={{ padding: 12, opacity: 0.5, fontSize: 12.5 }}>{tt("正在设备端编译 + 动态加载执行…")}</div>}
        {result && !busy && tab === "out" && (
          <>
            {result.stdout !== undefined && renderBlock(lines(result.stdout))}
            {result.stderr && <div style={{ borderTop: "1px dashed var(--line)" }}>{renderBlock(lines(result.stderr), "#b91c1c")}</div>}
          </>
        )}
        {result && !busy && tab === "ret" && renderBlock(lines(result.returnValue) || (result.ok ? tt("void / null") : ""), result.ok ? "inherit" : "#b91c1c")}
        {result && !busy && tab === "err" && (
          <div>
            {result.exception ? renderBlock(result.exception, "#b91c1c") : <div style={{ padding: 10, opacity: 0.45 }}>{tt("没有异常")}</div>}
            {result.stackTrace && <div style={{ borderTop: "1px dashed var(--line)" }}>{renderBlock(lines(result.stackTrace), "#6b7280")}</div>}
          </div>
        )}
      </div>

      {/* 编译日志（折叠） */}
      {result?.log && (
        <details style={{ borderTop: "1px solid var(--line)", padding: "6px 10px", fontSize: 12, opacity: 0.75 }}>
          <summary style={{ cursor: "pointer", userSelect: "none" }}>{tt("编译日志")}</summary>
          {renderBlock(lines(result.log), "#6b7280")}
        </details>
      )}
    </div>
  );
}

export const DebugRunPanel = memo(DebugRunPanelInner);
