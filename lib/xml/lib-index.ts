// lib/xml/lib-index.ts — M2b：设备端索引第三方库（.jar / .aar）里的类名 + 方法名，
// 产出 source='third' 词库，用于候选补全与「库类不误报未知符号」。
//
// 纯前端实现（不依赖原生）：
//   - zip 中央目录解析（EOCD + central dir）+ 条目 inflate（DecompressionStream('deflate-raw')）
//   - aar 内取 classes.jar 再递归
//   - .class 常量池 + 方法表解析（与 tools/class-reader.mjs 同一套规则）
// 全程 try/catch 容错：个别库/条目坏了只跳过，不炸整体。

import { createEmptyLexicon, type Lexicon, type LexMethod, type LexClass } from "./lexicon";

// ===== base64 → bytes =====
function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node 回退（测试环境）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const B = (globalThis as any).Buffer;
  if (B) return new Uint8Array(B.from(b64, "base64"));
  throw new Error("no base64 decoder");
}

const td = new TextDecoder("utf-8");

// ===== zip 解析 =====
interface ZipEntry {
  name: string;
  method: number;
  compSize: number;
  size: number;
  localOffset: number;
}

export function readZipEntries(bytes: Uint8Array): ZipEntry[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 找 EOCD（签名 0x06054b50，从尾部往前，最多 65557 字节）
  let eocd = -1;
  const minEocd = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minEocd; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return [];
  const total = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  let p = cdOffset;
  const out: ZipEntry[] = [];
  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length) break;
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // zip64 标记（0xFFFFFFFF）跳过（我们的库 < 15MB，不会触发）
    if (compSize !== 0xffffffff && localOffset !== 0xffffffff) {
      out.push({ name, method, compSize, size, localOffset });
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const DS = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!DS) throw new Error("no DecompressionStream");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = new Blob([data as any]).stream().pipeThrough(new DS("deflate-raw"));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** 取某条目的原始字节（method 0 直存，8 deflate；其它跳过） */
async function entryData(bytes: Uint8Array, e: ZipEntry): Promise<Uint8Array | null> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const p = e.localOffset;
  if (p + 30 > bytes.length || dv.getUint32(p, true) !== 0x04034b50) return null;
  const nameLen = dv.getUint16(p + 26, true);
  const extraLen = dv.getUint16(p + 28, true);
  const start = p + 30 + nameLen + extraLen;
  const raw = bytes.subarray(start, start + e.compSize);
  if (e.method === 0) return raw;
  if (e.method === 8) return inflateRaw(raw);
  return null;
}

// ===== .class 解析（FQN + 公开方法名 + 废弃标记） =====
export interface ParsedClass {
  fqn: string;
  simple: string;
  methods: string[];
  deprecated: Set<string>;
  classDeprecated: boolean;
}

export function parseClassInfo(buf: Uint8Array): ParsedClass | null {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (buf.length < 10 || dv.getUint32(0, false) !== 0xcafebabe) return null;
  let q = 8;
  const cpCount = dv.getUint16(q, false);
  q += 2;
  const utf8 = new Map<number, string>();
  const classRefs = new Map<number, number>(); // Class 常量索引 → name utf8 索引
  let i = 1;
  while (i < cpCount) {
    const tag = buf[q];
    q += 1;
    if (tag === 1) {
      const len = dv.getUint16(q, false);
      q += 2;
      utf8.set(i, td.decode(buf.subarray(q, q + len)));
      q += len;
    } else if (tag === 3 || tag === 4) q += 4;
    else if (tag === 5 || tag === 6) {
      q += 8;
      i++;
    } else if (tag === 7) {
      classRefs.set(i, dv.getUint16(q, false));
      q += 2;
    } else if (tag === 8 || tag === 16 || tag === 19 || tag === 20) q += 2;
    else if (tag === 15) q += 3;
    else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) q += 4;
    else return null; // 未知 tag → 放弃这个类（不猜）
    i++;
  }
  // 类名
  let r = q;
  const thisClassIdx = dv.getUint16(r + 2, false);
  r += 6;
  const ifCount = dv.getUint16(r, false);
  r += 2 + ifCount * 2;
  // 字段表
  const fieldsCount = dv.getUint16(r, false);
  r += 2;
  for (let f = 0; f < fieldsCount; f++) {
    const attrs = dv.getUint16(r + 6, false);
    r += 8;
    for (let a = 0; a < attrs; a++) {
      const aLen = dv.getUint32(r + 2, false);
      r += 6 + aLen;
    }
  }
  // 方法表
  const methodsCount = dv.getUint16(r, false);
  r += 2;
  const methods: string[] = [];
  const deprecated = new Set<string>();
  for (let m = 0; m < methodsCount; m++) {
    const mAccess = dv.getUint16(r, false);
    const nameIdx = dv.getUint16(r + 2, false);
    const attrs = dv.getUint16(r + 6, false);
    const name = utf8.get(nameIdx) || "";
    let hasDep = false;
    let ar = r + 8;
    for (let a = 0; a < attrs; a++) {
      const aNameIdx = dv.getUint16(ar, false);
      const aLen = dv.getUint32(ar + 2, false);
      if (utf8.get(aNameIdx) === "Deprecated") hasDep = true;
      ar += 6 + aLen;
    }
    r = ar;
    if (name && name !== "<init>" && name !== "<clinit>" && (mAccess & 0x0001)) {
      methods.push(name);
      if (hasDep) deprecated.add(name);
    }
  }
  // 类级 attribute
  let classDeprecated = false;
  if (r + 2 <= buf.length) {
    const classAttrs = dv.getUint16(r, false);
    let ar = r + 2;
    for (let a = 0; a < classAttrs && ar + 6 <= buf.length; a++) {
      const aNameIdx = dv.getUint16(ar, false);
      const aLen = dv.getUint32(ar + 2, false);
      if (utf8.get(aNameIdx) === "Deprecated") classDeprecated = true;
      ar += 6 + aLen;
    }
  }
  // this_class → Class → name
  const nameUtfIdx = classRefs.get(thisClassIdx);
  const fqnRaw = nameUtfIdx !== undefined ? utf8.get(nameUtfIdx) || "" : "";
  const fqn = fqnRaw.replace(/\//g, ".");
  if (!fqn) return null;
  const simple = fqn.split(".").pop()!.split("$").pop()!;
  return { fqn, simple, methods, deprecated, classDeprecated };
}

// ===== 索引入口 =====
export interface LibIndexResult {
  lex: Lexicon;
  classCount: number;
  libCount: number;
  failed: string[];
  truncated: boolean;
}

function addClass(lex: Lexicon, pc: ParsedClass): void {
  const simple = pc.simple;
  if (!simple) return;
  if (!lex.classes.has(simple)) {
    const cls: LexClass = {
      name: simple,
      fqn: pc.fqn,
      pkg: pc.fqn.split(".").slice(0, -1).join("."),
      parents: [],
      interfaces: [],
      source: "third",
      isDeprecated: pc.classDeprecated || undefined,
    };
    lex.classes.set(simple, cls);
    if (!lex.classesByFqn.has(pc.fqn)) lex.classesByFqn.set(pc.fqn, cls);
  }
  if (!lex.methods.has(simple)) {
    const ms: LexMethod[] = pc.methods.map((name) => ({
      name,
      originClass: simple,
      isDeprecated: pc.deprecated.has(name) ? true : undefined,
    }));
    lex.methods.set(simple, ms);
    for (const m of ms) {
      lex.allMethodNames.add(m.name);
      if (m.isDeprecated) lex.deprecated.add(m.name);
    }
  }
}

/**
 * 索引一组第三方库（base64）。
 * @param maxClasses 最多索引多少类（防超大库吃内存，默认 20000）
 */
export async function indexLibs(
  libs: { rel: string; base64: string }[],
  opts: { maxClasses?: number } = {},
): Promise<LibIndexResult> {
  const maxClasses = opts.maxClasses ?? 20000;
  const lex = createEmptyLexicon(1);
  let classCount = 0;
  const failed: string[] = [];
  let truncated = false;

  for (const lib of libs) {
    if (classCount >= maxClasses) {
      truncated = true;
      break;
    }
    try {
      const bytes = b64ToBytes(lib.base64);
      const entries = readZipEntries(bytes);
      if (!entries.length) {
        failed.push(lib.rel);
        continue;
      }
      // aar → classes.jar；否则当普通 jar（自身有 .class）
      const nested = entries.find((e) => /^classes\.jar$/i.test(e.name));
      let jarBytes: Uint8Array = bytes;
      let jarEntries: ZipEntry[] = entries;
      if (nested) {
        const data = await entryData(bytes, nested);
        if (!data) {
          failed.push(lib.rel);
          continue;
        }
        jarBytes = data;
        jarEntries = readZipEntries(jarBytes);
      }
      for (const e of jarEntries) {
        if (classCount >= maxClasses) {
          truncated = true;
          break;
        }
        if (!/\.class$/i.test(e.name)) continue;
        const data = await entryData(jarBytes, e);
        if (!data) continue;
        const pc = parseClassInfo(data);
        if (!pc) continue;
        addClass(lex, pc);
        classCount++;
        // 每 200 类让出主线程一次，避免大批同步解析卡 UI
        if (classCount % 200 === 0) await new Promise<void>((r) => setTimeout(r, 0));
      }
    } catch {
      failed.push(lib.rel);
    }
  }
  return { lex, classCount, libCount: libs.length, failed, truncated };
}

/** 把第三方库词库并入（同名简单类以已有为准，不覆盖项目/SDK） */
export function mergeThirdLexicon(base: Lexicon, third: Lexicon): Lexicon {
  const out = createEmptyLexicon(base.version + 1);
  out.classes = new Map(base.classes);
  out.classesByFqn = new Map(base.classesByFqn);
  out.methods = new Map(base.methods);
  out.allMethodNames = new Set(base.allMethodNames);
  out.fields = new Map(base.fields);
  out.resources = new Map(base.resources);
  out.deprecated = new Set(base.deprecated);
  for (const [simple, cls] of third.classes) {
    if (out.classes.has(simple)) continue;
    out.classes.set(simple, cls);
    if (cls.fqn && !out.classesByFqn.has(cls.fqn)) out.classesByFqn.set(cls.fqn, cls);
    const ms = third.methods.get(simple);
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

// ===== 带缓存的索引入口（同一项目库不变就复用，最多留 2 个项目）=====
const libCache = new Map<string, LibIndexResult>();

export function libIndexCacheKey(projRoot: string, libs: { rel: string; base64: string }[]): string {
  return projRoot + "|" + libs.map((l) => l.rel + ":" + l.base64.length).join(",");
}

export async function indexLibsCached(
  projRoot: string,
  libs: { rel: string; base64: string }[],
  opts: { maxClasses?: number } = {},
): Promise<LibIndexResult> {
  const key = libIndexCacheKey(projRoot, libs);
  const hit = libCache.get(key);
  if (hit) return hit;
  const r = await indexLibs(libs, opts);
  if (libCache.size >= 2) libCache.clear();
  libCache.set(key, r);
  return r;
}

export function resetLibIndexCache(): void {
  libCache.clear();
}
