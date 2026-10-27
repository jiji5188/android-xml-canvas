// lib/xml/bundle.ts — 导出「可落地到 Android 工程」的 res 包（布局 + 图标/资源 xml）
// 解决的问题：只导 activity_main.xml 时，布局里引用的 @drawable/ic_xxx 在别处打开会报「找不到图标」。

import type { ResourceExtras, ResTreeDir, ResTreeFile } from "./resdir";
import type { ZipEntry } from "./zip";

export interface BundleInput {
  /** 已规范化（带声明）的布局 XML 全文 */
  layoutXml: string;
  /** 布局文件名，默认 activity_main.xml */
  layoutName?: string;
  /** 图标选择器生成的矢量资源：资源名 → vector xml 原文 */
  iconVectors?: Record<string, string>;
  /** 已上传的 res 目录解析结果（要一并带走 shape/vector/values） */
  extras?: ResourceExtras | null;
}

/** 组装 zip 条目（路径相对 res/）：layout/ + drawable/ + values/ */
export function buildResBundle(input: BundleInput): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const seen = new Set<string>();
  const push = (path: string, text: string) => {
    if (!text || seen.has(path)) return;
    seen.add(path);
    entries.push({ path, text });
  };

  const layoutName = input.layoutName || "activity_main.xml";
  push(`layout/${layoutName}`, input.layoutXml);

  // 1) 图标选择器生成的 vector
  for (const [name, xml] of Object.entries(input.iconVectors ?? {})) {
    if (!xml) continue;
    push(`drawable/${name}.xml`, xml);
  }

  // 2) 上传 res 里的 drawable xml（shape/selector/ripple）与 vector
  const extras = input.extras;
  if (extras) {
    for (const [name, xml] of Object.entries(extras.drawableXml ?? {})) {
      if (!xml) continue;
      if (/<vector[\s>]/.test(xml)) continue; // vector 走下面的树遍历（保原文件名）
      push(`drawable/${name}.xml`, xml);
    }
    // 树里的 drawable/mipmap xml 全文（保原始路径，含 -night 等限定符目录）
    const walk = (dir: ResTreeDir) => {
      for (const child of Object.values(dir.children)) {
        if ("children" in child) walk(child);
        else {
          const f = child as ResTreeFile;
          if (!f.text) continue;
          if (!/\.xml$/i.test(f.rel)) continue;
          if (!/^(drawable|mipmap)/.test(f.rel)) continue;
          push(f.rel, f.text);
        }
      }
    };
    if (extras.tree) walk(extras.tree);
  }

  // 3) values：把上传的 values 片段拆回文件太脆，统一写 values/res_values.xml（可被 Android 读取）
  if (extras?.valuesXml && extras.valuesXml.trim()) {
    push("values/res_values.xml", wrapValues(extras.valuesXml));
  }

  // 排序：layout → drawable → values，方便人看
  return entries.sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

function rank(p: string): number {
  if (p.startsWith("layout/")) return 0;
  if (p.startsWith("drawable/")) return 1;
  if (p.startsWith("values/")) return 3;
  return 2;
}

/** 把零散的 <string>/<dimen>/<color> 标签包一层 <resources> */
function wrapValues(fragment: string): string {
  const body = fragment
    .replace(/<\?xml[^>]*\?>/gi, "")
    .replace(/<\/?resources[^>]*>/gi, "")
    .trim();
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}\n</resources>\n`;
}

/** 从布局里扫出引用的 @drawable/@mipmap 名（用于导出前提示缺哪些资源） */
export function referencedDrawables(layoutXml: string): string[] {
  const out = new Set<string>();
  const re = /@(?:drawable|mipmap)\/([A-Za-z0-9_.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(layoutXml)) !== null) out.add(m[1].replace(/\.\w+$/, ""));
  return [...out].sort();
}

/** 导出覆盖检查：布局引用了但包里没有的 drawable（会「找不到图标」的元凶） */
export function missingDrawables(layoutXml: string, entries: ZipEntry[]): string[] {
  const have = new Set(
    entries
      .filter((e) => /^(drawable|mipmap)/.test(e.path))
      .map((e) => e.path.replace(/^[^/]+\//, "").replace(/\.xml$/i, "").replace(/\.\w+$/, "")),
  );
  return referencedDrawables(layoutXml).filter((n) => !have.has(n));
}
