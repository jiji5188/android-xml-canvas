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
