// lib/xml/drawable-root.ts — 解析入口：先认根元素，再决定用哪个编辑器（M124）
//
// 背景：drawable 的根元素不是统一的，至少有这么几类：
//   1. 形状类      <shape>                       → 形状面板（参数最全）
//   2. 组合类      <selector> <layer-list> <ripple> <inset>  → 结构树
//   3. 只读类      <vector> <clip> <scale> <rotate> <level-list> <animation-list> …
//                                                           → 只读 + 原样保存（不假装能编辑）
//   4. 不是 drawable（layout / values / manifest …）         → 不要用 drawable 编辑器去改
//
// 为什么要单独一层：以前是「parseDrawable 拿到什么就当什么」，未知根元素会退化成
// unsupported 节点，用户看到的是一棵空树，保存还会把内容写坏。这里把判断提前，
// 让每种情况都有明确出口。
//
// M137：组合类的四个根支持互转（见 drawable-root-convert.ts），这里只提供目标清单和提醒。

export type RootRoute = "empty" | "shape" | "tree" | "readonly";

export interface RootInfo {
  /** 根标签名（localName，第三方前缀已剥掉） */
  tag: string;
  route: RootRoute;
  /** 面向用户的类型名 */
  label: string;
  /** 一句话说明这个根元素怎么处理 */
  note: string;
}

/** 能在结构树里编辑的根 */
const TREE_ROOTS: Record<string, string> = {
  selector: "状态选择",
  "layer-list": "图层叠加",
  ripple: "水波纹",
  inset: "内缩",
  color: "纯色",
};

/** 认识但暂不编辑的根（保留原文，只读展示） */
const READONLY_ROOTS: Record<string, string> = {
  "level-list": "等级列表",
  clip: "裁剪",
  scale: "缩放",
  rotate: "旋转",
  transition: "过渡",
  "animated-rotate": "动画旋转",
  "animation-list": "帧动画",
  "animated-selector": "动画状态选择",
  "animated-vector": "动画矢量图",
  vector: "矢量图",
  bitmap: "位图",
  "nine-patch": "九宫格",
  "adaptive-icon": "自适应图标",
  "animated-state-list": "动画状态列表",
};

/** 明显不是 drawable 的资源，给一句更准的话 */
const NOT_DRAWABLE: Record<string, string> = {
  layout: "布局 XML",
  manifest: "清单文件",
  resources: "values 资源",
  "shape-xml": "形状",
};

function localName(tag: string): string {
  return tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
}

/** 从 XML 文本里取根元素名（跳过声明、注释、DOCTYPE） */
export function rootTagOf(xml: string | undefined): string {
  if (!xml) return "";
  let s = xml;
  for (;;) {
    s = s.replace(/^\s+/, "");
    if (s.startsWith("<?") || s.startsWith("<!")) {
      const end = s.indexOf(">");
      if (end < 0) return "";
      s = s.slice(end + 1);
      continue;
    }
    break;
  }
  const m = /^<([A-Za-z_][\w:.-]*)/.exec(s);
  return m ? localName(m[1]) : "";
}

export function rootInfo(xml: string | undefined): RootInfo {
  const tag = rootTagOf(xml);
  if (!tag) {
    return { tag: "", route: "empty", label: "空", note: "还没有内容，从预设或空模板开始。" };
  }
  if (tag === "shape") {
    return { tag, route: "shape", label: "形状", note: "单形状用形状面板编辑，参数最全。" };
  }
  const tree = TREE_ROOTS[tag];
  if (tree) {
    return { tag, route: "tree", label: tree, note: "结构树里按层 / 状态 / 内容组合编辑。" };
  }
  const ro = READONLY_ROOTS[tag];
  if (ro) {
    return {
      tag,
      route: "readonly",
      label: ro,
      note: "这个类型暂时只能查看和原样保存，可视化编辑还没做，动它容易改坏。",
    };
  }
  const other = NOT_DRAWABLE[tag];
  return {
    tag,
    route: "readonly",
    label: other ?? tag,
    note: other
      ? "这看起来不是 drawable，建议在对应的编辑器里改，这里只保证不改坏。"
      : "还不认识这个根元素，只能查看和原样保存。",
  };
}

/** 结构树能不能编辑这个根 */
export function isEditableRoot(xml: string | undefined): boolean {
  const r = rootInfo(xml).route;
  return r === "shape" || r === "tree" || r === "empty";
}

/* ── M137：根标签互转 ── */

/** 可以互转的四个组合类根 */
export type RootTag = "selector" | "layer-list" | "ripple" | "inset";

export const ROOT_TAGS: RootTag[] = ["selector", "layer-list", "ripple", "inset"];

export const ROOT_LABELS: Record<RootTag, string> = {
  selector: "状态选择",
  "layer-list": "图层叠加",
  ripple: "水波纹",
  inset: "内缩",
};

/** 目标根的提醒：告诉用户转换后什么会失效（文案在 UI 层翻译） */
export const ROOT_WARN: Record<RootTag, string> = {
  selector: "转成状态后，同一时刻只画一支：原来的各层会变成独立状态项，需要自己设状态条件",
  "layer-list": "转成图层后，状态条件会失效：各状态项会同时叠在一起，可能需要手动删掉多余的层",
  ripple: "转成水波纹后，原内容整体并进「内容」层，波纹色和遮罩要重新设",
  inset: "转成内缩后，原内容整体包一层内边距，四边数值默认 0，要自己填",
};

/** 根标签能不能转（四个组合类之间都可以，同标签不算转换） */
export function canConvertRoot(from: string, to: RootTag): boolean {
  return ROOT_TAGS.includes(from as RootTag) && from !== to;
}
