// components/XmlCodeView.tsx — XML 代码视图（tab 切过来的全屏编辑器）
//
// M25i 从 XmlEditor.tsx 抽出。这个视图只在「XML 代码」tab 激活时出现。
// M30b：底部工具条（格式化/打开/保存/res 包/运行/存至）已删除——顶部工具栏都有这些按钮，
//       格式化改放到编辑器内的符号快捷条最前面。
// M39：res/values/*.xml 默认用「表格」视图，可一键切回「代码」。
// 注意：XmlCodeView 本身不带 hooks（老测试直接当函数调），表格/代码切换的 state 放在
//       ValuesTabs 子组件里。

import { useEffect, useState } from "react";
import type { LintIssue } from "@/lib/xml/lint";
import type { EditorLang } from "@/lib/xml/editor-lang";
import { CodeEditor } from "./CodeEditor";
import { ValuesEditor } from "./ValuesEditor";

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
  /** M39：当前文件是 values 资源 → 默认「表格」视图 */
  values?: boolean;
  /** M39：文件身份（切文件时重置视图模式） */
  fileKey?: string;
  /** M39：表格视图给个提示回调 */
  onNote?: (msg: string) => void;
}

/** values 文件：表格 / 代码 两视图，带切换条 */
function ValuesTabs(props: XmlCodeViewProps) {
  const [mode, setMode] = useState<"table" | "code">("table");

  useEffect(() => {
    setMode("table");
  }, [props.fileKey]);

  return (
    <>
      <div className="axv-code-switch" role="tablist" aria-label="视图">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "table"}
          className={mode === "table" ? "on" : ""}
          onClick={() => setMode("table")}
        >
          <span className="msr" aria-hidden="true">table_chart</span>
          表格
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "code"}
          className={mode === "code" ? "on" : ""}
          onClick={() => setMode("code")}
        >
          <span className="msr" aria-hidden="true">code</span>
          代码
        </button>
      </div>
      {mode === "table" ? (
        <ValuesEditor
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
        />
      )}
    </>
  );
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
      {props.values ? (
        <ValuesTabs {...props} />
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
        />
      )}
    </div>
  );
}
