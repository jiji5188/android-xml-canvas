// lib/xml/theme-item-descs.ts — M338：themes.xml 里 <item name="..."> 属性中文说明表
//
// 背景：themes.xml 的结构是
//   <style name="Theme.MyApp" parent="Theme.Material3.DayNight.NoActionBar">   ← 样式节点（名称 + 继承父样式）
//       <item name="colorPrimary">@color/primary</item>                        ← 属性配置（本文件给出人话说明）
//   </style>
// 视图里每条 item 后面显示对应说明，让用户看懂这个属性管什么；表里没有的按「自定义属性」处理，不隐藏。
//
// 只做查表 + 归一化，不参与写回逻辑。

export type ThemeItemValueType = "color" | "dimen" | "text" | "bool" | "other";

export interface ThemeItemDesc {
  /** Android 属性名（与 themes.xml 里 item 的 name 一致） */
  attr: string;
  /** 中文说明 */
  desc: string;
  /** 值类型：决定视图里给色块、尺寸还是普通输入 */
  type: ThemeItemValueType;
}

/** Material 3 / 系统主题常用属性（按色系 → 形状 → 文字 → 系统分类排列） */
export const THEME_ITEM_DESCS: ThemeItemDesc[] = [
  // —— M3 主色系 ——
  { attr: "colorPrimary", desc: "M3 主色", type: "color" }, // i18n-ignore
  { attr: "colorOnPrimary", desc: "主色上文字/图标色", type: "color" }, // i18n-ignore
  { attr: "colorPrimaryContainer", desc: "主容器色", type: "color" }, // i18n-ignore
  { attr: "colorOnPrimaryContainer", desc: "主容器上文字色", type: "color" }, // i18n-ignore
  // —— M3 次色系 ——
  { attr: "colorSecondary", desc: "次要色", type: "color" }, // i18n-ignore
  { attr: "colorOnSecondary", desc: "次要色上文字色", type: "color" }, // i18n-ignore
  { attr: "colorSecondaryContainer", desc: "次要容器色", type: "color" }, // i18n-ignore
  { attr: "colorOnSecondaryContainer", desc: "次要容器上文字色", type: "color" }, // i18n-ignore
  // —— M3 第三色系 ——
  { attr: "colorTertiary", desc: "第三色", type: "color" }, // i18n-ignore
  { attr: "colorOnTertiary", desc: "第三色上文字色", type: "color" }, // i18n-ignore
  { attr: "colorTertiaryContainer", desc: "第三容器色", type: "color" }, // i18n-ignore
  { attr: "colorOnTertiaryContainer", desc: "第三容器上文字色", type: "color" }, // i18n-ignore
  // —— M3 表面 / 轮廓 ——
  { attr: "colorSurface", desc: "表面底色", type: "color" }, // i18n-ignore
  { attr: "colorOnSurface", desc: "表面文字色", type: "color" }, // i18n-ignore
  { attr: "colorSurfaceVariant", desc: "表面变体色", type: "color" }, // i18n-ignore
  { attr: "colorOnSurfaceVariant", desc: "表面变体文字色", type: "color" }, // i18n-ignore
  { attr: "colorOutline", desc: "轮廓线颜色", type: "color" }, // i18n-ignore
  { attr: "colorOutlineVariant", desc: "轮廓变体色", type: "color" }, // i18n-ignore
  // —— M3 错误色 ——
  { attr: "colorError", desc: "错误色", type: "color" }, // i18n-ignore
  { attr: "colorOnError", desc: "错误色文字", type: "color" }, // i18n-ignore
  { attr: "colorErrorContainer", desc: "错误容器色", type: "color" }, // i18n-ignore
  { attr: "colorOnErrorContainer", desc: "错误容器文字", type: "color" }, // i18n-ignore
  // —— M3 遮罩 ——
  { attr: "colorScrim", desc: "遮罩颜色", type: "color" }, // i18n-ignore
  // —— M3 形状 ——
  { attr: "shapeCornerSmall", desc: "小圆角尺寸", type: "dimen" }, // i18n-ignore
  { attr: "shapeCornerMedium", desc: "中等圆角尺寸", type: "dimen" }, // i18n-ignore
  { attr: "shapeCornerLarge", desc: "大圆角尺寸", type: "dimen" }, // i18n-ignore
  // —— M3 文字 ——
  { attr: "textBodyLarge", desc: "大号正文样式", type: "text" }, // i18n-ignore
  { attr: "textBodyMedium", desc: "中号正文样式", type: "text" }, // i18n-ignore
  { attr: "textBodySmall", desc: "小号正文样式", type: "text" }, // i18n-ignore
  // —— 系统窗口 ——
  { attr: "android:statusBarColor", desc: "状态栏颜色", type: "color" }, // i18n-ignore
  { attr: "android:navigationBarColor", desc: "导航栏颜色", type: "color" }, // i18n-ignore
  { attr: "android:windowLightStatusBar", desc: "状态栏深色文字", type: "bool" }, // i18n-ignore
  { attr: "windowNoTitle", desc: "关闭标题", type: "bool" }, // i18n-ignore
  { attr: "windowActionBar", desc: "是否显示 ActionBar", type: "bool" }, // i18n-ignore
  { attr: "rippleColor", desc: "波纹颜色", type: "color" }, // i18n-ignore
];

/** 老项目/AppCompat 常见属性（不在 M3 表里，但配上说明更有用；不算「自定义」） */
const EXTRA_DESCS: ThemeItemDesc[] = [
  { attr: "colorPrimaryDark", desc: "主色深色变体（状态栏常用）", type: "color" }, // i18n-ignore
  { attr: "colorAccent", desc: "强调色（复选框/开关等）", type: "color" }, // i18n-ignore
  { attr: "colorControlNormal", desc: "控件默认色", type: "color" }, // i18n-ignore
  { attr: "colorControlActivated", desc: "控件激活色", type: "color" }, // i18n-ignore
  { attr: "windowBackground", desc: "窗口背景", type: "color" }, // i18n-ignore
  { attr: "android:windowBackground", desc: "窗口背景", type: "color" }, // i18n-ignore
  { attr: "android:textColorPrimary", desc: "主文字颜色", type: "color" }, // i18n-ignore
  { attr: "android:textColorSecondary", desc: "次文字颜色", type: "color" }, // i18n-ignore
  { attr: "android:windowNoTitle", desc: "关闭标题", type: "bool" }, // i18n-ignore
  { attr: "android:windowActionBar", desc: "是否显示 ActionBar", type: "bool" }, // i18n-ignore
];

/** M339：styles.xml 控件样式里 <item> 的常用属性（android: 控件属性） */
export const STYLE_ITEM_DESCS: ThemeItemDesc[] = [
  { attr: "android:background", desc: "控件背景", type: "color" }, // i18n-ignore
  { attr: "android:backgroundTint", desc: "背景着色", type: "color" }, // i18n-ignore
  { attr: "android:textColor", desc: "文字颜色", type: "color" }, // i18n-ignore
  { attr: "android:textColorHint", desc: "提示文字颜色", type: "color" }, // i18n-ignore
  { attr: "android:textSize", desc: "文字大小", type: "dimen" }, // i18n-ignore
  { attr: "android:textStyle", desc: "文字样式 normal|bold|italic", type: "text" }, // i18n-ignore
  { attr: "android:padding", desc: "内边距", type: "dimen" }, // i18n-ignore
  { attr: "android:paddingLeft", desc: "左内边距", type: "dimen" }, // i18n-ignore
  { attr: "android:paddingRight", desc: "右内边距", type: "dimen" }, // i18n-ignore
  { attr: "android:paddingTop", desc: "上内边距", type: "dimen" }, // i18n-ignore
  { attr: "android:paddingBottom", desc: "下内边距", type: "dimen" }, // i18n-ignore
  { attr: "android:paddingHorizontal", desc: "左右内边距", type: "dimen" }, // i18n-ignore
  { attr: "android:paddingVertical", desc: "上下内边距", type: "dimen" }, // i18n-ignore
  { attr: "android:layout_width", desc: "布局宽 wrap_content/match_parent/dp", type: "other" }, // i18n-ignore
  { attr: "android:layout_height", desc: "布局高 wrap_content/match_parent/dp", type: "other" }, // i18n-ignore
  { attr: "android:gravity", desc: "内部对齐", type: "other" }, // i18n-ignore
  { attr: "android:elevation", desc: "阴影高程", type: "dimen" }, // i18n-ignore
  { attr: "android:rippleColor", desc: "波纹颜色", type: "color" }, // i18n-ignore
  { attr: "android:strokeColor", desc: "描边颜色", type: "color" }, // i18n-ignore
  { attr: "android:strokeWidth", desc: "描边宽度", type: "dimen" }, // i18n-ignore
  { attr: "android:radius", desc: "圆角半径", type: "dimen" }, // i18n-ignore
  { attr: "android:maxLines", desc: "最大行数", type: "other" }, // i18n-ignore
  { attr: "android:singleLine", desc: "单行模式", type: "bool" }, // i18n-ignore
  { attr: "android:clickable", desc: "是否可点击 true/false", type: "bool" }, // i18n-ignore
  { attr: "android:focusable", desc: "是否可获取焦点 true/false", type: "bool" }, // i18n-ignore
];

const MAP = new Map<string, ThemeItemDesc>();
for (const d of EXTRA_DESCS) MAP.set(d.attr, d);
for (const d of THEME_ITEM_DESCS) MAP.set(d.attr, d);
for (const d of STYLE_ITEM_DESCS) MAP.set(d.attr, d);

/** 是否有 `android:` 前缀 */
function hasAndroidPrefix(s: string): boolean {
  return s.startsWith("android:");
}

/**
 * 查属性说明。
 * themes.xml 里同一属性可能写成 `statusBarColor` 也可能写成 `android:statusBarColor`，
 * 所以两种写法都试一遍（表里带前缀的优先）。
 */
export function themeItemDesc(name: string): ThemeItemDesc | undefined {
  const key = name.trim();
  if (!key) return undefined;
  const hit = MAP.get(key);
  if (hit) return hit;
  if (hasAndroidPrefix(key)) {
    const bare = key.slice("android:".length);
    const m = MAP.get(bare);
    return m ? { ...m, attr: key } : undefined;
  }
  const m = MAP.get("android:" + key);
  return m ? { ...m, attr: key } : undefined;
}

/** 属性说明文案（查不到返回空串，视图据此显示「自定义属性」） */
export function themeItemDescText(name: string): string {
  return themeItemDesc(name)?.desc || "";
}

/** 值类型（查不到给 other） */
export function themeItemType(name: string): ThemeItemValueType {
  return themeItemDesc(name)?.type || "other";
}
