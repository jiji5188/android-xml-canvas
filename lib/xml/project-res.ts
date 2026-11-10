// lib/xml/project-res.ts — M159：打开文件就把它引用的项目资源读进来
//
// 目标（用户 15:57 提的）：打开一个布局就能正常预览 / 真机 aapt2 打包，不用先手动「上传 res 目录」。
// 分两步，先快后全：
//   1) loadProjectResForDoc   只读 values + 从当前文档的 @drawable/@color/... 递归展开（秒级，先让预览可用）
//   2) loadProjectResIndex    再把 res 下其余 drawable/vector/图片扫进来（资源面板/选择器完整）
// 两步结果用 mergeProjectExtras 合并，项目资源优先级高于「上次上传的 res」缓存。
//
// 说明：图片走 io.readBase64（APK 原生桥 / 浏览器目录都支持），转 dataURL 给 <img>。

import type { AiFileIo } from "./ai-tools";
import { scanResDirs } from "./res-index";
import { buildResourceExtras, type ResourceExtras, type ResUploadItem } from "./resdir";
import { refsIn } from "./res-collect";
import { mergeValuesFragments, valuesKeys } from "./values-merge";

const IMG_EXT = /\.(png|webp|jpe?g|gif|bmp)$/i;
const MAX_READS = 420;
const MAX_IMAGE_BYTES = 1_500_000;

/** 空壳 File：buildResourceExtras 只用到 text()（图片我们自己转 dataURL） */
function textItem(rel: string, text: string): ResUploadItem {
  return {
    name: rel.split("/").pop() || rel,
    path: rel,
    file: { text: async () => text } as unknown as File,
  };
}

async function resolveRoot(io: AiFileIo, docRel: string | null) {
  try {
    const info = await scanResDirs(io, docRel);
    const resRel = info.resRel.replace(/\/+$/, "");
    let dirs = info.dirs;
    if (resRel && !dirs.length) {
      const again = await io.list(resRel);
      if (again.ok && again.items) dirs = again.items.filter((it) => it.kind === "dir").map((it) => it.name);
    }
    return { resRel, dirs };
  } catch {
    return { resRel: "", dirs: [] as string[] };
  }
}

async function readText(io: AiFileIo, resRel: string, rel: string): Promise<string | null> {
  try {
    const r = await io.read(`${resRel}/${rel}`);
    return r.ok && typeof r.text === "string" ? r.text : null;
  } catch {
    return null;
  }
}

async function readImage(io: AiFileIo, resRel: string, rel: string): Promise<string | null> {
  if (!io.readBase64) return null;
  try {
    const r = await io.readBase64(`${resRel}/${rel}`);
    if (!r.ok || !r.base64) return null;
    if (r.base64.length > MAX_IMAGE_BYTES * 1.4) return null;
    const ext = (rel.match(IMG_EXT)?.[1] || "png").toLowerCase().replace("jpeg", "jpg").replace("jpg", "jpeg");
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    return `data:${mime};base64,${r.base64}`;
  } catch {
    return null;
  }
}

/** 列出 res 下某个目录的直接文件（返回 res 内相对路径） */
async function listDir(io: AiFileIo, resRel: string, dir: string): Promise<string[]> {
  try {
    const r = await io.list(`${resRel}/${dir}`);
    if (!r.ok || !r.items) return [];
    return r.items.filter((it) => it.kind === "file").map((it) => `${dir}/${it.name}`);
  } catch {
    return [];
  }
}

function emptyExtras(): ResourceExtras {
  return {
    drawables: {},
    vectorNames: [],
    drawableXml: {},
    valuesXml: "",
    styles: {},
    sourceFiles: [],
    counts: { images: 0, vectors: 0, values: 0, styles: 0, shapes: 0 },
  };
}

function addImage(extras: ResourceExtras, rel: string, url: string) {
  const name = rel.split("/").pop()!.replace(IMG_EXT, "");
  if (!extras.drawables[name]) {
    extras.drawables[name] = url;
    extras.counts.images++;
    extras.sourceFiles.push(rel);
  }
}

/** 合并两份资源表（b 覆盖 a）
 *  M183c：valuesXml 不能再直接拼接 —— 这个函数被「载入项目资源」反复调用，
 *  拼一次就多一份，最后把整份 values 文本叠成几千条重复定义（还写回了项目 res）。
 *  改成按 kind/name 去重合并（幂等），同名以 b 为准。 */
export function mergeProjectExtras(a: ResourceExtras | null, b: ResourceExtras | null): ResourceExtras | null {
  if (!a) return b;
  if (!b) return a;
  const valuesXml = mergeValuesFragments(a.valuesXml ?? "", b.valuesXml ?? "");
  return {
    ...a,
    ...b,
    drawables: { ...a.drawables, ...b.drawables },
    drawableXml: { ...a.drawableXml, ...b.drawableXml },
    // M210：layouts 也合并（a 是快速通道里当前文档引用的，b 是全量扫描；缺一边都会少 id）
    layouts: { ...(a.layouts || {}), ...(b.layouts || {}) },
    styles: { ...a.styles, ...b.styles },
    vectorNames: [...new Set([...a.vectorNames, ...b.vectorNames])],
    valuesXml,
    sourceFiles: [...new Set([...a.sourceFiles, ...b.sourceFiles])],
    counts: {
      images: Object.keys({ ...a.drawables, ...b.drawables }).length,
      vectors: new Set([...a.vectorNames, ...b.vectorNames]).size,
      // 数真去重后的键数，不再把两边的计数盲加（旧版会越加越大）
      values: valuesKeys(valuesXml).size,
      styles: Object.keys({ ...a.styles, ...b.styles }).length,
      shapes: Math.max(a.counts.shapes, b.counts.shapes),
    },
    themeAttrs: { ...(a.themeAttrs || {}), ...(b.themeAttrs || {}) },
    themeAttrsNight: { ...(a.themeAttrsNight || {}), ...(b.themeAttrsNight || {}) },
    colorsNight: { ...(a.colorsNight || {}), ...(b.colorsNight || {}) },
    stringsByLocale: { ...(a.stringsByLocale || {}), ...(b.stringsByLocale || {}) },
  };
}

/**
 * 快速通道：values 全读 + 当前文档引用递归展开。
 * seedText 传当前编辑器里的 XML（未保存的也算）。
 */
export async function loadProjectResForDoc(
  io: AiFileIo | null,
  docRel: string | null,
  seedText: string,
  limit = 200,
): Promise<ResourceExtras | null> {
  if (!io) return null;
  const { resRel, dirs } = await resolveRoot(io, docRel);
  if (!resRel || dirs.length === 0) return null;

  const items: ResUploadItem[] = [];
  const seen = new Set<string>();
  let reads = 0;

  // 1) values（含 values-night / values-zh，交给 buildResourceExtras 分类）
  for (const d of dirs.filter((x) => /^values/.test(x))) {
    for (const rel of await listDir(io, resRel, d)) {
      if (!/\.xml$/i.test(rel) || reads >= MAX_READS) continue;
      reads++;
      const text = await readText(io, resRel, rel);
      if (text == null) continue;
      seen.add(rel);
      items.push(textItem(rel, text));
    }
  }

  // 2) 引用递归：drawable / mipmap / layout 的 xml（图片单独走 base64）
  const findXml = async (type: string, name: string) => {
    const buckets = dirs.filter((d) => d === type || d.startsWith(`${type}-`)).sort();
    for (const d of buckets) {
      const rel = `${d}/${name}.xml`;
      if (seen.has(rel) || reads >= MAX_READS) continue;
      reads++;
      const text = await readText(io, resRel, rel);
      if (text != null) return { rel, text };
    }
    return null;
  };

  const imageQueue: { type: string; name: string }[] = [];
  let queue = refsIn(seedText || "");
  while (queue.length && items.length < limit) {
    const next: { type: string; name: string }[] = [];
    for (const ref of queue) {
      if (items.length >= limit) break;
      if (ref.type === "drawable" || ref.type === "mipmap") {
        const hit = await findXml(ref.type, ref.name);
        if (hit) {
          if (!seen.has(hit.rel)) {
            seen.add(hit.rel);
            items.push(textItem(hit.rel, hit.text));
            next.push(...refsIn(hit.text));
          }
        } else {
          imageQueue.push(ref);
        }
      } else if (ref.type === "layout" || ref.type === "menu" || ref.type === "anim" || ref.type === "animator" || ref.type === "xml") {
        const hit = await findXml(ref.type, ref.name);
        if (hit && !seen.has(hit.rel)) {
          seen.add(hit.rel);
          items.push(textItem(hit.rel, hit.text));
          next.push(...refsIn(hit.text));
        }
      }
    }
    queue = next;
  }

  const extras = items.length ? await buildResourceExtras(items) : emptyExtras();
  // 3) 递归里遇到、但 res 里只有图片的 @drawable
  for (const ref of imageQueue) {
    for (const d of dirs.filter((x) => x === ref.type || x.startsWith(`${ref.type}-`))) {
      for (const ext of ["png", "webp", "jpg", "jpeg"]) {
        const rel = `${d}/${ref.name}.${ext}`;
        if (seen.has(rel)) break;
        const url = await readImage(io, resRel, rel);
        if (url) {
          seen.add(rel);
          addImage(extras, rel, url);
          break;
        }
      }
    }
  }
  return extras;
}

/** 全量：values + res 下所有 drawable/mipmap xml + 限量图片（后台补齐用） */
export async function loadProjectResIndex(
  io: AiFileIo | null,
  docRel: string | null,
  limit = 320,
): Promise<ResourceExtras | null> {
  if (!io) return null;
  const { resRel, dirs } = await resolveRoot(io, docRel);
  if (!resRel || dirs.length === 0) return null;

  const items: ResUploadItem[] = [];
  const seen = new Set<string>();
  let reads = 0;

  for (const d of dirs.filter((x) => /^values/.test(x))) {
    for (const rel of await listDir(io, resRel, d)) {
      if (!/\.xml$/i.test(rel) || reads >= MAX_READS) continue;
      reads++;
      const text = await readText(io, resRel, rel);
      if (text != null) {
        seen.add(rel);
        items.push(textItem(rel, text));
      }
    }
  }

  // M210：layout 目录也要扫 —— javaResEnv 靠 extras.layouts 收集 @+id 与布局名，
  //  以前只扫 values/drawable，导致「R.layout.xxx 不存在」和「R.id.xxx 不存在」满屏误报。
  //  单个布局文本通常 2~10KB，限制数量避免打爆内存。
  const layoutDirs = dirs.filter((d) => /^layout(-|$)/.test(d));
  let layoutsRead = 0;
  const MAX_LAYOUTS = 120;
  for (const d of layoutDirs) {
    for (const rel of await listDir(io, resRel, d)) {
      if (!/\.xml$/i.test(rel)) continue;
      if (seen.has(rel) || layoutsRead >= MAX_LAYOUTS || reads >= MAX_READS) continue;
      reads++;
      layoutsRead++;
      const text = await readText(io, resRel, rel);
      if (text != null) {
        seen.add(rel);
        items.push(textItem(rel, text));
      }
    }
  }

  const drawableDirs = dirs.filter((d) => /^(drawable|mipmap)/.test(d));  const images: string[] = [];
  for (const d of drawableDirs) {
    for (const rel of await listDir(io, resRel, d)) {
      if (!/\.xml$/i.test(rel)) {
        if (IMG_EXT.test(rel)) images.push(rel);
        continue;
      }
      if (seen.has(rel) || items.length >= limit) continue;
      reads++;
      const text = await readText(io, resRel, rel);
      if (text != null) {
        seen.add(rel);
        items.push(textItem(rel, text));
      }
    }
  }

  const extras = items.length ? await buildResourceExtras(items) : emptyExtras();
  // 图片按目录顺序取，最多 80 张（每张 ≤1.5MB，避免把手机内存打满）
  let pics = 0;
  for (const rel of images) {
    if (pics >= 80) break;
    if (seen.has(rel)) continue;
    const url = await readImage(io, resRel, rel);
    if (url) {
      pics++;
      addImage(extras, rel, url);
    }
  }
  return extras;
}

/* 简单缓存：同一项目 20 秒内重复打开文件不重复扫盘 */
const cache = new Map<string, { at: number; extras: ResourceExtras }>();
const CACHE_TTL = 20_000;

export function invalidateProjectRes(io?: AiFileIo | null): void {
  if (!io) {
    cache.clear();
    return;
  }
  const label = io.rootLabel();
  for (const k of cache.keys()) if (k.startsWith(`${label}|`)) cache.delete(k);
}

export async function loadProjectResIndexCached(
  io: AiFileIo | null,
  docRel: string | null,
  limit = 320,
): Promise<ResourceExtras | null> {
  if (!io) return null;
  const key = `${io.rootLabel()}|${docRel || ""}|${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.extras;
  const extras = await loadProjectResIndex(io, docRel, limit);
  if (extras) cache.set(key, { at: Date.now(), extras });
  return extras;
}
