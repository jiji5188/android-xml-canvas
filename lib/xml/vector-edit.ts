// lib/xml/vector-edit.ts — M11j：vector 图标的可编辑模型（解析 → 编辑 → 重新序列化）
// 只覆盖编辑器自己生成的图标形态：单个 <vector>，可选一层 <group>（旋转/镜像），若干 <path>。

export interface VectorPath {
  /** pathData */
  d: string;
  /** 填充色（#RRGGBB / #AARRGGBB / @color/x 原样保留） */
  fill: string;
  /** fillAlpha 0~1 */
  alpha?: number;
  stroke?: string;
  strokeWidth?: number;
  /** 描边不透明度 0~1（M81：画布编辑器用；旧数据没有则视为 1） */
  strokeAlpha?: number;
  /** 单条 path 的旋转（度）与其旋转中心；M88l：非 0 时导出为独立 <group> */
  rotation?: number;
  pivotX?: number;
  pivotY?: number;
  /** M145：填充规则（android:fillType）；缺省按 nonzero 处理 */
  fillType?: "evenOdd" | "nonZero";
}

export interface VectorGroup {
  rotation: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
}

/** M89a：vector 里的节点树（组/路径），用于保留 <group> 结构与 android:name */
export type VectorNode = VectorNodePath | VectorNodeGroup;

export interface VectorNodePath {
  kind: "path";
  path: VectorPath;
}

export interface VectorNodeGroup {
  kind: "group";
  /** android:name（animated-vector 靠它定位目标） */
  name?: string;
  attrs: VectorGroup;
  translateX: number;
  translateY: number;
  children: VectorNode[];
}

export interface VectorModel {
  /** 输出尺寸（dp） */
  w: number;
  h: number;
  /** 视口 */
  vw: number;
  vh: number;
  /** 变换（恒等时序列化会省略 group） */
  group: VectorGroup;
  /** 扁平路径列表（旧调用方兼容用；有 nodes 时以 nodes 为准） */
  paths: VectorPath[];
  /** 节点树：保留任意层 <group>（含 name / 变换 / 平移） */
  nodes?: VectorNode[];
}

const DEFAULT_GROUP: VectorGroup = { rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };

function num(v: string | undefined, fallback: number): number {
  if (v == null) return fallback;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function attrOf(head: string, name: string): string | undefined {
  const re = new RegExp(`(?:android:)?${name}\\s*=\\s*"([^"]*)"`, "m");
  return re.exec(head)?.[1];
}

/** 解析 vector xml → 可编辑模型；不是 vector 返回 null */
export function parseVectorModel(xml: string): VectorModel | null {
  if (!/<vector[\s>]/.test(xml)) return null;
  const vwMatch = /<vector\b[^>]*>/.exec(xml);
  const head = vwMatch ? vwMatch[0] : xml;
  const vw = num(attrOf(head, "viewportWidth"), 24);
  const vh = num(attrOf(head, "viewportHeight"), 24);
  const w = num((attrOf(head, "width") || "").replace(/dp$/, ""), vw);
  const h = num((attrOf(head, "height") || "").replace(/dp$/, ""), vh);

  /* 只有「没有 android:name」的首层 group 才当成整体变换 wrapper；
     带 name 的是内容分组，归节点树管（M89b） */
  const gm = /<group\b([^>]*)>/.exec(xml);
  const gmNamed = gm ? !!attrOf(gm[1], "name") : false;
  const group: VectorGroup = gm && !gmNamed
    ? {
        rotation: num(attrOf(gm[1], "rotation"), 0),
        scaleX: num(attrOf(gm[1], "scaleX"), 1),
        scaleY: num(attrOf(gm[1], "scaleY"), 1),
        pivotX: num(attrOf(gm[1], "pivotX"), vw / 2),
        pivotY: num(attrOf(gm[1], "pivotY"), vh / 2),
      }
    : { ...DEFAULT_GROUP, pivotX: vw / 2, pivotY: vh / 2 };

  const nodes = parseVectorNodes(xml, vw, vh);
  const paths = flattenNodes(nodes);
  if (!paths.length) return null;
  return { w, h, vw, vh, group, paths, nodes };
}

/** path 元素属性 → VectorPath */
function pathFromAttrs(raw: string): VectorPath | null {
  const d = attrOf(raw, "pathData");
  if (!d) return null;
  const alphaRaw = attrOf(raw, "fillAlpha");
  const swRaw = attrOf(raw, "strokeWidth");
  const saRaw = attrOf(raw, "strokeAlpha");
  return {
    d,
    fill: attrOf(raw, "fillColor") || "#1D1B20",
    alpha: alphaRaw == null ? undefined : num(alphaRaw, 1),
    stroke: attrOf(raw, "strokeColor") || undefined,
    strokeWidth: swRaw == null ? undefined : num(swRaw, 1),
    strokeAlpha: saRaw == null ? undefined : num(saRaw, 1),
    ...(/even-?odd/i.test(attrOf(raw, "fillType") || "") ? { fillType: "evenOdd" as const } : {}),
  };
}

/** 递归解析 <vector> 里的 <group>/<path>（支持多层嵌套；注释忽略） */
export function parseVectorNodes(xml: string, vw: number, vh: number): VectorNode[] {
  const body = xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<vector\b[^>]*>/, "")
    .replace(/<\/vector>\s*$/, "");
  const root: VectorNode[] = [];
  /** 当前容器栈（栈顶是正在收集子节点的数组） */
  const stack: { node?: VectorNodeGroup; list: VectorNode[] }[] = [{ list: root }];
  const re = /<(group|path)\b([^>]*?)(\/?)>|<\/group>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tag = m[1];
    const attrsRaw = m[2] || "";
    const selfClose = m[3] === "/";
    if (!tag) {
      // </group>
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tag === "path") {
      const p = pathFromAttrs(attrsRaw);
      if (p) stack[stack.length - 1].list.push({ kind: "path", path: p });
      continue;
    }
    const node: VectorNodeGroup = {
      kind: "group",
      name: attrOf(attrsRaw, "name") || undefined,
      attrs: {
        rotation: num(attrOf(attrsRaw, "rotation"), 0),
        scaleX: num(attrOf(attrsRaw, "scaleX"), 1),
        scaleY: num(attrOf(attrsRaw, "scaleY"), 1),
        pivotX: num(attrOf(attrsRaw, "pivotX"), vw / 2),
        pivotY: num(attrOf(attrsRaw, "pivotY"), vh / 2),
      },
      translateX: num(attrOf(attrsRaw, "translateX"), 0),
      translateY: num(attrOf(attrsRaw, "translateY"), 0),
      children: [],
    };
    stack[stack.length - 1].list.push(node);
    if (!selfClose) stack.push({ node, list: node.children });
  }
  return root;
}

/** 节点树 → 扁平路径列表（旧接口用） */
export function flattenNodes(nodes: VectorNode[]): VectorPath[] {
  const out: VectorPath[] = [];
  const walk = (list: VectorNode[]) => {
    for (const n of list) {
      if (n.kind === "path") out.push(n.path);
      else walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

const IDENTITY = (g: VectorGroup) =>
  g.rotation === 0 &&
  g.scaleX === 1 &&
  g.scaleY === 1;

/** 模型 → vector xml（能被 aapt 直接吃） */
export function buildVectorXml(m: VectorModel, name = "ic_icon"): string {
  const lines: string[] = [];
  lines.push(`<vector xmlns:android="http://schemas.android.com/apk/res/android"`);
  lines.push(`    android:width="${round(m.w)}dp"`);
  lines.push(`    android:height="${round(m.h)}dp"`);
  lines.push(`    android:viewportWidth="${round(m.vw)}"`);
  lines.push(`    android:viewportHeight="${round(m.vh)}"`);
  if (name) lines.push(`    android:name="${name}"`);
  lines[lines.length - 1] = lines[lines.length - 1] + ">";

  /* M89a：节点树与扁平 paths 一致 → 整棵树直接输出
     （树里已经含所有 <group>；m.group 若是从首层 group 读出来的，就别再包一层，否则重复） */
  if (m.nodes && m.nodes.length && nodesMatchPaths(m.nodes, m.paths)) {
    const wrap = !IDENTITY(m.group) && !firstGroupIsWrapper(m.nodes, m.group);
    if (wrap) emitWrapper(m.group, lines);
    emitNodes(m.nodes, wrap ? "        " : "    ", lines);
    if (wrap) lines.push("    </group>");
    lines.push("</vector>");
    return lines.join("\n");
  }

  /* 兼容路径：扁平 paths + 可选的整体变换 wrapper */
  const withGroup = !IDENTITY(m.group);
  if (withGroup) emitWrapper(m.group, lines);
  const pad = withGroup ? "        " : "    ";
  for (const p of m.paths) emitPath(p, pad, lines);
  if (withGroup) lines.push("    </group>");
  lines.push("</vector>");
  return lines.join("\n");
}

/** 首层节点就是「同参数且无 name」的 group → 说明 m.group 是从它读出来的，无需再包一层 */
function firstGroupIsWrapper(nodes: VectorNode[], g: VectorGroup): boolean {
  const n = nodes[0];
  if (!n || n.kind !== "group" || n.name) return false;
  const a = n.attrs;
  return (
    Math.abs(a.rotation - g.rotation) < 1e-6 &&
    Math.abs(a.scaleX - g.scaleX) < 1e-6 &&
    Math.abs(a.scaleY - g.scaleY) < 1e-6 &&
    Math.abs(a.pivotX - g.pivotX) < 1e-6 &&
    Math.abs(a.pivotY - g.pivotY) < 1e-6
  );
}

/** 整体变换 wrapper（旧接口的 m.group） */
function emitWrapper(g: VectorGroup, lines: string[]): void {
  lines.push(`    <group`);
  if (g.rotation) lines.push(`        android:rotation="${round(g.rotation)}"`);
  if (g.scaleX !== 1) lines.push(`        android:scaleX="${round(g.scaleX)}"`);
  if (g.scaleY !== 1) lines.push(`        android:scaleY="${round(g.scaleY)}"`);
  lines.push(`        android:pivotX="${round(g.pivotX)}"`);
  lines.push(`        android:pivotY="${round(g.pivotY)}">`);
}

/** 节点树扁平化后是否与 paths 完全一致（d/fill/alpha/stroke 逐条比对） */
function nodesMatchPaths(nodes: VectorNode[], paths: VectorPath[]): boolean {
  const flat = flattenNodes(nodes);
  if (flat.length !== paths.length) return false;
  for (let i = 0; i < flat.length; i++) {
    const a = flat[i];
    const b = paths[i];
    if (a.d !== b.d || a.fill !== b.fill) return false;
    if ((a.alpha ?? 1) !== (b.alpha ?? 1)) return false;
    if ((a.stroke ?? "") !== (b.stroke ?? "")) return false;
    if ((a.strokeWidth ?? 0) !== (b.strokeWidth ?? 0)) return false;
  }
  return true;
}

/** 节点树 → xml 行（保留 group 的 name / 平移 / 变换 / 嵌套） */
function emitNodes(nodes: VectorNode[], pad: string, lines: string[]): void {
  for (const n of nodes) {
    if (n.kind === "path") {
      emitPath(n.path, pad, lines);
      continue;
    }
    const attrs: string[] = [];
    if (n.name) attrs.push(`android:name="${n.name}"`);
    if (n.translateX) attrs.push(`android:translateX="${round(n.translateX)}"`);
    if (n.translateY) attrs.push(`android:translateY="${round(n.translateY)}"`);
    if (n.attrs.rotation) attrs.push(`android:rotation="${round(n.attrs.rotation)}"`);
    if (n.attrs.scaleX !== 1) attrs.push(`android:scaleX="${round(n.attrs.scaleX)}"`);
    if (n.attrs.scaleY !== 1) attrs.push(`android:scaleY="${round(n.attrs.scaleY)}"`);
    const transformed =
      !!n.attrs.rotation || n.attrs.scaleX !== 1 || n.attrs.scaleY !== 1 || !!n.translateX || !!n.translateY;
    if (transformed) {
      attrs.push(`android:pivotX="${round(n.attrs.pivotX)}"`);
      attrs.push(`android:pivotY="${round(n.attrs.pivotY)}"`);
    }
    if (!attrs.length) {
      lines.push(`${pad}<group>`);
    } else {
      lines.push(`${pad}<group`);
      attrs.forEach((a, i) => {
        lines.push(`${pad}    ${a}${i === attrs.length - 1 ? ">" : ""}`);
      });
    }
    emitNodes(n.children, pad + "    ", lines);
    lines.push(`${pad}</group>`);
  }
}

/** 单条路径 → xml 行（带可选的自旋转 group） */
function emitPath(p: VectorPath, pad: string, lines: string[]): void {
  const rotated = p.rotation != null && Math.abs(p.rotation) > 0.001;
  const q = rotated ? pad + "    " : pad;
  if (rotated) {
    const attrs = [`android:rotation="${round(p.rotation!)}"`];
    if (p.pivotX != null) attrs.push(`android:pivotX="${round(p.pivotX)}"`);
    if (p.pivotY != null) attrs.push(`android:pivotY="${round(p.pivotY)}"`);
    lines.push(`${pad}<group`);
    attrs.forEach((a, i) => {
      lines.push(`${pad}    ${a}${i === attrs.length - 1 ? ">" : ""}`);
    });
  }
  lines.push(`${q}<path`);
  lines.push(`${q}    android:fillColor="${p.fill}"`);
  if (p.fillType === "evenOdd") lines.push(`${q}    android:fillType="evenOdd"`);
  if (p.alpha != null && p.alpha !== 1) lines.push(`${q}    android:fillAlpha="${round(p.alpha)}"`);
  if (p.stroke) lines.push(`${q}    android:strokeColor="${p.stroke}"`);
  if (p.strokeWidth != null) lines.push(`${q}    android:strokeWidth="${round(p.strokeWidth)}"`);
  if (p.strokeAlpha != null && p.strokeAlpha !== 1) lines.push(`${q}    android:strokeAlpha="${round(p.strokeAlpha)}"`);
  lines.push(`${q}    android:pathData="${p.d}"/>`);
  if (rotated) lines.push(`${pad}</group>`);
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** 旋转 90° 一档（0/90/180/270 循环） */
export function nextRotation(r: number): number {
  return (Math.round(r / 90) * 90 + 90) % 360;
}
