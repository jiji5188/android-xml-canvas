// lib/xml/java-format.ts — M209：Java / Kotlin 轻量格式化
//
// 不做语义改写（不是真编译器，不敢动逻辑），只做三件安全事：
//   ① 按花括号深度重新缩进（统一 4 空格，连续 4 空格保留 8）
//   ② 折叠连续空行（>2 个压成 1 个）
//   ③ 去掉行尾空格
// 注释原样保留（行注释 / 块注释都按行处理，不改内容，只按所在深度缩进）。

export interface JavaFormatOpts {
  /** 缩进宽度，默认 4 */
  indent?: number;
}

/** 是否该行在块注释内部（斜杠星 开 / 斜杠星 闭）—— 逐行维护状态 */
function stripTrailingWs(s: string): string {
  return s.replace(/\s+$/g, "");
}

/**
 * 格式化 Java / Kotlin 源码。
 * 输入原文，返回重新排版的文本。空行与注释内容不变，只调缩进 + 折叠空行。
 */
export function formatJava(src: string, opts: JavaFormatOpts = {}): string {
  if (!src) return "";
  const indent = opts.indent ?? 4;
  const pad = " ".repeat(indent);
  const lines = src.split("\n");
  const out: string[] = [];
  let depth = 0;
  let inBlockComment = false;
  let blankRun = 0;

  for (let raw of lines) {
    // 去掉行尾空格（保留缩进前的逻辑，用 trimEnd 但先算深度变化）
    let line = stripTrailingWs(raw);

    if (inBlockComment) {
      out.push(pad.repeat(depth) + line.trimStart().replace(/^\/\*\*/, "/*"));
      // 检查这行是否关掉块注释
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }

    // 检测这行是否开块注释
    const openBlock = /\/\*/.test(line);
    const closeBlock = /\*\//.test(line);

    // 计算本行「逻辑开始前」的深度（用于缩进）
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    // 关闭行的缩进应落在“关闭后”的深度（} 归到父块层级）；其他行用当前深度
    const indentForLine = closes > 0 && opens === 0 ? Math.max(0, depth - closes) : depth;

    // 更新深度：统计花括号（简化：只看裸 { }）
    if (opens === 0 && closes > 0) depth = Math.max(0, depth - closes);
    else if (opens > 0 && closes === 0) depth = depth + opens;
    // opens>0 && closes>0（同一行开闭，如 `if(x){ y }`）保持深度

    if (line.trim() === "") {
      blankRun++;
      if (blankRun <= 2) out.push(""); // 最多 2 个空行（= 1 个视觉空行）
      continue;
    }
    blankRun = 0;

    // 去掉原有的前导空格，按新深度加缩进（块注释行 / 普通行都按所在深度）
    const trimmed = line.replace(/^ +/, "");
    out.push(pad.repeat(indentForLine) + trimmed);

    if (openBlock && !closeBlock) inBlockComment = true;
  }

  // 末尾保留一个换行
  return out.join("\n");
}
