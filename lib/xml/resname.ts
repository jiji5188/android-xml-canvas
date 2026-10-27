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

/** 属性值是不是颜色（#RGB / #ARGB / #RRGGBB / #AARRGGBB，也接受 0x 前缀） */
export function isColorValue(v: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v.trim());
}
