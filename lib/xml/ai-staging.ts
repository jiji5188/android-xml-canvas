// lib/xml/ai-staging.ts — M64e（B3）：AI 的写操作先暂存，等用户点「应用」才落盘
//
// 为什么：runTool 直接 write 的话，模型写错就是既成事实（还进不了编辑器撤销栈）。
// 这里把 AiFileIo 包一层：write 只记进 overlay，read 能读到 overlay（同一轮 patch 基于
// 暂存结果继续改）；真正落盘由 AiPanel 的「应用」按钮调 flushStaged。
import type { AiFileIo } from "./ai-tools";

export interface StagedChange {
  /** 相对项目根 */
  rel: string;
  /** 改前内容（文件不存在则 null = 新建） */
  before: string | null;
  /** 改后内容 */
  after: string;
}

export function createStagingIo(base: AiFileIo, onStage?: (changes: StagedChange[]) => void): AiFileIo & {
  staged(): StagedChange[];
  clear(): void;
} {
  const map = new Map<string, StagedChange>();

  const notify = () => onStage?.(Array.from(map.values()));

  return {
    rootLabel: () => base.rootLabel(),
    canWrite: base.canWrite,
    staging: true,
    async list(rel) {
      // 新建的文件在目录列表里也要出现（模型可能 list 后判断）
      const r = await base.list(rel);
      if (!r.ok) return r;
      const prefix = rel ? `${rel}/` : "";
      const items = [...(r.items || [])];
      const names = new Set(items.map((i) => i.rel));
      for (const c of map.values()) {
        if (!c.rel.startsWith(prefix)) continue;
        const rest = c.rel.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        if (!names.has(c.rel)) items.push({ name: rest, kind: "file", rel: c.rel });
      }
      return { ...r, items };
    },
    async read(rel) {
      const c = map.get(rel);
      if (c) return { ok: true, text: c.after };
      return base.read(rel);
    },
    async write(rel, text) {
      if (map.has(rel)) {
        map.set(rel, { rel, before: (map.get(rel) as StagedChange).before, after: text });
      } else {
        const cur = await base.read(rel);
        map.set(rel, { rel, before: cur.ok ? cur.text ?? "" : null, after: text });
      }
      notify();
      return { ok: true };
    },
    staged: () => Array.from(map.values()),
    clear: () => {
      map.clear();
      notify();
    },
  };
}

/** 落盘：先备份原文（.axv_backup/<rel>.<时间>），再写新内容 */
export async function flushStaged(
  base: AiFileIo,
  changes: StagedChange[],
): Promise<{ ok: boolean; results: { rel: string; ok: boolean; error?: string; backup?: string }[] }> {
  const stamp = (() => {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  })();

  const results: { rel: string; ok: boolean; error?: string; backup?: string }[] = [];
  for (const c of changes) {
    let backup: string | undefined;
    if (c.before !== null && c.before !== c.after) {
      const bRel = `.axv_backup/${c.rel}.${stamp}`;
      const b = await base.write(bRel, c.before);
      if (b.ok) backup = bRel;
    }
    const w = await base.write(c.rel, c.after);
    results.push({ rel: c.rel, ok: w.ok, error: w.ok ? undefined : w.error, backup });
  }
  return { ok: results.every((r) => r.ok), results };
}
