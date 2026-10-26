// lib/xml/resdir.ts — 上传 res/ 目录（或散件文件）后解析真实资源
// 纯前端：File → dataURL / 文本，不需要后端。
// 产出三类：
//   1) drawables/vectorNames：@drawable/@mipmap → dataURL（矢量只记名字，渲染成占位）
//   2) valuesXml：所有 values/*.xml 里 <string>/<dimen>/<color> 的标签拼接（交给 mergeResourceFragment 复用已测逻辑）
//   3) styles：@style/xxx → 展开 parent 继承链后的属性表

export interface StyleRecord {
  name: string;
  parent?: string;
  /** 含 parent 继承展开后的扁平属性 */
  attrs: Record<string, string>;
}

export interface ResourceExtras {
  /** drawable 名（无扩展名、无密度后缀）→ dataURL */
  drawables: Record<string, string>;
  /** 矢量图（vector xml）资源名，渲染为占位框 */
  vectorNames: string[];
  /** values/*.xml 中 string/dimen/color 标签集合，喂 mergeResourceFragment */
  valuesXml: string;
  /** styles.xml 展开记录 */
  styles: Record<string, StyleRecord>;
  /** 已读入的相对路径（提示用户读了什么） */
  sourceFiles: string[];
  /** 各类计数，给 UI 打提示 */
  counts: { images: number; vectors: number; values: number; styles: number };
}

export interface ResUploadItem {
  name: string;
  /** webkitRelativePath（选文件夹时才有） */
  path?: string;
  file: File;
}

const IMG_EXT = /\.(png|webp|jpe?g|gif|bmp)$/i;
/** 密度桶优先级（数字越大越优先，取最高清那张） */
function densityScore(dir: string): number {
  if (/-xxxhdpi$/.test(dir)) return 640;
  if (/-xxhdpi$/.test(dir)) return 480;
  if (/-xhdpi$/.test(dir)) return 320;
  if (/-hdpi$/.test(dir)) return 240;
  if (/-mdpi$/.test(dir)) return 160;
  if (/-ldpi$/.test(dir)) return 120;
  return 200; // 无后缀（drawable/）优先于 ldpi/hdpi
}

function relPath(item: ResUploadItem): string {
  const p = item.path && item.path.length > item.name.length ? item.path : item.name;
  return p.replace(/\\/g, "/");
}

function baseName(p: string): string {
  return p.split("/").pop() || p;
}

export async function buildResourceExtras(files: ResUploadItem[]): Promise<ResourceExtras> {
  const extras: ResourceExtras = {
    drawables: {},
    vectorNames: [],
    valuesXml: "",
    styles: {},
    sourceFiles: [],
    counts: { images: 0, vectors: 0, values: 0, styles: 0 },
  };

  const valuesParts: string[] = [];
  const rawStyles = new Map<string, { parent?: string; attrs: Record<string, string> }>();
  /** 同名图片按密度择优：name → {score, url} */
  const best = new Map<string, { score: number; url: string }>();

  for (const item of files) {
    const rel = relPath(item);
    const dir = rel.slice(0, Math.max(0, rel.lastIndexOf("/")));
    const file = baseName(rel);
    /** 没选目录（散件单选）时 rel 只有文件名，按名字推断归属 */
    const guessed = !rel.includes("/");
    const looksValues = guessed && /^(colors|dimens|strings|styles|themes|attrs)\.xml$/i.test(file);
    const looksDrawable = guessed && !looksValues;

    // ---- values/*.xml：string/dimen/color + styles ----
    const inValues = /\/values(-[a-z]+)?\//.test("/" + rel) || /^values(-[a-z]+)?\//.test(rel);
    if (inValues || looksValues) {
      if (!file.endsWith(".xml")) continue;
      // 只认默认 values/（不带限定符），避免 -night/-v21 覆盖
      const inDefaultValues = /(^|\/)values\//.test(rel) || looksValues;
      if (!inDefaultValues) continue;
      const text = await item.file.text();
      if (/<(string|dimen|color)[\s>]/.test(text)) {
        valuesParts.push(text);
        extras.counts.values++;
      }
      if (file === "styles.xml" || file === "themes.xml") {
        parseStylesXml(text, rawStyles);
        extras.counts.styles = rawStyles.size;
      }
      extras.sourceFiles.push(rel);
      continue;
    }

    // ---- drawable/mipmap 下的图片 ----
    if (IMG_EXT.test(file)) {
      if (!looksDrawable && !/(^|\/)(drawable|mipmap)/.test(rel)) continue;
      const name = file.replace(IMG_EXT, "");
      const score = densityScore(dir);
      const prev = best.get(name);
      if (!prev || score > prev.score) {
        best.set(name, { score, url: await fileToDataUrl(item.file) });
      }
      extras.sourceFiles.push(rel);
      continue;
    }

    // ---- drawable 下的矢量 xml ----
    if (file.endsWith(".xml") && (looksDrawable || /(^|\/)(drawable|mipmap)/.test(rel))) {
      const text = await item.file.text();
      if (/<vector[\s>]/.test(text)) {
        const name = file.replace(/\.xml$/i, "");
        if (!extras.vectorNames.includes(name)) {
          extras.vectorNames.push(name);
          extras.counts.vectors++;
        }
        extras.sourceFiles.push(rel);
      }
      continue;
    }
  }

  for (const [name, v] of best) extras.drawables[name] = v.url;
  extras.counts.images = best.size;
  extras.valuesXml = valuesParts.join("\n");

  // parent 继承链展开（限深、带环检测）
  for (const [name, st] of rawStyles) {
    extras.styles[name] = expandStyle(name, st, rawStyles, new Set());
  }

  return extras;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

interface RawStyle {
  parent?: string;
  attrs: Record<string, string>;
}

/** 解析 styles.xml / themes.xml：<style name parent> + 内部 <item name> */
function parseStylesXml(xml: string, out: Map<string, RawStyle>) {
  const styleRe = /<style\s+([^>]*)>([\s\S]*?)<\/style>/g;
  let m: RegExpExecArray | null;
  while ((m = styleRe.exec(xml)) !== null) {
    const head = m[1];
    const name = (head.match(/name\s*=\s*"([^"]+)"/) || [])[1];
    if (!name) continue;
    const parent = (head.match(/parent\s*=\s*"([^"]*)"/) || [])[1];
    const attrs: Record<string, string> = {};
    const itemRe = /<item\s+([^>]*)>([\s\S]*?)<\/item>/g;
    let im: RegExpExecArray | null;
    while ((im = itemRe.exec(m[2])) !== null) {
      const iname = (im[1].match(/name\s*=\s*"([^"]+)"/) || [])[1];
      if (!iname) continue;
      attrs[iname] = (im[2] || "").trim();
    }
    out.set(name, { parent, attrs });
    // 支持 <style name="X" parent="Y"/> 自闭合（无 item）
  }
  // 自闭合样式（无 body）
  const selfRe = /<style\s+([^>]*?)\/>/g;
  while ((m = selfRe.exec(xml)) !== null) {
    const head = m[1];
    const name = (head.match(/name\s*=\s*"([^"]+)"/) || [])[1];
    if (!name || out.has(name)) continue;
    const parent = (head.match(/parent\s*=\s*"([^"]*)"/) || [])[1];
    out.set(name, { parent, attrs: {} });
  }
}

/** parent 继承展开（子覆盖父）；环/缺 parent 时截断 */
function expandStyle(
  name: string,
  st: RawStyle,
  all: Map<string, RawStyle>,
  seen: Set<string>,
): StyleRecord {
  if (seen.has(name)) return { name, attrs: { ...st.attrs } };
  seen.add(name);
  let merged: Record<string, string> = {};
  if (st.parent) {
    const pname = st.parent.replace(/^@(android:)?style\//, "").replace(/^\?/, "");
    const parent = all.get(pname);
    if (parent) merged = { ...expandStyle(pname, parent, all, seen).attrs };
  }
  merged = { ...merged, ...st.attrs };
  return { name, parent: st.parent, attrs: merged };
}
