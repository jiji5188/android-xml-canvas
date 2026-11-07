// lib/xml/project-scope.ts — M182：项目面板分段（布局 / 资源 / 代码 / 全部）的分类纯函数
//
// 为什么要有它：res 下几十个限定符目录平铺会淹死人；按「布局 / 资源（按类型）/ 代码」
// 分段之后，用户不用先理解 Android 工程结构也能找到文件。
// 这一层只管「扫出来的扁平文件列表 → 该不该出现在某一段」，不碰 DOM、不碰 source。

export type ProjectScope = "all" | "layout" | "res" | "code";
export type ResKind = "icon" | "text" | "color" | "other";

export interface ScannedEntry {
  rel: string;
  name: string;
  isDir: boolean;
}

/** 取 rel 里 res/ 之后的相对路径（例：drawable/ic_x.xml）；不在 res 下返回 null */
function resSub(rel: string): string | null {
  const p = rel.replace(/\\/g, "/");
  const m = /(^|\/)res\/(.+)$/.exec(p);
  return m ? m[2] : null;
}

/** 把一个 res 下的文件归到「图标 / 文本 / 颜色 / 其他」四类之一 */
export function resKindOf(rel: string): ResKind | null {
  const sub = resSub(rel);
  if (!sub) return null;
  const slash = sub.indexOf("/");
  if (slash < 0) return null; // 直接丢在 res/ 根下的文件，不归类
  const dir = sub.slice(0, slash).toLowerCase();
  const base = sub.slice(slash + 1).toLowerCase().replace(/.*\//, "");
  // 图标/图片：mipmap（桌面图标）与 drawable（矢量、形状、选择器、位图）都归这里
  if (/^mipmap/.test(dir) || /^drawable/.test(dir)) return "icon";
  // 颜色：values*/colors.xml 与 res/color*（ColorStateList）
  if (/^color/.test(dir)) return "color";
  if (/^values/.test(dir)) {
    if (base === "colors.xml") return "color";
    if (base === "strings.xml" || base === "arrays.xml" || base === "plurals.xml") return "text";
    return "other"; // dimens / styles / themes / bools / integers…
  }
  // raw / font / anim / animator / xml / menu / navigation / transition…
  return "other";
}

/** 布局文件：res/layout 及其限定符目录（layout-land / layout-sw600dp…） */
export function isLayoutFile(rel: string): boolean {
  const sub = resSub(rel);
  if (!sub) return false;
  const slash = sub.indexOf("/");
  if (slash < 0) return false;
  return /^layout/i.test(sub.slice(0, slash));
}

/** 代码文件：java/kotlin 源码 + AndroidManifest（用户真的会手改的配置） */
export function isCodeFile(rel: string): boolean {
  const p = rel.replace(/\\/g, "/");
  if (/(^|\/)src\/main\/(java|kotlin)\/.+\.(java|kt)$/i.test(p)) return true;
  if (/(^|\/)src\/main\/AndroidManifest\.xml$/i.test(p)) return true;
  return false;
}

/** 按段过滤（只返回文件，不含目录） */
export function matchScope(files: ScannedEntry[], scope: ProjectScope, kind?: ResKind): ScannedEntry[] {
  const onlyFiles = files.filter((f) => !f.isDir);
  if (scope === "layout") return onlyFiles.filter((f) => isLayoutFile(f.rel));
  if (scope === "code") return onlyFiles.filter((f) => isCodeFile(f.rel));
  if (scope === "res") {
    if (!kind) return onlyFiles.filter((f) => resKindOf(f.rel) !== null);
    return onlyFiles.filter((f) => resKindOf(f.rel) === kind);
  }
  return onlyFiles;
}

/** 按父目录聚合（保持传入顺序），用于「目录分组 + 可折叠」的展示 */
export function groupByDir(files: ScannedEntry[]): Array<{ dir: string; files: ScannedEntry[] }> {
  const map = new Map<string, ScannedEntry[]>();
  for (const f of files) {
    const rel = f.rel.replace(/\\/g, "/");
    const i = rel.lastIndexOf("/");
    const dir = i < 0 ? "" : rel.slice(0, i);
    const arr = map.get(dir);
    if (arr) arr.push(f);
    else map.set(dir, [f]);
  }
  return [...map.entries()].map(([dir, list]) => ({ dir, files: list }));
}

/** 各类型数量（用于二级 tab 上的角标） */
export function countByKind(files: ScannedEntry[]): Record<ResKind, number> {
  const out: Record<ResKind, number> = { icon: 0, text: 0, color: 0, other: 0 };
  for (const f of files) {
    if (f.isDir) continue;
    const k = resKindOf(f.rel);
    if (k) out[k] += 1;
  }
  return out;
}

/** 目录短标签：res/layout-land → res/layout-land；java/com/x → com.x */
export function shortDirLabel(dir: string): string {
  const p = dir.replace(/\\/g, "/");
  const res = /(^|\/)res\/(.*)$/.exec(p);
  if (res) return "res/" + res[2];
  const code = /(^|\/)src\/main\/(?:java|kotlin)\/(.*)$/.exec(p);
  if (code) return code[2] ? code[2].replace(/\//g, ".") : "(默认包)";
  if (/(^|\/)src\/main$/.test(p)) return "src/main";
  return p || "(项目根)";
}
