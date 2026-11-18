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

/** fileTree include 过滤：*.jar / *.aar 后缀匹配；空/通配全过 */
export function matchFileTreeInclude(name: string, includes: string[]): boolean {
  if (!includes.length) return true;
  const lower = name.toLowerCase();
  return includes.some((inc) => {
    const p = (inc || "").trim().replace(/^\*\*\//, "").toLowerCase();
    if (!p || p === "*" || p === "*.*") return true;
    if (p.startsWith("*.")) return lower.endsWith(p.slice(1));
    return lower === p || lower.endsWith("/" + p);
  });
}

/** fileTree 目录规范化（去 ./ 前缀、尾部斜杠、反斜杠转正斜杠） */
export function normFtDir(dir: string): string {
  return (dir || "")
    .trim()
    .replace(/^\.\//, "")
    .replace(/^\/+/, "")
    .replace(/[\\/]+$/, "")
    .replace(/\\/g, "/");
}

/** fileTree 目录 → 项目根相对路径（libs → app/libs；../libs → libs）
 *  gradleRel 是 build.gradle 的项目相对路径（app/build.gradle → 基准目录 app/）。
 *  绝对路径 / 无法解析的写法返回空串（不猜）。 */
export function ftDirToProjectRel(dir: string, gradleRel: string): string {
  const raw = (dir || "").trim().replace(/\\/g, "/");
  // 绝对路径（/sdcard/libs、C:/libs）不猜——gradle 里这种写法本来就不可移植
  if (!raw || raw.startsWith("/") || /^[a-zA-Z]:/.test(raw)) return "";
  const d = normFtDir(raw);
  if (!d) return "";
  const gRel = (gradleRel || "build.gradle").replace(/\\/g, "/");
  const baseParts = gRel.split("/").slice(0, -1).filter(Boolean);
  const parts = [...baseParts];
  for (const seg of d.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) return ""; // 跑出项目根了，不猜
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

