// lib/xml/insert.ts — 往 XML 里插入新节点（组件面板「添加组件」用）
// 策略：在 path 对应节点上做结构操作（加子节点 / 加兄弟节点），重新序列化整棵树。
// 片段模板里可以不带 xmlns（文档其他节点已有），parser 会忽略。

import { parseLayoutXml, findNode, rewriteNodeAttrs, serialize } from "./parser";
import type { XmlNode, XmlIssue } from "./types";

export interface InsertResult {
  xml: string;
  /** 新节点在结果里的 path（可空） */
  insertedPath: string | null;
  issues: XmlIssue[];
  ok: boolean;
}

/** 可用作父容器的控件（拖放落位判定用） */
const CONTAINER_TAGS = new Set([
  "LinearLayout",
  "LinearLayoutCompat",
  "FrameLayout",
  "RelativeLayout",
  "ConstraintLayout",
  "GridLayout",
  "TableLayout",
  "TableRow",
  "ScrollView",
  "HorizontalScrollView",
  "NestedScrollView",
  "CoordinatorLayout",
  "DrawerLayout",
  "AppBarLayout",
  "CardView",
  "MaterialCardView",
  "SwipeRefreshLayout",
  "ViewFlipper",
  "ViewAnimator",
  "RadioGroup",
]);

/** 标签是否容器（全限定名取尾段，如 androidx.constraintlayout.widget.ConstraintLayout） */
export function isContainerTag(rawTag: string): boolean {
  const tag = rawTag.includes(".") ? rawTag.slice(rawTag.lastIndexOf(".") + 1) : rawTag;
  return CONTAINER_TAGS.has(tag);
}

/** 在 parentPath 下（末尾）插入一个节点，返回新 XML */
export function insertChild(xml: string, parentPath: string, snippetXml: string, tagLabel: string): InsertResult {
  const issues: XmlIssue[] = [];
  const { root } = parseLayoutXml(xml);
  if (!root) {
    issues.push({ level: "error", nodePath: parentPath, message: "原 XML 无法解析" });
    return { xml, insertedPath: null, issues, ok: false };
  }
  const parent = findNode(root, parentPath);
  if (!parent) {
    issues.push({ level: "error", nodePath: parentPath, message: "找不到父节点 " + parentPath });
    return { xml, insertedPath: null, issues, ok: false };
  }
  // 解析片段（可能带 <?xml 声明，parser 会剥掉）
  const parsed = parseLayoutXml(snippetXml);
  const frag = parsed.root;
  if (!frag) {
    issues.push({ level: "error", nodePath: parentPath, message: "组件模板解析失败：" + tagLabel });
    return { xml, insertedPath: null, issues, ok: false };
  }
  const newIdx = parent.children.length;
  const newPath = `${parentPath}/${newIdx}`;
  // 重编号：把 frag 子树 path 映射进 parent 下
  const rebase = (n: XmlNode, prefix: string): XmlNode => ({
    ...n,
    path: n.path.replace(/^#0/, prefix),
    children: n.children.map((c) => rebase(c, prefix)),
  });
  const rebased = rebase(frag, newPath);
  // 把 frag 的 path 本身也重写（#0 → newPath）
  parent.children.push({ ...rebased, path: newPath });
  // 父容器若有 nsDecls，子节点也带上（serialize 只输出节点自己的）
  const out = serialize(root);
  // 拼回 <?xml 声明
  const decl = xml.match(/^<\?xml[\s\S]*?\?>/i);
  const result = (decl ? decl[0] + "\n" : "") + out;
  return {
    xml: result,
    insertedPath: newPath,
    issues,
    ok: true,
  };
}

/** 在 targetPath 的同一父级里，作为 target 的下一个兄弟插入 */
export function insertSiblingAfter(xml: string, targetPath: string, snippetXml: string, tagLabel: string): InsertResult {
  const issues: XmlIssue[] = [];
  const { root } = parseLayoutXml(xml);
  if (!root) {
    issues.push({ level: "error", nodePath: targetPath, message: "原 XML 无法解析" });
    return { xml, insertedPath: null, issues, ok: false };
  }
  const target = findNode(root, targetPath);
  if (!target || targetPath === "#0") {
    issues.push({ level: "error", nodePath: targetPath, message: targetPath === "#0" ? "根节点没有兄弟位置" : "找不到节点 " + targetPath });
    return { xml, insertedPath: null, issues, ok: false };
  }
  // 找父级
  // 注意：targetPath 形如 #0/1，直接 split 后首段会带 '#'，要先剥掉再拼（否则得到 ##0）
  const segs = targetPath.slice(targetPath.startsWith("#") ? 1 : 0).split("/").filter(Boolean);
  const parentPath = "#" + segs.slice(0, -1).join("/");
  const parent = findNode(root, parentPath);
  if (!parent) {
    issues.push({ level: "error", nodePath: parentPath, message: "找不到父节点 " + parentPath });
    return { xml, insertedPath: null, issues, ok: false };
  }
  const selfIdx = Number(segs[segs.length - 1]);
  const insertAt = selfIdx + 1;
  const parsed = parseLayoutXml(snippetXml);
  const frag = parsed.root;
  if (!frag) {
    issues.push({ level: "error", nodePath: parentPath, message: "组件模板解析失败：" + tagLabel });
    return { xml, insertedPath: null, issues, ok: false };
  }
  const newPath = `${parentPath}/${insertAt}`;
  const rebase = (n: XmlNode, prefix: string): XmlNode => ({
    ...n,
    path: prefix,
    children: n.children.map((c, i) => rebase(c, `${prefix}/${i}`)),
  });
  const rebased = rebase(frag, newPath);
  parent.children.splice(insertAt, 0, rebased);
  // 重排后续兄弟的 path
  for (let i = insertAt + 1; i < parent.children.length; i++) {
    const fixPaths = (n: XmlNode, newPathStr: string) => {
      n.path = newPathStr;
      n.children.forEach((c, j) => fixPaths(c, `${newPathStr}/${j}`));
    };
    fixPaths(parent.children[i], `${parentPath}/${i}`);
  }
  const out = serialize(root);
  const decl = xml.match(/^<\?xml[\s\S]*?\?>/i);
  return { xml: (decl ? decl[0] + "\n" : "") + out, insertedPath: newPath, issues, ok: true };
}

/** 在 parentPath 下、指定 index 处插入（拖放精确落位） */
export function insertAt(xml: string, parentPath: string, index: number, snippetXml: string, tagLabel: string): InsertResult {
  const issues: XmlIssue[] = [];
  const { root } = parseLayoutXml(xml);
  if (!root) {
    issues.push({ level: "error", nodePath: parentPath, message: "原 XML 无法解析" });
    return { xml, insertedPath: null, issues, ok: false };
  }
  const parent = findNode(root, parentPath);
  if (!parent) {
    issues.push({ level: "error", nodePath: parentPath, message: "找不到父节点 " + parentPath });
    return { xml, insertedPath: null, issues, ok: false };
  }
  const parsed = parseLayoutXml(snippetXml);
  const frag = parsed.root;
  if (!frag) {
    issues.push({ level: "error", nodePath: parentPath, message: "组件模板解析失败：" + tagLabel });
    return { xml, insertedPath: null, issues, ok: false };
  }
  const clamped = Math.max(0, Math.min(index, parent.children.length));
  const newPath = `${parentPath}/${clamped}`;
  const rebase = (n: XmlNode, prefix: string): XmlNode => ({
    ...n,
    path: prefix,
    children: n.children.map((c, i) => rebase(c, `${prefix}/${i}`)),
  });
  parent.children.splice(clamped, 0, rebase(frag, newPath));
  // 重排后续兄弟
  for (let i = clamped + 1; i < parent.children.length; i++) {
    const fix = (n: XmlNode, p: string) => {
      n.path = p;
      n.children.forEach((c, j) => fix(c, `${p}/${j}`));
    };
    fix(parent.children[i], `${parentPath}/${i}`);
  }
  const out = serialize(root);
  const decl2 = xml.match(/^<\?xml[\s\S]*?\?>/i);
  return { xml: (decl2 ? decl2[0] + "\n" : "") + out, insertedPath: newPath, issues, ok: true };
}

/** 重命名 / 移动兄弟顺序（图层页「上移/下移」用）：把 targetPath 挪到 beforePath / afterPath 的兄弟位置 */
export interface MoveResult {
  xml: string;
  ok: boolean;
  issues: XmlIssue[];
  /** 移动后新节点 path */
  newPath: string | null;
}

/** 在父级兄弟列表里移动：fromIndex → toIndex（toIndex 是目标在「删除 from 之后」的列表里的位置） */
export function moveSibling(xml: string, targetPath: string, toIndex: number): MoveResult {
  const issues: XmlIssue[] = [];
  const { root } = parseLayoutXml(xml);
  if (!root) {
    issues.push({ level: "error", nodePath: targetPath, message: "原 XML 无法解析" });
    return { xml, ok: false, issues, newPath: null };
  }
  const target = findNode(root, targetPath);
  if (!target || targetPath === "#0") {
    issues.push({ level: "error", nodePath: targetPath, message: "根节点不能移动" });
    return { xml, ok: false, issues, newPath: null };
  }
  const segs = targetPath.slice(targetPath.startsWith("#") ? 1 : 0).split("/").filter(Boolean);
  const parentPath = "#" + segs.slice(0, -1).join("/");
  const parent = findNode(root, parentPath);
  if (!parent) {
    issues.push({ level: "error", nodePath: parentPath, message: "找不到父节点" });
    return { xml, ok: false, issues, newPath: null };
  }
  const fromIndex = Number(segs[segs.length - 1]);
  if (fromIndex < 0 || fromIndex >= parent.children.length) {
    issues.push({ level: "error", nodePath: targetPath, message: "节点索引越界" });
    return { xml, ok: false, issues, newPath: null };
  }
  const node = parent.children.splice(fromIndex, 1)[0];
  const clamped = Math.max(0, Math.min(toIndex, parent.children.length));
  parent.children.splice(clamped, 0, node);
  // 重新编号 path
  for (let i = 0; i < parent.children.length; i++) {
    const fix = (n: XmlNode, p: string) => {
      n.path = p;
      n.children.forEach((c, j) => fix(c, `${p}/${j}`));
    };
    fix(parent.children[i], `${parentPath}/${i}`);
  }
  const out = serialize(root);
  const decl3 = xml.match(/^<\?xml[\s\S]*?\?>/i);
  return { xml: (decl3 ? decl3[0] + "\n" : "") + out, ok: true, issues, newPath: `${parentPath}/${clamped}` };
}
