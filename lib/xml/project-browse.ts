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
import { wsListProjects, type WsProject } from "./workspace";

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
          } else if (/\.xml$/i.test(e.name)) {
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

/** native：APK 里 bridge 一次给出扁平（带 rel）列表，这里按前缀过滤出一层 */
export function nativeProjectSource(name: string, all: WsProject[]): ProjectSource {
  return {
    name,
    async listChildren(rel: string) {
      const prefix = rel ? `${rel}/` : "";
      const out: BrowseEntry[] = [];
      for (const it of all) {
        if (it.rel === rel) continue;
        if (!it.rel.startsWith(prefix)) continue;
        const rest = it.rel.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        out.push({ kind: it.kind, name: it.name, rel: it.rel, target: it.target });
      }
      return [...sortEntries(out.filter((e) => e.kind === "dir")), ...sortEntries(out.filter((e) => e.kind === "file"))];
    },
    async readText(rel: string) {
      const hit = all.find((it) => it.rel === rel && it.kind === "file");
      const target = hit?.target;
      if (!target) return null;
      const b = nativeBridge();
      try {
        return b?.readText ? b.readText(target) || null : null;
      } catch {
        return null;
      }
    },
    /** M31：从扁平列表里找 ic_launcher* 图片，走 bridge.readBase64 读字节 → data URL */
    async appIconUrl() {
      const b = nativeBridge();
      if (!b?.readBase64) return null;
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
          const b64 = b.readBase64(c.target as string);
          if (b64) return `data:${mimeOfIcon(c.name)};base64,${b64}`;
        } catch {
          /* 换下一个 */
        }
      }
      return null;
    },
  };
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

  // 1) 名称
  for (const rel of NATIVE_STRINGS_RELS) {
    try {
      const text = b.readText ? b.readText(abs(rel)) : null;
      const appName = text ? parseAppName(text) : null;
      if (appName) {
        fallback.name = appName;
        break;
      }
    } catch {
      /* 下一个 */
    }
  }

  // 2) 图标
  if (b.readBase64) {
    outer: for (const dir of NATIVE_ICON_DIRS) {
      for (const icon of NATIVE_ICON_NAMES) {
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

  nativeMetaCache.set(dirPath, fallback);
  return fallback;
}

/** native 扁平 rel 里的图标文件：.../res/mipmap-xxxhdpi/ic_launcher.png 这类图片 */
const ICON_REL_RE = /(^|\/)res\/(mipmap|drawable)(-[^\/]*)?\/[^\/]+\.(png|webp|jpe?g)$/i;

/** 工作目录里的一个顶层项（文件夹=项目）→ ProjectSource */
export async function projectSourceFromWorkspaceItem(item: WsProject): Promise<ProjectSource | null> {
  if (nativeBridge()) {
    const all = await wsListProjects();
    return nativeProjectSource(item.name, all);
  }
  if (item.kind === "dir" && item.handle) return webProjectSource(item.handle, item.name);
  // 单个 xml 文件：把它所在目录当项目根
  return null;
}

/** 新建/恢复的项目目录句柄 → ProjectSource */
export function projectSourceFromDir(dir: unknown, name: string): ProjectSource {
  return webProjectSource(dir, name);
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
  /** 应用图标（object URL），找不到就是 undefined */
  iconUrl?: string;
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
