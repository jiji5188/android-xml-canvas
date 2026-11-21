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
  /** M256：手机端日志抽屉展开时，代码区底边要上移让出抽屉高度，别被遮 */
  drawerOpen?: boolean;
  leftOpen: boolean;
  rightOpen: boolean;

  value: string;
  onChange: (next: string) => void;
  errors?: LintIssue[];
  focusLine?: number;
  focusTick?: number;
  onCursorLine?: (line: number) => void;
  /** M101：Ctrl/Cmd + 点击资源引用回调（raw 如 `@string/app_name`） */
  onRefClick?: (raw: string) => void;
  /** M209：悬停提示——把光标下 token 解析成提示文本 */
  hoverTip?: (raw: string) => string | null;
  /** M352：项目词库 ref */
  lexRef?: React.MutableRefObject<import("@/lib/xml/lexicon").Lexicon | null>;

  /** 格式化（重排缩进，保留注释） */
  onFormat: () => void;
  /** M179：一键修复可自动修的问题（资源引用拼错/方法名拼错） */
  onFixAll?: () => void;
  /** M202：修某一条（问题卡片里点「应用此修复」） */
  onFixOne?: (iss: LintIssue) => void;

  /** M38：当前文件语法（xml / java） */
  lang?: EditorLang;
  /** M40：缩进宽度（空格数） */
  indent?: number;
  /** M45：项目 res 资源名（drawable/values 等目录下的文件名），喂给关键词弹窗的 @引用补全 */
  resNames?: string[];
  /** M465：R 表索引（R. / R.layout. 候选列出项目资源引用） */
  rIndex?: Record<string, string[]>;
  /** M39/M42：当前页 —— values 文件的键值对表格（`axv-val`）还是代码编辑器（`axv-code-fill`） */
  view?: "code" | "values" | "manifest";
  /** M39：文件身份（切文件时重置视图模式） */
  fileKey?: string;
  /** M39：表格视图给个提示回调 */
  onNote?: (msg: string) => void;
  /** M341：其它 values 文件已用的顶层资源名（全局重名校验用，不含当前文件） */
  reservedNames?: string[];

  /** M405：编辑器下方插槽（调试日志面板），仅 Java 代码页显示 */
  codeSlot?: React.ReactNode;
  /** M405：运行调试回调（Java 页快捷条里的「▶ 调试」按钮） */
  onDebugRun?: () => void;
  /** M405：是否显示调试按钮（仅 Java 且有设备端编译能力时） */
  showDebugRun?: boolean;
  /** M438b：软键盘弹出（APK）——悬浮的错误说明面板（hover 提示/问题卡片/长按菜单/文档浮层）隐藏，
   *  避免键盘把浮层顶到屏幕中间挡视线。XmlEditor 顶层 useSoftKeyboard(nativeAvailable()) 检测。 */
  hideOnKeyboard?: boolean;
}

export function XmlCodeView(props: XmlCodeViewProps) {
  if (!props.open) return null;

  return (
    <div
      className="axv-mob-xml"
      style={
        props.isMobile
          ? // M256：手机端默认不写内联位置（走 CSS）；仅抽屉展开时抬底边，让出抽屉高度（mobile 抽屉高 42vh）
            props.drawerOpen
            ? { bottom: "calc(12px + 42vh)" }
            : undefined
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
          reservedNames={props.reservedNames}
        />
      ) : (
        <CodeEditor
          // M76：按文件重挂 —— 不重挂的话 history() 会跨文件，A 文件里 Ctrl+Z 能把 B 文件的内容撤回来
          key={props.fileKey || "code"}
          className="axv-code-fill"
          value={props.value}
          onChange={props.onChange}
          errors={props.errors}
          onFixAll={props.onFixAll}
          onFixOne={props.onFixOne}
          focusLine={props.focusLine}
          focusTick={props.focusTick}
          onCursorLine={props.onCursorLine}
          onFormat={props.onFormat}
          onRefClick={props.onRefClick}
          lexRef={props.lexRef}
          hoverTip={props.hoverTip}
          lang={props.lang}
          indent={props.indent}
          resNames={props.resNames}
          rIndex={props.rIndex}
          onDebugRun={props.showDebugRun ? props.onDebugRun : undefined}
          hideOnKeyboard={props.hideOnKeyboard}
        />
      )}
      {/* M405：调试日志面板（编辑器下方，仅代码页） */}
      {props.codeSlot}
    </div>
  );
}
