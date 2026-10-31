// lib/xml/editor-lang.ts — M38：代码编辑器用哪种语法（XML / Java）
//
// 编辑器（CodeMirror 6）需要提前知道语言，才能挂对应的解析器。
// 判定只看文件名/相对路径后缀，不值得看内容。

export type EditorLang = "xml" | "java";

/** .java / .kt / .kts → java（Kotlin 没有 CM6 官方包，先用 Java 语法近似；缩进/关键字八成对得上） */
export function pickLang(relOrName?: string | null): EditorLang {
  if (!relOrName) return "xml";
  const name = relOrName.replace(/\\/g, "/").split("/").pop() || "";
  if (/\.(java|kt|kts)$/i.test(name)) return "java";
  return "xml";
}

/** 给徽标/提示用的人话 */
export function langLabel(l: EditorLang): string {
  return l === "java" ? "Java" : "XML";
}
