// lib/xml/resname.ts — M4f：Android 资源命名规则（drawable 等）
//
// 为什么要单独一处：属性值既可能是颜色（#00C853）、也可能是资源引用（@drawable/bg_card）、
// 还可能是 @color/xxx 之类的主题引用。只有「合法资源名」才能当文件名落盘生成 xml，
// 否则会得到一个 res/drawable/#00c853.xml —— aapt 直接编译失败，画布也解析不出来。
//
// Android 规则（aapt2）：
//   - 只能包含 a-z、0-9、_（不能有大写、-#. / 空格等）
//   - 不能以数字开头
//   参考：https://developer.android.com/guide/topics/resources/providing-resources

/** 是否是可以直接当文件名用的资源名（a-z0-9_，且不以数字开头） */
export function isValidResName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

/**
 * 输入框在敲字时的清洗（跟提交时的 sanitizeResName 不同）：
 * 保留结尾的 _（否则永远敲不出 bg_round：敲完 bg_ 就被 trim 掉了），
 * 非法字符 → _，连续 _ 压成一个，全程小写，不截断 40 之后的输入。
 */
export function cleanResNameInput(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_");
}

/** 宽松判断：属性值是否整个就是「合法的 @drawable/名字」引用（带不带 .xml 都行） */
export function isDrawableRef(v: string): boolean {
  const m = /^@(?:drawable|mipmap)\/([A-Za-z0-9_]+)(?:\.xml)?$/.exec(v.trim());
  return !!m && isValidResName(m[1].toLowerCase());
}

/** 从 @drawable/xxx 里取资源名；不是（或非法）引用时返回 "" —— 颜色值绝不会被当成名字 */
export function resNameFromValue(v: string): string {
  const m = /^@(?:drawable|mipmap)\/([A-Za-z0-9_]+?)(?:\.xml)?$/.exec(v.trim());
  if (!m) return "";
  return sanitizeResName(m[1]);
}

/** 把任意字符串压成合法资源名：小写、非法字符变 _、数字开头补前缀、去首尾 _、最长 40 */
export function sanitizeResName(raw: string, fallback = "bg"): string {
  let n = (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!n) return fallback;
  if (/^[0-9]/.test(n)) n = `${fallback}_${n}`; // 数字开头不合法，补前缀
  return n.slice(0, 40);
}

/**
 * M158：按 drawable 根类型给资源名加类型前缀（用户要求：保存时体现资源类型）。
 *   selector   → bg_select_
 *   layer-list → bg_layer_
 *   ripple     → bg_ripple_
 *   inset      → bg_inset_
 *   vector     → ic_
 *   其它 shape → bg_
 */
export function resNamePrefix(tag: string): string {
  switch ((tag || "").toLowerCase()) {
    case "selector":
      return "bg_select_";
    case "layer-list":
      return "bg_layer_";
    case "ripple":
      return "bg_ripple_";
    case "inset":
      return "bg_inset_";
    case "vector":
      return "ic_";
    default:
      return "bg_";
  }
}

/** 新建资源时的默认名（保留类型前缀，用户可直接改后面那段） */
export function defaultResName(tag: string): string {
  const p = resNamePrefix(tag);
  return p ? `${p}new` : "bg_new";
}

/**
 * M158：保存前补类型前缀。
 * - 已经带同类前缀（bg_select_ / bg_layer_ / bg_ / ic_ …）→ 原样保留，不重复叠加；
 * - 用户自定义名（login_btn）→ 补成 bg_select_login_btn / ic_login_btn；
 * - 空名 → ""（调用方按错误处理，不要瞎造资源）。
 */
export function applyResNamePrefix(name: string, tag: string): string {
  const n = (name || "").trim();
  if (!n) return "";
  const p = resNamePrefix(tag);
  if (!p) return n;
  if (n.startsWith(p)) return n;
  // 同族前缀（用户自己写了 bg_xxx / ic_xxx）就尊重原意，只补「类型」这一层
  if (/^(bg|ic)_/.test(n)) {
    if (p === "bg_" || p === "ic_") return n;
    return p + n.replace(/^(bg|ic)_/, "");
  }
  return p + n;
}

/** 属性值是不是颜色（#RGB / #ARGB / #RRGGBB / #AARRGGBB，也接受 0x 前缀） */
export function isColorValue(v: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim());
}
