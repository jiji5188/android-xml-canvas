// lib/xml/ai-history.ts — M64g（D4）：AI 改动历史（跨文件一键回滚）
//
// B3 之后 AI 写盘已经备份到 .axv_backup/，但那是「磁盘上的兜底」：用户看不见、也回不来
// （文件管理器翻备份目录的方式不现实）。这里在内存里留最近 20 批改动，每批记住
// 「文件 + 改动前内容」，面板里点一次就能整批回滚——比 Ctrl+Z 更符合「这次 AI 干了啥」。

import type { AiFileIo } from "./ai-tools";

export interface AiHistoryItem {
  rel: string;
  /** null = 该文件是 AI 新建的，回滚时写空内容并标注 */
  before: string | null;
}

export interface AiHistoryBatch {
  id: string;
  at: number;
  items: AiHistoryItem[];
  /** 已回滚的批次标一下，避免用户重复点 */
  rolledBack?: boolean;
}

export const AI_HISTORY_CAP = 20;

let seq = 0;

export function makeBatch(items: AiHistoryItem[], at = Date.now()): AiHistoryBatch {
  seq += 1;
  return { id: `aih-${at}-${seq}`, at, items };
}

/** 新批次放最前，超过 cap 丢最旧的 */
export function pushBatch(list: AiHistoryBatch[], batch: AiHistoryBatch, cap = AI_HISTORY_CAP): AiHistoryBatch[] {
  const next = [batch, ...list.filter((b) => b.id !== batch.id)];
  return next.slice(0, cap);
}

export interface RestoreOutcome {
  ok: boolean;
  results: { rel: string; ok: boolean; error?: string; blanked?: boolean }[];
}

/**
 * 回滚一批改动：把每个文件写回 before。
 * 新建的文件没有原文 → 写空串（保留文件，避免「删了但还在别处引用」更乱），并标 blanked。
 */
export async function restoreBatch(io: AiFileIo, batch: AiHistoryBatch): Promise<RestoreOutcome> {
  const results: RestoreOutcome["results"] = [];
  for (const it of batch.items) {
    const text = it.before ?? "";
    const r = await io.write(it.rel, text);
    results.push({ rel: it.rel, ok: r.ok, error: r.error, blanked: it.before === null && r.ok });
  }
  return { ok: results.every((r) => r.ok), results };
}

/** 面板上显示的一行摘要 */
export function batchLabel(b: AiHistoryBatch): string {
  const t = new Date(b.at);
  const hh = String(t.getHours()).padStart(2, "0");
  const mm = String(t.getMinutes()).padStart(2, "0");
  const n = b.items.length;
  const name = n === 1 ? b.items[0].rel : `${b.items[0].rel} 等 ${n} 个文件`;
  return `${hh}:${mm} · ${name}`;
}
