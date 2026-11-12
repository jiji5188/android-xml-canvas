// lib/xml/res-ref.ts
//
// 「这段文本里有哪些 @type/name 资源引用」的唯一口径。
// 以前 res-collect（收资源）和 xml-res-check（查拼写）各写一条正则，
// 类型白名单也不一样 —— 一边认 @menu/，另一边当成没写过，最容易出「明明有却报找不到」。
//
// 规则（两边共同遵守）：
//   - 必须带类型前缀：@drawable/x 认，@x 不认
//   - 跳过声明与框架资源：@+id/x（声明）、@android:x/y、@*android:x/y
//   - 名字里允许 . 和 _（@drawable/ic_launcher.xml 这种少见写法也认，扩展名由调用方剥）

/** 认作「项目内资源」的类型（框架/AAR 常见类型之外，其余一律不碰，避免误报） */
export const RES_REF_TYPES = [
  "drawable",
  "mipmap",
  "layout",
  "color",
  "string",
  "dimen",
  "bool",
  "integer",
  "style",
  "plurals",
  "array",
  "string-array",
  "integer-array",
  "fraction",
  "menu",
  "anim",
  "animator",
  "xml",
  "font",
  "interpolator",
  "id",
] as const;

export type ResRefType = (typeof RES_REF_TYPES)[number];

const TYPE_ALT = [...RES_REF_TYPES]
  // 长的放前面，避免 string 抢先匹配 string-array 的前缀（正则回溯能救，但显式更稳）
  .sort((a, b) => b.length - a.length)
  .join("|");

/** 全局正则：调用方每次用完必须自己重置 lastIndex（或者直接用 resRefsIn） */
export const RES_REF_RE = new RegExp(`@(?!\\+)(?!\\*?android:)(${TYPE_ALT})\\/([A-Za-z0-9_.]+)`, "g");

export interface ResRef {
  /** 资源类型，如 drawable / string-array */
  type: ResRefType;
  /** 引用里写的名字（未剥扩展名） */
  name: string;
  /** 原文，如 @drawable/ic_home */
  raw: string;
  /** 在 text 里的起始偏移 */
  index: number;
}

/** 扫出文本里所有资源引用（自动管理 lastIndex，可安全重复调用） */
export function resRefsIn(text: string): ResRef[] {
  const out: ResRef[] = [];
  if (!text) return out;
  RES_REF_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RES_REF_RE.exec(text)) !== null) {
    out.push({
      type: m[1] as ResRefType,
      name: m[2],
      raw: m[0],
      index: m.index,
    });
    // 零宽匹配防御（理论上不会发生，但别让死循环有机会）
    if (m.index === RES_REF_RE.lastIndex) RES_REF_RE.lastIndex++;
  }
  return out;
}

/** 引用名字里的扩展名（@drawable/ic_launcher.png 这种少见但见过） */
export function stripResExt(name: string): string {
  return name.replace(/\.(9\.)?(png|jpg|jpeg|webp|gif|xml)$/i, "");
}
