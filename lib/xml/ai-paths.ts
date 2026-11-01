// lib/xml/ai-paths.ts — M64c（B4 + C5）：AI 读写路径的规范化、越界校验与保护区
//
// B4 之前只有 safeRel：含 ".." 就拒、绝对路径就拒。问题是：
//   · 没做规范化（"./a/./b"、"a//b"、"a/" 全靠运气）
//   · 没有「最终路径必须在根之内」的前缀校验（拿到 root 之后没人再验一次）
//   · 没有扩展名白名单 / 大小上限（模型可以把 50MB 日志往 write_file 里塞）
// C5 之前 AI 能直接写 build.gradle / AndroidManifest.xml，一次就能把工程搞崩。
//
// 这里把这些规则收成一个纯函数层：runTool 和 ai-fs 都只调这里，
// 保护区可以按设置开关放开（默认关）。

/** 允许 AI 写入/读取文本的扩展名（二进制一律不碰） */
export const AI_TEXT_EXT = new Set([
  "xml",
  "java",
  "kt",
  "kts",
  "gradle",
  "properties",
  "json",
  "md",
  "txt",
  "pro",
  "toml",
  "yml",
  "yaml",
  "cfg",
  "ini",
  "html",
  "js",
  "ts",
  "css",
  "gradlew",
]);

/** 目录名命中即保护区（任何层级） */
const PROTECTED_DIRS = new Set([".git", ".gradle", ".idea", ".next", "node_modules", "build", ".svn", "__pycache__", ".cxx"]);

/** 文件名命中即保护区（构建/签名/清单，改坏了很难救） */
const PROTECTED_FILES = [
  /^build\.gradle(\.kts)?$/i,
  /^settings\.gradle(\.kts)?$/i,
  /^gradle\.properties$/i,
  /^gradle-wrapper\.properties$/i,
  /^local\.properties$/i,
  /^proguard-rules\.pro$/i,
  /^AndroidManifest\.xml$/i,
  /^gradlew(\.bat)?$/i,
  /^keystore.*\.(jks|keystore)$/i,
];

/** AI 写构建文件的开关（默认关；只有用户在设置里明确打开才放开） */
export const AI_ALLOW_PROTECTED_KEY = "axv.ai.allowProtected";

export function aiAllowProtectedGet(): boolean {
  try {
    return window.localStorage.getItem(AI_ALLOW_PROTECTED_KEY) === "1";
  } catch {
    return false;
  }
}

export function aiAllowProtectedSet(on: boolean): void {
  try {
    window.localStorage.setItem(AI_ALLOW_PROTECTED_KEY, on ? "1" : "0");
  } catch {
    /* 隐私模式：忽略 */
  }
}

/** 是否是保护区路径（只看规范化后的相对路径） */
export function isProtectedRel(rel: string): boolean {
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return false;
  // 目录段命中（不含最后一段文件名，文件名单独判）
  for (let i = 0; i < parts.length - 1; i++) {
    if (PROTECTED_DIRS.has(parts[i])) return true;
  }
  const name = parts[parts.length - 1];
  if (PROTECTED_DIRS.has(name)) return true; // 写到一个叫 build 的文件也拦掉，保守
  return PROTECTED_FILES.some((re) => re.test(name));
}

/**
 * 规范化相对路径：去掉 ./ 与前导斜杠、折叠 a//b、处理 a/../b。
 * 返回 null 表示越界/非法（绝对路径、盘符、URL、.. 越出根、NUL）。
 * 空字符串合法（= 项目根，list/search 用）。
 */
export function normalizeAiRel(raw: string | undefined | null): string | null {
  let s = (raw ?? "").replace(/\\/g, "/").trim();
  if (s.includes("\0")) return null;
  if (!s) return "";
  if (/^[a-zA-Z]:/.test(s)) return null; // C:/…
  if (s.startsWith("/")) return null; // 绝对路径（含 //server/share）
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) return null; // content:// file:// http://
  if (s.startsWith("~")) return null;

  const out: string[] = [];
  for (const seg of s.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!out.length) return null; // 越出项目根
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join("/");
}

export interface AiPathOpts {
  /** read = 只读/列举；write = 落盘（走保护区与扩展名白名单） */
  mode?: "read" | "write";
  /** 覆盖保护区开关（默认读设置） */
  allowProtected?: boolean;
  /** 内容字节上限（write） */
  maxBytes?: number;
}

export type AiPathResult = { ok: true; rel: string } | { ok: false; error: string };

export const AI_MAX_WRITE_BYTES = 2 * 1024 * 1024;

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i + 1).toLowerCase() : "";
}

/** 统一的路径闸门：规范化 → 越界 → 保护区 → 扩展名（写） */
export function checkAiPath(raw: string | undefined | null, opts: AiPathOpts = {}): AiPathResult {
  const mode = opts.mode ?? "read";
  const rel = normalizeAiRel(raw);
  if (rel === null) {
    return { ok: false, error: "路径非法：不能是绝对路径、盘符、content:// 或跳出项目目录（..）" };
  }
  if (!rel) {
    if (mode === "write") return { ok: false, error: "路径非法：写入必须指定具体文件" };
    return { ok: true, rel };
  }
  const name = rel.split("/").pop() || rel;
  const allowProtected = opts.allowProtected ?? aiAllowProtectedGet();

  if (mode === "write" && isProtectedRel(rel) && !allowProtected) {
    return {
      ok: false,
      error: `拒绝写入 ${rel}：这是构建/清单保护区（build.gradle、AndroidManifest.xml、build/、.git/ 等）。需要改请自己在编辑器里改，或在 AI 设置里打开「允许改构建文件」。`,
    };
  }

  if (mode === "write") {
    const ext = extOf(name);
    if (!AI_TEXT_EXT.has(ext)) {
      return { ok: false, error: `拒绝写入 ${rel}：只允许写文本源码/资源（.xml/.java/.kt/.kts/.gradle/.properties/.json/.md/.txt 等）` };
    }
  }
  return { ok: true, rel };
}

/** 最后的防线：绝对目标路径必须仍在根之内（拼完路径后再验一次） */
export function isUnder(root: string, target: string): boolean {
  const norm = (p: string) => {
    const out: string[] = [];
    for (const seg of p.replace(/\\/g, "/").split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        out.pop();
        continue;
      }
      out.push(seg);
    }
    return "/" + out.join("/");
  };
  const r = norm(root);
  const t = norm(target);
  if (!r || r === "/") return false;
  return t === r || t.startsWith(r + "/");
}
