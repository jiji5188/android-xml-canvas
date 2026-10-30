// components/XmlCodeView.tsx — XML 代码视图（tab 切过来的全屏编辑器 + 底部工具栏）
//
// M25i 从 XmlEditor.tsx 抽出。这个视图只在「XML 代码」tab 激活时出现：
//   编辑器本体（XmlCodeEditor）+ 格式化 / 示例项目 / 文件选择 / 打开 / 保存 / res 包 / 运行 / 存至。
// 状态全在 XmlEditor，这里纯展示 + 回调。

import type { ReactNode } from "react";
import type { LintIssue } from "@/lib/xml/lint";
import { XmlCodeEditor } from "./XmlCodeEditor";

export interface XmlCodeViewProps {
  open: boolean;
  isMobile: boolean;
  leftOpen: boolean;
  rightOpen: boolean;

  value: string;
  onChange: (next: string) => void;
  errors?: LintIssue[];
  focusLine?: number;
  focusTick?: number;
  onCursorLine?: (line: number) => void;

  onFormat: () => void;
  /** 值形如 "blank:empty" 或示例 key，由调用方分发 */
  onSample: (value: string) => void;
  /** 文件下拉（XmlEditor 里根据当前项目现算，作为插槽传进来） */
  fileSelect?: ReactNode;

  onOpenFile: () => void;
  onSave: () => void;
  onExportRes: () => void;
  onRun: () => void;

  hasRes: boolean;
  nativeAvailable: boolean;
  workspaceLabel: string;
  onChooseWorkspace: () => void;
}

export function XmlCodeView(props: XmlCodeViewProps) {
  if (!props.open) return null;

  return (
    <div
      className="axv-mob-xml"
      style={
        props.isMobile
          ? undefined
          : {
              left: (props.leftOpen ? 320 : 0) + 16,
              right: (props.rightOpen ? 320 : 0) + 16,
              transition: "left 0.22s, right 0.22s",
            }
      }
    >
      <XmlCodeEditor
        className="axv-code-fill"
        value={props.value}
        onChange={props.onChange}
        errors={props.errors}
        focusLine={props.focusLine}
        focusTick={props.focusTick}
        onCursorLine={props.onCursorLine}
      />
      <div className="axv-mob-xml-tools">
        <button className="axv-mob-tool-btn axv-ghost" onClick={props.onFormat} title="重排缩进（保留注释）">
          格式化
        </button>
        <button className="axv-mob-tool-btn" onClick={props.onOpenFile} title="打开本地 XML 文件">
          打开
        </button>
        <button className="axv-mob-tool-btn" onClick={props.onSave} title="保存">
          保存
        </button>
        {props.hasRes ? (
          <button className="axv-mob-tool-btn" onClick={props.onExportRes} title="导出 res 包（含图标）">
            res 包
          </button>
        ) : null}
        <button className="axv-mob-tool-btn axv-mob-run" onClick={props.onRun} title="运行调试">
          ▶ 运行
        </button>
        {props.nativeAvailable ? (
          <button
            className="axv-mob-tool-btn"
            title={`保存位置：${props.workspaceLabel || "默认目录"}`}
            onClick={props.onChooseWorkspace}
          >
            存至
          </button>
        ) : null}
      </div>
    </div>
  );
}
