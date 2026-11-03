// lib/xml/text-trace.ts — 位图轮廓追踪（文字 → path 用）
// 算法：marching squares（等值线 + 亚像素插值）→ RDP 简化 → 二次曲线平滑
// 为什么不用字体解析：那要内置字体文件（中文字体动辄几 MB，还涉及授权）；
// 直接追踪画布上的实际字形，任何语言/字体都能量出来，结果和屏幕上看到的一致。
// 纯函数，不碰 DOM，可在 Node 里跑测试。

export interface Pt {
  x: number;
  y: number;
}

/** 闭合轮廓（点列）。相邻轮廓方向相反：外轮廓正、内孔负，可直接用 nonzero 填充 */
export function traceAlphaField(alpha: ArrayLike<number>, w: number, h: number, iso = 128): Pt[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : alpha[y * w + x]);
  /** 边编号 → 坐标（同一条边只会被相邻两个单元格共用，编号相同就是同一点） */
  const pts = new Map<string, Pt>();
  const segs: Array<[string, string]> = [];
  const ptOf = (id: string, build: () => Pt): Pt => {
    const got = pts.get(id);
    if (got) return got;
    const p = build();
    pts.set(id, p);
    return p;
  };

  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const a = at(x, y);
      const b = at(x + 1, y);
      const c = at(x + 1, y + 1);
      const d = at(x, y + 1);
      const idx = (a >= iso ? 1 : 0) | (b >= iso ? 2 : 0) | (c >= iso ? 4 : 0) | (d >= iso ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const t = (p: number, q: number) => (q - p === 0 ? 0.5 : (iso - p) / (q - p));
      const T = `H${x},${y}`;
      const R = `V${x + 1},${y}`;
      const B = `H${x},${y + 1}`;
      const L = `V${x},${y}`;
      // 先把用到的边坐标登记好（相邻单元格复用同一个 id，坐标一致）
      const need: Array<[string, Pt]> = [
        [T, { x: x + t(a, b), y }],
        [R, { x: x + 1, y: y + t(b, c) }],
        [B, { x: x + t(d, c), y: y + 1 }],
        [L, { x, y: y + t(a, d) }],
      ];
      for (const [id, p] of need) ptOf(id, () => p);
      switch (idx) {
        case 1:
          segs.push([L, T]);
          break;
        case 2:
          segs.push([T, R]);
          break;
        case 3:
          segs.push([L, R]);
          break;
        case 4:
          segs.push([R, B]);
          break;
        case 5: // 两个对角实心（鞍点）
          segs.push([L, T]);
          segs.push([R, B]);
          break;
        case 6:
          segs.push([T, B]);
          break;
        case 7:
          segs.push([L, B]);
          break;
        case 8:
          segs.push([B, L]);
          break;
        case 9:
          segs.push([T, B]);
          break;
        case 10: // 另一对鞍点
          segs.push([L, B]);
          segs.push([T, R]);
          break;
        case 11:
          segs.push([R, B]);
          break;
        case 12:
          segs.push([R, L]);
          break;
        case 13:
          segs.push([T, R]);
          break;
        case 14:
          segs.push([T, L]);
          break;
        default:
          break;
      }
    }
  }

  return stitch(segs, pts);
}

const keyOf = (p: Pt) => `${Math.round(p.x * 1024)}|${Math.round(p.y * 1024)}`;

/** 把线段按边编号首尾相接成闭合环 */
function stitch(segs: Array<[string, string]>, pts: Map<string, Pt>): Pt[][] {
  type Edge = { a: string; b: string; used: boolean };
  const edges: Edge[] = segs.map(([a, b]) => ({ a, b, used: false }));
  const byNode = new Map<string, Edge[]>();
  for (const e of edges) {
    for (const id of [e.a, e.b]) {
      const list = byNode.get(id);
      if (list) list.push(e);
      else byNode.set(id, [e]);
    }
  }

  const loops: Pt[][] = [];
  for (const start of edges) {
    if (start.used) continue;
    const ptsOut: Pt[] = [];
    start.used = true;
    const startNode = start.a;
    let node = start.b;
    let guard = 0;
    while (guard++ < 4_000_000) {
      const p = pts.get(node);
      if (p) ptsOut.push(p);
      if (node === startNode) break;
      const next = byNode.get(node)?.find((e) => !e.used);
      if (!next) break;
      next.used = true;
      node = next.a === node ? next.b : next.a;
    }
    const first = pts.get(startNode);
    if (first) ptsOut.unshift(first);
    const clean = dedupe(ptsOut);
    if (clean.length >= 3 && Math.abs(signedArea(clean)) > 0.5) loops.push(orient(clean));
  }
  return loops;
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-6 && Math.abs(last.y - p.y) < 1e-6) continue;
    out.push(p);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && Math.abs(first.x - last.x) < 1e-6 && Math.abs(first.y - last.y) < 1e-6) out.pop();
  return out;
}

/** 有符号面积（正 = 逆时针/数学正方向，负 = 顺时针） */
export function signedArea(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

function orient(pts: Pt[]): Pt[] {
  return signedArea(pts) < 0 ? pts.slice().reverse() : pts;
}

function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** 孔洞统一成负方向（nonzero 填充时才会被挖空） */
export function orientLoops(loops: Pt[][]): Pt[][] {
  const order = loops
    .map((pts, i) => ({ pts, i, area: Math.abs(signedArea(pts)) }))
    .sort((a, b) => b.area - a.area);
  const done: Pt[][] = [];
  for (const item of order) {
    const isHole = done.some((outer) => pointInPoly(item.pts[0], outer));
    let pts = item.pts;
    const area = signedArea(pts);
    if (isHole ? area > 0 : area < 0) pts = pts.slice().reverse();
    done.push(pts);
  }
  return done;
}

/** Ramer–Douglas–Peucker 简化（闭合环） */
export function simplifyLoop(pts: Pt[], tol: number): Pt[] {
  if (pts.length <= 4 || tol <= 0) return pts.slice();
  // 闭合环：找离起点最远的点，切成两条折线分别简化
  let far = 1;
  let farD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const a = rdp(pts.slice(0, far + 1), tol);
  const b = rdp(pts.slice(far).concat([pts[0]]), tol);
  const out = a.concat(b.slice(1, -1));
  return out.length >= 3 ? out : pts.slice();
}

function rdp(pts: Pt[], tol: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const last = pts.length - 1;
  let idx = -1;
  let maxD = 0;
  const [p0, p1] = [pts[0], pts[last]];
  for (let i = 1; i < last; i++) {
    const d = segDist(pts[i], p0, p1);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= tol || idx < 0) return [pts[0], pts[last]];
  const left = rdp(pts.slice(0, idx + 1), tol);
  const right = rdp(pts.slice(idx), tol);
  return left.slice(0, -1).concat(right);
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

export interface PathDataOpts {
  /** 简化容差（源像素） */
  tol?: number;
  /** 用二次曲线平滑（默认开） */
  smooth?: boolean;
  /** 坐标保留小数位 */
  digits?: number;
}

/** 轮廓 → pathData；map 负责把源像素坐标换算到目标坐标系 */
export function contoursToPathData(loops: Pt[][], map: (p: Pt) => Pt, opt: PathDataOpts = {}): string {
  const tol = opt.tol ?? 0.6;
  const smooth = opt.smooth !== false;
  const digits = opt.digits ?? 2;
  const f = (v: number) => {
    const n = Number(v.toFixed(digits));
    return String(Number.isFinite(n) ? n : 0);
  };

  const parts: string[] = [];
  for (const raw of orientLoops(loops)) {
    const pts = simplifyLoop(raw, tol).map(map).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    const uniq = pts.filter((p, i) => {
      const q = pts[(i + 1) % pts.length];
      return Math.abs(p.x - q.x) > 1e-4 || Math.abs(p.y - q.y) > 1e-4;
    });
    if (uniq.length < 3) continue;
    if (!smooth) {
      parts.push(`M${f(uniq[0].x)} ${f(uniq[0].y)}` + uniq.slice(1).map((p) => `L${f(p.x)} ${f(p.y)}`).join("") + "Z");
      continue;
    }
    // 二次曲线：控制点落在原来折线的顶点上，端点落在相邻顶点的中点（曲线更顺，点更少）
    const n = uniq.length;
    const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const start = mid(uniq[0], uniq[1]);
    let d = `M${f(start.x)} ${f(start.y)}`;
    for (let i = 1; i <= n; i++) {
      const cur = uniq[i % n];
      const next = uniq[(i + 1) % n];
      const m = mid(cur, next);
      d += `Q${f(cur.x)} ${f(cur.y)} ${f(m.x)} ${f(m.y)}`;
    }
    parts.push(d + "Z");
  }
  return parts.join("");
}
