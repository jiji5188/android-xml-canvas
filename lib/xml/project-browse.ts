// lib/xml/project-browse.ts — M25d：项目浏览（扁平列表 + 按需加载结构 + 名称/图标分析）
//
// 为什么重写这一层：
//   1) 原来「项目列表」是深层递归扫描（每个目录都 countXmlDeep），一个真安卓工程要读几百个目录句柄，
//      主线程被 await 链拖住 → 面板卡顿；
//   2) 现在列表只取工作目录的**直接子项**（一层），点开某个项目后才按需逐层列目录（懒加载），
//      每次只读一层，卡顿消失；
//   3) 项目名不再用文件夹名硬顶，改成读 res/values/strings.xml 的 app_name；
//      图标自动找 mipmap/drawable 里的 ic_launcher。
//
// 这里只依赖「结构化句柄」接口（File System Access 的 DirHandle/FileHandle 形状），
// 具体句柄从 workspace-fs 拿，不在这里存。

import { nativeBridge } from "./native-save";
import { hasAsyncIo, listDirQueued, readBase64Queued, readTextQueued } from "./native-async";
import { perfTimer } from "./perf-log";
import { type WsProject } from "./workspace";
import type { FileOpsCtx } from "./file-ops";

/** 列目录时跳过的噪声目录（安卓工程里 build/.gradle 体积大且没布局） */
export const SKIP_DIRS = new Set([
  ".git",
  ".gradle",
  ".idea",
  "build",
  "node_modules",
  ".svn",
  "__pycache__",
  ".cxx",
]);

export interface BrowseEntry {
  kind: "dir" | "file";
  name: string;
  /** 相对项目根的路径，如 "app/src/main/res/layout/activity_main.xml" */
  rel: string;
  /** web：目录/文件句柄 */
  handle?: unknown;
  /** native：绝对路径 / content URI（可直接给 bridge 读） */
  target?: string;
}

export interface ProjectSource {
  name: string;
  /** M46c：native 源的根绝对路径（派生 fileOps 用，避免上层拿不到 dirPath） */
  rootPath?: string;
  /** 列某一层的直接子项（rel="" 为项目根）；只读一层，不递归 */
  listChildren(rel: string): Promise<BrowseEntry[]>;
  /** 读一个 xml 文件内容 */
  readText(rel: string): Promise<string | null>;
  /** M31：读项目图标（res/mipmap*|drawable* 里的 ic_launcher* 图片）→ 可直接给 <img src> 的 URL */
  appIconUrl?(): Promise<string | null>;
}

type DirLike = {
  kind: "directory";
  name: string;
  values(): AsyncIterableIterator<DirLike | FileLike>;
  getDirectoryHandle(name: string): Promise<DirLike>;
  getFileHandle(name: string): Promise<FileLike>;
};

type FileLike = {
  kind: "file";
  name: string;
  getFile(): Promise<File>;
};

function nameOf(rel: string): string {
  return rel.split("/").filter(Boolean).pop() ?? rel;
}

function parentOf(rel: string): string {
  return rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
}

function joinRel(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

function sortEntries(list: BrowseEntry[]): BrowseEntry[] {
  return list.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name, "zh-Hans-CN") : a.kind === "dir" ? -1 : 1,
  );
}

/** 从项目根按 rel 逐级下钻拿目录句柄 */
async function resolveDir(root: DirLike, rel: string): Promise<DirLike | null> {
  let cur: DirLike = root;
  for (const part of rel.split("/").filter(Boolean)) {
    try {
      cur = await cur.getDirectoryHandle(part);
    } catch {
      return null;
    }
  }
  return cur;
}

/** M31：图标文件名优先级（数字越小越优）——按「ic_launcher 命名」优先，退到 icon/app_icon */
export function iconRank(name: string): number {
  const n = name.toLowerCase();
  // 只认位图；ic_launcher.xml（自适应图标描述）不能当图片用
  if (!/\.(png|webp|jpe?g)$/.test(n)) return 99;
  if (n === "ic_launcher.png") return 0;
  if (n === "ic_launcher.webp") return 1;
  if (n === "ic_launcher.jpg" || n === "ic_launcher.jpeg") return 2;
  if (n.startsWith("ic_launcher_round")) return 3;
  // 自适应图标的前景层是透明底，单独看得调背景，排最后
  if (n.startsWith("ic_launcher_foreground")) return 8;
  if (n.startsWith("ic_launcher")) return 4;
  if (n === "icon.png" || n === "icon.webp") return 5;
  if (n === "app_icon.png" || n === "app_icon.webp") return 6;
  return 99;
}

/** 候选文件名里挑一个最像应用图标的（213 个名字就扫一遍，开销可忽略） */
export function pickBestIconName(names: string[]): string | null {
  const hits = names.filter((n) => iconRank(n) < 99);
  if (!hits.length) return null;
  hits.sort((a, b) => iconRank(a) - iconRank(b) || a.localeCompare(b));
  return hits[0];
}

/** M31h：图片扩展名 —— res/drawable*|mipmap* 里的这些文件在结构树里也列出来，并直接显示缩略图 */
export const IMAGE_EXT_RE = /\.(png|webp|jpe?g|gif|bmp)$/i;

export function isImageName(name: string): boolean {
  return IMAGE_EXT_RE.test(name);
}

/** M45b：java/kt 源码目录（/main/java、/main/kotlin 等），rel 里任意一段为 java/kotlin/kt 都算 */
export const JAVA_SRC_EXT_RE = /\.(java|kt|kts)$/i;

export function isJavaDirRel(rel: string): boolean {
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return false;
  const lower = parts.map((p) => p.toLowerCase());
  return lower.includes("java") || lower.includes("kotlin") || lower.includes("kt");
}

export function isJavaSrcName(name: string): boolean {
  return JAVA_SRC_EXT_RE.test(name);
}

/** M31h：这个目录是不是图标资源目录（res/drawable*、res/mipmap*） */
export function isIconDirRel(rel: string): boolean {
  return /(^|\/)(drawable|mipmap)(-[^/]*)?(\/|$)/i.test(rel);
}

/** M31h：读一行文件的缩略图（web：File → objectURL；native：bridge.readBase64 → data URL），
 *  M59：LRU 上限 40 条 + 淘汰时 revoke（web 分支原来永不释放，base64 无上限 → 内存泄漏） */
const entryImageCache = new Map<string, string>();
const ENTRY_IMAGE_CACHE_MAX = 40;
function entryImageCacheSet(key: string, url: string): void {
  entryImageCache.delete(key);
  entryImageCache.set(key, url);
  while (entryImageCache.size > ENTRY_IMAGE_CACHE_MAX) {
    const oldest = entryImageCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    entryImageCache.delete(oldest);
    if (oldest.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(oldest);
      } catch {
        /* ignore */
      }
    }
  }
}
export async function readEntryImageUrl(entry: BrowseEntry): Promise<string | null> {
  if (!isImageName(entry.name)) return null;
  const key = entry.target || entry.rel;
  if (entryImageCache.has(key)) return entryImageCache.get(key) ?? null;
  let url: string | null = null;
  const fh = entry.handle as FileLike | undefined;
  if (fh && typeof fh.getFile === "function") {
    try {
      url = URL.createObjectURL(await fh.getFile());
    } catch {
      url = null;
    }
  } else if (entry.target) {
    const b = nativeBridge();
    try {
      // M33：优先异步读（不卡 UI）；旧 APK 退回同步
      let b64: string | null = null;
      if (hasAsyncIo()) {
        b64 = await readBase64Queued(entry.target);
      } else {
        b64 = b?.readBase64 ? b.readBase64(entry.target) : null;
      }
      url = b64 ? `data:${mimeOfIcon(entry.name)};base64,${b64}` : null;
    } catch {
      url = null;
    }
  }
  if (url) entryImageCacheSet(key, url);
  return url;
}

const IMG_EXT_MIME: Record<string, string> = {
  png: "image/png",
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
};

function mimeOfIcon(name: string): string {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return IMG_EXT_MIME[ext] ?? "image/png";
}

/** web：把一个目录句柄包成 ProjectSource（懒加载：每次只列一层） */
export function webProjectSource(root: unknown, name: string): ProjectSource {
  const dir = root as DirLike;
  return {
    name,
    async listChildren(rel: string) {
      const target = rel ? await resolveDir(dir, rel) : dir;
      if (!target) return [];
      const dirs: BrowseEntry[] = [];
      const files: BrowseEntry[] = [];
      try {
        for await (const e of target.values()) {
          const lower = e.name.toLowerCase();
          if (e.kind === "directory") {
            if (SKIP_DIRS.has(lower)) continue;
            dirs.push({ kind: "dir", name: e.name, rel: joinRel(rel, e.name), handle: e });
          } else if (/\.xml$/i.test(e.name) || (isIconDirRel(rel) && isImageName(e.name)) || (isJavaDirRel(rel) && isJavaSrcName(e.name))) {
            files.push({ kind: "file", name: e.name, rel: joinRel(rel, e.name), handle: e });
          }
        }
      } catch {
        return [];
      }
      return [...sortEntries(dirs), ...sortEntries(files)];
    },
    async readText(rel: string) {
      try {
        const parent = rel ? await resolveDir(dir, parentOf(rel)) : dir;
        if (!parent) return null;
        const fh = await parent.getFileHandle(nameOf(rel));
        const file = await fh.getFile();
        return await file.text();
      } catch {
        return null;
      }
    },
    async appIconUrl() {
      return await webIconUrl(dir);
    },
  };
}

/** web：在 res/mipmap*|drawable* 里找 ic_launcher* 图片，做成 object URL */
async function webIconUrl(dir: DirLike): Promise<string | null> {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return null;
  for (const resRel of RES_CANDIDATES) {
    const res = await resolveDir(dir, resRel).catch(() => null);
    if (!res) continue;
    const buckets: DirLike[] = [];
    try {
      for await (const e of res.values()) {
        if (e.kind !== "directory") continue;
        const l = e.name.toLowerCase();
        if (l.startsWith("mipmap") || l.startsWith("drawable")) buckets.push(e);
      }
    } catch {
      /* ignore */
    }
    // mipmap 优先（系统图标一般放这儿），同组内按名称排序保证稳定
    buckets.sort((a, b) => (b.name.toLowerCase().startsWith("mipmap") ? 1 : 0) - (a.name.toLowerCase().startsWith("mipmap") ? 1 : 0));
    for (const b of buckets) {
      const names: string[] = [];
      try {
        for await (const e of b.values()) {
          if (e.kind === "file") names.push(e.name);
        }
      } catch {
        continue;
      }
      const best = pickBestIconName(names);
      if (!best) continue;
      try {
        const fh = await b.getFileHandle(best);
        return URL.createObjectURL(await fh.getFile());
      } catch {
        /* 换下一个桶 */
      }
    }
  }
  return null;
}

/** native：APK 里 bridge 一次给出扁平（带 rel）列表，这里按前缀过滤出一层
 *  M31h：传了 rootDir 且 bridge 有新 listDir 时，改成真读一层目录（能列出 drawable/mipmap 里的图片）；
 *  旧 APK（没有 listDir）自动退回扁平列表。 */
export function nativeProjectSource(name: string, all: WsProject[], rootDir?: string): ProjectSource {
  const src: ProjectSource = {
    name,
    async listChildren(rel: string) {
      const b = nativeBridge();
      const tryListDir = !!(rootDir && (b?.listDir || hasAsyncIo()));
      if (tryListDir) {
        try {
          const abs = rel ? `${rootDir.replace(/\/+$/, "")}/${rel}` : rootDir;
          const t = perfTimer("tree.listDir", rel || "(root)");
          const raw = hasAsyncIo() ? await listDirQueued(abs) : b && b.listDir ? b.listDir(abs) : null;
          const parsed = raw ? (JSON.parse(raw) as { ok?: boolean; items?: { name: string; kind: string; path?: string }[] }) : null;
          if (parsed?.ok && Array.isArray(parsed.items)) {
            const out: BrowseEntry[] = [];
            for (const it of parsed.items) {
              if (it.kind === "dir") {
                if (SKIP_DIRS.has(it.name.toLowerCase())) continue;
                out.push({ kind: "dir", name: it.name, rel: joinRel(rel, it.name) });
              } else if (/\.xml$/i.test(it.name) || (isIconDirRel(rel) && isImageName(it.name)) || (isJavaDirRel(rel) && isJavaSrcName(it.name))) {
                out.push({ kind: "file", name: it.name, rel: joinRel(rel, it.name), target: it.path });
              }
            }
            t.end("items=" + out.length + " raw=" + parsed.items.length);
            return [
              ...sortEntries(out.filter((e) => e.kind === "dir")),
              ...sortEntries(out.filter((e) => e.kind === "file")),
            ];
          }
          t.end("ERR-parse");
        } catch {
          /* 退回下面的扁平列表 */
        }
      }
      const prefix = rel ? `${rel}/` : "";
      const out: BrowseEntry[] = [];
      for (const it of all) {
        if (it.rel === rel) continue;
        if (!it.rel.startsWith(prefix)) continue;
        const rest = it.rel.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        if (it.kind === "file" && !/\.xml$/i.test(it.name) && !(isIconDirRel(rel) && isImageName(it.name)) && !(isJavaDirRel(rel) && isJavaSrcName(it.name))) continue;
        out.push({ kind: it.kind, name: it.name, rel: it.rel, target: it.target });
      }
      return [...sortEntries(out.filter((e) => e.kind === "dir")), ...sortEntries(out.filter((e) => e.kind === "file"))];
    },
    async readText(rel: string) {
      const hit = all.find((it) => it.rel === rel && it.kind === "file");
      // M45b：java/kt 文件不在扁平列表里时，用 rootDir 拼绝对路径直接读
      // M55：老 APK 的 xml 条目 target 缺失（当时映射只取 docUri/mainPath）→ 任意扩展名都补一条 rootDir 回退
      let target = hit?.target;
      if (!target && rootDir) {
        target = `${rootDir.replace(/\/+$/, "")}/${rel}`;
      }
      if (!target) return null;
      const b = nativeBridge();
      try {
        if (hasAsyncIo()) return (await readTextQueued(target)) || null;
        return b?.readText ? b.readText(target) || null : null;
      } catch {
        return null;
      }
    },
    /** M31：从扁平列表里找 ic_launcher* 图片，走 bridge.readBase64 读字节 → data URL */
    async appIconUrl() {
      const b = nativeBridge();
      if (!b?.readBase64 && !hasAsyncIo()) return null;
      const cands = all
        .filter((it) => it.kind === "file" && ICON_REL_RE.test(it.rel) && /ic_launcher|app_icon|(^|\/)icon\./i.test(it.name) && !!it.target)
        .sort((a, b2) => {
          // mipmap 目录优先（安卓约定），再按文件名优先级
          const am = a.rel.toLowerCase().includes("/mipmap") ? 0 : 1;
          const bm = b2.rel.toLowerCase().includes("/mipmap") ? 0 : 1;
          return am - bm || iconRank(a.name) - iconRank(b2.name) || a.rel.localeCompare(b2.rel);
        });
      for (const c of cands) {
        try {
          const b64 = hasAsyncIo()
            ? await readBase64Queued(c.target as string)
            : b && b.readBase64 ? b.readBase64(c.target as string) : null;
          if (b64) return `data:${mimeOfIcon(c.name)};base64,${b64}`;
        } catch {
          /* 换下一个 */
        }
      }
      return null;
    },
  };
  if (rootDir) src.rootPath = rootDir.replace(/\/+$/, "");
  return src;
}

/**
 * M31（native）：APK 里没有 DirHandle，但有项目目录绕对路径 —— 直接按候选路径试读。
 * 名称：res/values/strings.xml 的 app_name
 * 图标：res/mipmap-*|drawable* 下的 ic_launcher* 图片（readBase64 → data URL）
 */
export const NATIVE_STRINGS_RELS = [
  "app/src/main/res/values/strings.xml",
  "src/main/res/values/strings.xml",
  "res/values/strings.xml",
];

/** 按密度从高到低排（高密度图更清晰，失败自动换下一个） */
export const NATIVE_ICON_DIRS = [
  "app/src/main/res/mipmap-xxxhdpi",
  "app/src/main/res/mipmap-xxhdpi",
  "app/src/main/res/mipmap-xhdpi",
  "app/src/main/res/mipmap-hdpi",
  "app/src/main/res/mipmap-mdpi",
  "app/src/main/res/mipmap",
  "app/src/main/res/drawable-xxhdpi",
  "app/src/main/res/drawable-xhdpi",
  "app/src/main/res/drawable-hdpi",
  "app/src/main/res/drawable",
  "src/main/res/mipmap-xxhdpi",
  "src/main/res/mipmap-xhdpi",
  "src/main/res/mipmap-hdpi",
  "src/main/res/mipmap",
  "src/main/res/drawable",
  "res/mipmap-xxhdpi",
  "res/mipmap-hdpi",
  "res/mipmap",
  "res/drawable",
];

export const NATIVE_ICON_NAMES = [
  "ic_launcher.png",
  "ic_launcher.webp",
  "ic_launcher.jpg",
  "ic_launcher_round.png",
  "ic_launcher_round.webp",
  "icon.png",
  "app_icon.png",
];

const nativeMetaCache = new Map<string, ProjectMeta>();

/** M33：从目录列表里挑最合适的图标文件名（纯函数，可单测）
 *  只认图片扩展名；`ic_launcher.xml`（自适应图标）要排除 */
export function pickIconFromNames(names: string[]): string | null {
  const imgs = names.filter((n) => isImageName(n) && /^(ic_launcher|icon|app_icon)/i.test(n));
  if (!imgs.length) return null;
  return imgs.sort((a, b) => iconRank(a) - iconRank(b) || a.localeCompare(b))[0];
}

export async function readProjectMetaNative(
  name: string,
  dirPath: string | undefined | null,
): Promise<ProjectMeta> {
  const fallback: ProjectMeta = { name };
  const b = nativeBridge();
  if (!b || !dirPath) return fallback;
  const cached = nativeMetaCache.get(dirPath);
  if (cached) return cached;

  const norm = dirPath.replace(/[\\/]+$/, "");
  const sep = norm.includes("\\") ? "\\" : "/";
  const abs = (rel: string) => `${norm}${sep}${rel.split("/").join(sep)}`;
  const io = hasAsyncIo();

  // 1) 名称
  for (const rel of NATIVE_STRINGS_RELS) {
    try {
      const text = io ? await readTextQueued(abs(rel)) : b.readText ? b.readText(abs(rel)) : null;
      const appName = text ? parseAppName(text) : null;
      if (appName) {
        fallback.name = appName;
        break;
      }
    } catch {
      /* 下一个 */
    }
  }

  // 2) 图标：先用 listDir 看目录里到底有哪张图（每目录一次调用），
  //    而不是拿 19×7 个路径一个个试读 —— 这是手机上卡顿的主因。
  const canList = !!b.listDir || io;
  if (canList) {
    for (const dir of NATIVE_ICON_DIRS) {
      try {
        const raw = io ? await listDirQueued(abs(dir)) : b.listDir ? b.listDir(abs(dir)) : null;
        if (!raw) continue;
        const parsed = JSON.parse(raw) as { ok?: boolean; items?: { name?: string; kind?: string }[] };
        if (!parsed?.ok || !Array.isArray(parsed.items)) continue;
        const names = parsed.items.filter((it) => it.kind !== "dir").map((it) => String(it.name || ""));
        const pick = pickIconFromNames(names);
        if (pick) {
          const b64 = io ? await readBase64Queued(abs(`${dir}/${pick}`)) : b.readBase64 ? b.readBase64(abs(`${dir}/${pick}`)) : null;
          if (b64) {
            fallback.iconUrl = `data:${mimeOfIcon(pick)};base64,${b64}`;
            break;
          }
        }
      } catch {
        /* 下一个目录 */
      }
    }
  } else if (b.readBase64) {
    // 旧 APK（没有 listDir）只能盲试；为了不卡，最多试前 4 个目录 × 2 个名字
    outer: for (const dir of NATIVE_ICON_DIRS.slice(0, 4)) {
      for (const icon of ["ic_launcher.png", "ic_launcher.webp"]) {
        try {
          const b64 = b.readBase64(abs(`${dir}/${icon}`));
          if (b64) {
            fallback.iconUrl = `data:${mimeOfIcon(icon)};base64,${b64}`;
            break outer;
          }
        } catch {
          /* 下一个 */
        }
      }
    }
  }

  // 3) M48：判断项目用的是 AndroidX 还是老 support 库（读 gradle 配置，只读少量文件）
  //    顺序：gradle.properties 里 useAndroidX=true 最权威；否则看 app/build.gradle(.kts) 的依赖前缀。
  try {
    const readOne = async (rel: string): Promise<string | null> => {
      try {
        return io ? await readTextQueued(abs(rel)) : b.readText ? b.readText(abs(rel)) : null;
      } catch {
        return null;
      }
    };
    const props = await readOne("gradle.properties");
    let appGradle: string | null = null;
    if (!/android\.useandroidx\s*=\s*true/i.test(props || "")) {
      appGradle = (await readOne("app/build.gradle.kts")) || (await readOne("app/build.gradle"));
    }
    fallback.lib = parseLibKind(props, appGradle, null);
  } catch {
    /* 读不到就当普通 Android 工程 */
  }

  nativeMetaCache.set(dirPath, fallback);
  return fallback;
}

/** native 扁平 rel 里的图标文件：.../res/mipmap-xxxhdpi/ic_launcher.png 这类图片 */
const ICON_REL_RE = /(^|\/)res\/(mipmap|drawable)(-[^\/]*)?\/[^\/]+\.(png|webp|jpe?g)$/i;

/** M44：res/ 直接子目录的作用说明（目录名 → 固定用途）
 *  例：rel="res/layout" → "界面布局文件"；"res/drawable-xxhdpi" → "图片与矢量资源（xxhdpi 变体）" */
export const RES_DIR_DESC: Record<string, string> = {
  layout: "界面布局文件",
  values: "字符串 / 颜色等资源值",
  color: "颜色资源",
  anim: "帧动画",
  animator: "属性动画",
  array: "数组资源",
  drawable: "图片与矢量资源",
  font: "字体资源",
  raw: "原始文件（音频、视频等）",
  menu: "菜单",
  xml: "自定义 XML 配置",
  mipmap: "应用图标资源",
  transition: "场景转场动画",
  backup: "备份规则",
  navigation: "导航图",
  interpolator: "动画插值器",
};

/** M44：这个目录是不是 res/ 的直接子目录；返回它的作用说明（没有说明返回 null） */
export function resDirDescription(rel: string): string | null {
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const parent = parts[parts.length - 2].toLowerCase();
  if (parent !== "res") return null;
  const name = parts[parts.length - 1].toLowerCase();
  const [base, ...quals] = name.split("-");
  const desc = RES_DIR_DESC[base];
  if (!desc) return null;
  return quals.length ? `${desc}（${quals.join("-")} 变体）` : desc;
}

/** M43：这个目录是不是 res/ 的直接子目录（纯函数，可单测） */
export function isResChildDirRel(rel: string): boolean {
  const parts = rel.split("/").filter(Boolean);
  if (parts.length < 2) return false;
  return parts[parts.length - 2].toLowerCase() === "res";
}

// ── M144：文件行的描述文案 ──
// 用户要求：副标题必须说清楚「这是什么」，不许一律兜底成「布局文件」。
// 优先看目录语义（res/xxx），再看扩展名；完全认不出时返回 ""（宁可不显示也不乱猜）。

/** res/drawable/ic_x.xml → { dir: "drawable", name: "ic_x" }；不在 res/ 下返回 null */
function resPathOf(rel: string): { dir: string; file: string } | null {
  const parts = rel.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("res");
  if (idx < 0 || idx === parts.length - 1) return null;
  return { dir: (parts[idx + 1] || "").toLowerCase(), file: parts[parts.length - 1] };
}

const EXT_DESC: Record<string, string> = {
  java: "Java 源码",
  kt: "Kotlin 源码",
  kts: "Kotlin 构建脚本",
  gradle: "Gradle 构建配置",
  properties: "项目配置",
  toml: "依赖版本 catalog",
  json: "JSON 数据",
  md: "说明文档",
  txt: "文本文件",
  ttf: "字体文件",
  otf: "字体文件",
  mp3: "音频文件",
  wav: "音频文件",
  ogg: "音频文件",
  mp4: "视频文件",
  webm: "视频文件",
  db: "数据库文件",
  sqlite: "数据库文件",
  sql: "SQL 脚本",
  bin: "二进制文件",
  pak: "打包数据",
  yml: "YAML 配置",
  yaml: "YAML 配置",
  proto: "protobuf 定义",
  sh: "Shell 脚本",
  bat: "批处理脚本",
  ps1: "PowerShell 脚本",
  jar: "JAR 依赖包",
  aar: "AAR 依赖包",
  class: "编译后的 class",
  iml: "IDE 模块配置",
  pro: "混淆规则",
  aidl: "AIDL 接口定义",
};

/** M144b：java/kotlin 文件按类名后缀说清楚「这是什么类」（用户要求 java 目录也要有描述） */
const CODE_CLASS_RULES: [RegExp, string][] = [
  [/Activity$/i, "Activity 页面"],
  [/Fragment$/i, "Fragment 页面片段"],
  [/Dialog(Fragment)?$/i, "对话框"],
  [/Adapter$/i, "列表适配器"],
  [/ViewHolder$/i, "列表项视图"],
  [/ContentProvider$/i, "内容提供者"],
  [/BroadcastReceiver$|Receiver$/i, "广播接收器"],
  [/Application$/i, "Application 入口"],
  [/Service$/i, "后台服务"],
  [/ViewModel$/i, "ViewModel"],
  [/Repository$/i, "数据仓库"],
  [/Dao$/i, "数据访问对象"],
  [/Manager$/i, "业务管理器"],
  [/(Helper|Utils?|Tools)$/i, "工具类"],
  [/(Config|Settings|Constants?)$/i, "配置 / 常量"],
  [/(Model|Bean|Entity|Dto|Vo|Pojo)$/i, "数据模型"],
  [/(Callback|Listener)$/i, "回调接口"],
  [/Test$/i, "单元测试"],
];

/** 一个文件该显示什么描述（"" = 认不出来，不显示副标题） */
export function describeFile(rel: string, name: string): string {
  const file = name || rel.split("/").pop() || "";
  const lower = file.toLowerCase();
  const res = resPathOf(rel);
  const ext = (lower.split(".").pop() || "").toLowerCase();

  // 九宫格先判（.9.png 的 ext 是 png）
  if (/\.9\.png$/i.test(lower)) return "九宫格图片（可拉伸）";

  if (IMAGE_EXT_RE.test(lower)) {
    if (!res) return "图片";
    if (/^mipmap/.test(res.dir)) return "应用图标";
    if (/^drawable/.test(res.dir)) return "图片资源";
    return "图片";
  }
  if (lower.endsWith(".svg")) return "SVG 矢量图";

  if (/^androidmanifest\.xml$/i.test(lower)) return "应用清单";

  if (ext === "java" || ext === "kt" || ext === "kts") {
    const base = file.replace(/\.[^.]+$/, "");
    const inTest = /(^|\/)(test|androidTest)(\/|$)/i.test(rel);
    for (const [re, label] of CODE_CLASS_RULES) {
      if (re.test(base)) return inTest ? `测试代码（${label}）` : label;
    }
    if (inTest) return "测试代码";
    return ext === "java" ? "Java 源码" : ext === "kt" ? "Kotlin 源码" : "Kotlin 构建脚本";
  }

  if (lower.endsWith(".xml")) {
    if (!res) return "XML 配置";
    const d = res.dir;
    if (/^layout/.test(d)) return "布局文件";
    if (/^drawable/.test(d)) return "图形 / 矢量资源";
    if (/^mipmap/.test(d)) return "应用图标";
    if (/^values/.test(d)) return "资源值（字符串 / 颜色等）";
    if (/^menu/.test(d)) return "菜单";
    if (/^anim/.test(d)) return "帧动画";
    if (/^animator/.test(d)) return "属性动画";
    if (/^raw/.test(d)) return "原始资源文件";
    if (/^color/.test(d)) return "颜色选择器";
    if (/^font/.test(d)) return "字体资源";
    if (/^navigation/.test(d)) return "导航图";
    if (/^transition/.test(d)) return "场景转场动画";
    if (/^interpolator/.test(d)) return "动画插值器";
    return "资源文件";
  }

  if (EXT_DESC[ext]) return EXT_DESC[ext];
  if (/^\.(gitignore|gitattributes)$/i.test(lower)) return "Git 配置";
  return "";
}

/** 工作目录里的一个顶层项（文件夹=项目）→ ProjectSource */
export async function projectSourceFromWorkspaceItem(item: WsProject): Promise<ProjectSource | null> {
  if (nativeBridge()) {
    // M43：native 的扁平列表里 rel 是「工作目录 → 文件」的完整相对路径，
    // 而 LazyTree 永远拿 rel="" 当项目根。旧实现直接把整个工作目录喂进来，
    // 结果「当前项目」树显示的是跟「项目列表」一样的根目录。现在把 item.rel
    // 剥掉一层：所有 rel 统一映射成「项目内相对路径」再交给 source。
    // M58：不再为打开项目跑 wsListProjects()（全树深扫，30 个项目就是几十秒）。
    // 打开路径 = 0 次扫描：懒加载走 listDir 逐层（M48 已修），读文件走 rootDir+rel（M55），
    // 扁平列表只在「目录读不了」时作最后兜底（传 [] 即关闭兜底，listDir 本身已够用）。
    const base = nativeProjectSource(item.name, [], item.dirPath);
    return base;
  }
  if (item.kind === "dir" && item.handle) return webProjectSource(item.handle, item.name);
  // 单个 xml 文件：把它所在目录当项目根
  return null;
}

/** 新建/恢复的项目目录句柄 → ProjectSource */
export function projectSourceFromDir(dir: unknown, name: string): ProjectSource {
  return webProjectSource(dir, name);
}

/** M46：从 OpenedProject 推导文件操作的后端和根（native=rootPath/dirPath 绝对路径；web=handle 句柄）
 *  拿不到 root 时返回 null（调用方不显示文件操作菜单）。 */
export function fileOpsCtxOf(
  p:
    | { dirPath?: string; rootPath?: string; handle?: unknown; source?: ProjectSource | null }
    | null
    | undefined,
): FileOpsCtx | null {
  if (!p) return null;
  // M46c：dirPath/rootPath 可能缺（新建项目、恢复项目），再从 source.rootPath 垓一层
  const roots = [p.rootPath, p.dirPath, p.source?.rootPath];
  for (const r of roots) {
    if (r && r.startsWith("/")) return { backend: "native", root: r.replace(/\/+$/, "") };
  }
  if (p.handle) return { backend: "web", root: p.handle };
  return null;
}

/* ---------------- 项目名 / 图标 ---------------- */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

export function decodeXmlEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = parseInt(body.slice(2), 16);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    if (body.startsWith("#")) {
      const n = parseInt(body.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    const hit = ENTITIES[body.toLowerCase()];
    return hit ?? m;
  });
}

/** 从 strings.xml 里取 app_name（取不到返回 null） */
export function parseAppName(xml: string): string | null {
  if (!xml) return null;
  const re = /<string\b[^>]*\bname\s*=\s*["']app_name["'][^>]*>([\s\S]*?)<\/string>/i;
  const m = re.exec(xml);
  if (!m) return null;
  const text = decodeXmlEntities(m[1]).replace(/\\'/g, "'").trim();
  return text || null;
}

export interface ProjectMeta {
  /** 展示名：app_name > 文件夹名 */
  name: string;
  /** 应用图标（object URL / data URL），找不到就是 undefined */
  iconUrl?: string;
  /** M48：项目库类型（AndroidX / 老 support / 普通 Android） */
  lib?: LibKind;
}

export type LibKind = "androidx" | "support" | "android";

/** M48：从 gradle 配置判断项目库类型
 *  · gradle.properties 里 android.useAndroidX=true → androidx（最权威）
 *  · 依赖里出现 androidx. → androidx；出现 com.android.support → support
 *  · 都没有 → 当普通 Android 工程 */
export function parseLibKind(
  gradleProps?: string | null,
  appGradle?: string | null,
  rootGradle?: string | null,
): LibKind {
  const props = (gradleProps || "").toLowerCase();
  if (/android\.useandroidx\s*=\s*true/.test(props)) return "androidx";
  const all = `${appGradle || ""}\n${rootGradle || ""}`.toLowerCase();
  if (all.includes("androidx.")) return "androidx";
  if (all.includes("com.android.support")) return "support";
  return "android";
}

const STRINGS_CANDIDATES = [
  "app/src/main/res/values/strings.xml",
  "src/main/res/values/strings.xml",
  "res/values/strings.xml",
  "values/strings.xml",
  "strings.xml",
];

const RES_CANDIDATES = ["app/src/main/res", "src/main/res", "res"];

const metaCache = new WeakMap<object, ProjectMeta>();

/**
 * M31：从 ProjectSource 读展示名 + 图标（APK / 网页 / 测试都能用，不依赖 DirHandle）。
 * 名称：res/values/strings.xml 的 app_name（找不到回退目录名）
 * 图标：res/mipmap*|drawable* 里的 ic_launcher* 图片
 */
export async function readProjectMetaFromSource(
  source: ProjectSource,
  fallbackName: string,
): Promise<ProjectMeta> {
  const meta: ProjectMeta = { name: fallbackName };
  for (const rel of STRINGS_CANDIDATES) {
    const text = await source.readText(rel);
    if (!text) continue;
    const name = parseAppName(text);
    if (name) {
      meta.name = name;
      break;
    }
  }
  try {
    const icon = await source.appIconUrl?.();
    if (icon) meta.iconUrl = icon;
  } catch {
    /* 图标读不到就用占位 */
  }
  return meta;
}

/** M31：桶里的候选图标名，按优先级排好；先试最高优先的几个，失败再试其他 ic_launcher* */
export function iconCandidates(names: string[]): string[] {
  const picks = names.filter((n) => iconRank(n) < 99);
  picks.sort((a, b) => iconRank(a) - iconRank(b) || a.localeCompare(b));
  return picks;
}

/**
 * 分析项目文件拿名称和图标（只读几个候选路径 + 一轮 mipmap 目录，几十次句柄调用，可接受）。
 * 找不到就用文件夹名、不显示图标 —— 不阻塞列表渲染，调用方自行决定什么时候 await。
 */
export async function readProjectMeta(root: unknown, fallbackName: string): Promise<ProjectMeta> {
  const dir = root as DirLike;
  if (!dir || typeof dir.values !== "function") return { name: fallbackName };
  const cached = metaCache.get(dir as object);
  if (cached) return cached;

  const meta: ProjectMeta = { name: fallbackName };

  // 1) app_name
  for (const rel of STRINGS_CANDIDATES) {
    try {
      const parent = rel.includes("/") ? await resolveDir(dir, parentOf(rel)) : dir;
      if (!parent) continue;
      const fh = await parent.getFileHandle(nameOf(rel));
      const text = await (await fh.getFile()).text();
      const name = parseAppName(text);
      if (name) {
        meta.name = name;
        break;
      }
    } catch {
      /* 文件不存在，继续下一个候选 */
    }
  }

  // 1.5) M48：库类型（AndroidX / support / android）—— 只读 gradle 配置，最坏 3 次读写
  try {
    const readRoot = async (rel: string): Promise<string | null> => {
      try {
        const parent = rel.includes("/") ? await resolveDir(dir, parentOf(rel)) : dir;
        if (!parent) return null;
        const fh = await parent.getFileHandle(nameOf(rel));
        return await (await fh.getFile()).text();
      } catch {
        return null;
      }
    };
    const props = await readRoot("gradle.properties");
    let appGradle: string | null = null;
    if (!/android\.useandroidx\s*=\s*true/i.test(props || "")) {
      appGradle = (await readRoot("app/build.gradle.kts")) || (await readRoot("app/build.gradle"));
    }
    meta.lib = parseLibKind(props, appGradle, null);
  } catch {
    /* 读不到就当普通 Android 工程 */
  }

  // 2) 图标：res/mipmap-* 里的 ic_launcher*，其次 res/drawable-*
  for (const resRel of RES_CANDIDATES) {
    const res = await resolveDir(dir, resRel).catch(() => null);
    if (!res) continue;
    const buckets: DirLike[] = [];
    try {
      for await (const e of res.values()) {
        if (e.kind !== "directory") continue;
        const l = e.name.toLowerCase();
        if (l.startsWith("mipmap")) buckets.push(e);
        else if (l.startsWith("drawable")) buckets.push(e);
      }
    } catch {
      /* ignore */
    }
    // mipmap 排前面
    buckets.sort((a, b) => (a.name.startsWith("mipmap") ? -1 : 1) - (b.name.startsWith("mipmap") ? -1 : 1));
    for (const b of buckets) {
      // M31：不再写死文件名，把桶里所有文件名扫一遍再挑（ic_launcher_xx 也能命中）
      const names: string[] = [];
      try {
        for await (const e of b.values()) {
          if (e.kind === "file") names.push(e.name);
        }
      } catch {
        continue;
      }
      for (const iconName of iconCandidates(names)) {
        try {
          const fh = await b.getFileHandle(iconName);
          const file = await fh.getFile();
          // 非浏览器环境（vitest node）没有 createObjectURL，只拿名字不拿图标
          if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
            meta.iconUrl = URL.createObjectURL(file);
          }
          metaCache.set(dir as object, meta);
          return meta;
        } catch {
          /* 换下一个 */
        }
      }
    }
    if (meta.name !== fallbackName) break;
  }

  metaCache.set(dir as object, meta);
  return meta;
}

/* ---------------- 找主布局 ---------------- */

const MAIN_CANDIDATES = [
  "app/src/main/res/layout/activity_main.xml",
  "src/main/res/layout/activity_main.xml",
  "res/layout/activity_main.xml",
  "layout/activity_main.xml",
  "activity_main.xml",
  "app/src/main/res/layout/main.xml",
  "res/layout/main.xml",
  "main.xml",
];

function mainRank(name: string): number {
  const base = name.toLowerCase();
  if (base === "activity_main.xml") return 0;
  if (base === "main.xml") return 1;
  if (base.includes("main")) return 2;
  return 3;
}

/**
 * 在项目里找「最像主布局」的 xml。
 * 先试常见路径（几乎零成本），再浅层 BFS（深度 3、最多 80 个目录）兜底。
 */
export async function findMainLayout(source: ProjectSource): Promise<BrowseEntry | null> {
  for (const rel of MAIN_CANDIDATES) {
    const text = await source.readText(rel);
    if (text !== null) return { kind: "file", name: nameOf(rel), rel };
  }

  const queue: { rel: string; depth: number }[] = [{ rel: "", depth: 0 }];
  const found: BrowseEntry[] = [];
  let budget = 80;
  while (queue.length && budget > 0) {
    const cur = queue.shift() as { rel: string; depth: number };
    budget--;
    const kids = await source.listChildren(cur.rel);
    for (const k of kids) {
      if (k.kind === "dir") {
        if (cur.depth < 3) queue.push({ rel: k.rel, depth: cur.depth + 1 });
      } else if (mainRank(k.name) < 3) {
        found.push(k);
      }
    }
    if (found.some((f) => mainRank(f.name) === 0)) break;
  }
  if (!found.length) return null;
  found.sort((a, b) => mainRank(a.name) - mainRank(b.name) || a.rel.localeCompare(b.rel));
  return found[0];
}
