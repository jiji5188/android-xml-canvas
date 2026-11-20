// lib/xml/sdk-lexicon.ts — M2：把构建期预消化的 SDK API 索引（public/sdk-api-index.json）
// 转成词库（source='sdk'），供候选/检查器合并。懒加载 + 模块级缓存，只解析一次。
//
// 索引由 tools/sdk-digest.mjs 生成：
//   { v, gen, count, classes: { Simple: { pkg, fqn, d?, m: string[], dm?: string[] } } }
// 只收高频 Android/Java 包（约 4100 类，原始 ~1MB / gzip ~187KB）。

import { createEmptyLexicon, type Lexicon, type LexMethod, type LexClass } from "./lexicon";

export interface SdkClassEntry {
  pkg: string;
  fqn: string;
  /** 类本身 @Deprecated */
  d?: 1;
  /** 方法名 */
  m: string[];
  /** M452：方法名 → 返回类型简名（void 不存）。候选说明行展示「这个方法返回什么」 */
  r?: Record<string, string>;
  /** M453：方法名 → 参数类型串（无参 = ""）。候选主行展示 `name(参数)` */
  p?: Record<string, string>;
  /** 废弃方法名 */
  dm?: string[];
}

export interface SdkIndex {
  v: number;
  gen: string;
  count: number;
  classes: Record<string, SdkClassEntry>;
}

let cachedLex: Lexicon | null = null;
let pending: Promise<Lexicon | null> | null = null;

/** 纯函数：索引 → 词库（单测用，不碰网络） */
export function sdkIndexToLexicon(idx: SdkIndex): Lexicon {
  const lex = createEmptyLexicon(1);
  for (const [simple, e] of Object.entries(idx.classes || {})) {
    if (!simple || !e) continue;
    const cls: LexClass = {
      name: simple,
      fqn: e.fqn,
      pkg: e.pkg || "",
      parents: [],
      interfaces: [],
      source: "sdk",
      isDeprecated: e.d === 1,
    };
    if (!lex.classes.has(simple)) lex.classes.set(simple, cls);
    if (e.fqn) lex.classesByFqn.set(e.fqn, cls);
    const dm = new Set(e.dm || []);
    const rm = e.r || {};
    const pm = e.p || {};
    const ms: LexMethod[] = (e.m || []).map((name) => ({
      name,
      originClass: simple,
      isDeprecated: dm.has(name) ? true : undefined,
      ret: rm[name] || undefined,
      signature: pm[name] !== undefined ? pm[name] : undefined,
    }));
    if (ms.length) lex.methods.set(simple, ms);
    for (const m of ms) {
      lex.allMethodNames.add(m.name);
      if (m.isDeprecated) lex.deprecated.add(m.name);
    }
  }
  return lex;
}

/** 懒加载 SDK 词库（fetch public/sdk-api-index.json，缓存一次）。失败返回 null。 */
export async function loadSdkLexicon(fetchImpl?: typeof fetch): Promise<Lexicon | null> {
  if (cachedLex) return cachedLex;
  if (pending) return pending;
  pending = (async () => {
    try {
      const f = fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
      if (!f) return null;
      const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      const res = await f(`${base}/sdk-api-index.json`);
      if (!res.ok) return null;
      const idx = (await res.json()) as SdkIndex;
      const lex = sdkIndexToLexicon(idx);
      cachedLex = lex;
      return lex;
    } catch {
      return null;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** 合并 SDK 词库进项目词库：同名简单类以项目为准（连同方法都不合并，避免污染） */
export function mergeSdkLexicon(proj: Lexicon, sdk: Lexicon): Lexicon {
  const out = createEmptyLexicon(Math.max(proj.version, sdk.version) + 1);
  out.classes = new Map(proj.classes);
  out.classesByFqn = new Map(proj.classesByFqn);
  out.methods = new Map(proj.methods);
  out.allMethodNames = new Set(proj.allMethodNames);
  out.fields = new Map(proj.fields);
  out.resources = new Map(proj.resources);
  out.deprecated = new Set(proj.deprecated);
  for (const [simple, cls] of sdk.classes) {
    if (out.classes.has(simple)) continue; // 项目里已有同名类 → 整个跳过
    out.classes.set(simple, cls);
    if (cls.fqn && !out.classesByFqn.has(cls.fqn)) out.classesByFqn.set(cls.fqn, cls);
    const ms = sdk.methods.get(simple);
    if (ms && ms.length) {
      out.methods.set(simple, ms);
      for (const m of ms) {
        out.allMethodNames.add(m.name);
        if (m.isDeprecated) out.deprecated.add(m.name);
      }
    }
  }
  return out;
}

/** 测试/重置用 */
export function resetSdkLexiconCache(): void {
  cachedLex = null;
  pending = null;
}
