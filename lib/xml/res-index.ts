// lib/xml/res-index.ts — M65（C1/C3）：把 `@string/app_name` 解析成「哪个文件的第几行」
//
// 用在属性面板的「跳到定义」小按钮上。数据源和 AI 工具同一套 AiFileIo（原生桥 / 浏览器目录句柄），
// 所以网页版和 APK 都能用。结果按 (根标签 + res 目录) 缓存，重复点击不再扫盘。

import type { AiFileIo } from "./ai-tools";
import { dirMatchesType, findValuesDefLine, isValuesType, parseResRef, type ResRef } from "./res-refs";

export interface ResHit {
  /** 命中文件的相对路径（相对项目根） */
  rel: string;
  /** 1 起的行号；媒体文件固定 1 */
  line: number;
  ref: ResRef;
}

export interface ResResolver {
  /** 解析失败/找不到返回 null（UI 提示「项目里没找到」） */
  resolve(value: string): Promise<ResHit | null>;
  /** 已扫到的 res 目录（诊断用） */
  resRel(): string;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; resRel: string; dirs: string[] }>();

function resCandidates(docRel?: string | null): string[] {
  const out: string[] = [];
  if (docRel) {
    const i = docRel.indexOf("res/");
    if (i >= 0) out.push(docRel.slice(0, i + 4));
  }
  for (const c of ["app/src/main/res", "src/main/res", "res"]) if (!out.includes(c)) out.push(c);
  return out;
}

const timeout = async <T,>(p: Promise<T>, ms = 1200): Promise<T | null> => {
  let t: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<null>((r) => {
        t = setTimeout(() => r(null), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
};

/** 找 res 目录并列出子目录（带缓存；换项目/换文档就重新找） */
async function scanRes(io: AiFileIo, docRel?: string | null): Promise<{ resRel: string; dirs: string[] }> {
  const key = `${io.rootLabel()}|${docRel || ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return { resRel: hit.resRel, dirs: hit.dirs };
  for (const cand of resCandidates(docRel)) {
    const r = (await timeout(io.list(cand))) || { ok: false as const };
    if (!r.ok || !r.items) continue;
    const dirs = r.items.filter((it) => it.kind === "dir").map((it) => it.name);
    cache.set(key, { at: Date.now(), resRel: cand, dirs });
    return { resRel: cand, dirs };
  }
  cache.set(key, { at: Date.now(), resRel: "", dirs: [] });
  return { resRel: "", dirs: [] };
}

/** 清缓存（改完 values 文件后调用，或者换项目时调用） */
export function clearResIndex(): void {
  cache.clear();
}

export function createResResolver(io: AiFileIo | null, docRel?: string | null): ResResolver | null {
  if (!io) return null;
  let res: { resRel: string; dirs: string[] } | null = null;

  const dirsFor = async (type: ResRef["type"]): Promise<string[]> => {
    res = res ?? (await scanRes(io, docRel));
    return res.dirs.filter((d) => dirMatchesType(d, type)).sort();
  };

  return {
    resRel: () => res?.resRel ?? "",
    async resolve(value: string): Promise<ResHit | null> {
      const ref = parseResRef(value);
      if (!ref) return null;
      const dirs = await dirsFor(ref.type);
      if (!dirs.length) return null;

      if (isValuesType(ref.type)) {
        for (const d of dirs) {
          const list = (await timeout(io.list(`${res!.resRel}/${d}`))) || { ok: false as const };
          for (const it of list.items || []) {
            if (it.kind !== "file" || !/\.xml$/i.test(it.name)) continue;
            const rel = `${res!.resRel}/${d}/${it.name}`;
            const r = (await timeout(io.read(rel))) || { ok: false as const };
            if (!r.ok) continue;
            const line = findValuesDefLine(r.text || "", ref.type, ref.name);
            if (line > 0) return { rel, line, ref };
          }
        }
        return null;
      }

      // 文件型资源：drawable/foo.png、layout/foo.xml、mipmap-xxhdpi/foo.png …
      for (const d of dirs) {
        const list = (await timeout(io.list(`${res!.resRel}/${d}`))) || { ok: false as const };
        const items = (list.items || []).filter((it) => it.kind === "file");
        // 精确同名优先，其次去掉 .9.png 后缀
        const exact = items.find((it) => it.name === ref.name || it.name.startsWith(ref.name + "."));
        const nine = items.find((it) => it.name === `${ref.name}.9.png`);
        const pick = exact ?? nine;
        if (pick) return { rel: `${res!.resRel}/${d}/${pick.name}`, line: 1, ref };
      }
      return null;
    },
  };
}
