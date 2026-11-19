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
import { ToolbarRunMenu, type RunMenuItem } from "./ToolbarRunMenu";
import { ToolbarNewMenu, DEFAULT_NEW_ITEMS, type NewItemKind } from "./ToolbarNewMenu";
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

  /** M404：撤销按钮前的「＋」新建菜单（新建 Activity 页面 / Java 类 / XML 布局） */
  onNewItem?: (kind: NewItemKind) => void;

  onSave: () => void;
  /** 有 res 资源或生成的 drawable 时才显示「导出 res 包」 */
  showResZip: boolean;
  onExportRes: () => void;

  onRun: () => void;
  /** M154：设备端 aapt2 真渲染（只有 APK 里桥在才有） */
  realRenderAvailable?: boolean;
  realRenderBusy?: boolean;
  onRealRender?: () => void;
  /** M290：能否在当前环境打包（hasBuildApk）——「打包并运行 / 签名发布」两项的开关 */
  canBuildApk?: boolean;
  /** M290：一键打包（默认签名）并安装到本机 */
  onBuildRun?: () => void;
  onFormat: () => void;
  /** M140：历史版本快照面板（可选，不传就不画按钮） */
  onHistory?: () => void;
  /** M188a：打开「签名与发布」配置弹层 */
  onSign?: () => void;
  /** M188a：有可写项目根时才显示签名项（网页版目录句柄也算） */
  canSign?: boolean;
  /** M190：导出可编译项目 zip（需项目根 / AI 文件通道） */
  canExportProject?: boolean;
  onExportProject?: () => void;
  snapCount?: number;
  /** M412：返回项目管理页（不传 = 不显示返回按钮，老入口不变） */
  onHome?: () => void;
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
    onNewItem,
    onSave,
    showResZip,
    onExportRes,
    onRun,
    realRenderAvailable,
    realRenderBusy,
    onRealRender,
    canBuildApk,
    onBuildRun,
    onFormat,
    onSign,
    canSign,
    canExportProject,
    onExportProject,
    onHistory,
    snapCount,
    onHome,
  } = props;

  /* M173：低频操作收进「更多」弹出菜单（M404：删掉「打开 XML / 复制 XML / 清除 res / 更换保存位置」，只留导出 res 包 + 导出可编译项目） */
  const moreItems: MoreItem[] = [];
  if (showResZip) {
    moreItems.push({
      key: "reszip",
      icon: "folder_zip",
      label: tt("导出 res 包"),
      hint: tt("布局 + 图标矢量 + shape/values"),
      onClick: onExportRes,
    });
  }
  if (canExportProject) {
    moreItems.push({
      key: "exportproj",
      icon: "archive",
      label: tt("导出可编译项目"),
      hint: tt("整个项目打成 zip，拷到电脑出 release 包"),
      onClick: () => onExportProject?.(),
    });
  }

  /* M290：运行 ▾ 菜单。M316：「模拟界面」与「布局编译预览」合并为「界面预览」——
     APK 壳（realRenderAvailable）走真机编译预览，浏览器/桌面走前端模拟界面 */
  const apkOnlyHint = tt("仅 APK 端可用");
  const isApkShell = !!realRenderAvailable;
  const runItems: RunMenuItem[] = [
    {
      key: "run-preview",
      icon: isApkShell ? "android" : "smart_display",
      label: tt("界面预览"),
      hint: isApkShell
        ? tt("编译资源后渲染布局（真机路线）")
        : tt("前端轻量预览，不调用 AAPT2 编译"),
      onClick: () => (isApkShell ? onRealRender?.() : onRun()),
    },
    {
      key: "run-build",
      icon: "rocket_launch",
      label: tt("打包并运行"),
      hint: tt("完整项目编译，安装到真机"),
      disabled: !canBuildApk,
      disabledHint: apkOnlyHint,
      onClick: () => onBuildRun?.(),
    },
    {
      key: "run-sign",
      icon: "verified",
      label: tt("签名打包发布"),
      hint: tt("输出正式签名 APK"),
      disabled: !canSign || !canBuildApk,
      disabledHint: apkOnlyHint,
      onClick: () => onSign?.(),
    },
  ];

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
      {/* M412：返回项目管理页（入口页模式才有）——放最左，先于左栏按钮 */}
      {onHome ? (
        <button
          className="axv-tb-btn axv-tb-side-btn"
          title={tt("返回项目列表")}
          aria-label={tt("返回项目列表")}
          onClick={onHome}
        >
          <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>arrow_back</span>
        </button>
      ) : null}

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
          {/* M404：＋新建菜单（撤销按钮前） */}
          {onNewItem ? <ToolbarNewMenu items={DEFAULT_NEW_ITEMS(onNewItem)} /> : null}
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
          {/* M404：导出预览图按钮已删除 */}
          {/* M290：运行按钮菜单（M316：模拟+编译合并为「界面预览」，共三项） */}
          <ToolbarRunMenu busy={realRenderBusy || undefined} items={runItems} />
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
