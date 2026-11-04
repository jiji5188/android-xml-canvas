// lib/xml/clip.ts — M115：画布多选后的「复制 / 粘贴 / 成组 / 解组」
//
// 与 reorder.ts 同思路：**纯文本切片**，不走「解析 → serialize」。
// 理由：serialize 会重排注释、打乱属性顺序、丢空行，复制粘贴和成组是高频操作，
// 每次都把用户的排版洗一遍很难接受。
//
// path 规则与 parser 一致：#0 是根，#0/1/0 是根的第 1 个子节点的第 0 个子节点。

import { elementAt, scanElements, splitPath, type ElemSpan } from "./reorder";

/* ===== 基础：行首缩进 ===== */

function lineStart(s: string, pos: number): number {
  return s.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
}

/** 某位置所在行开头的空白（制表符 / 空格） */
export function indentAt(s: string, pos: number): string {
  const ls = lineStart(s, pos);
  let i = ls;
  while (i < s.length && (s[i] === " " || s[i] === "\t")) i++;
  return s.slice(ls, i);
}

/** 去掉每行共同的行首缩进（空行保持为空） */
export function dedent(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let min = Infinity;
  for (const l of lines) {
    if (!l.trim()) continue;
    const m = l.match(/^[ \t]*/);
    min = Math.min(min, m ? m[0].length : 0);
  }
  if (!Number.isFinite(min) || min === 0) return lines.join("\n");
  return lines.map((l) => (l.trim() ? l.slice(min) : "")).join("\n");
}

/* ===== 选择集规整 ===== */

/** 去重、排序，并丢掉「祖先是已选节点」的后代（避免重复删 / 重复复制） */
export function normalizePaths(paths: string[]): string[] {
  const uniq = [...new Set(paths.filter((p) => !!p && p !== "#0"))];
  const segs = (p: string) => p.replace(/^#/, "").split("/");
  const isDesc = (child: string, anc: string) => {
    const a = segs(anc);
    const c = segs(child);
    if (c.length <= a.length) return false;
    return a.every((v, i) => v === c[i]);
  };
  const kept = uniq.filter((p) => !uniq.some((q) => q !== p && isDesc(p, q)));
  return kept.sort((a, b) => {
    const x = segs(a).map(Number);
    const y = segs(b).map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] ?? -1) - (y[i] ?? -1);
      if (d !== 0) return d;
    }
    return 0;
  });
}

/* ===== 复制：剪出片段 ===== */

export interface ClipSnippet {
  path: string;
  tag: string;
  /** 已去掉共同缩进的原文 */
  text: string;
}

export function collectSnippets(xml: string, paths: string[]): ClipSnippet[] {
  const root = scanElements(xml);
  if (!root) return [];
  const out: ClipSnippet[] = [];
  for (const p of normalizePaths(paths)) {
    const el = elementAt(root, p);
    if (!el) continue;
    out.push({ path: p, tag: el.tag, text: dedent(xml.slice(el.start, el.end)) });
  }
  return out;
}

/** 复制到系统剪贴板的文本（多选时按原顺序拼接） */
export function snippetsToText(list: ClipSnippet[]): string {
  return list.map((s) => s.text).join("\n");
}

/**
 * 把「多段拼接在一起的片段文本」拆回单段（粘贴时用）。
 * 实现：包一层假根节点交给 scanElements，靠它的位置信息切片，比自己再写一遍扫描器可靠。
 */
export function splitSnippets(text: string): string[] {
  const t = dedent(String(text ?? "").replace(/\r\n/g, "\n")).trim();
  if (!t) return [];
  const OPEN = "<axv-wrap>";
  const root = scanElements(OPEN + t + "</axv-wrap>");
  if (!root) return [];
  return root.children.map((c) => t.slice(c.start - OPEN.length, c.end - OPEN.length)).filter((s) => !!s.trim());
}

/* ===== 删除（多选） ===== */

/**
 * 删除若干节点：整行只有这个元素时连行一起删，避免留下空行。
 * 从后往前删，path 不受前面的删除影响。
 */
export function deletePaths(xml: string, paths: string[]): string {
  const root = scanElements(xml);
  if (!root) return xml;
  const spans = normalizePaths(paths)
    .map((p) => elementAt(root, p))
    .filter((e): e is ElemSpan => !!e)
    .sort((a, b) => b.start - a.start);
  let out = xml;
  for (const sp of spans) {
    let from = sp.start;
    let to = sp.end;
    const ls = out.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
    const head = out.slice(ls, from);
    const le = out.indexOf("\n", to);
    const tail = le < 0 ? "" : out.slice(to, le);
    if (!head.trim() && !tail.trim()) {
      from = ls;
      to = le < 0 ? out.length : le + 1;
    }
    out = out.slice(0, from) + out.slice(to);
  }
  return out;
}

/* ===== 粘贴 ===== */

export interface InsertSnippetsResult {
  ok: boolean;
  xml: string;
  firstPath: string | null;
  /** 插入的节点数 */
  count: number;
  reason?: string;
}

/**
 * 在 parentPath 的第 index 个位置插入若干个片段（纯文本插入，保留原排版）。
 * snippets 里的每段会先 dedent，再按父级缩进 + 4 空格重新缩进。
 */
export function insertSnippetsAt(
  xml: string,
  parentPath: string,
  index: number,
  snippets: string[],
): InsertSnippetsResult {
  const fail = (reason: string): InsertSnippetsResult => ({ ok: false, xml, firstPath: null, count: 0, reason });
  const clean = snippets.map((s) => dedent(String(s ?? "").replace(/\r\n/g, "\n"))).filter((s) => s.trim());
  if (!clean.length) return fail("没有可粘贴的内容");
  const root = scanElements(xml);
  if (!root) return fail("原 XML 无法解析");
  const parent = elementAt(root, parentPath);
  if (!parent) return fail("找不到父节点 " + parentPath);
  if (parent.selfClosing) return fail("父节点是自闭合标签，先展开再粘贴");

  const kids = parent.children;
  const clamped = Math.max(0, Math.min(index, kids.length));
  const parentIndent = indentAt(xml, parent.start);
  const childIndent = kids.length ? indentAt(xml, kids[0].start) : parentIndent + "    ";
  const at = clamped < kids.length ? kids[clamped].start : parent.closeStart;
  const ls = lineStart(xml, at);
  const before = xml.slice(ls, at);

  const blockLines: string[] = [];
  for (const s of clean) {
    for (const l of s.split("\n")) blockLines.push(l.trim() ? l : "");
  }

  if (before.trim()) {
    // 插入点不在行首（同一行里有别的内容）→ 直接原样拼接
    const block = blockLines.map((l) => (l ? childIndent + l : "")).join("\n");
    return {
      ok: true,
      xml: xml.slice(0, at) + block + "\n" + childIndent + xml.slice(at),
      firstPath: `${parentPath}/${clamped}`,
      count: clean.length,
    };
  }
  // 常规：从行首开始铺，每行（含第一行）都带子级缩进，末尾补一个换行接回原有行
  const block = blockLines.map((l) => (l ? childIndent + l : "")).join("\n") + "\n";
  return {
    ok: true,
    xml: xml.slice(0, ls) + block + xml.slice(ls),
    firstPath: `${parentPath}/${clamped}`,
    count: clean.length,
  };
}

/* ===== id 去重（粘贴时避免 @+id 撞名） ===== */

export function definedIds(xml: string): string[] {
  const out: string[] = [];
  const re = /@\+id\/([A-Za-z_][A-Za-z0-9_]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/**
 * 把片段里与既有文档撞名的 id 改成 name_2 / name_3 …，
 * 片段内部的 @+id/name 与 @id/name 引用一起改（否则约束会指向外面）。
 */
export function renameDuplicateIds(existingXml: string, snippet: string): string {
  const used = new Set(definedIds(existingXml));
  let out = snippet;
  for (const id of definedIds(snippet)) {
    if (!used.has(id)) {
      used.add(id);
      continue;
    }
    let n = 2;
    let cand = `${id}_${n}`;
    while (used.has(cand)) {
      n += 1;
      cand = `${id}_${n}`;
    }
    used.add(cand);
    const refDef = new RegExp(`@\\+id\\/${id}(?![A-Za-z0-9_])`, "g");
    const refUse = new RegExp(`@id\\/${id}(?![A-Za-z0-9_])`, "g");
    out = out.replace(refDef, `@+id/${cand}`).replace(refUse, `@id/${cand}`);
  }
  return out;
}

/* ===== 成组 / 解组 ===== */

export interface GroupResult {
  ok: boolean;
  xml: string;
  /** 新容器（成组）/ 原容器所在位置（解组） */
  newPath: string | null;
  /** 解组后各子节点的新 path */
  childPaths: string[];
  reason?: string;
}

const GROUP_TAG_ATTRS: Record<string, string[]> = {
  FrameLayout: ['android:layout_width="match_parent"', 'android:layout_height="wrap_content"'],
  LinearLayout: [
    'android:layout_width="match_parent"',
    'android:layout_height="wrap_content"',
    'android:orientation="vertical"',
  ],
};

/**
 * 把**同一级、相邻**的若干节点包进一个容器（默认 FrameLayout）。
 * 不相邻也给做：把中间那些兄弟一起包进去（更符合直觉），但会在 reason 里说明。
 */
export function wrapSiblings(
  xml: string,
  paths: string[],
  tag: "FrameLayout" | "LinearLayout" = "FrameLayout",
): GroupResult {
  const fail = (reason: string): GroupResult => ({ ok: false, xml, newPath: null, childPaths: [], reason });
  const root = scanElements(xml);
  if (!root) return fail("原 XML 无法解析");
  const ps = normalizePaths(paths);
  if (ps.length < 2) return fail("至少选中两个控件才能成组");

  const parts = ps.map((p) => splitPath(p));
  const parentPath = parts[0].parentPath;
  if (parts.some((p) => p.parentPath !== parentPath)) return fail("只能把同一级的控件放成一组");

  const idx = parts.map((p) => p.index).sort((a, b) => a - b);
  const first = idx[0];
  const last = idx[idx.length - 1];
  const firstEl = elementAt(root, `${parentPath}/${first}`);
  const lastEl = elementAt(root, `${parentPath}/${last}`);
  if (!firstEl || !lastEl) return fail("找不到选中的控件");

  const innerIndent = indentAt(xml, firstEl.start);
  const headAttr = GROUP_TAG_ATTRS[tag] ?? GROUP_TAG_ATTRS.FrameLayout;
  const openTag = `<${tag}\n` + headAttr.map((a) => `${innerIndent}    ${a}`).join("\n") + ">";
  const blockRaw = xml.slice(firstEl.start, lastEl.end);
  // 被包进去的内容整体右缩进 4 空格（首行在 openTag 后面，不需要额外前缀）
  const shifted = blockRaw
    .split("\n")
    .map((l, i) => (i === 0 ? l : l.trim() ? "    " + l : l))
    .join("\n");
  const wrapped = openTag + "\n" + shifted + "\n" + innerIndent + `</${tag}>`;
  return {
    ok: true,
    xml: xml.slice(0, firstEl.start) + wrapped + xml.slice(lastEl.end),
    newPath: `${parentPath}/${first}`,
    childPaths: [],
  };
}

/** 把一个容器节点的子节点提上来，替掉容器本身（成组的逆操作） */
export function unwrapElement(xml: string, path: string): GroupResult {
  const fail = (reason: string): GroupResult => ({ ok: false, xml, newPath: null, childPaths: [], reason });
  const root = scanElements(xml);
  if (!root) return fail("原 XML 无法解析");
  const el = elementAt(root, path);
  if (!el) return fail("找不到要解组的控件");
  if (el.selfClosing || !el.children.length) return fail("这个控件里没有子控件，解不了组");
  const { parentPath, index } = splitPath(path);
  const outerIndent = indentAt(xml, el.start);
  const childIndent = indentAt(xml, el.children[0].start);
  const inner = xml.slice(el.openEnd, el.closeStart).replace(/\r\n/g, "\n");
  const lines = inner.split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const rel = lines.map((l) => (l.startsWith(childIndent) ? l.slice(childIndent.length) : l.trimStart()));
  const block = rel.length ? rel[0] + (rel.length > 1 ? "\n" + rel.slice(1).map((l) => (l ? outerIndent + l : "")).join("\n") : "") : "";
  const out = xml.slice(0, el.start) + block + xml.slice(el.end);
  return {
    ok: true,
    xml: out,
    newPath: `${parentPath}/${index}`,
    childPaths: rel.length === 0 ? [] : el.children.map((_, i) => `${parentPath}/${index + i}`),
  };
}

/** 某个节点能否解组（容器 + 有子节点） */
export function canUnwrap(xml: string, path: string): boolean {
  const root = scanElements(xml);
  if (!root) return false;
  const el = elementAt(root, path);
  if (!el || el.selfClosing) return false;
  return el.children.length > 0;
}
