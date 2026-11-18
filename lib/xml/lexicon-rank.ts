// lib/xml/lexicon-rank.ts — 候选词打分排序（接在 lexicon.ts 后面）
//
// 方案（用户拍板）：
//   来源层级（固定）：当前文件 > 项目 > SDK > 第三方 > 废弃
//   recency = 同来源内的加权（不跨来源升 tier）
//   匹配质量：精确 > 前缀开头 > 前缀包含 > 模糊
//   截断：池 ≤ 50，UI 前 15~20
//   废弃：压最低，但保留（可滚动看到）
//
// 纯函数，单测覆盖。

import type { Lexicon, LexMethod } from "./lexicon";
import { KIND_PRIORITY, type SuggestKind } from "./suggest-kind";

export interface RankCtx {
  /** 当前文件里的方法/类/字段（最便宜、最先就绪） */
  currentFile: { methods: string[]; classes: string[]; fields: string[]; vars: string[] };
  /** 词库（项目级） */
  lex: Lexicon;
  /** receiver 类型（能推出就按该类过滤方法） */
  receiverType?: string | null;
  /** 接收者变量名 */
  receiver?: string | null;
  /** 资源名（@drawable/xxx 等，按 resType） */
  resNames?: Record<string, string[]> | null;
}

export interface RankItem {
  text: string;
  kind: SuggestKind;
  /** 归属类（同名跨类标注） */
  originClass?: string;
  /** 重载签名（候选第二行） */
  signature?: string;
  /** 是否废弃（候选划删除线） */
  isDeprecated?: boolean;
  /** 废弃替代 */
  alt?: string;
  /** M396：修饰符（"public static" / "private"…），候选第二行展示 */
  mod?: string;
  score: number;
  /** 来源（debug / 分组） */
  source: "current" | "project" | "sdk" | "third" | "jdk" | "resource";
}

// 来源层级基础分（越高越靠前）
const SOURCE_SCORE: Record<RankItem["source"], number> = {
  current: 100,
  project: 80,
  sdk: 60,
  third: 40,
  jdk: 30,
  resource: 50,
};

// 匹配质量乘数
function matchQuality(text: string, prefix: string): number {
  const t = text.toLowerCase();
  const p = prefix.toLowerCase();
  if (t === p) return 1.0;
  if (t.startsWith(p)) return 0.85;
  if (t.includes(p)) return 0.4;
  return 0; // 模糊的由调用方（编辑距离）决定要不要进池
}

export interface RankOpts {
  /** 池上限（排序后截断前） */
  poolCap?: number; // 默认 50
  /** UI 上限 */
  uiCap?: number; // 默认 18
  /** 使用记忆：候选名 → 权重 0~1（近期选中过的高） */
  recency?: Map<string, number>;
}

/** 打分配 + 排序 + 截断。返回 { pool, ui }（pool 最多 poolCap，ui 前 uiCap） */
export function rankCandidates(prefix: string, ctx: RankCtx, opts: RankOpts = {}): { pool: RankItem[]; ui: RankItem[] } {
  const poolCap = opts.poolCap ?? 50;
  const uiCap = opts.uiCap ?? 18;
  const p = prefix.toLowerCase();
  const isResource = prefix.startsWith("@");

  const pool = new Map<string, RankItem>();
  const add = (
    text: string,
    kind: SuggestKind,
    source: RankItem["source"],
    extra?: Partial<RankItem>,
  ) => {
    if (text.toLowerCase() === p) return; // 正在打的词自己不算候选
    const existing = pool.get(text);
    const q = matchQuality(text, prefix);
    if (q === 0) return; // 不匹配的不进池（模糊匹配的由调用方先过滤好再传）
    const base = SOURCE_SCORE[source];
    // 废弃压最低
    const dep = extra?.isDeprecated ? 5 : base;
    let score = dep * q;
    // recency：同来源内加权（最多 +15，不跨来源升 tier）
    const rec = opts.recency?.get(text) ?? 0;
    if (rec > 0) score += rec * 15;
    if (existing) {
      // 同名多个来源：取最高分那条，但合并来源标注（这里简单取高）
      if (score > existing.score) {
        existing.score = score;
        const merged = { ...existing, ...extra, score } as RankItem;
        // M352 M3：新条目没带签名时，别把已有的第二行签名抹掉
        if (!extra?.signature) merged.signature = existing.signature;
        // M396：新条目没带修饰符时别抹掉已有的
        if (!extra?.mod) merged.mod = existing.mod;
        if (!extra?.originClass) merged.originClass = existing.originClass;
        pool.set(text, merged);
      } else {
        // M396：低分条目也把修饰符/签名补给已有条目（current 先进池没 mod，project 后进有 mod）
        if (extra?.mod && !existing.mod) {
          existing.mod = extra.mod;
          if (extra.signature && !existing.signature) existing.signature = extra.signature;
          pool.set(text, { ...existing });
        }
      }
    } else {
      pool.set(text, {
        text,
        kind,
        source,
        score,
        originClass: extra?.originClass,
        signature: extra?.signature,
        isDeprecated: extra?.isDeprecated,
        alt: extra?.alt,
        mod: extra?.mod,
      });
    }
  };

  // 1) 当前文件（最高）
  for (const m of ctx.currentFile.methods) add(m, "method", "current");
  for (const c of ctx.currentFile.classes) add(c, "class", "current");
  for (const v of ctx.currentFile.vars) add(v, "var", "current");
  for (const f of ctx.currentFile.fields) add(f, "const", "current");

  // 2) 项目（继承/接口合并后的方法；receiverType 能认出就按该类过滤）
  const lex = ctx.lex;
  // 方法名 → 废弃标记 + 签名（从 methods 里扫一遍，用于「无 receiver 走全项目方法名」时带第二行/废弃标记）
  const depByName = new Map<string, { alt?: string; sig?: string; dep?: boolean; mod?: string }>();
  for (const arr of lex.methods.values()) {
    for (const m of arr) {
      const cur = depByName.get(m.name);
      // 保留首个签名（非空优先），废弃标记任意一个为真即可
      if (!cur) depByName.set(m.name, { alt: m.alt, sig: m.signature, dep: m.isDeprecated, mod: m.mod });
      else {
        if (!cur.sig && m.signature) cur.sig = m.signature;
        if (!cur.mod && m.mod) cur.mod = m.mod;
        if (m.isDeprecated) {
          cur.dep = true;
          if (!cur.alt) cur.alt = m.alt;
        }
      }
    }
  }
  if (ctx.receiverType) {
    // 按 receiver 类取方法（含继承/接口）
    for (const m of resolveClassMethodEntriesSafe(lex, ctx.receiverType)) {
      if (matchQuality(m.name, prefix) === 0) continue;
      add(m.name, "method", "project", {
        originClass: m.originClass,
        signature: m.signature,
        isDeprecated: m.isDeprecated,
        alt: m.alt,
        mod: m.mod,
      });
    }
  } else {
    // 没 receiver：全项目方法名（去重），带签名（第二行）+ 废弃标记
    for (const name of lex.allMethodNames) {
      const d = depByName.get(name);
      add(name, "method", "project", { isDeprecated: !!d?.dep, alt: d?.alt, signature: d?.sig, mod: d?.mod });
    }
    // 项目类名
    for (const c of lex.classes.values()) add(c.name, "class", "project", { isDeprecated: c.isDeprecated });
  }

  // 3) 资源（@drawable/ 等）
  if (isResource && ctx.resNames) {
    const slash = prefix.lastIndexOf("/");
    const resType = slash > 0 ? prefix.slice(1, slash) : "";
    const namePrefix = slash >= 0 ? prefix.slice(slash + 1) : prefix;
    const names = ctx.resNames[resType] || Object.values(ctx.resNames).flat();
    for (const n of names) {
      const full = `@${resType ? resType + "/" : ""}${n}`;
      if (matchQuality(full, prefix) > 0 || n.toLowerCase().startsWith(namePrefix.toLowerCase())) {
        add(full, "ref", "resource");
      }
    }
  }

  // 排序 + 截断
  // M394：同分/同来源时按类型层级排（声明>变量>常量>类>方法）——仅无 receiver 的通用场景；
  //   有 receiver 时是成员语义，保持分数 + 文本序即可（不拿类/关键词压方法）。
  const kindTie = !ctx.receiverType;
  const poolArr = [...pool.values()].sort(
    (a, b) =>
      b.score - a.score ||
      (kindTie ? (KIND_PRIORITY[a.kind] ?? 6) - (KIND_PRIORITY[b.kind] ?? 6) : 0) ||
      a.text.localeCompare(b.text),
  );
  const cappedPool = poolArr.slice(0, poolCap);
  const ui = cappedPool.slice(0, uiCap);
  return { pool: cappedPool, ui };
}

/** 安全版（内部用 lexicon.resolveClassMethodEntries，但避免 import 循环） */
function resolveClassMethodEntriesSafe(lex: Lexicon, cls: string): LexMethod[] {
  // 延迟 import 避免与 lexicon 循环；这里直接内联最小实现
  const out: LexMethod[] = [];
  const seen = new Set<string>();
  const walk = (c: string, depth: number): void => {
    if (depth > 8 || seen.has(c)) return;
    seen.add(c);
    const ms = lex.methods.get(c);
    if (ms) {
      for (const m of ms) {
        const k = `${m.name}|${m.signature ?? ""}`;
        if (!seen.has("ms:" + k)) {
          out.push(m);
        }
      }
    }
    const cc = lex.classes.get(c);
    if (cc) for (const p of [...cc.parents, ...cc.interfaces]) walk(p, depth + 1);
  };
  walk(cls, 0);
  // 去重（同名同签名）
  const dedup = new Set<string>();
  return out.filter((m) => {
    const k = `${m.name}|${m.signature ?? ""}`;
    if (dedup.has(k)) return false;
    dedup.add(k);
    return true;
  });
}
