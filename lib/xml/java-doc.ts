// lib/xml/java-doc.ts — M404：查「选中类/方法」的文档（Javadoc / KDoc）
//
// 目的：代码编辑器里长按选一个类或方法 → 弹菜单「查看文档」→ 就地显示它的
//       注释文档（Javadoc / KDoc）+ 方法签名。
//
// 实现：纯文本扫描，不引 AST。
//   1. 用 parseOutline 定位符号（类 / 方法）的声明行；
//   2. 在声明行上方找紧邻的块注释（/** ... */ 或 KDoc /** ... */），剥掉 * 前缀；
//   3. 拼上签名（方法取 sig，类取 class 名）。
// 找不到符号或没有注释 → 返回 null（菜单就不显示「文档」项）。

import { parseOutline, type OutlineItem } from "./java-outline";

/** 把 Javadoc/KDoc 块注释文本剥成纯正文（去注释标记、每行前导星号、@ 标签单独留） */
function cleanDocComment(raw: string): string {
  let s = raw.replace(/^\/\*+\s*/, "").replace(/\s*\*+\/\s*$/, "").trim();
  const lines = s.split("\n");
  const out: string[] = [];
  for (const ln of lines) {
    // 去掉前导 *（Javadoc 每行以 * 开头）
    let t = ln.replace(/^[\s*]+/, "").replace(/\s+$/, "");
    // @ 标签行保留原文（@param/@return/@deprecated 等）
    if (/^@/.test(t)) t = ln.trim();
    if (t) out.push(t);
  }
  return out.join("\n").trim();
}

/** 在 src 里、lineNo(1 起) 声明行上方，找紧邻的块注释（Javadoc 或 KDoc，形如斜杠星星 ... 星斜杠）。
 *  允许中间夹注解（如 @Override）与空行。 */
function findDocAbove(src: string, lineNo: number): string | null {
  const lines = src.split("\n");
  let i = lineNo - 2; // 声明行上一行（0 起）
  // 跳过空行 + 注解行（以 @ 或 public/protected/private/abstract 等修饰符 + 注解开头）
  while (i >= 0) {
    const t = lines[i].trim();
    if (t === "" || /^@[\w$]/.test(t) || /^(public|protected|private|abstract|final|static|synchronized|strictfp)\b/.test(t)) {
      i--;
      continue;
    }
    break;
  }
  // 现在 i 指向候选注释行（可能是 */ 或 */ 的上一行）
  if (i < 0) return null;
  const t = lines[i].trim();
  if (t === "") return null;
  // i 行以注释结束符（星斜杠）结尾，或单行注释：往上找注释开头
  if (t.startsWith("/**") && t.endsWith("*/") && t.length > 4) {
    // 单行注释（斜杠星星 xxx 星斜杠）
    return cleanDocComment(t) || null;
  }
  if (!t.endsWith("*/")) return null;
  let j = i;
  while (j >= 0) {
    const tj = lines[j].trim();
    if (tj.startsWith("/**") || tj.startsWith("/*")) {
      const raw = lines.slice(j, i + 1).join("\n");
      return cleanDocComment(raw) || null;
    }
    if (tj && !tj.startsWith("*")) break;
    j--;
  }
  return null;
}

/** M404：查符号文档。
 *  @param src 当前文件全文（Java/Kotlin）
 *  @param isKotlin 是否 Kotlin
 *  @param name 要查的类名或方法名（选区 trim 后 / 光标下 token）
 *  返回拼好的文档文本（注释 + 签名），查不到或没注释返回 null */
export function symbolDoc(
  src: string,
  isKotlin: boolean,
  name: string,
): { title: string; body: string } | null {
  if (!src || !name) return null;
  const items = parseOutline(src, isKotlin);
  const hit: OutlineItem | undefined = items.find((s) => s.name === name);
  if (!hit) return null;
  const doc = findDocAbove(src, hit.line);
  const sig = hit.sig ? hit.sig : "";
  const title =
    (hit.kind === "class" ? "类 " : "方法 ") + hit.name + (sig ? " " + sig : "");
  const body = doc ? doc + (sig ? "\n\n" + sig : "") : sig || null;
  if (!doc && !sig) return null;
  return { title, body: body as string };
}
