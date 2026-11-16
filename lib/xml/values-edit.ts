// lib/xml/values-edit.ts — M39：res/values/*.xml 的可视化编辑（纯逻辑，可单测）
//
// 设计原则：**不做全量重新序列化**。values 文件里常有注释、空行、自定义排列，
// 全量 parse → stringify 会把它们全丢掉（用户会骂人）。
// 所以这里只做「外科手术」：
//   - 解析出每个顶层条目的字符区间（name / 值 / 整个元素）
//   - 改值 = 只替换值区间；改名 = 只替换 name 属性值；删 = 删整段；加 = 插到 </resources> 前
// 原文件的注释、缩进风格、条目顺序全部原样保留。

import { themeItemType } from "./theme-item-descs";

export interface ValueItem {
  /** 元素名（string/color/dimen/…；<item type="color"> 也归成 color） */
  tag: string;
  /** 分组用的类型（string/color/dimen/integer/bool/other） */
  kind: string;
  name: string;
  value: string;
  /** 值文本在原文中的区间（含 CDATA / 实体原样） */
  valueFrom: number;
  valueTo: number;
  /** 整个元素的区间（含 <tag ...> ... </tag>，不含前后换行） */
  elemFrom: number;
  elemEnd: number;
  /** 自定义 item 的 type 属性（<item type="color">） */
  itemType?: string;
  /** name 属性值在原文中的区间，用于改名 */
  nameFrom: number;
  nameTo: number;
  /** 行号（1 基，给界面显示/定位） */
  line: number;
  /** M338：容器型条目（style/declare-styleable）的 parent 继承值 */
  parent?: string;
  /** M338：本条属于哪个容器（style 的 name），视图据此缩进 + 显示属性说明 */
  inStyle?: string;
  /** M338：层级（0=顶层/容器标题，1=容器内子项），视图缩进用 */
  depth?: number;
}

export interface ValuesDoc {
  ok: boolean;
  items: ValueItem[];
  /** <resources> 的结束标签起点（插入新条目用）；没有 </resources> 时为 -1 */
  closeAt: number;
  /** 解析失败原因 */
  reason?: string;
}

const ELEM_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR_RE = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

function attrSpan(attrs: string, attrsStart: number, want: string) {
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrs))) {
    if (m[1] !== want) continue;
    const quoted = m[2];
    const valueStart = attrsStart + m.index + m[0].indexOf(quoted) + 1;
    return { value: quoted.slice(1, -1), from: valueStart, to: valueStart + quoted.length - 2 };
  }
  return null;
}

/** 值里若含 CDATA，取 CDATA 里的内容做展示（写回时仍然整体替换） */
function displayValue(raw: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  return m ? m[1] : raw;
}

/** 容器型条目：内部嵌套 <item>/<attr>，不是单值键值（M315） */
function isContainerTag(tag: string): boolean {
  return tag === "style" || tag === "declare-styleable" || tag === "attr";
}

/** 把容器内部的嵌套 <item>/<attr> 展开成逐行（M315）；值区间对准子元素，保留可编辑 */
function emitContainerChildren(xml: string, bodyFrom: number, raw: string, items: ValueItem[]) {
  const re = /<(item|attr)\b([^>]*?)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const childTag = m[1];
    const childAttrs = m[2];
    const childBody = m[3];
    const childFullLen = m[0].length;
    const absStart = bodyFrom + m.index;
    const nameM = /name\s*=\s*("([^"]*)"|'([^']*)')/g.exec(childAttrs);
    const typeM = /type\s*=\s*("([^"]*)"|'([^']*)')/g.exec(childAttrs);
    const nameVal = nameM ? nameM[2] || nameM[3] || "" : "";
    const typeVal = typeM ? typeM[2] || typeM[3] || "" : "";
    // 开标签长度 = 全长 - 体 - 闭标签（</item> / </attr>）
    const closeLen = ("</" + childTag + ">").length;
    const openLen = childFullLen - childBody.length - closeLen;
    const vFrom = absStart + openLen;
    const vTo = vFrom + childBody.length;
    const nameOffset = nameM != null ? childAttrs.indexOf(nameVal) : -1;
    // 子元素开标签内 name 值起点：absStart + "<item"/"<attr" 长度 + attrs 中 nameVal 偏移
    const tagLen = ("<" + childTag).length;
    const nameFrom = nameOffset >= 0 ? absStart + tagLen + nameOffset : vFrom;
    items.push({
      tag: childTag === "item" ? "item" : "attr",
      kind: childTag === "item" ? typeVal || "other" : "attr",
      name: nameVal,
      value: displayValue(childBody),
      valueFrom: vFrom,
      valueTo: vTo,
      elemFrom: absStart,
      elemEnd: absStart + childFullLen,
      itemType: typeVal || undefined,
      nameFrom,
      nameTo: nameFrom + nameVal.length,
      line: lineAt(xml, absStart),
    });
  }
}

export function parseValues(xml: string): ValuesDoc {
  const items: ValueItem[] = [];
  let closeAt = -1;
  let depth = 0;
  let sawResources = false;
  /** 当前顶层条目（等着它的闭合标签来确定值区间） */
  let pending: {
    tag: string;
    start: number;
    bodyFrom: number;
    attrs: string;
    attrsStart: number;
    depth: number;
  } | null = null;

  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;

    // CDATA / 注释 / PI / DOCTYPE 整体跳过（里面可能含 <tag>，不能当元素）
    if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt);
      i = e < 0 ? xml.length : e + 3;
      continue;
    }
    if (xml.startsWith("<!--", lt)) {
      const e = xml.indexOf("-->", lt);
      i = e < 0 ? xml.length : e + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const e = xml.indexOf("?>", lt);
      i = e < 0 ? xml.length : e + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      const e = xml.indexOf(">", lt);
      i = e < 0 ? xml.length : e + 1;
      continue;
    }

    ELEM_RE.lastIndex = lt;
    const m = ELEM_RE.exec(xml);
    if (!m || m.index !== lt) {
      i = lt + 1;
      continue;
    }
    const [whole, slash, tag, attrs, selfClose] = m;
    const at = m.index;
    i = at + whole.length;

    if (slash) {
      // 闭合标签
      if (tag === "resources") {
        closeAt = at;
        sawResources = true;
        depth = 0;
        continue;
      }
      if (pending && pending.tag === tag && depth === pending.depth + 1) {
        const nameAttr = attrSpan(pending.attrs, pending.attrsStart, "name");
        const typeAttr = attrSpan(pending.attrs, pending.attrsStart, "type");
        // M315：容器型（style/declare-styleable/attr）展开嵌套 item 逐行，不再整块塞进 value（否则视图显示 &lt;item&gt; 乱码）
        if (isContainerTag(pending.tag)) {
          // M338：容器标题行先入列（样式节点 name + parent 在前，子项缩进在后），
          // 视图才能呈现「样式 → 属性配置」的层级，而不是子项飘在标题上面。
          const parentAttr = attrSpan(pending.attrs, pending.attrsStart, "parent");
          const styleName = nameAttr ? nameAttr.value : "";
          if (nameAttr) {
            items.push({
              tag: pending.tag,
              kind: kindOf(pending.tag, typeAttr?.value),
              name: nameAttr.value,
              value: "",
              valueFrom: -1,
              valueTo: -1,
              elemFrom: pending.start,
              elemEnd: at + whole.length,
              itemType: typeAttr?.value,
              nameFrom: nameAttr.from,
              nameTo: nameAttr.to,
              line: lineAt(xml, pending.start),
              parent: parentAttr?.value,
              depth: 0,
            });
          }
          const before = items.length;
          emitContainerChildren(xml, pending.bodyFrom, xml.slice(pending.bodyFrom, at), items);
          for (let k = before; k < items.length; k++) {
            const child = items[k];
            child.inStyle = styleName;
            child.depth = 1;
            // M338：style 里的 <item name="colorPrimary"> 没写 type，
            // 用属性说明表把类型补上（否则全部挤到「其他」，按类型筛就筛不出来）
            if (!child.itemType && child.kind === "other") {
              const ty = themeItemType(child.name);
              if (ty !== "other" && ty !== "text") child.kind = ty;
            }
          }
        } else if (nameAttr) {
          const raw = xml.slice(pending.bodyFrom, at);
          items.push({
            tag: pending.tag,
            kind: kindOf(pending.tag, typeAttr?.value),
            name: nameAttr.value,
            value: displayValue(raw),
            valueFrom: pending.bodyFrom,
            valueTo: at,
            elemFrom: pending.start,
            elemEnd: at + whole.length,
            itemType: typeAttr?.value,
            nameFrom: nameAttr.from,
            nameTo: nameAttr.to,
            line: lineAt(xml, pending.start),
          });
        }
        pending = null;
      }
      depth = Math.max(0, depth - 1);
      continue;
    }

    // 开标签
    if (tag === "resources") {
      sawResources = true;
      depth = 0;
      continue;
    }
    if (!sawResources) continue;

    if (depth === 0) {
      if (selfClose) {
        // <string name="x" /> —— 空值条目
        const nameAttr = attrSpan(attrs, at + 1 + tag.length, "name");
        if (nameAttr) {
          const typeAttr = attrSpan(attrs, at + 1 + tag.length, "type");
          items.push({
            tag,
            kind: kindOf(tag, typeAttr?.value),
            name: nameAttr.value,
            value: "",
            valueFrom: at + whole.length,
            valueTo: at + whole.length,
            elemFrom: at,
            elemEnd: at + whole.length,
            itemType: typeAttr?.value,
            nameFrom: nameAttr.from,
            nameTo: nameAttr.to,
            line: lineAt(xml, at),
          });
        }
      } else {
        pending = {
          tag,
          start: at,
          bodyFrom: at + whole.length,
          attrs,
          attrsStart: at + 1 + tag.length,
          depth: 0,
        };
        depth = 1;
      }
      continue;
    }

    // 顶层条目里面的嵌套标签（如 <style> 下的 <item>）只计深度
    if (!selfClose) depth++;
  }

  if (!sawResources) {
    return { ok: false, items: [], closeAt: -1, reason: "没找到 <resources> 根节点" };
  }
  if (closeAt < 0) {
    return { ok: false, items, closeAt: -1, reason: "没找到 </resources> 结束标签" };
  }
  return { ok: true, items, closeAt };
}

function kindOf(tag: string, itemType?: string): string {
  if (tag === "item") return itemType || "other";
  if (tag === "string") return "string";
  if (tag === "color") return "color";
  if (tag === "dimen") return "dimen";
  if (tag === "integer") return "integer";
  if (tag === "bool") return "bool";
  return "other";
}

/** 位置 → 行号（1 基） */
export function lineAt(text: string, pos: number): number {
  let n = 1;
  for (let i = 0; i < pos && i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** values 里的文本转义（只处理会破坏 XML 的三个字符） */
export function escValue(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 颜色的宽松校验：支持 #RGB/#ARGB/#RRGGBB/#AARRGGBB 与 @color/ 引用 */
export function isColorValue(v: string): boolean {
  const s = v.trim();
  return /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(s) || /^@color\//.test(s);
}

/** #RGB / #ARGB → #RRGGBB / #AARRGGBB（色块预览用；不合法的返回 null） */
export function colorForPreview(v: string): string | null {
  const s = v.trim();
  if (!/^#[0-9a-f]+$/i.test(s)) return null;
  const h = s.slice(1);
  if (h.length === 3) return "#" + h.split("").map((c) => c + c).join("");
  if (h.length === 4) {
    // #ARGB → 丢掉 alpha，前三位转成 6 位
    return "#" + h.slice(1).split("").map((c) => c + c).join("");
  }
  if (h.length === 6) return s;
  if (h.length === 8) return "#" + h.slice(2);
  return null;
}

/* ===== 编辑（全部返回新字符串，不改原对象） ===== */

/** 改某条目的值 */
export function setItemValue(xml: string, item: ValueItem, nextValue: string): string {
  // M315：容器分组标题行（valueFrom=-1）不参与值编辑，原样返回，避免 slice(-1) 截断文件
  if (item.valueFrom < 0 || item.valueTo < item.valueFrom) return xml;
  return xml.slice(0, item.valueFrom) + escValue(nextValue) + xml.slice(item.valueTo);
}

/** 改某条目的 name（调用方负责查重） */
export function setItemName(xml: string, item: ValueItem, nextName: string): string {
  if (item.nameFrom < 0 || item.nameTo < item.nameFrom) return xml;
  return xml.slice(0, item.nameFrom) + nextName + xml.slice(item.nameTo);
}

/** 删除条目：连同它所在的那一行一起删（吞掉行尾换行 + 前置缩进） */
export function removeItem(xml: string, item: ValueItem): string {
  let from = item.elemFrom;
  let to = item.elemEnd;
  // 往前吃掉同一行的缩进
  while (from > 0 && (xml[from - 1] === " " || xml[from - 1] === "\t")) from--;
  // 往后吃掉行尾空白 + 一个换行
  while (to < xml.length && (xml[to] === " " || xml[to] === "\t")) to++;
  if (xml[to] === "\r") to++;
  if (xml[to] === "\n") to++;
  return xml.slice(0, from) + xml.slice(to);
}

/** 渲染一条新条目的 XML（按文件既有缩进） */
export function renderItem(
  tag: string,
  name: string,
  value: string,
  opts: { itemType?: string; indent?: string } = {},
): string {
  const indent = opts.indent ?? "    ";
  const typeAttr = tag === "item" && opts.itemType ? ` type="${opts.itemType}"` : "";
  return `${indent}<${tag}${typeAttr} name="${name}">${escValue(value)}</${tag}>`;
}

/** 探测文件里顶层条目的缩进（默认 4 空格） */
export function detectIndent(xml: string, doc?: ValuesDoc): string {
  const d = doc || parseValues(xml);
  const first = d.items[0];
  if (first) {
    let i = first.elemFrom;
    let n = 0;
    while (i > 0 && (xml[i - 1] === " " || xml[i - 1] === "\t")) {
      i--;
      n++;
    }
    if (n > 0) {
      const s = xml.slice(i, first.elemFrom);
      if (s.includes("\t")) return "\t";
      if (n <= 8) return " ".repeat(n);
    }
  }
  return "    ";
}

/** 在 </resources> 前追加一条（保持缩进与换行风格） */
export function appendItem(
  xml: string,
  entry: { tag: string; name: string; value: string; itemType?: string },
  doc?: ValuesDoc,
): string {
  const d = doc || parseValues(xml);
  if (d.closeAt < 0) return xml;
  const indent = detectIndent(xml, d);
  const crlf = xml.includes("\r\n");
  const nl = crlf ? "\r\n" : "\n";
  const line = renderItem(entry.tag, entry.name, entry.value, {
    itemType: entry.itemType,
    indent,
  });

  // </resources> 前面若已有换行与缩进，就直接插在那一行开头
  let insertAt = d.closeAt;
  while (insertAt > 0 && (xml[insertAt - 1] === " " || xml[insertAt - 1] === "\t")) insertAt--;
  if (insertAt > 0 && xml[insertAt - 1] === "\n") {
    return xml.slice(0, insertAt) + line + nl + xml.slice(insertAt);
  }
  // 单行文件：<resources></resources>
  return xml.slice(0, insertAt) + nl + line + nl + xml.slice(insertAt);
}

/** name 是否已存在（查重用） */
export function hasName(doc: ValuesDoc, name: string, except?: ValueItem): boolean {
  return doc.items.some((i) => i !== except && i.name === name);
}

/** 生成不重名的 name：foo → foo_2 → foo_3 */
export function uniqueName(doc: ValuesDoc, base: string): string {
  const clean = (base || "item").replace(/[^A-Za-z0-9_]/g, "_").replace(/^(\d)/, "_$1");
  if (!hasName(doc, clean)) return clean;
  let n = 2;
  while (hasName(doc, `${clean}_${n}`)) n++;
  return `${clean}_${n}`;
}

/** 按内容判断：根节点是不是 <resources>（网页项目里的文件可能没有完整路径） */
export function looksLikeValuesDoc(xml: string): boolean {
  if (!xml) return false;
  const head = xml.slice(0, 4000).replace(/^\uFEFF/, "");
  const at = head.search(/<resources[\s>]/);
  if (at < 0) return false;
  // 根节点之前只能有 XML 声明/注释/空白
  const before = head
    .slice(0, at)
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return before.trim() === "";
}

/** 界面上按类型分组时的显示名/顺序 */
export const KIND_LABEL: Record<string, string> = {
  string: "字符串",
  color: "颜色",
  dimen: "尺寸",
  integer: "整数",
  bool: "布尔",
  other: "其他",
};
