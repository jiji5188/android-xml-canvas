// lib/xml/nearest-name.ts — M179：拼写建议的公共工具
//
// 三处地方都需要「这个名字好像拼错了，最接近的是哪个」：
//   - Java 方法名（setTxt → setText）      java-methods.ts
//   - Java 资源引用（R.id.titel → title）  java-lint.ts
//   - XML 资源引用（@drawable/ic_hom → ic_home）xml-res-check.ts
//
// 规则刻意保守：唯一最近 + 距离在阈值内才给建议，宁可不修也不要改错。

/** 编辑距离（只算替换/插入/删除，带上限提前退出） */
export function editDistance(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array<number>(b.length + 1);
  const cur = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

/**
 * 在一堆候选名里找最接近的拼写。
 * - 候选里已有同名 → null（没得修）
 * - 两个候选一样近（平票）→ null（不猜）
 * - 最近距离 > maxDist → null
 * 比较时会同时试「原样」和「全小写」，所以 btnOk 能对上 btn_ok。
 */
export function nearestName(name: string, candidates: Iterable<string>, maxDist = 3): string | null {
  const lower = name.toLowerCase();
  let best: string | null = null;
  let bestD = maxDist + 1;
  let tie = false;
  for (const c of candidates) {
    if (c === name) return null;
    const d = Math.min(editDistance(lower, c.toLowerCase()), editDistance(name, c));
    if (d < bestD) {
      bestD = d;
      best = c;
      tie = false;
    } else if (d === bestD && c !== best) {
      tie = true;
    }
  }
  return best && !tie ? best : null;
}
