"use client";

/**
 * M25c：顶部工具栏（纯展示组件）
 *
 * 从 XmlEditor 里抽出来的原因：这块 JSX 夹在 3300 行组件中段，改一处要在几千行里找锚点。
 * 这里只负责布局与按钮外观，所有行为（保存/打开/导出/撤销…）都由 XmlEditor 通过 props 注入，
 * 组件自身无 state、无副作用，便于单测和后续再调整按钮顺序。
 */

import { ViewSettingsMenu } from "./ViewSettingsMenu";

export type ToolbarProps = {
  /** 移动端：工具栏铺满宽度，不做左右面板避让 */
  isMobile: boolean;
  leftOpen: boolean;
  rightOpen: boolean;
  onOpenLeft: () => void;
  onOpenRight: () => void;

  deviceId: string;
  onChangeDevice: (id: string) => void;
  scale: number;
  onScale: (n: number) => void;

  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;

  onSave: () => void;
  onOpenFile: () => void;
  onCopyXml: () => void;
  /** 有 res 资源或生成的 drawable 时才显示「导出 res 包」 */
  showResZip: boolean;
  onExportRes: () => void;
  onExportImage: () => void;
  /** 有 res 资源时才显示「清除 res」 */
  hasRes: boolean;
  onClearRes: () => void;

  /** 原生容器（APK）才有「更换保存位置」 */
  nativeAvailable: boolean;
  workspaceLabel: string;
  onChangeWorkspace: () => void;

  onRun: () => void;
  onFormat: () => void;
};

export function Toolbar(props: ToolbarProps) {
  const {
    isMobile,
    leftOpen,
    rightOpen,
    onOpenLeft,
    onOpenRight,
    deviceId,
    onChangeDevice,
    scale,
    onScale,
    canUndo,
    canRedo,
    onUndo,
    onRedo,
    onSave,
    onOpenFile,
    onCopyXml,
    showResZip,
    onExportRes,
    onExportImage,
    hasRes,
    onClearRes,
    nativeAvailable,
    workspaceLabel,
    onChangeWorkspace,
    onRun,
    onFormat,
  } = props;

  return (
    <div
      className="axv-toolbar-v2"
      style={
        isMobile
          ? undefined
          : {
              left: leftOpen ? 320 : 0,
              right: rightOpen ? 320 : 0,
              transition: "left 0.22s, right 0.22s",
            }
      }
    >
      {leftOpen ? null : (
        <button
          className="axv-tb-btn axv-tb-side-btn"
          title="展开左侧面板"
          aria-label="展开左侧面板"
          aria-pressed={false}
          onClick={onOpenLeft}
        >
          <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>left_panel_open</span>
        </button>
      )}

      {/* M6b：中间可横向滚动的工具栏区（左/右侧滑按钮各占一边，不悬浮不吸边） */}
      <div className="axv-tb-scroll">
        <div className="axv-tb-group">
          {/* M6c/M10：设备 + 缩放收进这个按钮，并与其它工具同处一个工具组 */}
          <ViewSettingsMenu deviceId={deviceId} onDevice={onChangeDevice} scale={scale} onScale={onScale} />
          <button className="axv-tb-btn" title="撤销" aria-label="撤销" disabled={!canUndo} onClick={onUndo}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>undo</span>
          </button>
          <button className="axv-tb-btn" title="重做" aria-label="重做" disabled={!canRedo} onClick={onRedo}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>redo</span>
          </button>
          <button
            className="axv-tb-btn"
            title="保存（打开的文件写回原路径；新建文件选择保存位置）"
            aria-label="保存"
            onClick={onSave}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>save</span>
          </button>
          <button
            className="axv-tb-btn"
            title="打开本地 XML 文件（也可直接把文件拖进来）"
            aria-label="打开 XML 文件"
            onClick={onOpenFile}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>file_open</span>
          </button>
          <button className="axv-tb-btn" title="复制生成的 XML" aria-label="复制 XML" onClick={onCopyXml}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>content_copy</span>
          </button>
          {showResZip ? (
            <button
              className="axv-tb-btn"
              title="导出 res 目录（zip：布局 + 图标矢量 + shape/values）"
              aria-label="导出 res 包"
              onClick={onExportRes}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>folder_zip</span>
            </button>
          ) : null}
          <button
            className="axv-tb-btn"
            title="导出预览图（PNG / SVG）"
            aria-label="导出预览图"
            onClick={onExportImage}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>image</span>
          </button>
          {hasRes ? (
            <button className="axv-tb-btn" title="清除已上传的 res 资源" aria-label="清除 res" onClick={onClearRes}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>hide_image</span>
            </button>
          ) : null}
          {nativeAvailable ? (
            <button
              className="axv-tb-btn"
              title={`保存位置：${workspaceLabel || "默认目录"}（点击更换）`}
              aria-label="更换保存位置"
              onClick={onChangeWorkspace}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>save_location</span>
            </button>
          ) : null}
          <button
            className="axv-tb-btn axv-tb-run"
            title="运行调试：全屏交互预览，可点控件跳布局（Esc 退出）"
            aria-label="运行"
            onClick={onRun}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>play_arrow</span>
          </button>
          <button
            className="axv-tb-btn"
            title="格式化代码（重排缩进，保留注释）"
            aria-label="格式化"
            onClick={onFormat}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 22 }}>format_shapes</span>
          </button>
        </div>
      </div>

      {rightOpen ? null : (
        <button
          className="axv-tb-btn axv-tb-side-btn"
          title="展开右侧属性面板"
          aria-label="右侧属性面板"
          aria-pressed={false}
          onClick={onOpenRight}
        >
          <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>right_panel_open</span>
        </button>
      )}
    </div>
  );
}
