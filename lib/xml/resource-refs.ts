// lib/xml/resource-refs.ts — M278/P2：打包前预检查「代码用到的 R.xxx 资源在 res/ 里是否存在」
//
// 只做「读」：扫 Java 源码里 `R.(type).name` 的引用，跟 res/ 文件名/values 资源名比对，
// 缺的列出来提前告警（不阻断打包，因为资源可能来自 aar/内置插件）。

/** 从 res/ 文件路径 + values/*.xml 内容，建一张 {resType → Set<name>} 表 */
export function buildResNameIndex(
  resFileNames: string[], // 形如 "drawable/foo.png" / "values/strings.xml" / "layout/main.xml"
  valuesXmlTexts?: Record<string, string>, // rel → values xml 文本（解析 string/color/dimen/style/...）
): Map<string, Set<string>> {
  const idx = new Map<string, Set<string>>();
  const add = (t: string, n: string) => {
    let s = idx.get(t);
    if (!s) { s = new Set(); idx.set(t, s); }
    s.add(n);
  };
  for (const p of resFileNames) {
    const norm = p.replace(/\\/g, "/");
    const m = norm.match(/^([a-z]+)(-[^/]+)?\/([^/]+)\./i);
    if (m) {
      const dir = m[1];
      const base = m[3];
      const t = dirResType(dir);
      if (t) add(t, base);
    }
  }
  // values xml：解析 <string name> / <color name> / <dimen name> / <style name> / <string-array name>
  if (valuesXmlTexts) {
    for (const [rel, text] of Object.entries(valuesXmlTexts)) {
      const base = rel.replace(/^.*\//, "").replace(/\.xml$/, "");
      // 跳过 strings/ids/colors 等子集里的，name 才是资源名
      const re = /<(string|color|dimen|style|string-array|integer-array|bool|integer|fraction|declare-styleable)\s+[^>]*name\s*=\s*"([^"]+)"/g;
      let mm;
      while ((mm = re.exec(text)) !== null) {
        const tag = mm[1];
        add(tag, mm[2]);
      }
    }
  }
  return idx;
}

function dirResType(dir: string): string | null {
  const d = dir.toLowerCase();
  // drawable / drawable-xxx / mipmap / layout / raw / anim
  if (/^drawable/.test(d)) return "drawable";
  if (/^mipmap/.test(d)) return "mipmap";
  if (/^layout/.test(d)) return "layout";
  if (/^raw/.test(d)) return "raw";
  if (/^anim/.test(d)) return "anim";
  return null;
}

/** 扫一段 Java 源码里所有 R.<type>.<name> 引用，返回 {type, name} 列表 */
export function collectResourceRefs(code: string): { type: string; name: string }[] {
  const out: { type: string; name: string }[] = [];
  const re = /\bR\.\s*([a-zA-Z][\w]*)\s*\.\s*([a-zA-Z_$][\w$]*)/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    const t = m[1];
    const n = m[2];
    // 过滤掉明显不是资源类型（R 类自身方法/字段）
    if (["class", "string", "int"].includes(t)) continue;
    out.push({ type: t, name: n });
  }
  return out;
}

/** 扫 Java 源码里的第三方 import（jxl / com.google / org.apache 等，非 android/androidx/java 开头） */
export function collectExternalImports(codes: string[]): string[] {
  const set = new Set<string>();
  const re = /\bimport\s+(?:static\s+)?([a-z][\w.]*)/g;
  for (const c of codes) {
    let m;
    while ((m = re.exec(c)) !== null) {
      const full = m[1]; // 形如 jxl.Workbook / com.google.gson.Gson / android.os.Bundle
      const segs = full.split(".");
      // 顶层：jxl → "jxl"；com.google → "com.google"；android/androidx/java/javax/kotlin 过滤
      const top = segs[0];
      if (/^(android|androidx|java|javax|kotlin)$/.test(top)) continue;
      const pkg = top.match(/^(com|org|io|net|io)$/i) ? segs.slice(0, 2).join(".") : top;
      set.add(pkg);
    }
  }
  return [...set];
}

/** 预检查：第三方 import 的顶层包，是否能在 libs 的 jar/aar 名字里对上（粗匹配） */
export function missingLibPackages(imports: string[], libPaths: string[]): string[] {
  const libText = libPaths.join(" ").toLowerCase();
  const out: string[] = [];
  for (const imp of imports) {
    // 取前两段匹配（com.google → 看 libs 里有没有含 google 的）
    const segs = imp.split(".").slice(0, 2).join("_");
    const key = imp.split(".").slice(0, 2).join(".");
    // 常见映射：jxl→jxl, com.google→google, org.apache→apache
    const aliases: Record<string, string> = {
      "com.google": "google", "org.apache": "apache", "org.json": "json", "com.squareup": "squareup", "com.fasterxml": "jackson", "com.ibm": "icu4j", "jxl": "jxl", "org.jsoup": "jsoup",
    };
    const token = aliases[key] || key.split(".").pop() || key;
    if (!libText.includes(token)) out.push(imp);
  }
  return out;
}
export function missingResourceRefs(
  codes: string[], // 各 java 文件文本
  idx: Map<string, Set<string>>,
): { type: string; name: string; files: number }[] {
  const fileSeen = new Map<string, Set<number>>(); // key = type/name → 在哪些文件索引里引用过
  codes.forEach((c, i) => {
    for (const r of collectResourceRefs(c)) {
      const key = r.type + "/" + r.name;
      let s = fileSeen.get(key);
      if (!s) { s = new Set(); fileSeen.set(key, s); }
      s.add(i);
    }
  });
  const missing: { type: string; name: string; files: number }[] = [];
  for (const [key, s] of fileSeen.entries()) {
    const slash = key.indexOf("/");
    const t = key.slice(0, slash);
    const n = key.slice(slash + 1);
    const set = idx.get(t);
    if (set && set.has(n)) continue; // res/ 里存在
    missing.push({ type: t, name: n, files: s.size });
  }
  missing.sort((a, b) => b.files - a.files);
  return missing;
}
