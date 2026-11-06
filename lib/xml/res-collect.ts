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
  /@(?!\+)(?!\*?android:)(drawable|mipmap|layout|color|string|dimen|bool|integer|style|plurals|array|string-array|integer-array|fraction|menu|anim|animator|xml|font|interpolator|id)\/([A-Za-z0-9_.]+)/g;

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

export function refsIn(text: string): { type: string; name: string }[] {
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
      const attrRe = /<attr\b[^>]*?\bname="([^"]+)"/g;
      while ((m = attrRe.exec(f.text || "")) !== null) defs.add(`attr/${m[1]}`);
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
  /** M159：找不到、已用占位实现顶上的资源（能编译，但看不到原图） */
  stubbed?: string[];
}

/* M159：res_values.xml 是「上传/合并的 values」的落地文件；现在项目自己的 values/*.xml
 * 也会一起带去真机，同名资源会被 aapt2 判 duplicate。这里按「项目优先」去重，
 * 只保留项目里没有的定义；全被覆盖就整份文件丢掉。 */
const VALUE_ELEM_RE =
  /<(string|color|dimen|style|integer|bool|fraction|plurals|array|string-array|integer-array)\b[^>]*(?:\/>|>[\s\S]*?<\/\1>)/g;

function definedValueKeys(xml: string): Set<string> {
  const out = new Set<string>();
  const re = new RegExp(VALUE_ELEM_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const head = m[0].slice(0, m[0].indexOf(">") + 1);
    const name = (head.match(/\bname\s*=\s*"([^"]+)"/) || [])[1];
    if (name) out.add(`${m[1]}/${name}`);
  }
  return out;
}

export function dedupeValuesFiles(files: RenderFile[], projectDefs?: Set<string>): RenderFile[] {
  const mergedPath = "values/res_values.xml";
  const merged = files.find((f) => f.path === mergedPath);
  if (!merged || !merged.text) return files;
  const defineNonMerged = new Set<string>(projectDefs ?? []);
  for (const f of files) {
    if (f === merged || !/^values(\/|$)/.test(f.path) || !/\.xml$/i.test(f.path) || !f.text) continue;
    for (const k of definedValueKeys(f.text)) defineNonMerged.add(k);
  }
  if (defineNonMerged.size === 0) return files;

  const re = new RegExp(VALUE_ELEM_RE.source, "g");
  const kept: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(merged.text)) !== null) {
    const head = m[0].slice(0, m[0].indexOf(">") + 1);
    const name = (head.match(/\bname\s*=\s*"([^"]+)"/) || [])[1];
    if (!name) continue;
    if (defineNonMerged.has(`${m[1]}/${name}`)) continue;
    kept.push(`    ${m[0].trim()}`);
  }
  if (kept.length === 0) {
    return files.filter((f) => f !== merged);
  }
  const text = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${kept.join("\n")}\n</resources>\n`;
  return files.map((f) => (f === merged ? { ...f, text } : f));
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

  // 空文本 / 无内容的条目不能算“资源已存在”：它们出现在上传缓存里但实际没内容，
  // 会让后续查找和占位全部跳过，最后 aapt2 报 xxx not found
  const alive = (f: RenderFile) =>
    Boolean((f.text && f.text.trim()) || (f as { base64?: string }).base64);
  if (files.some((f) => !alive(f))) {
    for (let i = files.length - 1; i >= 0; i--) if (!alive(files[i])) files.splice(i, 1);
  }

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

  const addFile = (path: string, text: string, base64?: string) => {
    if ((!text && !base64) || have.has(path) || added >= budget) return false;
    have.add(path);
    files.push(base64 ? { path, text: "", base64 } : { path, text });
    added++;
    return true;
  };

  /** M159：项目自己的 values/*.xml 先全带上（true render 依赖样式/主题/颜色），
   *  同时记下它们定义了哪些资源 —— 合并来的 values/res_values.xml 要按它们去重。 */
  const projectValueDefs = new Set<string>();
  for (const dir of dirs.filter((d) => /^values/.test(d))) {
    let items: { name: string; kind: "file" | "dir" }[] = [];
    try {
      const r = await io.list(`${resRel}/${dir}`);
      if (r.ok && r.items) items = r.items.map((it) => ({ name: it.name, kind: it.kind }));
    } catch {
      continue;
    }
    for (const it of items) {
      if (it.kind !== "file" || !/\.xml$/i.test(it.name) || reads > 400) continue;
      reads++;
      const rel = `${dir}/${it.name}`;
      if (have.has(rel)) continue;
      const r = await io.read(`${resRel}/${rel}`);
      const text = r.ok ? r.text || "" : "";
      valuesCache.set(`${resRel}/${rel}`, text || null);
      if (!text) continue;
      if (addFile(rel, text)) {
        for (const k of definedValueKeys(text)) {
          projectValueDefs.add(k);
          defs.add(k);
        }
        const attrRe = /<attr\b[^>]*?\bname="([^"]+)"/g;
        let am: RegExpExecArray | null;
        while ((am = attrRe.exec(text)) !== null) {
          projectValueDefs.add(`attr/${am[1]}`);
          defs.add(`attr/${am[1]}`);
        }
      }
    }
  }

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
        if (have.has(path)) continue; // 已带过这个目录，接着看别的限定符目录
        reads++;
        const r = await io.read(`${resRel}/${path}`);
        if (r.ok && r.text) return { path, text: r.text };
      }
    }
    return null;
  };

  /** M159：图片（png/webp）——读 base64，真机侧写字节，不再当成缺资源 */
  const findDirImage = async (type: string, name: string): Promise<{ path: string; base64: string } | null> => {
    if (!io.readBase64) return null;
    const dirs2 = dirs.filter((d) => d === type || d.startsWith(`${type}-`)).sort();
    for (const dir of dirs2) {
      for (const ext of ["png", "webp", "jpg", "jpeg"]) {
        const path = `${dir}/${name}.${ext}`;
        if (have.has(path)) continue;
        reads++;
        const r = await io.readBase64(`${resRel}/${path}`);
        if (r.ok && r.base64) return { path, base64: r.base64 };
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
        const img = await findDirImage(ref.type, ref.name);
        if (img) {
          if (addFile(img.path, "", img.base64)) defs.add(key);
          else missing.add(key);
        } else {
          missing.add(key);
        }
        continue;
      }
      if (addFile(hit.path, hit.text)) {
        defs.add(key);
        next.push(...refsIn(hit.text));
      }
    }
    queue = next;
  }

  // M159：最后扫一遍最终清单里所有引用——递归时可能因 have/预算提前 return 漏记，
  // 导致 aapt2 报 xxx not found 却连占位都没生成。
  for (const f of files) {
    for (const ref of refsIn(f.text || "")) {
      const key = `${ref.type}/${ref.name}`;
      if (!defs.has(key)) missing.add(key);
    }
  }
  // 再试一次真文件（限定符目录 / 多模块 res 里的图片、布局）
  for (const key of [...missing]) {
    const slash = key.indexOf("/");
    if (slash < 0) continue;
    const type = key.slice(0, slash);
    const name = key.slice(slash + 1);
    if (type !== "drawable" && type !== "mipmap" && type !== "layout") continue;
    const direct = files.some((f) => new RegExp(`^${type}(-[^/]+)?/${name}\\.`).test(f.path));
    if (direct) {
      defs.add(key);
      missing.delete(key);
      continue;
    }
    const hit = await findDirFile(type, name);
    if (hit && addFile(hit.path, hit.text)) {
      defs.add(key);
      missing.delete(key);
      continue;
    }
    const img = await findDirImage(type, name);
    if (img && addFile(img.path, "", img.base64)) {
      defs.add(key);
      missing.delete(key);
    }
  }

  // M159：自定义 View 的 app:/cardview: 属性（MaterialCardView 的 cardCornerRadius 等）
  // 不声明 aapt2 link 会直接报 attribute not found；无 format 的 <attr> 就能过链。
  const customAttrs = new Set<string>();
  const attrScan = /\s([A-Za-z][\w-]*):([A-Za-z_][\w.-]*)\s*=/g;
  const attrRefScan = /\?attr\/([A-Za-z0-9_]+)|\?([A-Za-z][A-Za-z0-9_]*)(?![\w:.])/g;
  for (const f of files) {
    if (!f.text) continue;
    attrScan.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = attrScan.exec(f.text)) !== null) {
      const prefix = m[1];
      if (prefix === "android" || prefix === "xmlns" || prefix === "tools" || prefix === "xml") continue;
      if (defs.has(`attr/${m[2]}`)) continue;
      customAttrs.add(m[2]);
    }
    // ?attr/colorPrimary、?colorAccent 这类主题属性引用：库里定义的属性要自己补声明
    attrRefScan.lastIndex = 0;
    while ((m = attrRefScan.exec(f.text)) !== null) {
      const name = m[1] || m[2];
      if (!name || defs.has(`attr/${name}`)) continue;
      customAttrs.add(name);
    }
  }

  // M159：真缺的资源给占位实现——否则 aapt2 一个 @drawable 缺失就整包 link 失败，
  // 预览全黑。占位会记进 stubbed，界面照旧提示“这些资源项目里没有”。
  const stubbed: string[] = [];
  const stubValues: string[] = [];
  const stubSeen = new Set<string>();

  // @+id/xxx 在布局里已经声明过的 id，不需要再补 <item type="id">（会重复定义）
  for (const f of files) {
    if (!f.text) continue;
    const plusId = /@\+id\/([A-Za-z0-9_]+)/g;
    let pm: RegExpExecArray | null;
    while ((pm = plusId.exec(f.text)) !== null) defs.add(`id/${pm[1]}`);
  }
  for (const key of [...missing]) if (defs.has(key)) missing.delete(key);

  const stubValue = (line: string, key: string) => {
    if (stubSeen.has(key)) return;
    stubSeen.add(key);
    stubValues.push(`    ${line}`);
    missing.delete(key);
    stubbed.push(key);
  };

  // 样式：显式 parent + 带点号的隐式父级（Theme.AppCompat.Light → Theme.AppCompat），
  // 项目里没有的逐级补空样式，否则 link 报 style not found
  const styleInfo: { name: string; parent?: string }[] = [];
  {
    const docRe = /<style\b([^>]*)(?:\/>|>([\s\S]*?)<\/style>)/g;
    for (const f of files) {
      if (!f.text || !/^values/.test(f.path)) continue;
      docRe.lastIndex = 0;
      let dm: RegExpExecArray | null;
      while ((dm = docRe.exec(f.text)) !== null) {
        const head = dm[1];
        const name = (head.match(/\bname="([^"]+)"/) || [])[1];
        if (!name) continue;
        const parent = (head.match(/\bparent="([^"]*)"/) || [])[1] || undefined;
        styleInfo.push({ name, parent });
      }
    }
  }
  const ensureStyle = (raw?: string) => {
    if (!raw) return;
    let p = raw.trim();
    if (!p || p.startsWith("@android:") || p.startsWith("android:") || p.startsWith("@*android:")) return;
    p = p.replace(/^@style\//, "");
    if (defs.has(`style/${p}`) || stubSeen.has(`style/${p}`)) return;
    stubSeen.add(`style/${p}`);
    defs.add(`style/${p}`);
    stubValues.push(`    <style name="${p}" parent="" />`);
    stubbed.push(`style/${p}`);
  };
  const ensureParentChain = (raw: string) => {
    const parts = raw.split(".");
    for (let i = parts.length - 1; i > 0; i--) ensureStyle(parts.slice(0, i).join("."));
  };
  for (const s of styleInfo) {
    ensureStyle(s.parent);
    ensureParentChain(s.name);
    if (s.parent && s.parent.includes(".")) {
      ensureParentChain(s.parent.replace(/^@style\//, ""));
    }
  }

  // M159：<item name="xxx"> 写在 style 里时，xxx 会被解析成 attr/xxx，
  // 库的主题属性（colorPrimary 等）要一并声明，否则 link 报 style attribute not found。
  const itemAttrRe = /<item\b[^>]*\bname="([^"]+)"/g;
  for (const f of files) {
    if (!f.text || !/^values/.test(f.path)) continue;
    itemAttrRe.lastIndex = 0;
    let im: RegExpExecArray | null;
    while ((im = itemAttrRe.exec(f.text)) !== null) {
      const n = im[1];
      if (!n || defs.has(`attr/${n}`)) continue;
      customAttrs.add(n);
    }
  }

  for (const key of [...missing]) {
    const slash = key.indexOf("/");
    if (slash < 0) continue;
    const type = key.slice(0, slash);
    const name = key.slice(slash + 1);

    if (type === "drawable" || type === "mipmap") {
      const ok = addFile(
        `drawable/${name}.xml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<shape xmlns:android="http://schemas.android.com/apk/res/android">\n    <solid android:color="#00000000" />\n</shape>\n`,
      );
      if (ok) {
        missing.delete(key);
        stubbed.push(key);
      }
      continue;
    }
    if (type === "layout") {
      const ok = addFile(
        `layout/${name}.xml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<!--axv-stub-->\n<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent" android:layout_height="match_parent" />\n`,
      );
      if (ok) {
        missing.delete(key);
        stubbed.push(key);
      }
      continue;
    }
    if (type === "menu" || type === "anim" || type === "animator" || type === "xml") {
      const root = type === "menu" ? "menu" : type === "xml" ? "x" : "set";
      const ok = addFile(
        `${type}/${name}.xml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<${root} xmlns:android="http://schemas.android.com/apk/res/android" />\n`,
      );
      if (ok) {
        missing.delete(key);
        stubbed.push(key);
      }
      continue;
    }
    if (type === "raw") {
      if (addFile(`raw/${name}.txt`, "placeholder")) {
        missing.delete(key);
        stubbed.push(key);
      }
      continue;
    }

    if (type === "color") stubValue(`<color name="${name}">#00000000</color>`, key);
    else if (type === "string") stubValue(`<string name="${name}" />`, key);
    else if (type === "dimen") stubValue(`<dimen name="${name}">0dp</dimen>`, key);
    else if (type === "bool") stubValue(`<bool name="${name}">false</bool>`, key);
    else if (type === "integer") stubValue(`<integer name="${name}">0</integer>`, key);
    else if (type === "fraction") stubValue(`<fraction name="${name}">50%</fraction>`, key);
    else if (type === "style") stubValue(`<style name="${name}" parent="" />`, key);
    else if (type === "id") stubValue(`<item type="id" name="${name}" />`, key);
    else if (type === "array" || type === "string-array" || type === "integer-array")
      stubValue(`<${type} name="${name}" />`, key);
    else if (type === "plurals")
      stubValue(`<plurals name="${name}"><item quantity="other">%s</item></plurals>`, key);
  }

  if (stubValues.length > 0) {
    addFile(
      "values/axv_stub.xml",
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${stubValues.join("\n")}\n</resources>\n`,
    );
  }

  if (customAttrs.size > 0) {
    const decl = [...customAttrs].sort().map((n) => `    <attr name="${n}" />`).join("\n");
    addFile(
      "values/axv_attrs.xml",
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${decl}\n</resources>\n`,
    );
  }

  return { files: dedupeValuesFiles(files, projectValueDefs), missing: [...missing].sort(), added, stubbed };
}
