// lib/xml/text-style.ts — M72（C7）：落盘文本的换行 / BOM 统一
//
// 问题：手动保存写的是编辑器里的原文（CRLF 就是 CRLF、带 BOM 就还带 BOM），
// 而 AI 的 apply_patch 拼出来的新文本一律是 JS 的 "\n"、且会丢掉原文件的 BOM。
// 结果：同一个文件经 AI 改一次，git diff 里整份都变（每行都算改动），
// 有些 Java 工具链对 BOM 敏感，也可能因此报错。
//
// 这里只做一件事：让「写出去的文本」跟「原来那个文件」用同一套换行与 BOM。

export interface TextStyle {
  /** 主换行符 */
  eol: "\n" | "\r\n";
  /** 原文件是否带 UTF-8 BOM */
  bom: boolean;
}

export const BOM = "\uFEFF";

export function detectEol(text: string): "\n" | "\r\n" {
  if (!text) return "\n";
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/\n/g) || []).length - crlf;
  // 有 CRLF 就算 CRLF 文件（Windows 项目混入少数 LF 时也按 CRLF 归一）
  return crlf > 0 && crlf >= lf * 0.5 ? "\r\n" : "\n";
}

export function detectTextStyle(prev: string | null | undefined): TextStyle {
  const p = prev ?? "";
  return { eol: detectEol(p), bom: p.startsWith(BOM) };
}

/** 把文本的换行统一成 eol（先归一到 \n，再统一展开，避免 \r\r\n） */
export function normalizeEol(text: string, eol: "\n" | "\r\n"): string {
  const lf = text.replace(/\r\n?/g, "\n");
  return eol === "\n" ? lf : lf.replace(/\n/g, "\r\n");
}

export function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

/**
 * 按原文件风格准备要写入的文本。
 * - 原文件是 CRLF → 新文本也写 CRLF
 * - 原文件带 BOM → 新文本保留 BOM；原来没有 → 去掉模型可能带进来的 BOM
 * - 新文件（prev 为 null）→ 保持传入文本原样（不擅自加 BOM / 改换行）
 */
export function prepareWriteText(
  next: string,
  prev: string | null | undefined,
): { text: string; style: TextStyle | null; converted: boolean } {
  if (prev === null || prev === undefined) {
    return { text: next, style: null, converted: false };
  }
  const style = detectTextStyle(prev);
  let out = normalizeEol(stripBom(next), style.eol);
  if (style.bom) out = BOM + out;
  const converted = out !== next;
  return { text: out, style, converted };
}

/** 人话说明（只在真的改动了换行/BOM 时给） */
export function styleNote(style: TextStyle | null, converted: boolean): string {
  if (!style || !converted) return "";
  const bits: string[] = [];
  if (style.eol === "\r\n") bits.push("CRLF 换行");
  if (style.bom) bits.push("UTF-8 BOM");
  return bits.length ? `（已按原文件统一为 ${bits.join(" + ")}）` : "";
}
