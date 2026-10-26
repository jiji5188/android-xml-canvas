// lib/xml/autoconstrain.ts — 「自动约束」推断（Android Studio Infer Constraints 的轻量版）
// 纯函数：输入几何盒子，输出要写入的 XML 属性（不碰 React/DOM）。
//
// 两种模式：
// 1) 节点已有约束 → 就近推断：每条边找最近的可锚目标（父容器或兄弟控件），写一条约束 + margin
// 2) 节点毫无约束 → 智能堆叠：贴父容器左边，纵向接在上一个兄弟下面（避免所有控件叠在左上角）

export interface CBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface SibInfo {
  /** XML 里的 id 原样（@+id/xxx 或 @id/xxx） */
  ref: string;
  tag: string;
  box: CBox;
}

export interface AutoInput {
  attrs: Record<string, string>;
  box: CBox;
  parent: CBox;
  /** 兄弟（不含自己），已按 XML 顺序 */
  siblings: SibInfo[];
  /** 上一个兄弟（XML 顺序），无则 null */
  prev: SibInfo | null;
  /** 1dp = scale px */
  scale: number;
  /** 未约束时贴边留白（dp） */
  gapDp?: number;
}

export interface AutoResult {
  /** [属性名, 值]；值为 null 表示删除 */
  changes: [string, string | null][];
  notes: string[];
}

const CONSTRAINT_RE = /^layout_constraint/;

export function hasConstraints(attrs: Record<string, string>): boolean {
  return Object.keys(attrs).some((k) => CONSTRAINT_RE.test(k));
}

interface Cand {
  /** 例如 layout_constraintStart_toEndOf */
  attr: string;
  /** 目标 id 文本（parent 或 @+id/xxx） */
  target: string;
  marginAttr: string;
  marginPx: number;
  dist: number;
}

const mk = (attr: string, target: string, marginAttr: string, marginPx: number): Cand => ({
  attr,
  target,
  marginAttr,
  marginPx,
  dist: Math.abs(marginPx),
});

const pickMin = (list: Cand[]): Cand | null => {
  let best: Cand | null = null;
  for (const c of list) {
    if (c.marginPx < -2) continue; // 明显重叠的候选（负边距）不作为锚点
    if (!best || c.dist < best.dist) best = c;
  }
  return best;
};

const dpStr = (px: number, scale: number): string => `${Math.max(0, Math.round(px / scale))}dp`;

/** 就近推断：四边各挑一个最近锚点 */
function inferNearest(input: AutoInput): AutoResult {
  const { box, parent, siblings, scale } = input;
  const myL = box.left;
  const myR = box.left + box.width;
  const myT = box.top;
  const myB = box.top + box.height;
  const pL = parent.left;
  const pR = parent.left + parent.width;
  const pT = parent.top;
  const pB = parent.top + parent.height;

  const startCands: Cand[] = [mk("layout_constraintStart_toStartOf", "parent", "layout_marginStart", myL - pL)];
  const endCands: Cand[] = [mk("layout_constraintEnd_toEndOf", "parent", "layout_marginEnd", pR - myR)];
  const topCands: Cand[] = [mk("layout_constraintTop_toTopOf", "parent", "layout_marginTop", myT - pT)];
  const bottomCands: Cand[] = [mk("layout_constraintBottom_toBottomOf", "parent", "layout_marginBottom", pB - myB)];

  for (const s of siblings) {
    const sL = s.box.left;
    const sR = s.box.left + s.box.width;
    const sT = s.box.top;
    const sB = s.box.top + s.box.height;
    if (s.ref) {
      startCands.push(mk("layout_constraintStart_toEndOf", s.ref, "layout_marginStart", myL - sR));
      startCands.push(mk("layout_constraintStart_toStartOf", s.ref, "layout_marginStart", myL - sL));
      endCands.push(mk("layout_constraintEnd_toStartOf", s.ref, "layout_marginEnd", sL - myR));
      endCands.push(mk("layout_constraintEnd_toEndOf", s.ref, "layout_marginEnd", sR - myR));
      topCands.push(mk("layout_constraintTop_toBottomOf", s.ref, "layout_marginTop", myT - sB));
      topCands.push(mk("layout_constraintTop_toTopOf", s.ref, "layout_marginTop", myT - sT));
      bottomCands.push(mk("layout_constraintBottom_toTopOf", s.ref, "layout_marginBottom", sT - myB));
      bottomCands.push(mk("layout_constraintBottom_toBottomOf", s.ref, "layout_marginBottom", sB - myB));
    }
  }

  // 水平方向只取一侧（避免过度约束），选更近的那条边
  const hStart = pickMin(startCands);
  const hEnd = pickMin(endCands);
  const vTop = pickMin(topCands);
  const vBottom = pickMin(bottomCands);

  const changes: [string, string | null][] = [];
  const notes: string[] = [];

  const h = hStart && hEnd ? (hStart.dist <= hEnd.dist ? hStart : hEnd) : hStart ?? hEnd;
  const v = vTop && vBottom ? (vTop.dist <= vBottom.dist ? vTop : vBottom) : vTop ?? vBottom;

  if (h) {
    changes.push([h.attr, h.target]);
    changes.push([h.marginAttr, dpStr(h.marginPx, scale)]);
    notes.push(`水平：贴 ${h.target}（${dpStr(h.marginPx, scale)}）`);
    // 只保留这一侧：清掉另一侧的两条 + 本侧另一种写法
    const isStart = h.attr.startsWith("layout_constraintStart");
    const opposite = isStart
      ? ["layout_constraintEnd_toEndOf", "layout_constraintEnd_toStartOf"]
      : ["layout_constraintStart_toStartOf", "layout_constraintStart_toEndOf"];
    const sameSideWipe = isStart
      ? (h.attr === "layout_constraintStart_toStartOf" ? "layout_constraintStart_toEndOf" : "layout_constraintStart_toStartOf")
      : (h.attr === "layout_constraintEnd_toEndOf" ? "layout_constraintEnd_toStartOf" : "layout_constraintEnd_toEndOf");
    for (const k of [...opposite, sameSideWipe]) changes.push([k, null]);
  }
  if (v) {
    changes.push([v.attr, v.target]);
    changes.push([v.marginAttr, dpStr(v.marginPx, scale)]);
    notes.push(`垂直：贴 ${v.target}（${dpStr(v.marginPx, scale)}）`);
    const isTop = v.attr.startsWith("layout_constraintTop");
    const oppositeV = isTop
      ? ["layout_constraintBottom_toBottomOf", "layout_constraintBottom_toTopOf"]
      : ["layout_constraintTop_toTopOf", "layout_constraintTop_toBottomOf"];
    const sameSideWipeV = isTop
      ? (v.attr === "layout_constraintTop_toTopOf" ? "layout_constraintTop_toBottomOf" : "layout_constraintTop_toTopOf")
      : (v.attr === "layout_constraintBottom_toBottomOf" ? "layout_constraintBottom_toTopOf" : "layout_constraintBottom_toBottomOf");
    for (const k of [...oppositeV, sameSideWipeV]) changes.push([k, null]);
  }

  return { changes, notes };
}

/** 无约束 → 贴父左边 + 接在上一个兄弟下面 */
function smartStack(input: AutoInput): AutoResult {
  const { parent, prev, scale } = input;
  const gap = input.gapDp ?? 8;
  const changes: [string, string | null][] = [];
  const notes: string[] = [];

  changes.push(["layout_constraintStart_toStartOf", "parent"]);
  changes.push(["layout_marginStart", `${gap}dp`]);
  changes.push(["layout_constraintEnd_toEndOf", null]);
  notes.push(`水平：贴父容器左边（${gap}dp）`);

  if (prev && prev.ref) {
    // 若接在 prev 下面会超出父容器底边，就改成和 prev 顶对顶（同一行），避免控件跑到屏幕外
    const overflow = prev.box.top + prev.box.height + gap * scale + input.box.height > parent.top + parent.height;
    if (overflow) {
      changes.push(["layout_constraintTop_toTopOf", prev.ref]);
      changes.push(["layout_marginTop", "0dp"]);
      notes.push(`垂直：与 ${prev.ref} 顶对齐（下方已放不下）`);
    } else {
      changes.push(["layout_constraintTop_toBottomOf", prev.ref]);
      changes.push(["layout_marginTop", `${gap}dp`]);
      notes.push(`垂直：接在 ${prev.ref} 下面（${gap}dp）`);
    }
    changes.push(["layout_constraintBottom_toBottomOf", null]);
  } else {
    changes.push(["layout_constraintTop_toTopOf", "parent"]);
    changes.push(["layout_marginTop", `${gap}dp`]);
    changes.push(["layout_constraintBottom_toBottomOf", null]);
    notes.push(`垂直：贴父容器顶部（${gap}dp）`);
  }
  // 顺手兜底：宽度不写死时给个 wrap_content，避免 0dp 在无对边约束下塌成 0
  if (!input.attrs.layout_width) changes.push(["layout_width", "wrap_content"]);
  void parent;

  return { changes, notes };
}

export function autoConstrain(input: AutoInput): AutoResult {
  return hasConstraints(input.attrs) ? inferNearest(input) : smartStack(input);
}

/** 从一组已有 id 里生成不重复的 @+id/view_N */
export function nextViewId(existingRefs: string[]): string {
  const used = new Set(
    existingRefs.map((r) => r.replace(/^@\+?id\//, "")).filter(Boolean),
  );
  let n = 1;
  while (used.has(`view_${n}`)) n++;
  return `@+id/view_${n}`;
}
