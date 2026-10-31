// components/XmlCodeView.tsx — XML 代码视图（tab 切过来的全屏编辑器）
//
// M25i 从 XmlEditor.tsx 抽出。这个视图只在「XML 代码」tab 激活时出现。
// M30b：底部工具条（格式化/打开/保存/res 包/运行/存至）已删除——顶部工具栏都有这些按钮，
//       格式化改放到编辑器内的符号快捷条最前面。
// M39：res/values/*.xml 默认用「视图」（表格）页，可切回「代码」页。
// M42：切换条从代码视图里搬到顶部 tab（`视图` / `代码`），这里只剩「渲染哪一页」。
// 注意：XmlCodeView 本身不带 hooks（老测试直接当函数调）。

import type { LintIssue } from "@/lib/xml/lint";
import type { EditorLang } from "@/lib/xml/editor-lang";
import { CodeEditor } from "./CodeEditor";
import { ValuesEditor } from "./ValuesEditor";
import { ManifestEditor } from "./ManifestEditor";

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

  /** 格式化（重排缩进，保留注释） */
  onFormat: () => void;

  /** M38：当前文件语法（xml / java） */
  lang?: EditorLang;
  /** M40：缩进宽度（空格数） */
  indent?: number;
  /** M45：项目 res 资源名（drawable/values 等目录下的文件名），喂给关键词弹窗的 @引用补全 */
  resNames?: string[];
  /** M39/M42：当前页 —— values 文件的键值对表格（`axv-val`）还是代码编辑器（`axv-code-fill`） */
  view?: "code" | "values" | "manifest";
  /** M39：文件身份（切文件时重置视图模式） */
  fileKey?: string;
  /** M39：表格视图给个提示回调 */
  onNote?: (msg: string) => void;
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
      {props.view === "manifest" ? (
        <ManifestEditor
          key={props.fileKey || "manifest"}
          className="axv-code-fill"
          xml={props.value}
          onChange={props.onChange}
          onNote={props.onNote}
        />
      ) : props.view === "values" ? (
        <ValuesEditor
          key={props.fileKey || "values"}
          className="axv-code-fill"
          xml={props.value}
          onChange={props.onChange}
          onNote={props.onNote}
        />
      ) : (
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
          indent={props.indent}
          resNames={props.resNames}
        />
      )}
    </div>
  );
}
