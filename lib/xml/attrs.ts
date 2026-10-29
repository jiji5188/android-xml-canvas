// lib/xml/attrs.ts — 属性级「手术式」改写（M3c）
//
// 旧做法：parse 整棵树 → 改属性 → serialize 全文重写。
// 后果：注释全被搬到文件末尾、属性顺序被重排、缩进和空行全丢。
// 属性面板改一次字号就把用户的排版洗一遍，这个不能接受。
//
// 现在只动目标节点开标签里的那几个属性 token，其余字节一个不碰。
// 支持：改已有属性值、新增属性（自动补 android:/app: 前缀与 xmlns:app）、删除属性。

import { scanElements, elementAt } from "./reorder";
import { scanElements, elementAt } from "./reorder";
import { ANDROIDX_ATTRS } from "./namespace";

/** ConstraintLayout / MotionLayout 专用属性：必须用 app: 前缀 */
export const APP_ATTR_RE =
  /^(layout_constraint|layout_guideline|layout_barrier|layout_wrapBehavior|layout_optimizationLevel|layout_behavior|layout_anchor|layout_keyline|layout_scrollFlags|layout_collapseMode|layout_collapseParallaxMultiplier|flow_|motion_|constraint_referenced_ids|constraint_referenced_tags|barrierDirection|barrierMargin|barrierAllowsGoneWidgets|visibilityMode)/;

/** M12：新属性该用哪个前缀（androidx/Material 库属性 → app:） */
export function attrPrefixFor(name: string): "app" | "android" {
  return APP_ATTR_RE.test(name) || ANDROIDX_ATTRS.has(name) ? "app" : "android";
}

export const APP_NS = "http://schemas.android.com/apk/res-auto";
export const ANDROID_NS = "http://schemas.android.com/apk/res/android";

const NAME_CH = /[\w:.\-]/;

interface AttrToken {
  /** 完整名（含前缀，如 android:text / xmlns:app） */
  name: string;
  /** 不带前缀的名字 */
  bare: string;
  value: string;
  /** 属性名起点 */
  start: number;
  /** 值（含引号）结束位置 */
  end: number;
  quote: string;
}

/** 扫描开标签内的属性 token；[from, to) 是标签名之后、'>' 或 '/>' 之前的区间 */
function scanAttrs(xml: string, from: number, to: number): AttrToken[] {
  const out: AttrToken[] = [];
  let i = from;
  while (i < to) {
    // 跳过空白
    while (i < to && /\s/.test(xml[i])) i++;
    if (i >= to) break;
    const ns = i;
    while (i < to && NAME_CH.test(xml[i])) i++;
    if (i === ns) {
      i++; // 异常字符，跳过防死循环
      continue;
    }
    const name = xml.slice(ns, i);
    while (i < to && /\s/.test(xml[i])) i++;
    if (xml[i] !== "=") {
      // 无值属性（HTML 风格），Android XML 不应出现；跳过
      continue;
    }
    i++; // '='
    while (i < to && /\s/.test(xml[i])) i++;
    const q = xml[i];
    if (q !== '"' && q !== "'") {
      continue;
    }
    const vs = i + 1;
    const ve = xml.indexOf(q, vs);
    if (ve < 0 || ve > to) break;
    const value = xml.slice(vs, ve);
    const colon = name.indexOf(":");
    out.push({
      name,
      bare: colon >= 0 ? name.slice(colon + 1) : name,
      value,
      start: ns,
      end: ve + 1,
      quote: q,
    });
    i = ve + 1;
  }
  return out;
}

/** 从开标签文本里推断属性缩进（优先取独立成行的属性前导空白） */
function detectIndent(xml: string, from: number, to: number): string {
  const seg = xml.slice(from, to);
  const m = seg.match(/\n([ \t]+)\S/);
  if (m) return "\n" + m[1];
  return "\n    ";
}

/** 选一个不会把值写坏的引号：值里有双引号且没单引号时用单引号包裹 */
function quoteFor(value: string): { q: string; v: string } {
  if (value.includes('"') && !value.includes("'")) return { q: "'", v: value };
  return { q: '"', v: value };
}

export interface SetAttrsResult {
  xml: string;
  changed: boolean;
  /** 实际写入/删除的属性名（带前缀） */
  touched: string[];
}

/**
 * 修改节点属性（文本级）。
 * @param add 要设置/新增的属性（名不带前缀，如 text / layout_constraintTop_toTopOf）
 * @param remove 要删除的属性名（同样不带前缀）
 */
export function setNodeAttrs(
  xml: string,
  path: string,
  add: Record<string, string>,
  remove?: string[],
): SetAttrsResult {
  const el = elementAt(scanElements(xml), path);
  if (!el) return { xml, changed: false, touched: [] };

  // 标签名之后的起始位置
  let i = el.start + 1;
  while (i < el.openEnd && /\s/.test(xml[i])) i++;
  while (i < el.openEnd && !/[\s/>]/.test(xml[i])) i++;
  const nameEnd = i;
  const contentEnd = el.selfClosing ? el.openEnd - 2 : el.openEnd - 1;
  const tokens = scanAttrs(xml, nameEnd, contentEnd);

  const byBare = new Map<string, AttrToken>();
  for (const t of tokens) {
    if (!t.name.startsWith("xmlns")) byBare.set(t.bare, t);
  }
  /** 自己或文档里任何祖先已经声明过 xmlns:app 就不用再写（命名空间是继承的，重复声明纯属噪声） */
  const hasNsApp = tokens.some((t) => t.name === "xmlns:app") || xml.includes("xmlns:app=");

  const edits: { start: number; end: number; text: string }[] = [];
  const touched: string[] = [];

  // 删除
  for (const bareName of remove ?? []) {
    const t = byBare.get(bareName);
    if (!t) continue;
    // 连同前面的空白一起删（保持行数整洁）
    let s = t.start;
    while (s > nameEnd && /[ \t]/.test(xml[s - 1])) s--;
    if (xml[s - 1] === "\n") s--; // 整个属性行都删掉
    edits.push({ start: s, end: t.end, text: "" });
    byBare.delete(bareName);
    touched.push(t.name);
  }

  // 新增 / 更新
  const pending: { full: string; value: string }[] = [];
  for (const [rawName, rawValue] of Object.entries(add)) {
    const bare = rawName.includes(":") ? rawName.slice(rawName.indexOf(":") + 1) : rawName;
    const prefix = rawName.includes(":")
      ? rawName.slice(0, rawName.indexOf(":"))
      : attrPrefixFor(bare);
    const full = `${prefix}:${bare}`;
    const existing = byBare.get(bare);
    if (existing) {
      if (existing.value === rawValue) continue;
      const { q, v } = quoteFor(rawValue);
      edits.push({
        start: existing.start,
        end: existing.end,
        text: `${existing.name}=${q}${v}${q}`,
      });
      touched.push(full);
    } else {
      pending.push({ full, value: rawValue });
      touched.push(full);
    }
  }

  // 新属性统一插在最后一个属性之后
  if (pending.length) {
    const indent = detectIndent(xml, nameEnd, contentEnd);
    const anchor = tokens.length ? tokens[tokens.length - 1].end : nameEnd;
    /** 同一次调用只补一次 xmlns:app（以前没这个标记，一次加两个 app: 属性会写出两份声明） */
    let nsAppDone = hasNsApp;
    let text = "";
    for (const p of pending) {
      // app: 属性首次出现时补 xmlns:app
      if (p.full.startsWith("app:") && !nsAppDone) {
        text += `${indent}xmlns:app="${APP_NS}"`;
        nsAppDone = true;
      }
      const { q, v } = quoteFor(p.value);
      text += `${indent}${p.full}=${q}${v}${q}`;
    }
    edits.push({ start: anchor, end: anchor, text });
    // ⚠️ 不要再动 "/>"：插入点在斜杠之前，标签结尾本就完整。
    // 历史 bug：这里曾把自闭合末尾的斜杠删掉 → 控件变成没闭合的 <Xxx ... >，
    // 整篇 XML 非法；之后层级调整/拖拽在错位的节点区间上切片，才会丢节点、重复节点。
  }

  if (!edits.length) return { xml, changed: false, touched: [] };

  // 从后往前替换，保证偏移有效
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = xml;
  let lastStart = Number.POSITIVE_INFINITY;
  for (const e of edits) {
    if (e.end > lastStart) continue; // 重叠的跳过
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return { xml: out, changed: out !== xml, touched };
}
