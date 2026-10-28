// lib/xml/asset-refs.ts — M5b：已生成资源（图标 / shape / vector）的引用统计与改名
//
// 「已生成资源」= generatedDrawables 里由编辑器写出的 drawable xml（ic_xxx 图标、
// bg_xxx shape 等）。资源管理面板要用它们：
//   - 统计布局里 @drawable/x、@mipmap/x 的引用次数（改名前提示、删除前警告）
//   - 改名时同步改布局里的引用 + 资源之间互相的引用（selector 引用别的 drawable）
//
// 注意：改名是纯文本替换，边界必须精确 —— `ic_home` 不能把 `ic_home_2` 一起改掉。

const ESC = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 资源引用正则：@drawable/name 或 @mipmap/name，name 后不能紧跟资源名字符 */
function refRe(name: string): RegExp {
  return new RegExp(`@(drawable|mipmap)/${ESC(name)}(?![A-Za-z0-9_])`, "g");
}

/** 统计一段 XML 里对某资源的引用次数（@drawable/x + @mipmap/x） */
export function countReferences(xml: string, name: string): number {
  if (!xml || !name) return 0;
  const m = xml.match(refRe(name));
  return m ? m.length : 0;
}

/** 把一段 XML 里对 oldName 的引用换成 newName */
export function renameReferences(xml: string, oldName: string, newName: string): string {
  if (!xml || !oldName || !newName || oldName === newName) return xml;
  return xml.replace(refRe(oldName), (_all, kind: string) => `@${kind}/${newName}`);
}

/** 资源类型：vector / shape / selector / layer / ripple / inset / 其它 */
export function assetKind(xml: string): string {
  if (/<vector[\s>]/.test(xml)) return "vector";
  if (/<ripple[\s>]/.test(xml)) return "ripple";
  if (/<selector[\s>]/.test(xml)) return "selector";
  if (/<layer-list[\s>]/.test(xml)) return "layer-list";
  if (/<inset[\s>]/.test(xml)) return "inset";
  if (/<shape[\s>]/.test(xml)) return "shape";
  return "other";
}

/** 类型徽标文案 */
export function kindLabel(kind: string): string {
  switch (kind) {
    case "vector":
      return "矢量图";
    case "shape":
      return "形状";
    case "selector":
      return "状态选择";
    case "layer-list":
      return "图层";
    case "ripple":
      return "水波纹";
    case "inset":
      return "内嵌";
    default:
      return "其它";
  }
}

/** 改名后的新资源表；oldName 不存在或 newName 已占用时返回 null */
export function renameAsset(
  assets: Record<string, string>,
  oldName: string,
  newName: string
): Record<string, string> | null {
  if (!(oldName in assets)) return null;
  if (!newName || newName === oldName) return null;
  if (newName in assets) return null;
  const next: Record<string, string> = {};
  for (const [k, v] of Object.entries(assets)) {
    if (k === oldName) {
      // 自身内容里如果引用了自己（少见但可能），也一并改
      next[newName] = renameReferences(v, oldName, newName);
    } else {
      // 其它资源内部互相引用
      next[k] = renameReferences(v, oldName, newName);
    }
  }
  return next;
}

/** 被引用的资源名（供「哪些能安全删除」提示用） */
export function referencedNames(xml: string, names: string[]): Set<string> {
  const out = new Set<string>();
  for (const n of names) if (countReferences(xml, n) > 0) out.add(n);
  return out;
}

/** 字节大小的可读文案 */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
