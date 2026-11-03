// lib/xml/ref-token.ts —— M101：光标下的「资源引用」识别（Ctrl+点击跳转的地基）
//
// 背景：引用分析（findUsages）和「跳定义」（openResRef）早就有了，但都得先选中/点面板，
// 看代码时想从 `@string/app_name` 直接跳过去只能手动翻。这里做纯计算的一层：
// 给定「整篇文本 + 光标偏移」，认出光标底下是哪个资源引用，以及它是哪一种写法。
//
// 只做识别，不读文件、不碰 DOM → 可以在 node 里直接单测。
// 支持四种写法：
//   @string/app_name          普通引用（定义在 values/strings.xml）
//   @+id/btn  /  @id/btn      布局里的 id（定义就在布局，跳转应该走「查引用」）
//   @android:string/ok        框架资源（没有可跳的定义，明确告诉调用方）
//   R.string.app_name         代码里的引用（Java / Kotlin）

export type RefTokenForm =
  /** XML 里的 @type/name（含可选包名前缀） */
  | "xml-ref"
  /** XML 里的 @+id/x / @id/x */
  | "xml-id"
  /** 框架内置 @android:type/name */
  | "xml-framework"
  /** 代码里的 R.type.name */
  | "code-ref";

export interface RefToken {
  /** 原样文本，如 `@string/app_name` */
  raw: string;
  /** 资源类型，如 string / drawable / id */
  type: string;
  /** 资源名 */
  name: string;
  /** 写法归类 */
  form: RefTokenForm;
  /** 是否带包名前缀（@com.lib:string/x、@android:string/x） */
  packageName?: string;
  /** 在整篇文本里的起止偏移（end 不含） */
  start: number;
  end: number;
}

/** 名字段允许的字符（不含 / 与 @，避免把 xml 标签卷进来） */
const NAME = "[A-Za-z_][A-Za-z0-9_]*";
/** 类型段：string / string-array? 资源类型都是小写+下划线 */
const TYPE = "[a-z][a-z0-9_]*";

/**
 * 从整篇文本里扫出所有资源引用（按出现顺序）。
 * 用于「全文高亮」「删除前统计」这类批量场景；单点跳转用 tokenAt 更省。
 */
export function scanRefTokens(text: string): RefToken[] {
  const out: RefToken[] = [];
  const push = (t: RefToken) => {
    // 同一位置只保留第一个（@string/x 不会被当作 id 再收一次）
    if (out.some((o) => o.start === t.start)) return;
    out.push(t);
  };

  // ① @[+*]?[包名:]type/name
  const xmlRe = new RegExp(
    `@(\\+)?(?:([A-Za-z0-9_.]+):)?(${TYPE})\\/(${NAME})`,
    "g",
  );
  for (const m of text.matchAll(xmlRe)) {
    const start = m.index ?? 0;
    const plus = !!m[1];
    const pkg = m[2];
    const type = m[3];
    const name = m[4];
    const form: RefTokenForm = pkg === "android"
      ? "xml-framework"
      : type === "id" || plus
        ? "xml-id"
        : "xml-ref";
    push({
      raw: m[0],
      type,
      name,
      form,
      packageName: pkg,
      start,
      end: start + m[0].length,
    });
  }

  // ② R.type.name（Java / Kotlin；R 前后不能紧跟标识符字符）
  const codeRe = new RegExp(`\\bR\\.(${TYPE})\\.(${NAME})\\b`, "g");
  for (const m of text.matchAll(codeRe)) {
    const start = m.index ?? 0;
    push({
      raw: m[0],
      type: m[1],
      name: m[2],
      form: "code-ref",
      start,
      end: start + m[0].length,
    });
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * 光标（偏移）落在哪个资源引用上；返回 null 表示这里不是引用。
 * 判定用「包含偏移」，且允许光标停在最后一个字符之后（编辑器里很常见）。
 */
export function tokenAt(text: string, offset: number): RefToken | null {
  if (offset < 0 || offset > text.length) return null;
  // 只扫附近窗口，避免整篇 4000 行重扫
  const from = Math.max(0, offset - 120);
  const to = Math.min(text.length, offset + 120);
  const windowText = text.slice(from, to);
  const local = offset - from;
  for (const t of scanRefTokens(windowText)) {
    if (local >= t.start && local <= t.end) {
      return { ...t, start: t.start + from, end: t.end + from };
    }
  }
  return null;
}

/** 解析单个 token 文本（给 Ctrl+点击 回传的值用） */
export function parseRefToken(raw: string): RefToken | null {
  const list = scanRefTokens(raw);
  // 只认“整串命中”（避免把一段包含引用的句子当成 token）
  const t = list[0];
  if (!t) return null;
  if (raw.trim() !== t.raw.trim() && raw.trim().length !== t.raw.length) {
    // 允许前后空白，但内部不能多了字符
    if (raw.trim().replace(/^\s+|\s+$/g, "") !== t.raw) return null;
  }
  return { ...t, start: 0, end: raw.length };
}

/** 统一成 `type/name` 键（查引用 / 去重都用它） */
export function refKey(t: Pick<RefToken, "type" | "name">): string {
  return `${t.type}/${t.name}`;
}

/** 跳转决策：调用方据此选「跳定义」还是「查引用」还是「不用跳」 */
export type RefAction =
  /** 有定义可跳（@string/x、@drawable/x、R.string.x …） */
  | { kind: "definition"; type: string; name: string; refValue: string }
  /** id 没有独立定义文件，跳转应改为「查引用」 */
  | { kind: "usages"; type: string; name: string; refValue: string }
  /** 框架资源 / 无法处理 */
  | { kind: "none"; reason: "framework" | "unknown" };

export function refAction(t: RefToken): RefAction {
  if (t.form === "xml-framework") return { kind: "none", reason: "framework" };
  if (t.form === "xml-id" || t.type === "id") {
    return { kind: "usages", type: t.type, name: t.name, refValue: `@id/${t.name}` };
  }
  return {
    kind: "definition",
    type: t.type,
    name: t.name,
    refValue: `@${t.type}/${t.name}`,
  };
}
