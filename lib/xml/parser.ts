// lib/xml/parser.ts — XML 文本 → 归一化树（M1：基础布局子集）
// 纯函数，浏览器/Node 双端可用（不依赖 DOMParser，自带轻量 XML 解析器，
// 规避 M3E 运行环境里 Node 冒烟脚本拿不到 DOM 的问题）。

import type { XmlNode, XmlIssue } from "./types";

/** M1 支持的标签（其余走 unknown 占位，不阻断） */
export const KNOWN_TAGS = new Set([
  "LinearLayout", "FrameLayout", "ScrollView", "HorizontalScrollView",
  "TextView", "Button", "ImageView", "EditText", "ProgressBar", "View",
  "Space", "ImageView",
  // M2c：ConstraintLayout 专用辅助节点
  "Guideline", "Barrier",
]);

/** 轻量 XML 解析（支持属性、嵌套、注释、自闭合；不支持 CDATA/实体除标准五件套） */
export function parseLayoutXml(xml: string, resourceDeclOk = true): { root: XmlNode | null; issues: XmlIssue[] } {
  const issues: XmlIssue[] = [];
  // 去掉 XML 声明与 doctype
  const text = xml
    .replace(/^<\?xml[\s\S]*?\?>/i, "")
    .replace(/<!DOCTYPE[\s\S]*?>/i, "");

  // M2y：行号索引（记录每一行首字符的偏移，offset → 1 基行号）
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") lineStarts.push(i + 1);
  }
  const lineOf = (offset: number): number => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  };

  const pos = { i: 0, lineOf } as { i: number; lineOf: (o: number) => number };
  const root = parseElement(text, pos, "#0", issues);
  if (!root && text.trim() !== "") {
    issues.push({ level: "error", nodePath: "#0", message: "无法解析根元素（XML 可能不完整）" });
  }
  return { root, issues };
}

function skipWs(s: string, pos: { i: number }): void {
  while (pos.i < s.length && /\s/.test(s[pos.i])) pos.i++;
}

function parseElement(s: string, pos: { i: number; lineOf?: (o: number) => number }, path: string, issues: XmlIssue[]): XmlNode | null {
  skipWs(s, pos);
  // 注释：跳过并继续找元素
  while (s.startsWith("<!--", pos.i)) {
    const end = s.indexOf("-->", pos.i);
    pos.i = end === -1 ? s.length : end + 3;
    skipWs(s, pos);
  }
  if (!s.startsWith("<", pos.i)) return null;
  const openIdx = pos.i; // M2y：标签起始偏移（取行号用）
  pos.i++;
  const tagStart = pos.i;
  while (pos.i < s.length && !/[>\s/]/.test(s[pos.i])) pos.i++;
  let tag = s.slice(tagStart, pos.i).trim();
  // 自闭合标签 <tag/> 的 tag 可能吃到 “/”（例如 <TextView/>），去掉斜杠
  if (tag.endsWith("/")) tag = tag.slice(0, -1).trim();
  if (tag === "") {
    issues.push({ level: "warn", nodePath: path, message: "空标签名" });
    return null;
  }

  const attrs: Record<string, string> = {};
  const nsDecls: Record<string, string> = {};
  let selfClosed = false; // <tag ... /> 无子元素
  // 解析属性
  while (true) {
    skipWs(s, pos);
    if (pos.i >= s.length) break;
    const ch = s[pos.i];
    if (ch === "/") {
      pos.i++;
      selfClosed = true;
      break;
    }
    if (ch === ">") {
      pos.i++;
      break;
    }
    // 属性名
    const nameStart = pos.i;
    while (pos.i < s.length && !/[=\s>\/]/.test(s[pos.i])) pos.i++;
    const name = s.slice(nameStart, pos.i).trim();
    if (name === "") {
      pos.i++;
      continue;
    }
    // 命名空间声明（xmlns:xxx）不存入 attrs，否则回写时会变成 android:android="..."
    const colonIdx = name.indexOf(":");
    const prefix = colonIdx !== -1 ? name.slice(0, colonIdx) : "";
    const isTools = prefix === "tools";
    const isXmlns = prefix === "xmlns" || name.startsWith("xmlns");
    const localName = colonIdx !== -1 ? name.slice(colonIdx + 1) : name;
    if (isXmlns) {
      // 命名空间声明存进 nsDecls（writeback 时补回，不进 attrs）
      skipWs(s, pos);
      if (s[pos.i] === "=") {
        pos.i++;
        skipWs(s, pos);
        const q = s[pos.i];
        if (q === '"' || q === "'") {
          pos.i++;
          const vStart = pos.i;
          while (pos.i < s.length && s[pos.i] !== q) pos.i++;
          nsDecls[localName] = s.slice(vStart, pos.i);
          pos.i++; // 过引号
        } else {
          const vStart = pos.i;
          while (pos.i < s.length && !/[>\s]/.test(s[pos.i])) pos.i++;
          nsDecls[localName] = s.slice(vStart, pos.i);
        }
      }
      continue;
    }
    skipWs(s, pos);
    let value = "";
    if (s[pos.i] === "=") {
      pos.i++;
      skipWs(s, pos);
      const q = s[pos.i];
      if (q === '"' || q === "'") {
        pos.i++;
        const vStart = pos.i;
        while (pos.i < s.length && s[pos.i] !== q) pos.i++;
        value = unescapeXml(s.slice(vStart, pos.i));
        pos.i++; // 过引号
      } else {
        const vStart = pos.i;
        while (pos.i < s.length && !/[>\s]/.test(s[pos.i])) pos.i++;
        value = unescapeXml(s.slice(vStart, pos.i));
      }
    }
    if (!isTools) attrs[localName] = value;
  }

  const node: XmlNode = { tag, attrs, nsDecls: Object.keys(nsDecls).length ? nsDecls : undefined, children: [], path, line: pos.lineOf ? pos.lineOf(openIdx) : undefined };

  // 自闭合标签没有子元素，直接返回（不要吞掉后面的兄弟节点）
  if (selfClosed) return node;

  // 子元素
  while (true) {
    skipWs(s, pos);
    while (s.startsWith("<!--", pos.i)) {
      const end = s.indexOf("-->", pos.i);
      pos.i = end === -1 ? s.length : end + 3;
      skipWs(s, pos);
    }
    if (pos.i >= s.length) break;
    if (s.startsWith(`</${tag}`, pos.i)) {
      pos.i += 2 + tag.length; // 跳过 </tag
      skipWs(s, pos);
      if (s[pos.i] === ">") pos.i++;
      break;
    }
    if (s.startsWith("<", pos.i)) {
      // 遇到别的开标签但没有子元素容器（如 <resources>）—— M1 不处理，直接跳过该标签块
      const nextTagMatch = s.slice(pos.i).match(/^<\s*([A-Za-z_][\w.:-]*)/);
      if (nextTagMatch) {
        const nextTag = nextTagMatch[1];
        const child = parseElement(s, pos, `${path}/${node.children.length}`, issues);
        if (child) node.children.push(child);
        else pos.i++;
        void nextTag;
        continue;
      }
      // 无法识别：跳过这个字符继续
      pos.i++;
      continue;
    }
    // 文本节点：M1 忽略（TextView 文本走 android:text 属性）
    while (pos.i < s.length && s[pos.i] !== "<") pos.i++;
  }
  return node;
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** M2y：按行号找最深节点（DFS 序里最后一个开标签行 <= 目标行的节点），用于代码编辑器 → 画布选中 */
export function nodeAtLine(root: XmlNode, line: number): XmlNode {
  let deepest: XmlNode = root;
  const walk = (n: XmlNode) => {
    for (const c of n.children) {
      if (c.line !== undefined && c.line <= line) {
        deepest = c; // DFS 序：更晚开始标签的更深/更右兄弟覆盖前值
        walk(c);
      }
    }
  };
  walk(root);
  return deepest;
}

/** 按 path（#0/1/0 风格）定位节点 */
export function findNode(root: XmlNode, path: string): XmlNode | null {
  // path 形如 #0 / #0/1 / #0/1/0：#0 恒为根；其后每段是父节点的 children 下标，逐段步进
  let cur: XmlNode | null = root;
  const segs = path.slice(path.startsWith("#") ? 1 : 0).split("/");
  for (let i = 1; i < segs.length; i++) {
    const n = parseInt(segs[i], 10);
    if (!cur || isNaN(n) || n < 0 || n >= cur.children.length) return null;
    cur = cur.children[n];
  }
  return cur;
}

/**
 * 把原 XML 文本中 path 对应节点的属性替换后重新序列化（保留其他部分原文）。
 * M1b 用：整文档重序列化 + 注释保留（先注释锚点后拼回）。
 */
export function rewriteNodeAttrs(
  xml: string,
  path: string,
  newAttrs: Record<string, string>,
  removedAttrs?: string[],
): string {
  // 简化策略：重新 parse → 改属性 → serialize。
  // 保留注释：先扫出原注释文本，序列化后再按出现顺序插回。
  const { root } = parseLayoutXml(xml);
  if (!root) return xml;
  const target = findNode(root, path);
  if (!target) return xml;
  const attrs = { ...target.attrs };
  for (const [k, v] of Object.entries(newAttrs)) attrs[k] = v;
  for (const k of removedAttrs ?? []) delete attrs[k];
  target.attrs = attrs;

  const comments: { text: string }[] = [];
  const re = /<!--[\s\S]*?-->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) comments.push({ text: m[0] });

  const serialized = serialize(root);
  // 注释简单追加到文档尾（M1b 够用；M2 再做原位保留）
  const withComments = comments.length
    ? serialized + "\n" + comments.map((c) => c.text).join("\n") + "\n"
    : serialized;

  // 把 XML 声明拼回
  const decl = xml.match(/^<\?xml[\s\S]*?\?>/i);
  return (decl ? decl[0] + "\n" : "") + withComments;
}

/** 序列化：把归一化树写回 XML 文本 */
/** ConstraintLayout / MotionLayout 专用属性：序列化时必须用 app: 前缀 */
const APP_ATTR_RE = /^(layout_constraint|layout_guideline|layout_barrier|layout_wrapBehavior|layout_optimizationLevel|flow_|motion_|constraint_referenced_ids|barrierDirection|barrierMargin|barrierAllowsGoneWidgets)/;
const APP_NS = "http://schemas.android.com/apk/res-auto";

/** 子树里是否用了 app: 命名空间的属性 */
function usesAppNs(n: XmlNode): boolean {
  if (Object.keys(n.attrs).some((k) => APP_ATTR_RE.test(k))) return true;
  return n.children.some(usesAppNs);
}

export function serialize(node: XmlNode, indent = ""): string {
  const isRoot = indent === "";
  // 命名空间声明补回（xmlns:android / xmlns:app），单独一行；再是属性
  const decls: Record<string, string> = { ...(node.nsDecls ?? {}) };
  if (isRoot && usesAppNs(node) && !decls.app) decls.app = APP_NS;
  const nsLine = Object.entries(decls)
    .map(([p, uri]) => `xmlns:${p}="${uri}"`)
    .join(" ");
  const attrsStr = Object.entries(node.attrs)
    .map(([k, v]) => `    ${APP_ATTR_RE.test(k) ? "app:" : "android:"}${k}="${v}"`)
    .join("\n");

  const buildOpen = (selfClosed: boolean): string => {
    const lines: string[] = [`${indent}<${node.tag}`];
    if (nsLine) lines.push(`    ${nsLine}`);
    if (attrsStr) lines.push(attrsStr);
    const tagEnd = selfClosed ? "/>" : ">";
    if (lines.length === 1) {
      // 无属性：单行
      return selfClosed ? `${indent}<${node.tag} />` : `${indent}<${node.tag}>`;
    }
    return lines.join("\n") + "\n" + indent + tagEnd;
  };

  if (node.children.length === 0) return buildOpen(true);
  const open = buildOpen(false);
  const inner = node.children.map((c) => serialize(c, indent + "  ")).join("\n");
  return `${open}\n${inner}\n${indent}</${node.tag}>`;
}
