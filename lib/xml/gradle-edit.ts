// lib/xml/gradle-edit.ts — M403：gradle 文件「可编辑」纯函数（项目属性页表单用）
//
// 与 gradle-deps.ts（解析/下载）区分：这里只放「写」类纯函数，全部外科式定位行、保留原文。
// 设计原则与 project-info.ts 一致：认常见写法、找不到就报错不猜、kts/groovy 双风格。

/** 块定位：text 里 `name { ... }` 的 { 后第一个字符偏移 / 匹配块原文。
 *  括号配对 + 跳过字符串/注释（与 gradle-deps 的 extractCalls 同款思路，轻量版）。 */
export function findBlock(text: string, name: string): { open: number; close: number; raw: string } | null {
  const re = new RegExp(`\\b${name}\\s*\\{`, "m");
  const m = re.exec(text);
  if (!m) return null;
  const open = m.index + m[0].length; // 指向 { 之后的第一个字符
  let i = open;
  let depth = 1;
  let quote = "";
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      if (nl < 0) break;
      i = nl;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) return null; // 块没闭合，不猜
  return { open, close: i, raw: text.slice(open, i) };
}

/** 把一行插到某块的 { 之后（块不存在则整块建在文件尾）。indent 给块内缩进。 */
export function insertIntoBlock(text: string, name: string, line: string, indent = "    "): { text: string; created: boolean } {
  const b = findBlock(text, name);
  if (b) {
    return { text: text.slice(0, b.open) + `\n${indent}${line}` + text.slice(b.open), created: false };
  }
  const block = `\n${name} {\n${indent}${line}\n}\n`;
  return { text: text.replace(/\s*$/, "") + "\n" + block, created: true };
}

/* ============================ gradle.properties 编辑 ============================ */

/** 读 gradle.properties 的单个 key=value（去注释/变量不展开——原样返回） */
export function readGradleProp(text: string, key: string): string | null {
  const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.*)$`, "m");
  const m = re.exec(text || "");
  if (!m) return null;
  let v = m[1].trim();
  const h = v.search(/\s[#;]/);
  if (h >= 0) v = v.slice(0, h).trim();
  return v || null;
}

/** 改 gradle.properties 里的 key=value；key 不存在则追加到末尾（# 注释行不影响）。 */
export function setGradleProp(text: string, key: string, value: string): { text: string; changed: boolean } {
  const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=.*$`, "m");
  if (re.test(text)) {
    const next = text.replace(re, `${key}=${value}`);
    return { text: next, changed: next !== text };
  }
  const line = `${key}=${value}`;
  const base = text.replace(/\s*$/, "");
  return { text: (base ? base + "\n" : "") + line + "\n", changed: true };
}

/** 列 gradle.properties 里所有 key（去重，保序）——给 UI 做「编译标记」可编辑列表 */
export function listGradleProps(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of (text || "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/* ============================ app/build.gradle 扩展字段 ============================ */
// project-info.ts 的 setAppConfigField 已支持 7 字段；这里补「buildFeatures」这种列表型
// （buildConfig / viewBinding / compose 的 true/false 开关），走 android { buildFeatures { } } 块。

export interface BuildFeatures {
  buildConfig?: boolean;
  viewBinding?: boolean;
  compose?: boolean;
  aidl?: boolean;
  prefab?: boolean;
  /** 原文里出现过的全部键（UI 列出来让用户勾） */
  keys: string[];
}

const BF_KEYS = ["buildConfig", "viewBinding", "compose", "aidl", "prefab"] as const;

/** 解析 app/build.gradle 的 buildFeatures 开关（android { buildFeatures { } }） */
export function parseBuildFeatures(text: string): BuildFeatures {
  const out: BuildFeatures = { keys: [] };
  const b = findBlock(text, "buildFeatures");
  if (!b) return out;
  const inner = text.slice(b.open, b.close);
  for (const k of BF_KEYS) {
    // k true / k = true / k(false)  kts 也认
    const m = new RegExp(`\\b${k}\\b\\s*=?\\s*(true|false)`).exec(inner);
    if (m) {
      out[k] = m[1] === "true";
      if (!out.keys.includes(k)) out.keys.push(k);
    }
  }
  return out;
}

/** 改 buildFeatures 里某键的 true/false；键不存在则插到 buildFeatures 块内（没有块则建在 android { } 里） */
export function setBuildFeature(
  text: string,
  key: string,
  value: boolean,
  kts = false,
): { ok: boolean; text: string; msg?: string } {
  if (!BF_KEYS.includes(key as (typeof BF_KEYS)[number])) {
    return { ok: false, text, msg: `不识别的 buildFeatures 键：${key}` };
  }
  const v = value ? "true" : "false";
  const b = findBlock(text, "buildFeatures");
  const stmt = kts ? `${key} = ${v}` : `${key} ${v}`;
  if (b) {
    const inner = text.slice(b.open, b.close);
    const re = new RegExp(`\\b${key}\\b\\s*=?\\s*(true|false)`);
    if (re.test(inner)) {
      const nextInner = inner.replace(re, () => stmt);
      return { ok: true, text: text.slice(0, b.open) + nextInner + text.slice(b.close) };
    }
    // 块里有其他键 → 追加一行
    const add = `\n        ${stmt}`;
    return { ok: true, text: text.slice(0, b.close) + add + text.slice(b.close) };
  }
  // 没有 buildFeatures 块 → 插到 android { } 里
  const ab = findBlock(text, "android");
  if (!ab) return { ok: false, text, msg: "没找到 android { } 块" };
  const block = `\n    buildFeatures {\n        ${stmt}\n    }`;
  return { ok: true, text: text.slice(0, ab.close) + block + text.slice(ab.close) };
}

/* ============================ 仓库（repositories）增删改 ============================ */
// 仓库声明可能在三处：
//   1) settings.gradle 的 pluginManagement { repositories { } } / dependencyResolutionManagement { repositories { } }
//   2) 根 build.gradle 的 buildscript { repositories { } }
//   3) 根 build.gradle 的 allprojects { repositories { } }
// 用户要「区分 buildscript 和 allprojects」——所以仓库操作必须按「所在块」定位，不混。

export type RepoScope = "settings" | "buildscript" | "allprojects";

export interface RepoEntry {
  /** 展示：google / mavenCentral / gradlePluginPortal / mavenLocal / maven(url) */
  name: string;
  /** 自定义 maven 的 url；内置简写为空 */
  url?: string;
  /** 这条仓库声明所在的原始行（删的时候定位用） */
  raw: string;
  /** 来自哪个 scope（解析时标注） */
  scope: RepoScope;
}

/** 内置简写名 → 是否内置 */
const BUILTIN_REPO = /^(google|mavenCentral|gradlePluginPortal|mavenLocal|jcenter)\s*\(\s*\)$/;

/** 解析某个 scope 块内的 repositories { } 条目。
 *  scopeText：该 scope 对应的源文本（settings.gradle 全文 / 根 build.gradle 全文）。
 *  scope 决定找哪块：settings→pluginManagement/dependencyResolutionManagement；buildscript→buildscript；allprojects→allprojects。 */
export function parseRepoScope(scopeText: string, scope: RepoScope): RepoEntry[] {
  const out: RepoEntry[] = [];
  const seen = new Set<string>();
  let blocks: string[] = [];
  if (scope === "settings") {
    for (const nm of ["pluginManagement", "dependencyResolutionManagement"]) {
      const b = findBlock(scopeText, nm);
      if (b) blocks.push(text_of_block(scopeText, b));
    }
  } else {
    const b = findBlock(scopeText, scope);
    if (b) blocks.push(text_of_block(scopeText, b));
  }
  for (const blockRaw of blocks) {
    const rb = findBlock(blockRaw, "repositories");
    if (!rb) continue;
    const inner = blockRaw.slice(rb.open, rb.close);
    // 按行拆，抓 google() / maven { url '...' }
    for (const rawLine of inner.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (BUILTIN_REPO.test(line)) {
        const nm = line.match(/\w+/)![0];
        const k = nm;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ name: nm, raw: line, scope });
        continue;
      }
      if (/^maven\s*\{/.test(line)) {
        const m =
          line.match(/url\s*=?\s*["']([^"']+)["']/) ||
          line.match(/uri\s*\(\s*["']([^"']+)["']\s*\)/);
        if (m) {
          const url = m[1];
          if (seen.has(url)) continue;
          seen.add(url);
          out.push({ name: "maven", url, raw: line, scope });
          continue;
        }
      }
    }
  }
  return out;
}

function text_of_block(text: string, b: { open: number; close: number }): string {
  return text.slice(b.open - 1, b.close + 1); // 含外层 { }
}

/** 往某个 scope 的 repositories { } 加一条（内置简写或 maven url）；幂等。
 *  没有该 scope 的 repositories 块时：settings→在 dependencyResolutionManagement 里建；
 *  buildscript/allprojects→在对应块里建。scope 块本身不存在则建块。 */
export function addRepoUrl(
  text: string,
  scope: RepoScope,
  url: string,
  kts = false,
): { ok: boolean; text: string; msg?: string } {
  // 幂等：整段文本已含该 url（任意 scope）→ 不动
  if (text.includes(url) && url.length > 8) {
    return { ok: true, text, msg: "already" };
  }
  const line =
    url === "https://dl.google.com/dl/android/maven2" || url === "https://maven.google.com"
      ? "google()"
      : url === "https://repo.maven.apache.org/maven2"
        ? "mavenCentral()"
        : url === "https://plugins.gradle.org/m2"
          ? "gradlePluginPortal()"
          : url === "file:~/.m2/repository"
            ? "mavenLocal()"
            : kts
              ? `maven { url = uri("${url}") }`
              : `maven { url '${url}' }`;
  // 目标 scope 块
  let host = text;
  const hostName = scope === "settings" ? "dependencyResolutionManagement" : scope;
  const hb = findBlock(host, hostName);
  if (hb) {
    // 块内找 repositories { }（相对块内偏移）
    const inner = host.slice(hb.open, hb.close);
    const rb = findBlock(inner, "repositories");
    if (rb) {
      const absClose = hb.open + rb.close;
      const add = `\n        ${line}`;
      host = host.slice(0, absClose) + add + host.slice(absClose);
      return { ok: true, text: host };
    }
    // 块里没有 repositories → 在块内插一个
    const block = `\n    repositories {\n        ${line}\n    }`;
    host = host.slice(0, hb.close) + block + host.slice(hb.close);
    return { ok: true, text: host };
  }
  // scope 块不存在 → 在文件尾建
  const block = `\n${hostName} {\n    repositories {\n        ${line}\n    }\n}\n`;
  return { ok: true, text: host.replace(/\s*$/, "") + "\n" + block };
}

/** 删某个 scope 里的一条仓库（按 url 或内置名定位原始行）。 */
export function removeRepoUrl(
  text: string,
  scope: RepoScope,
  target: string,
): { ok: boolean; text: string; msg?: string } {
  // target 是内置名（google/mavenCentral...）或 url
  const entries = parseRepoScope(text, scope);
  const hit = entries.find((e) => e.url === target || e.name === target);
  if (!hit) return { ok: false, text, msg: "没找到这条仓库" };
  // 在整段文本里找含该 raw 且属于该 scope 块的一行，删掉整行
  const hostName = scope === "settings" ? "dependencyResolutionManagement" : scope;
  const hb = findBlock(text, hostName);
  const searchIn = hb ? text.slice(hb.open - 1, hb.close + 1) : text;
  const lines = searchIn.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.trim() === hit.raw || (hit.url && l.includes(hit.url)));
  if (idx < 0) return { ok: false, text, msg: "定位不到原始行" };
  lines.splice(idx, 1);
  const replaced = lines.join("\n");
  return { ok: true, text: hb ? text.slice(0, hb.open - 1) + replaced + text.slice(hb.close + 1) : replaced };
}
