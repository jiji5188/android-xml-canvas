// lib/xml/res-refs.ts — M65（C1/C3）：资源引用 → 定义位置
//
// 属性面板里看到 `@string/app_name`，以前只能自己翻 values/strings.xml 找。
// 这里只做「纯计算」：解析引用、算出该去哪些目录找、在文本里定位第几行。
// 真正的读文件交给 res-index.ts（可以从浏览器目录句柄读，也可以从原生桥读）。

export type ResType =
  | "string"
  | "color"
  | "dimen"
  | "style"
  | "integer"
  | "bool"
  | "fraction"
  | "layout"
  | "drawable"
  | "mipmap"
  | "menu"
  | "anim"
  | "animator"
  | "xml"
  | "raw"
  | "font";

export interface ResRef {
  /** 资源类型（@string/x → "string"） */
  type: ResType;
  /** 资源名（不带 @type/ 前缀） */
  name: string;
  /** 原样值，用于回显 */
  raw: string;
}

/** 常见类型 → 目录前缀（values 类都在 values*，其余按目录名） */
const DIR_PREFIX: Record<ResType, string> = {
  string: "values",
  color: "values",
  dimen: "values",
  style: "values",
  integer: "values",
  bool: "values",
  fraction: "values",
  layout: "layout",
  drawable: "drawable",
  mipmap: "mipmap",
  menu: "menu",
  anim: "anim",
  animator: "animator",
  xml: "xml",
  raw: "raw",
  font: "font",
};

/** values 里能出现该类型的标签名（string-array 之类也能命中） */
const VALUE_TAGS: Partial<Record<ResType, string[]>> = {
  string: ["string", "string-array"],
  color: ["color", "color-state-list"],
  dimen: ["dimen"],
  style: ["style"],
  integer: ["integer", "integer-array"],
  bool: ["bool"],
  fraction: ["fraction", "item"],
};

/**
 * 解析属性值里的资源引用。
 * 解析不了（`@+id/x`、`@android:string/ok`、`?attr/x`、普通文本、空串）返回 null，
 * 这些要么是框架资源、要么是新建 id，没有「定义行」可跳。
 */
export function parseResRef(value: string): ResRef | null {
  const raw = (value || "").trim();
  if (!raw.startsWith("@")) return null;
  if (raw.startsWith("@+") || raw.startsWith("@*") || raw.startsWith("@android:")) return null;
  const m = /^@([a-zA-Z][a-zA-Z0-9_-]*)\/([A-Za-z0-9_.]+)$/.exec(raw);
  if (!m) return null;
  const type = m[1] as ResType;
  if (!(type in DIR_PREFIX)) return null;
  return { type, name: m[2], raw };
}

/** 该引用要扫的 res 子目录前缀（layout-v21 这类限定符都要命中） */
export function resDirPrefix(type: ResType): string {
  return DIR_PREFIX[type];
}

/** 目录名是否匹配某类型（`layout-land` 也匹配 layout） */
export function dirMatchesType(dirName: string, type: ResType): boolean {
  const pre = resDirPrefix(type);
  return dirName === pre || dirName.startsWith(pre + "-");
}

/** values 类资源：true 表示去 values* 目录里按 `<tag name="x">` 找 */
export function isValuesType(type: ResType): boolean {
  return resDirPrefix(type) === "values";
}

/**
 * 在 values 文件里找定义的**行号**（1 起）。
 * 找不到返回 0 —— 调用方据此判断「这个文件不包含它」。
 */
export function findValuesDefLine(text: string, type: ResType, name: string): number {
  const tags = VALUE_TAGS[type] ?? [type];
  const lines = text.split("\n");
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 同一行可能写多个标签，用宽松匹配即可（只要出现 <tag ... name="x"）
    for (const tag of tags) {
      const re = new RegExp(`<${tag}\\b[^>]*\\bname\\s*=\\s*"${escaped}"`);
      if (re.test(line)) return i + 1;
    }
  }
  return 0;
}

/** 媒体文件（drawable/mipmap）→ 该文件本身就是定义，行号固定 1 */
export function fileDefLine(type: ResType): number {
  return isValuesType(type) ? 0 : 1;
}

/** 给用户看的一行描述，如「@string/app_name → values/strings.xml:12」 */
export function formatResRefHit(ref: ResRef, rel: string, line: number): string {
  return `${ref.raw} → ${rel}${line > 1 ? ":" + line : ""}`;
}
