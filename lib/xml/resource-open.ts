// lib/xml/resource-open.ts — 资源树里点一个文件，该干什么？
// 用户 2026-10-28：drawable 目录下的 xml 默认用「绘制编辑器」打开（可改参数回写），
// 图片文件（png/jpg/webp…）弹出图片预览框。
// 抽成纯函数，方便测试（组件里只是 switch 一下）。

import type { ResourceExtras } from "./resdir";
import { vectorToDataUrl } from "./vector-svg";

export type ResOpenAction =
  /** 形状类 xml（shape / ripple / selector / layer-list / inset）→ 形状编辑器 */
  | { kind: "drawable"; name: string; xml: string }
  /** 位图 → 图片预览（url 可能为空 = 没解析到） */
  | { kind: "image"; name: string; url: string }
  /** vector xml → 图片预览（转成 svg data URL 真画） */
  | { kind: "vector"; name: string; url: string }
  /** 不归这里管（布局 / values / 菜单 / 不支持的 xml） */
  | { kind: "none" };

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i;
const SHAPE_ROOT = /<(shape|ripple|selector|layer-list|inset|animated-rotate|animation-list|level-list|clip|scale|transition|crossfade|bitmap)[\s>]/;

/** res/drawable-hdpi/ic_home.png → ic_home */
export function resBaseName(rel: string): string {
  const file = rel.split("/").pop() || "";
  return file.replace(/\.[^.]+$/, "");
}

export function resOpenAction(
  rel: string,
  text: string | null,
  extras: ResourceExtras | null,
): ResOpenAction {
  // 路径归一：可能是 res/drawable/x.xml，也可能是 src/main/res/drawable/x.xml（整目录导入）
  const idx = rel.lastIndexOf("/res/");
  const path = idx >= 0 ? rel.slice(idx + 5) : rel.replace(/^res\//, "").replace(/^\/+/, "");
  const dir = path.split("/")[0] || "";
  const isDrawableDir = /^(drawable|mipmap)(-|$)/.test(dir) || dir === "drawable" || dir === "mipmap";
  if (!isDrawableDir) return { kind: "none" };

  const name = resBaseName(path);

  if (IMAGE_EXT.test(path)) {
    const url = extras?.drawables?.[name] ?? "";
    return { kind: "image", name, url };
  }

  if (/\.xml$/i.test(path) && text) {
    if (/<vector[\s>]/.test(text)) {
      return { kind: "vector", name, url: vectorToDataUrl(text) ?? "" };
    }
    if (SHAPE_ROOT.test(text)) return { kind: "drawable", name, xml: text };
  }

  return { kind: "none" };
}
