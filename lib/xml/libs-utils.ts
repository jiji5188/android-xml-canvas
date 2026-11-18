// lib/xml/libs-utils.ts — M368：库管理面板纯逻辑（排序/过滤/大小格式化），可单测
//
// 从 LibsPanel 抽出来的纯函数：面板很大（1100+ 行），列表的排序/过滤/大小格式化
// 不该埋在 JSX 里，抽出可测 + 可复用（本地库/项目库/库目录/gradle 依赖都用同一套匹配规则）。

/** 库文件条目（LibsPanel.LibFile 的最小形状） */
export interface LibItemLike {
  name: string;
  rel: string;
  size?: number;
}

/** 字节数 → 人话（1.2 MB / 860 KB / 34 B）；无效值返回 null */
export function formatBytes(n: number | undefined | null): string | null {
  if (n === undefined || n === null || !Number.isFinite(n) || n < 0) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/**
 * 查询匹配：name 或 rel 任意子串命中即算（大小写不敏感）。
 * 多词（空格分隔）→ 全部命中才算（AND）。
 */
export function matchLibQuery(name: string, rel: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${name}\n${rel}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

/** 过滤 + 按名称排序（大小写不敏感；同名按 rel 稳定） */
export function sortLibFiles<T extends LibItemLike>(list: T[]): T[] {
  return [...list].sort((a, b) => {
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0;
  });
}

/** gradle 依赖（GradleDep 最小形状）匹配：name/group 命中即算 */
export function matchGradleDep(d: { name: string; group: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${d.name}\n${d.group}`.toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
