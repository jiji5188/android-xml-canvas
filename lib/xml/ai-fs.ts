// lib/xml/ai-fs.ts — M64b（B2）：AI 的文件能力统一从「当前项目」来，不再拼默认目录 + 项目名
//
// 真 bug：AiPanel 以前用 createNativeIo(projectName)，根路径 = getDefaultWorkspace() + "/" + 项目名。
// 但用户用「打开项目目录」授权的自定义目录 / SAF 目录根本不在默认工作目录下，
// 这个路径不存在 → list/read 全失败，模型拿不到东西就开始瞎猜。
//
// 现在按优先级选根：
//   1) 当前项目已有 ProjectSource  → 直接用它的 listChildren / readText（web 和 APK 都通）
//   2) 只有绝对根路径（rootPath / dirPath）→ 走 native bridge
//   3) 都没有 → 返回 null，AiPanel 会把工具段整段从 prompt 里去掉
// 写入：只有拿到绝对根路径时才能写（浏览器 FSA 的写能力留给 B1/B3）。

import type { AiFileEntry, AiFileIo } from "./ai-tools";
import type { ProjectSource } from "./project-browse";
import { hasAsyncIo, listDirQueued, readTextQueued } from "./native-async";
import { nativeBridge, writeTextNative } from "./native-save";
import { isUnder } from "./ai-paths";

interface NativeFsBridge {
  listDir?(path: string): string | null;
  readText?(target: string): string | null;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e ?? "未知错误"));

const trimRoot = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");

/** 相对路径 → 绝对路径（越界由调用方/Java 侧再挡） */
function absOf(root: string, rel: string): string {
  const r = trimRoot(root);
  const s = (rel || "").replace(/\\/g, "/").replace(/^\/+/, "");
  return s ? `${r}/${s}` : r;
}

/** 包一层 ProjectSource：读/列都用项目自己的实现（自定义目录、SAF、浏览器目录都能走） */
export function ioFromProjectSource(source: ProjectSource | null | undefined): AiFileIo | null {
  if (!source) return null;
  const root = trimRoot(source.rootPath || "");
  return {
    rootLabel: () => root || source.name || ".",
    async list(rel) {
      try {
        const entries = await source.listChildren(rel);
        const items: AiFileEntry[] = entries.map((e) => ({ name: e.name, kind: e.kind, rel: e.rel }));
        return { ok: true, items };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },
    async read(rel) {
      try {
        const text = await source.readText(rel);
        if (text === null || text === undefined) return { ok: false, error: "读不到（文件不存在或没有权限）" };
        return { ok: true, text };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },
    async write(rel, text) {
      if (!root) return { ok: false, error: "当前项目没有可写根路径（浏览器目录请用另存为）" };
      return writeUnder(root, rel, text);
    },
  };
}

/** 只有绝对根路径时的 native 实现（APK） */
export function ioFromRootPath(rootPath: string | null | undefined, label?: string): AiFileIo | null {
  const root = trimRoot(rootPath || "");
  if (!root) return null;
  const b = nativeBridge() as (ReturnType<typeof nativeBridge> & NativeFsBridge) | null;

  return {
    rootLabel: () => label || root,
    async list(rel) {
      const dir = absOf(root, rel);
      if (!isUnder(root, dir)) return { ok: false, error: "路径非法：跳出了项目目录" };
      try {
        if (hasAsyncIo()) {
          const json = await listDirQueued(dir);
          return parseDirJson(json, rel);
        }
        const json = b?.listDir?.(dir) ?? null;
        return parseDirJson(json, rel);
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },
    async read(rel) {
      const target = absOf(root, rel);
      if (!isUnder(root, target)) return { ok: false, error: "路径非法：跳出了项目目录" };
      try {
        if (hasAsyncIo()) {
          const t = await readTextQueued(target);
          if (t === null || t === undefined) return { ok: false, error: "读不到（文件不存在或没有权限）" };
          return { ok: true, text: t };
        }
        const t = b?.readText?.(target) ?? null;
        if (t === null) return { ok: false, error: "读不到（文件不存在或没有权限）" };
        return { ok: true, text: t };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },
    async write(rel, text) {
      return writeUnder(root, rel, text);
    },
  };
}

/** 从编辑器里的 activeProject 选一条可用通道（顺序即优先级） */
export function ioForProject(p: {
  source?: ProjectSource | null;
  rootPath?: string | null;
  dirPath?: string | null;
  name?: string | null;
} | null | undefined): AiFileIo | null {
  if (!p) return null;
  const bySource = ioFromProjectSource(p.source);
  if (bySource) return bySource;
  return ioFromRootPath(p.rootPath || p.dirPath || null, p.name || undefined);
}

function parseDirJson(json: string | null, rel: string): { ok: boolean; items?: AiFileEntry[]; error?: string } {
  if (!json) return { ok: false, error: "目录不可读（可能没给「所有文件访问」权限）" };
  try {
    const o = JSON.parse(json) as { ok?: boolean; items?: { name: string; kind: string }[] };
    if (!o.ok) return { ok: false, error: "目录不可读（可能没给「所有文件访问」权限）" };
    const items: AiFileEntry[] = (o.items || []).map((it) => ({
      name: it.name,
      kind: it.kind === "dir" ? "dir" : "file",
      rel: rel ? `${rel}/${it.name}` : it.name,
    }));
    return { ok: true, items };
  } catch {
    return { ok: false, error: "返回格式异常" };
  }
}

function writeUnder(root: string, rel: string, text: string): { ok: boolean; error?: string } {
  const target = absOf(root, rel);
  // M64c（B4）：拼完绝对路径再验一次前缀，防 normalize 与拼接口径不一致
  if (!isUnder(root, target)) return { ok: false, error: "路径非法：跳出了项目目录" };
  try {
    const ok = writeTextNative(target, text);
    return ok ? { ok: true } : { ok: false, error: "写入失败（没有权限或 APK 版本过旧）" };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}
