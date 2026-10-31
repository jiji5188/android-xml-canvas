// components/CanvasStage.tsx — 画布舞台（M25e 从 XmlEditor.tsx 抽出）
//
// 只负责「把手机外壳 + 画布 + 各种提示条画出来」：状态栏 / 导航栏 / 解析失败卡片 /
// 结构告警 / 渲染崩溃兜底 / 缩放气泡 / 提示列表。
// 所有状态与回调都由 XmlEditor 注入，这里纯展示（props 进、JSX 出），方便单独调外壳样式。

import type { DragEvent, RefObject } from "react";
import { DRAG_WIDGET_MIME } from "./widget-catalog";
import { XmlCanvas } from "./XmlCanvas";
import CanvasBoundary from "@/components/CanvasBoundary";
import type { RenderModel, XmlIssue } from "@/lib/xml/types";

export interface CanvasStageProps {
  /** 是否在「预览」tab（移动端切到代码视图时整块不渲染） */
  active: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  stageRef: RefObject<HTMLDivElement | null>;
  phoneRef: RefObject<HTMLDivElement | null>;

  tr: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
  gotoLine: (line: number) => void;

  /** 缩放提示（右上角百分比气泡），null = 不显示 */
  zoomHud: number | null;
  /** 手机外壳尺寸（未缩放）与缩放比 */
  outerW: number;
  outerH: number;
  fitRatio: number;
  /** 1dp 对应多少 px（含缩放）——只喂状态栏/导航栏高度和圆角 */
  DPX: number;
  /** 设备圆角（dp），0 = 直角 */
  radius: number;
  phoneBg: string;
  phoneFg: string;
  showSystemBars: boolean;
  STATUS_BAR_H: number;
  NAV_BAR_H: number;

  /** 拖拽落点提示：drop = 高亮 · null = 正常 */
  dropHint: string | null;
  onDropHint: (v: string | null) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;

  model: RenderModel | null;
  parsedXml: string;
  issues: XmlIssue[];
  showIssues: boolean;
  parseErr: boolean;
  parseReason: string;
  /** M37b：非布局文件（manifest/values/menu…）在画布区的说明卡片；null = 不显示 */
  notice?: { title: string; msg: string } | null;
  lintErrCount: number;
  exportNote: string;

  selectedPath: string | null;
  onSelectPath: (p: string | null) => void;
  onDropWidget: (path: string, key: string, isContainer: boolean) => void;
  onConstraintDraw: (
    childPath: string,
    side: "start" | "end" | "top" | "bottom",
    targetPath: string,
    targetSide: "start" | "end" | "top" | "bottom",
  ) => void;
  onGeometryChange: (path: string, g: { x?: number; y?: number; w?: number; h?: number }) => void;
  isPathLocked: (path: string) => boolean;
}

export function CanvasStage(props: CanvasStageProps) {
  const {
    active,
    leftOpen,
    rightOpen,
    stageRef,
    phoneRef,
    tr,
    gotoLine,
    zoomHud,
    outerW,
    outerH,
    fitRatio,
    DPX,
    radius,
    phoneBg,
    phoneFg,
    showSystemBars,
    STATUS_BAR_H,
    NAV_BAR_H,
    dropHint,
    onDropHint,
    onDrop,
    model,
    parsedXml,
    issues,
    showIssues,
    parseErr,
    parseReason,
    notice,
    lintErrCount,
    exportNote,
    selectedPath,
    onSelectPath,
    onDropWidget,
    onConstraintDraw,
    onGeometryChange,
    isPathLocked,
  } = props;

  if (!active) return null;

  return (
    <div
      className={"axv-stage" + (leftOpen ? " pad-l" : "") + (rightOpen ? " pad-r" : "")}
      ref={stageRef}
    >
      {zoomHud !== null ? (
        <div className="axv-zoom-hud" role="status" aria-live="polite">
          {Math.round(zoomHud * 100)}%
        </div>
      ) : null}
      {!parseErr && lintErrCount > 0 ? (
        <div className="axv-struct-warn" role="status">
          <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>warning</span>
          <span>
            {tr("err.structWarn", "有 {n} 处结构问题（不影响预览）", { n: lintErrCount })}
          </span>
          <button className="axv-struct-warn-btn" onClick={() => gotoLine(1)}>
            {tr("err.fix", "去代码面板修正")}
          </button>
        </div>
      ) : null}
      {notice ? (
        <div className="axv-parse-fail axv-codeonly-card" role="status">
          <span className="msr axv-parse-fail-icon" aria-hidden="true">
            description
          </span>
          <div className="axv-parse-fail-title">{notice.title}</div>
          <div className="axv-parse-fail-msg">{notice.msg}</div>
          <button className="axv-parse-fail-btn" onClick={() => gotoLine(1)}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>
              code
            </span>
            {tr("err.toCode", "去代码面板")}
          </button>
        </div>
      ) : parseErr ? (
        <div className="axv-parse-fail" role="alert">
          <span className="msr axv-parse-fail-icon" aria-hidden="true">error</span>
          <div className="axv-parse-fail-title">{tr("err.parseTitle", "这个 XML 现在画不出来")}</div>
          <div className="axv-parse-fail-msg">
            {parseReason || tr("err.parseMsg", "XML 结构不完整或有语法错误")}
          </div>
          <div className="axv-parse-fail-hint">
            {tr(
              "err.parseHint",
              "先到「代码」面板修正这段内容，画布会自动恢复；改动不会丢失，也不会影响你原来的文件。",
            )}
          </div>
          <button className="axv-parse-fail-btn" onClick={() => gotoLine(1)}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>code</span>
            {tr("err.fix", "去代码面板修正")}
          </button>
        </div>
      ) : model ? (
        <div
          style={{
            width: outerW * fitRatio,
            height: outerH * fitRatio,
            flex: "0 0 auto",
          }}
        >
        <div
          ref={phoneRef}
          className={"axv-phone" + (dropHint ? " axv-drop-target" : "")}
          style={{
            width: outerW,
            height: outerH,
            boxSizing: "border-box",
            background: phoneBg,
            color: phoneFg,
            transform: fitRatio < 1 ? `scale(${fitRatio})` : undefined,
            transformOrigin: "top left",
            borderRadius: radius ? Math.round(radius * DPX) : undefined,
          }}
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes(DRAG_WIDGET_MIME)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "copy";
              onDropHint("drop");
            }
          }}
          onDragLeave={() => onDropHint(null)}
          onDrop={onDrop}
        >
          {/* 状态栏（系统窗口，不属于布局 XML）：时间 + 前置摄像头（居中）+ 信号/WiFi/电池 */}
          {showSystemBars && (
          <div className="axv-statusbar" style={{ height: STATUS_BAR_H }}>
            <span className="axv-sb-time">9:41</span>
            {exportNote ? <div className="axv-toast axv-sb-camera-note">{exportNote}</div> : <div className="axv-sb-camera" aria-hidden="true" />}
            <span className="axv-sb-icons">
              <span className="msr" aria-hidden="true">
                signal_cellular_alt
              </span>
              <span className="msr" aria-hidden="true">
                wifi
              </span>
              <span className="msr" aria-hidden="true">
                battery_full
              </span>
            </span>
          </div>
          )}

          {/* 应用内容区：根布局填满这里 */}
          <div className="axv-phone-body">
            <CanvasBoundary
              resetKey={parsedXml}
              onFix={() => gotoLine(1)}
              labels={{
                title: tr("err.crashTitle", "画布渲染出错了"),
                hint: tr(
                  "err.crashHint",
                  "这不是你操作的问题，多半是某段布局数据超出了支持范围。到「代码」面板改一下（哪怕加个空格再删掉）画布会自动重试。",
                ),
                fix: tr("err.fix", "去代码面板修正"),
                retry: tr("err.retry", "重试渲染"),
              }}
            >
              <XmlCanvas
                node={model.root}
                selectedPath={selectedPath}
                onSelect={onSelectPath}
                onDropWidget={onDropWidget}
                onConstraintDraw={onConstraintDraw}
                onGeometryChange={onGeometryChange}
                isLocked={isPathLocked}
                scale={DPX}
              />
            </CanvasBoundary>
          </div>

          {/* 导航栏（三键导航：返回 / 主页 / 多任务） */}
          {showSystemBars && (
          <div className="axv-navbar" style={{ height: NAV_BAR_H }}>
            <span className="axv-nav-btn" title="返回">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M13.5 4.5 L14.5 4.5 L14.5 4.75 L14.75 4.75 L14.75 5 L15 5 L15 5.75 L14.75 5.75 L14.75 6.25 L14.5 6.25 L14.5 6.5 L14.25 6.5 L14.25 6.75 L14 6.75 L14 7 L13.75 7 L13.75 7.25 L13.5 7.25 L13.5 7.5 L13.25 7.5 L13.25 7.75 L13 7.75 L13 8 L12.75 8 L12.75 8.25 L12.5 8.25 L12.5 8.5 L12.25 8.5 L12.25 8.75 L12 8.75 L12 9 L11.75 9 L11.75 9.25 L11.5 9.25 L11.5 9.5 L11.25 9.5 L11.25 9.75 L11 9.75 L11 10.25 L11.25 10.25 L11.25 10.5 L11.5 10.5 L11.5 10.75 L11.75 10.75 L11.75 11 L12 11 L12 11.25 L12.25 11.25 L12.25 11.5 L12.5 11.5 L12.5 11.75 L12.75 11.75 L12.75 12 L13 12 L13 12.25 L13.25 12.25 L13.25 12.5 L13.5 12.5 L13.5 12.75 L13.75 12.75 L13.75 13 L14 13 L14 13.25 L14.25 13.25 L14.25 13.5 L14.5 13.5 L14.5 13.75 L14.75 13.75 L14.75 14.25 L15 14.25 L15 15 L14.75 15 L14.75 15.25 L14.5 15.25 L14.5 15.5 L13.5 15.5 L13.5 15.25 L13.25 15.25 L13.25 15 L13 15 L13 14.75 L12.75 14.75 L12.75 14.5 L12.5 14.5 L12.5 14.25 L12.25 14.25 L12.25 14 L12 14 L12 13.75 L11.75 13.75 L11.75 13.5 L11.5 13.5 L11.5 13.25 L11.25 13.25 L11.25 13 L11 13 L11 12.75 L10.75 12.75 L10.75 12.5 L10.5 12.5 L10.5 12.25 L10.25 12.25 L10.25 12 L10 12 L10 11.75 L9.75 11.75 L9.75 11.5 L9.5 11.5 L9.5 11.25 L9.25 11.25 L9.25 11 L9 11 L9 10.75 L8.75 10.75 L8.75 10.5 L8.5 10.5 L8.5 9.5 L8.75 9.5 L8.75 9.25 L9 9.25 L9 9 L9.25 9 L9.25 8.75 L9.5 8.75 L9.5 8.5 L9.75 8.5 L9.75 8.25 L10 8.25 L10 8 L10.25 8 L10.25 7.75 L10.5 7.75 L10.5 7.5 L10.75 7.5 L10.75 7.25 L11 7.25 L11 7 L11.25 7 L11.25 6.75 L11.5 6.75 L11.5 6.5 L11.75 6.5 L11.75 6.25 L12 6.25 L12 6 L12.25 6 L12.25 5.75 L12.5 5.75 L12.5 5.5 L12.75 5.5 L12.75 5.25 L13 5.25 L13 5 L13.25 5 L13.25 4.75 L13.5 4.75 Z" fill="currentColor" />
              </svg>
            </span>
            <span className="axv-nav-btn" title="主页">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
            <span className="axv-nav-btn" title="多任务">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
          </div>
          )}
        </div>
        </div>
      ) : null}
      {showIssues && issues.length > 0 && (
        <div className="axv-issues">
          <strong>{issues.length} 条提示：</strong>
          {issues.slice(0, 8).map((i, idx) => (
            <div key={idx}>[{i.level}] {i.nodePath} {i.message}</div>
          ))}
          {issues.length > 8 && <div>… 共 {issues.length} 条</div>}
        </div>
      )}
    </div>
  );
}
