// lib/xml/export.ts — M3 导出：从编辑树生成可下载的 Android 布局 XML
// 复用 serialize() 的树 → 文本能力，输出正式缩进格式 + XML 声明；并做导出前检查。

import { parseLayoutXml, serialize } from "./parser";
import { lintXml } from "./lint";
import { fixNamespacePrefixes } from "./namespace";
import { toCompatXml } from "./compat";
import type { XmlNode } from "./types";

/** <include> 指向的布局引用是否合法（必须是 @layout/x 或裸名） */
function includeRefOk(n: XmlNode): boolean {
  const raw = (n.attrs["layout"] ?? "").trim();
  if (!raw) return false;
  const s = raw.startsWith("@") ? raw.slice(1) : raw;
  const slash = s.indexOf("/");
  const name = slash >= 0 ? s.slice(slash + 1) : s;
  if (!name || name === "@") return false;
  if (slash >= 0 && !/^layout(-[a-z0-9-]+)?$/i.test(s.slice(0, slash))) return false;
  return true;
}

/**
 * M169b：删掉没有合法 layout 引用的 <include>。
 * Android 里这种 include 在 inflate 时必定抛
 * "You must specify a layout in the include tag"（LayoutInflater.parseInclude：
 * getAttributeResourceValue(null, "layout", 0) 拿到 0，getAttributeValue 是 null）。
 * 宁可导出的 XML 里不出现这个节点，也不能让真机崩。返回删掉的个数。
 */
export function pruneBrokenIncludes(root: XmlNode): number {
  let removed = 0;
  const walk = (n: XmlNode) => {
    for (let i = n.children.length - 1; i >= 0; i--) {
      const c = n.children[i];
      if (c.tag === "include" && !includeRefOk(c)) {
        n.children.splice(i, 1);
        removed++;
        continue;
      }
      walk(c);
    }
  };
  walk(root);
  return removed;
}

export type ExportMode = "modern" | "compat";

export interface ExportOptions {
  /** modern = 原样（androidx + Material）；compat = 降级成纯平台控件，老 aapt / AIDE 可编译 */
  mode?: ExportMode;
}

export interface ExportCheck {
  /** 阻断下载/复制的结构性错误（lint 的 error 级） */
  errors: number;
  /** 警告条数 */
  warnings: number;
  /** 导出前语义提示（未约束的 CL 子项、缺 id 等），空 = 可直接导出 */
  notes: string[];
}

/** 把当前 XML 文本规范成可直接下载的 Android 布局文件 */
export function exportLayoutXml(src: string, opts: ExportOptions = {}): string {
  // M12：先把 android:cornerRadius 这类库属性改成 app:，否则 aapt 编译直接报错
  const fixed = fixNamespacePrefixes(src);
  const declMatch = fixed.match(/^<\?xml[^>]*>/i);
  const declLine = declMatch ? declMatch[0] : '<?xml version="1.0" encoding="utf-8"?>';

  // M13：兼容模式——先降级成纯平台控件，再走正常序列化
  if (opts.mode === "compat") {
    const compat = toCompatXml(fixed);
    return `${declLine}\n${compat.xml}\n`;
  }

  const { root } = parseLayoutXml(fixed);
  if (!root) {
    // 解析失败时不吞用户原文：去掉旧声明后补一个，保持内容原样
    const body = fixed.trim().replace(/^<\?xml[\s\S]*?\?>/i, "").trim();
    return `${declLine}\n${body}\n`;
  }
  // M169b：没写 layout 的 include 真机必崩，导出前直接剔掉
  pruneBrokenIncludes(root);
  return `${declLine}\n${serialize(root)}\n`;
}

/** 导出前检查：结构性错误（lint）+ 语义提醒（未约束的 ConstraintLayout 子项 / 缺 id） */
export function exportChecks(src: string): ExportCheck {
  const lint = lintXml(src);
  const errors = lint.filter((i) => i.level === "error").length;
  const warnings = lint.filter((i) => i.level === "warn").length;

  const notes: string[] = [];
  const { root } = parseLayoutXml(src);
  if (root) {
    const isCL = (tag: string) => {
      const st = tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
      return st === "ConstraintLayout";
    };
    const walk = (n: XmlNode, inCL: boolean) => {
      const st = n.tag.includes(".") ? n.tag.slice(n.tag.lastIndexOf(".") + 1) : n.tag;
      if (st === "include" && !includeRefOk(n)) {
        notes.push(`<include>（#${n.path}）没指定要引入的布局，导出时会自动移除（否则真机 inflate 直接崩）`);
      }
      if (inCL && !isCL(n.tag) && st !== "Guideline" && st !== "Barrier" && st !== "include") {
        const id = n.attrs["id"];
        if (!id) notes.push(`${st}（#${n.path}）缺 android:id，约束与代码引用都需要它`);
        // layout_width/height/margin 不是约束；只认 layout_constraint* 与 layout_behavior
        const hasConstraint = Object.keys(n.attrs).some(
          (k) => k.startsWith("layout_constraint") || k === "layout_behavior",
        );
        if (!hasConstraint)
          notes.push(`${st}（${id ?? "#" + n.path}）在 ConstraintLayout 里没有任何约束，渲染会贴左上角`);
      }
      for (const c of n.children) walk(c, inCL || isCL(n.tag));
    };
    walk(root, false);
  }
  return { errors, warnings, notes: notes.slice(0, 12) };
}
