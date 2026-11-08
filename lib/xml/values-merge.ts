// lib/xml/values-merge.ts — M183c：values 片段合并（按 kind/name 去重）
//
// 背景（用户 2026-11-08 报的问题）：
//   colors.xml 和 strings.xml 本来是两份很小的文件，但代码编辑器里出现了三千多条重复的
//   颜色 + 文字配置。原因不是编辑器渲染，而是 resExtras.valuesXml 被「拼接式合并」：
//     mergeProjectExtras(prev, next) → valuesXml: [prev, next].join("\n")
//   而「打开文件 → 载入项目资源」的 effect 每次触发都会 merge 一遍（quick + full 两次），
//   于是每轮把整份 values 文本再叠一份；导出/保存资源时 wrapValues() 又把这份累积文本
//   写回项目 values/res_values.xml —— 越叠越肥，最后就是几千条重复定义（aapt2 也会报
//   duplicate value）。
//
// 这里提供「按资源键去重」的合并：同一个 kind/name 只留最后一份（后到的覆盖先到的），
// 合并是幂等的 —— 同样的输入 merge 多少次，结果都一样。

/** 会被当成「值资源」的标签 */
const VALUE_TAGS =
  "string|color|dimen|integer|bool|fraction|plurals|array|string-array|integer-array|item|attr|declare-styleable|style|eat-comment";

const ELEM_RE = new RegExp(
  `<(?:${VALUE_TAGS})\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/(?:${VALUE_TAGS})>)`,
  "g",
);

export interface ValueElement {
  /** 去重键：kind/name（无 name 的用原文做键） */
  key: string;
  /** 原始元素文本 */
  text: string;
}

function nameOf(head: string): string {
  return (head.match(/\bname\s*=\s*"([^"]*)"/) || [])[1] || "";
}

/**
 * 把 values 片段拆成顶层元素（自动忽略 <?xml?>、<resources> 包裹、注释）。
 * 解析失败的片段不抛错，尽量把能认出来的元素取出来。
 */
export function splitValueElements(fragment: string): ValueElement[] {
  const out: ValueElement[] = [];
  if (!fragment) return out;
  const src = fragment.replace(/<\?xml[^>]*\?>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const re = new RegExp(ELEM_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const text = m[0];
    const tag = (/^<\s*([A-Za-z-]+)/.exec(text) || [])[1] || "item";
    const head = text.slice(0, text.indexOf(">") + 1);
    const name = nameOf(head);
    // 没名字的元素（declare-styleable 之外很少见）用原文当键，至少不会自我复制
    const key = name ? `${tag}/${name}` : `#${text}`;
    out.push({ key, text });
  }
  return out;
}

/** 只保留唯一元素（后者覆盖前者，位置按首次出现） */
export function dedupeValuesFragment(fragment: string): string {
  const els = splitValueElements(fragment);
  if (els.length === 0) return fragment.trim();
  const order: string[] = [];
  const map = new Map<string, string>();
  for (const e of els) {
    if (!map.has(e.key)) order.push(e.key);
    map.set(e.key, e.text);
  }
  return order.map((k) => map.get(k)!).join("\n");
}

/** 片段里定义的资源键集合（kind/name） */
export function valuesKeys(fragment: string): Set<string> {
  return new Set(splitValueElements(fragment).map((e) => e.key));
}

/**
 * 合并两段 values 片段：a 的顺序在前，b 的新键追加在后；同一个键以 b 为准。
 * 幂等：mergeValuesFragments(x, x) === dedupeValuesFragment(x)。
 */
export function mergeValuesFragments(a: string, b: string): string {
  const ea = splitValueElements(a);
  const eb = splitValueElements(b);
  const order: string[] = [];
  const map = new Map<string, string>();
  for (const e of ea) {
    if (!map.has(e.key)) order.push(e.key);
    map.set(e.key, e.text);
  }
  for (const e of eb) {
    if (!map.has(e.key)) order.push(e.key);
    map.set(e.key, e.text);
  }
  return order.map((k) => map.get(k)!).join("\n");
}
