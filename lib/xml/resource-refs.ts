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
  // M284：另外收两种 id 声明：`<item type="id" name>` 和 布局里的 `@+id/name`
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
      // M284：`<item type="id" name="x" />` 也是合法 id 声明（属性顺序不固定）
      const itemRe = /<item\b([^>]*)>/g;
      let im: RegExpExecArray | null;
      while ((im = itemRe.exec(text)) !== null) {
        const attrs = im[1];
        if (!/\btype\s*=\s*"id"/.test(attrs)) continue;
        const nm = attrs.match(/\bname\s*=\s*"([^"]+)"/);
        if (nm) add("id", nm[1]);
      }
      // M284：布局文件里的 @+id/x 也算声明（调用方把 layout 文本也传进来时生效）
      const plusIdRe = /@\+id\/([A-Za-z0-9_]+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = plusIdRe.exec(text)) !== null) add("id", pm[1]);
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

/** 扫 Java 源码里的第三方 import（jxl / com.google / org.apache 等，非 android/androidx/java 开头）
 * @param ownPackages 项目自己的包前缀（如 ["com.momo", "com.jiji.axv"]），这些不算外部依赖 */
export function collectExternalImports(codes: string[], ownPackages: string[] = []): string[] {
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
      // org.json / org.w3c 是 Android 框架自带（android.jar 里有），不需第三方 jar
      if (full.startsWith("org.json.") || full.startsWith("org.w3c.")) continue;
      const pkg = top.match(/^(com|org|io|net|io)$/i) ? segs.slice(0, 2).join(".") : top;
      // 项目自己的包（import com.momo.xxx.R / com.momo.xxx.YourClass）不算外部依赖
      if (ownPackages.some((o) => pkg === o || pkg.startsWith(o + ".") || full.startsWith(o + "."))) continue;
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

/** M284：为「代码引用但 res 里没有」的资源生成占位，让 ECJ/D8 能过。
 *  目的不是假装功能正常，而是把「编不过」变成「编得过 + 明确告诉你哪些是占位」。
 *  - 先扫 payload 里所有 xml 的 `@+id/x`，已声明的 id 不再补（否则 aapt2 报重复定义）
 *  - id/string/dimen/color/bool/integer/fraction/style → values 占位
 *  - drawable/mipmap → 透明 shape；layout → 空 FrameLayout；menu/anim/animator/xml/raw → 最小骨架
 *  返回新的 files（不修改入参）+ 实际补了哪些 key。 */
export function stubMissingRefs(
  files: { path: string; text: string; base64?: string }[],
  missing: { type: string; name: string }[],
): { files: { path: string; text: string; base64?: string }[]; stubbed: string[]; skipped: string[] } {
  type StubFile = { path: string; text: string; base64?: string };
  const out: StubFile[] = files.map((f) => ({ path: f.path, text: f.text, ...(f.base64 ? { base64: f.base64 } : {}) }));
  const have = new Set(out.map((f) => f.path));

  // 布局/菜单里用 @+id/ 声明过的 id 已在 res 中，不能再补 <item type="id">
  const declaredIds = new Set<string>();
  for (const f of out) {
    if (!f.text) continue;
    const re = /@\+id\/([A-Za-z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.text)) !== null) declaredIds.add(m[1]);
  }

  const values: string[] = [];
  const stubbed: string[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  const addVal = (key: string, line: string) => {
    if (seen.has(key)) return;
    seen.add(key);
    values.push("    " + line);
    stubbed.push(key);
  };

  for (const r of missing) {
    const key = r.type + "/" + r.name;
    const name = r.name;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue; // R 里根本不可能有这种名字

    if (r.type === "id") {
      if (declaredIds.has(name)) { skipped.push(key); continue; }
      addVal(key, `<item type="id" name="${name}" />`);
      continue;
    }
    if (r.type === "string") { addVal(key, `<string name="${name}" />`); continue; }
    if (r.type === "color") { addVal(key, `<color name="${name}">#00000000</color>`); continue; }
    if (r.type === "dimen") { addVal(key, `<dimen name="${name}">0dp</dimen>`); continue; }
    if (r.type === "bool") { addVal(key, `<bool name="${name}">false</bool>`); continue; }
    if (r.type === "integer") { addVal(key, `<integer name="${name}">0</integer>`); continue; }
    if (r.type === "fraction") { addVal(key, `<fraction name="${name}">50%</fraction>`); continue; }
    if (r.type === "style") { addVal(key, `<style name="${name}" parent="" />`); continue; }
    if (r.type === "plurals") { addVal(key, `<plurals name="${name}"><item quantity="other">%s</item></plurals>`); continue; }
    if (r.type.endsWith("array")) { addVal(key, `<${r.type} name="${name}" />`); continue; }

    if (r.type === "drawable" || r.type === "mipmap") {
      const p = `drawable/${name}.xml`;
      if (have.has(p)) { skipped.push(key); continue; }
      have.add(p);
      out.push({
        path: p,
        text: `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android">\n    <solid android:color="#00000000" />\n</shape>\n`,
      });
      stubbed.push(key);
      continue;
    }
    if (r.type === "layout") {
      const p = `layout/${name}.xml`;
      if (have.has(p)) { skipped.push(key); continue; }
      have.add(p);
      out.push({
        path: p,
        text: `<?xml version="1.0" encoding="utf-8"?>\n<!--axv-stub-->\n<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent" android:layout_height="match_parent" />\n`,
      });
      stubbed.push(key);
      continue;
    }
    if (r.type === "menu" || r.type === "anim" || r.type === "animator" || r.type === "xml") {
      const p = `${r.type}/${name}.xml`;
      if (have.has(p)) { skipped.push(key); continue; }
      have.add(p);
      const root = r.type === "menu" ? "menu" : r.type === "xml" ? "x" : "set";
      out.push({ path: p, text: `<?xml version="1.0" encoding="utf-8"?>\n<${root} xmlns:android="http://schemas.android.com/apk/res/android" />\n` });
      stubbed.push(key);
      continue;
    }
    if (r.type === "raw") {
      const p = `raw/${name}.txt`;
      if (have.has(p)) { skipped.push(key); continue; }
      have.add(p);
      out.push({ path: p, text: "placeholder" });
      stubbed.push(key);
      continue;
    }
    skipped.push(key);
  }

  if (values.length) {
    const p = "values/axv_stub_ids.xml";
    const existing = out.find((f) => f.path === p);
    const body = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${values.join("\n")}\n</resources>\n`;
    if (existing) existing.text = (existing.text || "") + "\n" + values.join("\n");
    else if (!have.has(p)) out.push({ path: p, text: body });
  }
  return { files: out, stubbed, skipped };
}
