"use client";

/**
 * M25c：顶部工具栏（纯展示组件）
 *
 * 从 XmlEditor 里抽出来的原因：这块 JSX 夹在 3300 行组件中段，改一处要在几千行里找锚点。
 * 这里只负责布局与按钮外观，所有行为（保存/打开/导出/撤销…）都由 XmlEditor 通过 props 注入，
 * 组件自身无 state、无副作用，便于单测和后续再调整按钮顺序。
 */

import { ViewSettingsMenu } from "./ViewSettingsMenu";
import { ToolbarMoreMenu, type MoreItem } from "./ToolbarMoreMenu";
import { t as tt } from "@/lib/i18n-src";

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
  /** M165：并排对比 */
  onCompare?: () => void;

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
  /** M154：设备端 aapt2 真渲染（只有 APK 里桥在才有） */
  realRenderAvailable?: boolean;
  realRenderBusy?: boolean;
  onRealRender?: () => void;
  onFormat: () => void;
  /** M140：历史版本快照面板（可选，不传就不画按钮） */
  onHistory?: () => void;
  /** M188a：打开「签名与发布」配置弹层 */
  onSign?: () => void;
  /** M188a：有可写项目根时才显示签名项（网页版目录句柄也算） */
  canSign?: boolean;
  snapCount?: number;
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
    onCompare,
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
    realRenderAvailable,
    realRenderBusy,
    onRealRender,
    onFormat,
    onSign,
    canSign,
    onHistory,
    snapCount,
  } = props;

  /* M173：低频操作收进「更多」弹出菜单（渲染在 ToolbarMoreMenu 里，portal 到 .axv-main，避免被工具栏裁剪） */
  const moreItems: MoreItem[] = [
    {
      key: "open",
      icon: "file_open",
      label: tt("打开 XML 文件"),
      hint: tt("也可直接把文件拖进来"),
      onClick: onOpenFile,
    },
    { key: "copy", icon: "content_copy", label: tt("复制 XML"), onClick: onCopyXml },
  ];
  if (showResZip) {
    moreItems.push({
      key: "reszip",
      icon: "folder_zip",
      label: tt("导出 res 包"),
      hint: tt("布局 + 图标矢量 + shape/values"),
      onClick: onExportRes,
    });
  }
  if (hasRes) {
    moreItems.push({ key: "clearres", icon: "hide_image", label: tt("清除 res"), onClick: onClearRes });
  }
  if (canSign) {
    moreItems.push({
      key: "sign",
      icon: "key",
      label: tt("签名与发布"),
      hint: tt("别名 / 口令 / keystore 路径 / scheme 开关"),
      onClick: () => onSign?.(),
    });
  }
  if (nativeAvailable) {
    moreItems.push({
      key: "workspace",
      icon: "save_location",
      label: tt("更换保存位置"),
      hint: workspaceLabel || tt("默认目录"),
      title: tt("保存位置：{path}（点击更换）", { path: workspaceLabel || tt("默认目录") }),
      onClick: onChangeWorkspace,
    });
  }
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
          title={tt("展开左侧面板")}
          aria-label={tt("展开左侧面板")}
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
          <ViewSettingsMenu deviceId={deviceId} onDevice={onChangeDevice} scale={scale} onScale={onScale} onCompare={onCompare} />
          <button className="axv-tb-btn" title={tt("撤销")} aria-label={tt("撤销")} disabled={!canUndo} onClick={onUndo}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>undo</span>
          </button>
          <button className="axv-tb-btn" title={tt("重做")} aria-label={tt("重做")} disabled={!canRedo} onClick={onRedo}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>redo</span>
          </button>
          <button
            className="axv-tb-btn"
            title={tt("保存（打开的文件写回原路径；新建文件选择保存位置）")}
            aria-label={tt("保存")}
            onClick={onSave}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>save</span>
          </button>
          {onHistory ? (
            <button
              className="axv-tb-btn axv-tb-history"
              title={tt("历史版本：自动/手动存的文档快照，可以回退")}
              aria-label={tt("历史版本")}
              onClick={onHistory}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>history</span>
              {snapCount ? <span className="axv-tb-badge">{snapCount}</span> : null}
            </button>
          ) : null}
          <button
            className="axv-tb-btn"
            title={tt("导出预览图（PNG / SVG）")}
            aria-label={tt("导出预览图")}
            onClick={onExportImage}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>image</span>
          </button>
          <button
            className="axv-tb-btn axv-tb-run"
            title={tt("运行调试：全屏交互预览，可点控件跳布局（Esc 退出）")}
            aria-label={tt("运行")}
            onClick={onRun}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>play_arrow</span>
          </button>
          {realRenderAvailable && onRealRender ? (
            <button
              className="axv-tb-btn"
              title={tt("真机渲染：用设备上的 aapt2 现场编译资源，再用系统 LayoutInflater 渲染（对比 CSS 模拟用）")}
              aria-label={tt("真机渲染")}
              aria-busy={realRenderBusy ? true : undefined}
              disabled={realRenderBusy}
              onClick={onRealRender}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>android</span>
            </button>
          ) : null}
          <button
            className="axv-tb-btn"
            title={tt("格式化代码（重排缩进，保留注释）")}
            aria-label={tt("格式化")}
            onClick={onFormat}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 22 }}>code</span>
          </button>

          {/* M173：低频操作收进这个菜单 */}
          <ToolbarMoreMenu items={moreItems} />
        </div>
      </div>

      {rightOpen ? null : (
        <button
          className="axv-tb-btn axv-tb-side-btn"
          title={tt("展开右侧属性面板")}
          aria-label={tt("右侧属性面板")}
          aria-pressed={false}
          onClick={onOpenRight}
        >
          <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>right_panel_open</span>
        </button>
      )}
    </div>
  );
}
