// M463：adaptive icon（mipmap-anydpi-v26/*.xml）引用的 drawable 缺失时，
// 它会被渲染成「透明背景 + 前景」≈ 默认/空白图标，盖住项目里真正有用的密度 PNG。
// 修法：这类「坏的 adaptive icon」从包里剔除，让 mipmap-hdpi/ic_launcher.png 等密度 PNG 接管，
// 用户在桌面看到的才是自己定义的图标。

import type { RenderFile } from "./native-render";

/** adaptive-icon 的 background/foreground 引用的 drawable 名（@drawable/xxx） */
function adaptiveDrawables(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<(?:background|foreground)[^>]*android:drawable\s*=\s*"@(?:drawable)\/([A-Za-z0-9_.]+)"/g)) {
    out.push(m[1].replace(/\.(9\.)?(png|jpg|jpeg|webp|gif|xml)$/i, ""));
  }
  return out;
}

/** 这批文件里是否存在 drawable/<name>（任意限定符目录、png/xml 都算） */
function hasDrawable(files: RenderFile[], name: string): boolean {
  const re = new RegExp(
    `^drawable(-[^/]+)?/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(xml|png|jpg|jpeg|webp|gif)$`,
    "i",
  );
  return files.some((f) => re.test(f.path || ""));
}

/**
 * 剔除「adaptive icon XML 引用的 drawable 全部缺失」的坏图标。
 * @returns 新文件清单 + 剔除了哪些（供构建日志）
 * 规则：只针对 mipmap-anydpi-v26/（adaptive 专属目录）下的 .xml；
 *      且该 xml 是 <adaptive-icon>；且它 background+foreground 引用的 drawable 一个都不在包里。
 *      只要有一个 drawable 在（前景在、背景缺），就不剔（避免误伤半成品），交给 stub 兜底。
 *      同名的密度 PNG（mipmap-hdpi/ic_launcher.png）存在时才剔——确保剔了有东西顶上。
 */
export function dropBrokenAdaptiveIcons(
  files: RenderFile[],
): { files: RenderFile[]; dropped: string[] } {
  const out = files.map((f) => ({ ...f }));
  const dropped: string[] = [];

  // 先按「同名是否有密度 PNG」建索引：mipmap-anydpi-v26/ic_launcher.xml → 看 mipmap-*/ic_launcher.png 在不在
  const pngBase = new Set<string>();
  for (const f of out) {
    const m = (f.path || "").match(/^mipmap-[^/]+\/([A-Za-z0-9_.]+)\.png$/i);
    if (m) pngBase.add(m[1]);
  }

  for (const f of out) {
    const p = f.path || "";
    if (!/^mipmap-anydpi-v26\/[A-Za-z0-9_.]+\.xml$/i.test(p)) continue;
    if (typeof f.text !== "string" || !/<adaptive-icon/i.test(f.text)) continue;
    const refs = adaptiveDrawables(f.text);
    if (!refs.length) continue;
    // 只要有一个引用的 drawable 缺失（会被 stub 成透明/占位 → adaptive 渲染成默认/空白），就剔
    const anyMissing = refs.some((r) => !hasDrawable(out, r));
    if (!anyMissing) continue;
    // 必须有同名密度 PNG 顶上，否则剔了就没图标了
    const base = p.replace(/^mipmap-anydpi-v26\//, "").replace(/\.xml$/i, "");
    if (!pngBase.has(base)) continue;
    dropped.push(p);
  }

  const dropSet = new Set(dropped);
  const kept = out.filter((f) => !dropSet.has(f.path));
  return { files: kept, dropped };
}
