// lib/xml/skip-dirs.ts
//
// 「递归项目目录时哪些目录不进去」的唯一口径。
// 以前 java-files / project-dex / project-export / workspace-fs 各写一份，
// 基础 6 项重复 4 遍，差异点（build / .svn / __pycache__）还互相不一致。
//
// 规则：
//   - `coreSkipDirs` 是共识集合（IDE/构建缓存/依赖目录），任何递归都该跳
//   - 调用方需要额外跳的（比如不扫 build/）用 `withExtra(core, ...extras)` 追加
//   - 注意：project-dex **故意不跳 build/**（dex 就是 build 产物），这是有意的差异，别"帮忙"统一掉

/** 所有项目递归都该跳的目录（IDE 缓存 / 构建缓存 / 依赖 / Android Studio 抓包） */
export const coreSkipDirs = new Set([
  ".git",
  ".gradle",
  ".idea",
  ".cxx",
  ".kotlin",
  "node_modules",
  "captures",
]);

/** 在核心集合基础上加额外要跳的目录（返回新 Set，不改核心） */
export function withSkipExtras(core: Set<string>, ...extras: string[]): Set<string> {
  const out = new Set(core);
  for (const e of extras) out.add(e);
  return out;
}
