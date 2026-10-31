// components/XmlCodeView.tsx — XML 代码视图（tab 切过来的全屏编辑器）
//
// M25i 从 XmlEditor.tsx 抽出。这个视图只在「XML 代码」tab 激活时出现。
// M30b：底部工具条（格式化/打开/保存/res 包/运行/存至）已删除——顶部工具栏都有这些按钮，
//       格式化改放到编辑器内的符号快捷条最前面。
// 状态全在 XmlEditor，这里纯展示 + 回调。

import type { LintIssue } from "@/lib/xml/lint";
import type { EditorLang } from "@/lib/xml/editor-lang";
import { CodeEditor } from "./CodeEditor";

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

  /** M38：当前文件语法（xml / java） */
  lang?: EditorLang;

  /** 格式化（重排缩进，保留注释） */
  onFormat: () => void;
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
      <CodeEditor
        className="axv-code-fill"
        value={props.value}
        onChange={props.onChange}
        errors={props.errors}
        focusLine={props.focusLine}
        focusTick={props.focusTick}
        onCursorLine={props.onCursorLine}
        onFormat={props.onFormat}
        lang={props.lang}
      />
    </div>
  );
}
