// lib/xml/reorder.ts — 兄弟节点重排（图层「上移 / 下移 / 置顶 / 置底」）
//
// 为什么不用「解析 → serialize」那套？
// 因为 serialize 会把文档整体重写：注释会被统一挪到文件末尾、属性顺序被打乱、
// 空行缩进全丢。层级调整是很高频的操作，每次都把用户的排版洗一遍很难接受。
//
// 这里改成**纯文本切片**：只把目标节点那一段原文剪出来，插到新位置，
// 其余字节一个不动。注释、缩进、属性顺序、命名空间声明全部原样保留。
//
// path 规则与 parser 一致：#0 是根，#0/1/0 是根的第 1 个子节点的第 0 个子节点。

export interface ElemSpan {
  /** '<' 的位置 */
  start: number;
  /** 开标签结束（'>' 之后）的位置 */
  openEnd: number;
  /** 闭标签 '<' 的位置；自闭合时等于 openEnd */
  closeStart: number;
  /** 整个元素结束（闭标签 '>' 之后 / 自闭合 '>' 之后） */
  end: number;
  tag: string;
  selfClosing: boolean;
  children: ElemSpan[];
}

export interface ReorderIssue {
  level: "error" | "warn";
  message: string;
}

export interface ReorderResult {
  xml: string;
  ok: boolean;
  issues: ReorderIssue[];
  /** 移动后节点的新 path */
  newPath: string | null;
  /** 移动后的最终下标 */
  index: number | null;
}

/** 从 i（指向 '<'）开始找该标签的 '>'，跳过引号内的尖括号 */
function findTagEnd(s: string, i: number): number {
  let q = "";
  for (let k = i + 1; k < s.length; k++) {
    const c = s[k];
    if (q) {
      if (c === q) q = "";
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === ">") return k + 1;
  }
  return -1;
}

/**
 * 扫描出元素树（只关心位置与层级，不解析属性值）。
 * 注释 / CDATA / 处理指令 / DOCTYPE 一律跳过，不参与层级。
 */
export function scanElements(xml: string): ElemSpan | null {
  const s = xml;
  const stack: ElemSpan[] = [];
  let root: ElemSpan | null = null;
  let i = 0;

  while (i < s.length) {
    const lt = s.indexOf("<", i);
    if (lt < 0) break;

    // 注释
    if (s.startsWith("<!--", lt)) {
      const e = s.indexOf("-->", lt + 4);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    // CDATA
    if (s.startsWith("<![CDATA[", lt)) {
      const e = s.indexOf("]]>", lt + 9);
      i = e < 0 ? s.length : e + 3;
      continue;
    }
    // 处理指令 / DOCTYPE / 其他 <! 开头
    if (s.startsWith("<?", lt) || s.startsWith("<!", lt)) {
      const e = findTagEnd(s, lt);
      i = e < 0 ? s.length : e;
      continue;
    }

    // 闭标签
    if (s.startsWith("</", lt)) {
      const e = findTagEnd(s, lt);
      if (e < 0) break;
      const cur = stack.pop();
      if (cur) {
        cur.closeStart = lt;
        cur.end = e;
        // 校验标签名配对（不匹配只影响位置判定的可信度，但仍采用）
        const name = s.slice(lt + 2, e - 1).trim();
        if (name && name !== cur.tag) {
          cur.tag = cur.tag || name;
        }
      }
      i = e;
      continue;
    }

    // 开标签
    const e = findTagEnd(s, lt);
    if (e < 0) break;
    let k = lt + 1;
    while (k < e && /[\s]/.test(s[k])) k++;
    let nameEnd = k;
    while (nameEnd < e && !/[\s/>]/.test(s[nameEnd])) nameEnd++;
    const tag = s.slice(k, nameEnd);
    const selfClosing = s[e - 2] === "/";

    const el: ElemSpan = {
      start: lt,
      openEnd: e,
      closeStart: e,
      end: e,
      tag,
      selfClosing,
      children: [],
    };

    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(el);
    else if (!root) root = el;
    // 多个根节点时，后续根节点忽略（Android 布局文件本就只有一个根）

    if (!selfClosing) stack.push(el);
    i = e;
  }

  return root;
}

/** 按 path 取元素；path 形如 #0 / #0/1 / #0/1/0 */
export function elementAt(root: ElemSpan | null, path: string): ElemSpan | null {
  if (!root) return null;
  const raw = (path || "").trim();
  if (!raw) return null;
  const segs = raw.replace(/^#/, "").split("/");
  // 第 0 段恒为根（#0），从第 1 段开始逐级取下标
  let cur: ElemSpan | null = root;
  for (let i = 1; i < segs.length; i++) {
    const n = Number(segs[i]);
    if (!Number.isInteger(n) || n < 0 || n >= cur.children.length) return null;
    cur = cur.children[n];
  }
  return cur;
}

/** 拆 path：「#0/1/0」→ { parentPath: "#0/1", index: 0 } */
export function splitPath(path: string): { parentPath: string; index: number } {
  const segs = path.replace(/^#/, "").split("/");
  const index = Number(segs[segs.length - 1]);
  return { parentPath: "#" + segs.slice(0, -1).join("/"), index };
}

/** 父元素的内容区间 [innerStart, innerEnd) */
function innerRange(el: ElemSpan): { from: number; to: number } {
  if (el.selfClosing) return { from: el.openEnd, to: el.openEnd };
  return { from: el.openEnd, to: el.closeStart };
}

/**
 * 把某个子节点移到同一父级下的新位置。
 *
 * toIndex 语义：**移出之后的列表**里要放的下标（0 = 最前 / 最底层，length-1 = 最后 / 最上层）。
 * 越界自动夹到合法范围，所以「置底」直接传 children.length 即可。
 *
 * ⚠️ 与解析式实现不同：本函数不碰属性，{{path}} 只在父子层级间保持下标一致，
 * 不会修改任何控件属性里的 @id 引用 —— 因为 id 引用与下标无关，天然安全。
 */
export function moveSiblingRaw(xml: string, targetPath: string, toIndex: number): ReorderResult {
  const issues: ReorderIssue[] = [];
  const root = scanElements(xml);
  if (!root) {
    issues.push({ level: "error", message: "XML 无法解析" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }

  const segs = targetPath.replace(/^#/, "").split("/");
  if (segs.length < 2) {
    issues.push({ level: "error", message: "根节点不能移动" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }

  const { parentPath, index: from } = splitPath(targetPath);
  const parent = elementAt(root, parentPath);
  if (!parent) {
    issues.push({ level: "error", message: "找不到父节点" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }
  if (from < 0 || from >= parent.children.length) {
    issues.push({ level: "error", message: "节点下标越界" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }

  const { from: innerStart, to: innerEnd } = innerRange(parent);
  if (innerEnd < innerStart) {
    issues.push({ level: "error", message: "父节点内容区间异常" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }

  const kids = parent.children;
  // 分段：第 i 段 = 上一个兄弟结束 → 本兄弟结束。
  // 这样写在控件前面的注释/空行会跟着该控件一起走（符合书写习惯）。
  // 第 0 段从自己的 '<' 开始（不包含它前面的缩进），那段缩进留在原位当「头」，
  // 避免第一个子项移到末尾时把父标签后的换行也拖走。
  const head = xml.slice(innerStart, kids[0].start);
  const segsText: string[] = [];
  for (let i = 0; i < kids.length; i++) {
    const segStart = i === 0 ? kids[0].start : kids[i - 1].end;
    segsText.push(xml.slice(segStart, kids[i].end));
  }
  // 最后一个兄弟之后到闭标签之间的内容（尾随注释/换行）挂在原地不动
  const tail = xml.slice(kids[kids.length - 1].end, innerEnd);

  const clamped = Math.max(0, Math.min(toIndex, kids.length - 1));
  if (clamped === from) {
    return { xml, ok: true, issues, newPath: targetPath, index: from };
  }

  const moved = segsText.splice(from, 1)[0];
  segsText.splice(clamped, 0, moved);

  const rebuilt = xml.slice(0, innerStart) + head + segsText.join("") + tail + xml.slice(innerEnd);
  return {
    xml: rebuilt,
    ok: true,
    issues,
    newPath: `${parentPath}/${clamped}`,
    index: clamped,
  };
}

/** 上移 / 下移一层（delta = -1 / +1），到边界时返回 ok 但无变化 */
export function moveBy(xml: string, targetPath: string, delta: number): ReorderResult {
  const { index } = splitPath(targetPath);
  return moveSiblingRaw(xml, targetPath, index + delta);
}

/** 置顶（渲染在最上层 = 兄弟列表最后） */
export function bringToFront(xml: string, targetPath: string): ReorderResult {
  const root = scanElements(xml);
  const { parentPath } = splitPath(targetPath);
  const parent = elementAt(root, parentPath);
  if (!parent) {
    return { xml, ok: false, issues: [{ level: "error", message: "找不到父节点" }], newPath: null, index: null };
  }
  return moveSiblingRaw(xml, targetPath, parent.children.length - 1);
}

/** 置底（渲染在最下层 = 兄弟列表最前） */
export function sendToBack(xml: string, targetPath: string): ReorderResult {
  return moveSiblingRaw(xml, targetPath, 0);
}

// ===== M3d：跨父级移动（拖拽排序：移到上层 / 下层 / 兄弟层）=====

/** 路径段数组：#0/1/2 → [0,1,2] */
function segsOf(path: string): number[] {
  return path.replace(/^#/, "").split("/").map((x) => Number(x));
}

function pathOf(segs: number[]): string {
  return "#" + segs.join("/");
}

/** a 是否等于 b 或者是 b 的祖先 */
function isAncestorOrSelf(a: string, b: string): boolean {
  const sa = segsOf(a);
  const sb = segsOf(b);
  if (sa.length > sb.length) return false;
  return sa.every((v, i) => v === sb[i]);
}

/** 从一个位置删除节点后，其他路径需要重映射（同一父级下 index 变动的兄弟） */
export function remapPathAfterRemoval(path: string, removedPath: string): string | null {
  const segs = segsOf(path);
  const rm = segsOf(removedPath);
  const depth = rm.length - 1; // 被删节点的父级深度
  if (segs.length <= depth) return path;
  for (let i = 0; i < depth; i++) {
    if (segs[i] !== rm[i]) return path;
  }
  const removedIdx = rm[depth];
  if (segs[depth] === removedIdx) return null; // 自己就是被删的那个（或它下方）
  if (segs[depth] > removedIdx) {
    const out = segs.slice();
    out[depth] -= 1;
    return pathOf(out);
  }
  return path;
}

/** 取元素所在行的缩进（行首空白） */
function lineIndent(xml: string, pos: number): string {
  const ls = xml.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const head = xml.slice(ls, pos);
  return /^[ \t]*$/.test(head) ? head : "";
}

/** 把节点文本整体平移到新缩进（保持内部相对层级） */
function reindent(nodeText: string, from: string, to: string): string {
  if (from === to) return nodeText;
  const delta = to.length - from.length;
  return nodeText
    .split("\n")
    .map((line, i) => {
      if (i === 0) return line;
      if (!line.trim()) return line;
      if (delta > 0) return " ".repeat(delta) + line;
      const lead = line.match(/^[ \t]*/)![0];
      const cut = Math.min(lead.length, -delta);
      return line.slice(cut);
    })
    .join("\n");
}

export interface MoveNodeOptions {
  /** 目标父级 path */
  parentPath: string;
  /** 插到目标父级的第几个子项之前（0..children.length） */
  index: number;
  /** 目标父级最多允许多少子项（用于单 child 容器校验，不传则不校验） */
  maxChildren?: number;
}

/**
 * 把节点移到另一个父级（或同父级的新位置）。
 *
 * 这是拖拽排序的核心：
 *  - 拖到某个控件「上方/下方」→ parentPath = 该控件的父级，index = 该控件下标 / 下标+1
 *  - 拖到某个容器「中间」   → parentPath = 该容器，index = 末尾（或指定位置）
 *
 * 移动后原文保留（注释、缩进、属性顺序都不动），只是把节点块剪走再插入，
 * 并按目标层级重新缩进。
 */
export function moveNodeRaw(
  xml: string,
  targetPath: string,
  opts: MoveNodeOptions,
): ReorderResult {
  const issues: ReorderIssue[] = [];
  const { parentPath, index, maxChildren } = opts;
  const root = scanElements(xml);
  if (!root) {
    issues.push({ level: "error", message: "XML 无法解析" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }
  const targetSegs = segsOf(targetPath);
  if (targetSegs.length < 2) {
    issues.push({ level: "error", message: "根节点不能移动" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }
  if (isAncestorOrSelf(targetPath, parentPath)) {
    issues.push({ level: "error", message: "不能把控件移动到它自己内部" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }
  const src = elementAt(root, targetPath);
  const dest = elementAt(root, parentPath);
  if (!src || !dest) {
    issues.push({ level: "error", message: "找不到源节点或目标父级" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }

  const fromParent = pathOf(targetSegs.slice(0, -1));
  const fromIndex = targetSegs[targetSegs.length - 1];
  const sameParent = fromParent === parentPath;

  // 同父级 → 退化成纯重排（走已验证的 moveSiblingRaw）
  if (sameParent) {
    const after = index > fromIndex ? index - 1 : index;
    return moveSiblingRaw(xml, targetPath, after);
  }

  // 容器容量校验
  if (maxChildren !== undefined && dest.children.length >= maxChildren) {
    issues.push({ level: "error", message: "目标容器已满，不能再放子控件" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }

  // ---- 1) 把节点块从原位置剪出来 ----
  const srcParent = elementAt(root, fromParent)!;
  const srcInner = innerRange(srcParent);
  const srcKids = srcParent.children;
  let cutStart = src.start;
  // 连带前面紧跟的注释行（注释是在描述这个控件的）
  for (;;) {
    const prevLineEnd = xml.lastIndexOf("\n", cutStart - 1);
    if (prevLineEnd < srcInner.from) break;
    const prevLineStart = xml.lastIndexOf("\n", prevLineEnd - 1) + 1;
    const prevLine = xml.slice(prevLineStart, prevLineEnd).trim();
    const leadOfCut = xml.slice(prevLineStart, cutStart);
    if (!/^<!--[\s\S]*-->$/.test(prevLine)) break;
    if (!/^[ \t]*$/.test(leadOfCut)) break;
    cutStart = prevLineStart;
  }
  // 行首缩进也一起剪（避免留空白行）
  const cutLineStart = xml.lastIndexOf("\n", cutStart - 1) + 1;
  if (cutLineStart >= srcInner.from && /^[ \t]*$/.test(xml.slice(cutLineStart, cutStart))) {
    cutStart = cutLineStart;
  }
  // 剪到行尾换行（含）、不留空行
  let cutEnd = src.end;
  while (cutEnd < xml.length && /[ \t]/.test(xml[cutEnd])) cutEnd++;
  if (xml[cutEnd] === "\n") cutEnd += 1;

  const srcIndent = lineIndent(xml, src.start);
  const nodeText = xml.slice(src.start, src.end);
  const removed = xml.slice(0, cutStart) + xml.slice(cutEnd);

  // ---- 2) 在删除后的文本里重新定位目标父级并插入 ----
  const destPath2 = remapPathAfterRemoval(parentPath, targetPath);
  if (destPath2 === null) {
    issues.push({ level: "error", message: "目标位置在被移动的子树内" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }
  const dest2 = elementAt(scanElements(removed), destPath2);
  if (!dest2) {
    issues.push({ level: "error", message: "移动后找不到目标父级" });
    return { xml, ok: false, issues, newPath: null, index: null };
  }
  const destIndent = dest2.children.length
    ? lineIndent(removed, dest2.children[0].start)
    : lineIndent(removed, dest2.start) + "    ";

  // 目标容器还是自闭合形式（<CardView ... />）：
  // 子节点若直接插在 "/>" 后面会变成它的兄弟（看起来就是「拖进去加不了」），
  // 必须先把标签改成 <CardView ...>\n  子控件\n</CardView> 的成对形式。
  if (dest2.selfClosing) {
    const destLineIndent = lineIndent(removed, dest2.start);
    const block2 = reindent(nodeText, srcIndent, destIndent);
    const out2 =
      removed.slice(0, dest2.openEnd - 2) +
      ">" +
      "\n" +
      destIndent +
      block2 +
      "\n" +
      destLineIndent +
      `</${dest2.tag}>` +
      removed.slice(dest2.openEnd);
    return { xml: out2, ok: true, issues, newPath: `${destPath2}/0`, index: 0 };
  }

  const insertIdx = Math.max(0, Math.min(index, dest2.children.length));
  const at = insertIdx === 0 ? dest2.openEnd : dest2.children[insertIdx - 1].end;

  const block = "\n" + destIndent + reindent(nodeText, srcIndent, destIndent);
  const out = removed.slice(0, at) + block + removed.slice(at);

  return {
    xml: out,
    ok: true,
    issues,
    newPath: `${destPath2}/${insertIdx}`,
    index: insertIdx,
  };
}
