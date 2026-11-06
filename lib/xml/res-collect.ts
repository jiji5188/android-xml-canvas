// lib/xml/res-collect.ts — M158：真机渲染前，把布局真正用到的资源从项目里补齐
//
// 为什么需要：打开 APK 里的项目时，resExtras 只有「上传过的 res 目录」，
// 项目自己的 drawable/*.xml 不在里面。结果布局引用 @drawable/bg_button_selector，
// aapt2 前的资源检查直接判「未包含」——资源列表里明明有。
//
// 这里用当前项目 IO 按引用关系递归收集（layout → drawable → 它引用的 color/drawable…），
// 只带真正用得到的文件，不会把整个 res 塞给 aapt2。

import type { AiFileIo } from "./ai-tools";
import { scanResDirs } from "./res-index";
import type { RenderFile } from "./native-render";

const REF_RE =
  /@(?!\+)(?!\*?android:)(drawable|mipmap|layout|color|string|dimen|bool|integer|style|plurals|array|string-array|integer-array|fraction|menu|anim|animator|xml|font|interpolator)\/([A-Za-z0-9_.]+)/g;

const VALUE_TYPES = new Set([
  "string",
  "color",
  "dimen",
  "bool",
  "integer",
  "style",
  "plurals",
  "array",
  "string-array",
  "integer-array",
  "fraction",
]);

function refsIn(text: string): { type: string; name: string }[] {
  const out: { type: string; name: string }[] = [];
  let m: RegExpExecArray | null;
  REF_RE.lastIndex = 0;
  while ((m = REF_RE.exec(text || "")) !== null) {
    out.push({ type: m[1], name: m[2].replace(/\.\w+$/, "") });
  }
  return out;
}

/** 已经出现在文件清单里的资源（values 里的 <string name> / drawable/name.xml） */
function definedIn(files: RenderFile[]): Set<string> {
  const defs = new Set<string>();
  for (const f of files) {
    if (/^values(-[^/]+)?\//i.test(f.path)) {
      const re = /<(string|color|dimen|style|integer|bool|fraction|array|string-array|integer-array|plurals)\b[^>]*?\bname="([^"]+)"/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.text || "")) !== null) defs.add(`${m[1]}/${m[2]}`);
      continue;
    }
    const d = f.path.match(/^(drawable|mipmap|layout|menu|anim|animator|xml|font|interpolator|color)(-[^/]+)?\/([^/]+?)(\.[a-z0-9]+)?$/i);
    if (d) defs.add(`${d[1]}/${d[3]}`);
  }
  return defs;
}

export interface CollectResult {
  files: RenderFile[];
  /** 项目里确实找不到的资源（交给调用方提示，不静默吞掉） */
  missing: string[];
  /** 补了多少个文件 */
  added: number;
}

/**
 * 把 files 里引用但没定义的资源从项目 res 递归补齐。
 * @param io     项目 IO（APK native bridge / 浏览器 FSA），为空则原样返回
 * @param docRel 当前文档相对路径，用来定位 res 根
 */
export async function collectProjectRes(
  io: AiFileIo | null,
  docRel: string | null,
  input: RenderFile[],
  budget = 160,
): Promise<CollectResult> {
  const files = input.map((f) => ({ ...f }));
  if (!io) return { files, missing: [], added: 0 };

  let info: { resRel: string; dirs: string[] };
  try {
    info = await scanResDirs(io, docRel);
  } catch {
    return { files, missing: [], added: 0 };
  }
  if (!info.resRel) return { files, missing: [], added: 0 };
  // scanResDirs 可能返回带尾斜杠的根（docRel 切出来的），偶尔还会列出空目录 → 归一化后重列一次
  const resRel = info.resRel.replace(/\/+$/, "");
  let dirs = info.dirs;
  if (!dirs.length) {
    const again = await io.list(resRel);
    if (again.ok && again.items) dirs = again.items.filter((it) => it.kind === "dir").map((it) => it.name);
  }

  const have = new Set(files.map((f) => f.path));
  const defs = definedIn(files);
  const missing = new Set<string>();
  const valuesCache = new Map<string, string | null>();
  const valuesIndex = new Map<string, string>(); // "string/app_name" → "values/strings.xml"
  let valuesScanned = false;
  let reads = 0;
  let added = 0;

  const addFile = (path: string, text: string) => {
    if (!text || have.has(path) || added >= budget) return false;
    have.add(path);
    files.push({ path, text });
    added++;
    return true;
  };

  /** 扫一遍 values 目录，建「资源 → 定义文件」索引（只做一次） */
  const scanValues = async () => {
    if (valuesScanned) return;
    valuesScanned = true;
    const dirs2 = dirs.filter((d) => /^values/.test(d));
    for (const dir of dirs2) {
      if (reads > 400) break;
      const list = await io.list(`${resRel}/${dir}`);
      if (!list.ok || !list.items) continue;
      for (const it of list.items) {
        if (it.kind !== "file" || !/\.xml$/i.test(it.name) || reads > 400) continue;
        reads++;
        const rel = `${resRel}/${dir}/${it.name}`;
        const r = await io.read(rel);
        const text = r.ok ? r.text || "" : "";
        valuesCache.set(rel, text || null);
        const re = /<(string|color|dimen|style|integer|bool|fraction|array|string-array|integer-array|plurals)\b[^>]*?\bname="([^"]+)"/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(text)) !== null) valuesIndex.set(`${m[1]}/${m[2]}`, `${dir}/${it.name}`);
      }
    }
  };

  /** 在某个资源类型的目录里找一个 xml 文件（含 -night/-v21 等限定符目录） */
  const findDirFile = async (type: string, name: string): Promise<{ path: string; text: string } | null> => {
    const dirs2 = dirs.filter((d) => d === type || d.startsWith(`${type}-`)).sort();
    for (const dir of dirs2) {
      if (reads > 400) return null;
      for (const ext of [".xml", ""]) {
        const path = `${dir}/${name}${ext}`;
        if (!path.startsWith(`${dir}/`)) continue;
        if (have.has(path)) return null; // 已经带过
        reads++;
        const r = await io.read(`${resRel}/${path}`);
        if (r.ok && r.text) return { path, text: r.text };
      }
    }
    return null;
  };

  let queue = files.flatMap((f) => refsIn(f.text));
  const seenRef = new Set<string>();

  while (queue.length > 0 && added < budget) {
    const next: { type: string; name: string }[] = [];
    for (const ref of queue) {
      const key = `${ref.type}/${ref.name}`;
      if (seenRef.has(key)) continue;
      seenRef.add(key);
      if (defs.has(key)) continue;

      if (VALUE_TYPES.has(ref.type)) {
        await scanValues();
        const rel = valuesIndex.get(key);
        if (!rel) {
          missing.add(key);
          continue;
        }
        const full = `${resRel}/${rel}`;
        if (!have.has(rel)) {
          const text = valuesCache.get(full) ?? null;
          if (text && addFile(rel, text)) {
            defs.add(key);
            next.push(...refsIn(text));
          } else if (!text) {
            missing.add(key);
          }
        }
        continue;
      }

      const hit = await findDirFile(ref.type, ref.name);
      if (!hit) {
        missing.add(key);
        continue;
      }
      if (addFile(hit.path, hit.text)) {
        defs.add(key);
        next.push(...refsIn(hit.text));
      }
    }
    queue = next;
  }

  return { files, missing: [...missing].sort(), added };
}
