// lib/xml/res-search.ts — M180：项目结构树的搜索 + res 目录分组 + 重命名同步引用
//
// 三个纯函数，UI 层（ProjectPanel / XmlEditor）负责 I/O：
//   1. groupResDirs：把 res/ 下的限定符目录（drawable-mdpi、drawable-night、layout-land…）
//      按「资源类型」合并成虚拟分组，树里显示成 drawable (3) / layout (2) / values (5)…
//   2. resSearchMatches：按文件名过滤整棵项目文件列表（搜索框用）
//   3. renameResRef：把一段文本里对某资源的 @type/name 引用换成 @type/newName

/** 目录名 → 资源类型（drawable-mdpi → drawable；values-zh → values） */
export function resDirType(dirName: string): string | null {
  const m = /^(layout|drawable|mipmap|values|menu|anim|animator|xml|raw|font|color|transition)/.exec(dirName);
  return m ? m[1] : null;
}

/**
 * 把 res 下的一层目录（name 列表）按资源类型分组。
 * drawable / mipmap / values 系合并成虚拟组（键 = 类型名），其它资源目录各自成组（键 = 目录全名）。
 * 返回 Map：组键 → 组内实际目录名列表（drawable → [drawable-mdpi, drawable-night]）。
 */
export function groupResDirs(names: string[]): Map<string, string[]> {
  const g = new Map<string, string[]>();
  for (const n of names) {
    const t = resDirType(n);
    if (t === "drawable" || t === "mipmap" || t === "values") {
      g.set(t, [...(g.get(t) || []), n]);
    } else if (t) {
      g.set(n, [n]);
    }
  }
  return g;
}

/**
 * 文件搜索：items 是整棵树的文件/目录条目（rel 相对项目根）。
 * 命中 = 文件名包含查询串（不区分大小写），或文件位于「目录名命中」的目录下。
 * 目录命中时其下全部文件都列出，好一次看到整个 drawable/ 的内容。
 */
export function resSearchMatches(
  items: Array<{ rel: string; name: string; isDir: boolean }>,
  query: string,
  limit = 300,
): Array<{ rel: string; name: string; isDir: boolean }> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const dirHits: string[] = [];
  for (const it of items) if (it.isDir && it.name.toLowerCase().includes(q)) dirHits.push(it.rel);
  const out: Array<{ rel: string; name: string; isDir: boolean }> = [];
  for (const it of items) {
    if (out.length >= limit) break;
    if (it.isDir) continue;
    if (it.name.toLowerCase().includes(q)) {
      out.push(it);
      continue;
    }
    for (const d of dirHits) {
      if (it.rel.startsWith(d + "/")) {
        out.push(it);
        break;
      }
    }
  }
  return out;
}

/**
 * values 文件名 → R 类型（strings→string、colors→color、dimens→dimen…）。
 * 不归一化的话 `colors.xml` 会算出 resType="colors"，XML 的 `@colors/x` 和
 * `<color name="x">` 两边都对不上（M196 修）。
 */
export function singularResType(name: string): string {
  const n = (name || "").trim().toLowerCase();
  const map: Record<string, string> = {
    strings: "string",
    colors: "color",
    dimens: "dimen",
    bools: "bool",
    integers: "integer",
    styles: "style",
    ids: "id",
    arrays: "array",
    attrs: "attr",
  };
  return map[n] || n;
}

/**
 * 重命名同步：把文本里对资源 oldName 的引用/定义名改成 newName。
 *   kind="ref"    ：`@type/oldName`（含 drawable↔mipmap 互通）+ Java/Kotlin 的 `R.type.oldName`
 *   kind="values" ：`<tag ... name="oldName">`（tag ∈ 该类型允许集合），不动 android:name
 * 返回 { text, n }，n = 替换次数（0 = 没动）。
 */
export function renameResRef(
  text: string,
  kind: "ref" | "values",
  resType: string,
  oldName: string,
  newName: string,
): { text: string; n: number } {
  if (!text || !oldName || oldName === newName) return { text, n: 0 };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const type = singularResType(resType);
  let n = 0;
  let out = text;

  /** Java/Kotlin：R.type.oldName（也覆盖 R.drawable↔R.mipmap 混用） */
  const replaceR = (types: string[]) => {
    for (const t of types) {
      const re = new RegExp(`\\bR\\.${esc(t)}\\.${esc(oldName)}(?![A-Za-z0-9_])`, "g");
      out = out.replace(re, () => {
        n++;
        return `R.${t}.${newName}`;
      });
    }
  };

  if (kind === "ref") {
    const re = new RegExp(`@${esc(resType)}/${esc(oldName)}(?![A-Za-z0-9_])`, "g");
    out = out.replace(re, () => {
      n++;
      return `@${resType}/${newName}`;
    });
    // drawable / mipmap 经常混用（@drawable/ic_x 也可能写成 @mipmap/ic_x）
    const types: string[] = [type];
    if (type === "drawable" || type === "mipmap") {
      const other = type === "drawable" ? "mipmap" : "drawable";
      types.push(other);
      const re2 = new RegExp(`@${esc(other)}/${esc(oldName)}(?![A-Za-z0-9_])`, "g");
      out = out.replace(re2, () => {
        n++;
        return `@${other}/${newName}`;
      });
    }
    replaceR(types);
    return { text: out, n };
  }

  const tags: string[] =
    type === "string"
      ? ["string", "string-array"]
      : type === "color"
        ? ["color", "color-state-list"]
        : type === "style"
          ? ["style", "styleable", "declare-styleable"]
          : [type];
  for (const tag of tags) {
    // attrs = 标签名与 name 之间的所有属性（带前导空格），原样保留
    const re = new RegExp(`<${esc(tag)}\\b(\\s[^>]*?)?\\bname\\s*=\\s*"${esc(oldName)}"`, "g");
    out = out.replace(re, (_m, attrs: string | undefined) => {
      n++;
      return `<${tag}${attrs ?? ""}name="${newName}"`;
    });
  }
  // values 改名字也要同步 Java 的 R.string.xxx / R.color.xxx
  replaceR([type]);
  return { text: out, n };
}
