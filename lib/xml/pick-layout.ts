// lib/xml/pick-layout.ts — M192g：打包时挑一个「项目里真实存在的布局」
//
// 背景：用户开着 MainActivity.java 点「打包并安装」，以前会把编辑器正文（Java）当成
// layout/activity_main.xml 写盘 → aapt2 报 syntax error。而 collectProjectRes 只按引用收集，
// 不会把 layout/ 整目录带进来，所以必须自己去项目 res 下把布局列出来。
//
// 挑选顺序：Java 里 R.layout.X 提到的那个 → activity_main → 谁先扫到用谁。
import type { AiFileIo } from "./ai-tools";
import { scanResDirs } from "./res-index";

export interface PickedLayout {
  /** 布局名（不带 .xml，不带目录） */
  name: string;
  /** 相对项目根的路径，如 layout/activity_main.xml */
  rel: string;
  /** 文件全文 */
  text: string;
}

interface Cand {
  name: string;
  rel: string;
  dir: string;
}

/**
 * 从项目 res 里挑一个布局并读出正文。找不到返回 null（调用方提示用户先建布局）。
 * 只读 layout* 目录下的 .xml，单次最多读 60 个，避免大项目卡住。
 */
export async function pickProjectLayout(
  io: AiFileIo | null,
  docRel: string | null,
  want = "",
): Promise<PickedLayout | null> {
  if (!io) return null;
  let resRel = "";
  let dirs: string[] = [];
  try {
    const info = await scanResDirs(io, docRel);
    resRel = (info.resRel || "").replace(/\/+$/, "");
    dirs = info.dirs || [];
  } catch {
    return null;
  }
  if (!resRel) return null;

  // 无后缀的 layout/ 优先（限定符目录放后面）
  const layoutDirs = dirs.filter((d) => /^layout(-|$)/.test(d)).sort((a, b) => {
    const pa = a === "layout" ? 0 : 1;
    const pb = b === "layout" ? 0 : 1;
    return pa - pb || a.localeCompare(b);
  });

  const cands: Cand[] = [];
  for (const dir of layoutDirs) {
    let items: { name: string; kind: "file" | "dir" }[] = [];
    try {
      const r = await io.list(`${resRel}/${dir}`);
      if (!r.ok || !r.items) continue;
      items = r.items.map((it) => ({ name: it.name, kind: it.kind }));
    } catch {
      continue;
    }
    for (const it of items) {
      if (it.kind !== "file" || !/\.xml$/i.test(it.name)) continue;
      cands.push({ name: it.name.replace(/\.xml$/i, ""), dir, rel: `${dir}/${it.name}` });
      if (cands.length >= 60) break;
    }
    if (cands.length >= 60) break;
  }
  if (!cands.length) return null;

  const hit =
    (want ? cands.find((c) => c.name === want) : undefined) ||
    cands.find((c) => c.name === "activity_main") ||
    cands[0];

  try {
    const r = await io.read(`${resRel}/${hit.rel}`);
    if (!r.ok) return null;
    const text = r.text || "";
    if (!text.trim()) return null;
    return { name: hit.name, rel: hit.rel, text };
  } catch {
    return null;
  }
}
