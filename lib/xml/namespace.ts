// lib/xml/namespace.ts — M12：属性命名空间校验（aapt 编译通过性）
//
// 背景：androidx / Material 的属性（cornerRadius、cardCornerRadius、boxStrokeColor…）
// 定义在库里，命名空间是 `app:`（res-auto）。写成 `android:` 时 aapt 直接报
//   No resource identifier found for attribute 'cornerRadius' in package 'android'
// 预览站不解析命名空间所以看不出问题 —— 导出到 AIDE / Android Studio 才炸。

/** 必须写成 app: 的属性名（androidx / MaterialComponents / AppCompat 库属性） */
export const ANDROIDX_ATTRS = new Set<string>([
  // MaterialButton / MaterialCardView
  "cornerRadius",
  "strokeColor",
  "strokeWidth",
  "backgroundTint",
  "rippleColor",
  "iconGravity",
  "iconPadding",
  "iconSize",
  "icon",
  "iconTint",
  "iconTintMode",
  "shapeAppearance",
  "shapeAppearanceOverlay",
  "elevationOverlayColor",
  // TextInputLayout
  "boxBackgroundMode",
  "boxBackgroundColor",
  "boxStrokeColor",
  "boxStrokeWidth",
  "boxStrokeWidthFocused",
  "boxCornerRadiusTopStart",
  "boxCornerRadiusTopEnd",
  "boxCornerRadiusBottomStart",
  "boxCornerRadiusBottomEnd",
  "hintEnabled",
  "counterEnabled",
  "endIconMode",
  "startIconDrawable",
  "endIconDrawable",
  // CardView
  "cardCornerRadius",
  "cardElevation",
  "cardMaxElevation",
  "cardBackgroundColor",
  "cardForegroundColor",
  "cardUseCompatPadding",
  "cardPreventCornerOverlap",
  "contentPadding",
  "contentPaddingLeft",
  "contentPaddingTop",
  "contentPaddingRight",
  "contentPaddingBottom",
  // TabLayout
  "tabIndicatorColor",
  "tabIndicatorHeight",
  "tabIndicatorFullWidth",
  "tabMode",
  "tabGravity",
  "tabTextColor",
  "tabSelectedTextColor",
  "tabRippleColor",
  // Chip / ChipGroup
  "chipCornerRadius",
  "chipBackgroundColor",
  "chipStrokeWidth",
  "chipStrokeColor",
  "chipIcon",
  "chipStartPadding",
  "chipEndPadding",
  "closeIcon",
  "checkedIconVisible",
  "singleSelection",
  "chipSpacing",
  "chipSpacingHorizontal",
  "chipSpacingVertical",
  "chipMinHeight",
  // Toolbar（androidx.appcompat.widget.Toolbar）
  "title",
  "subtitle",
  "titleTextColor",
  "subtitleTextColor",
  "navigationIcon",
  "titleMarginStart",
  "titleMarginTop",
  "logo",
  // BottomNavigationView / NavigationView
  "menu",
  "itemIconTint",
  "itemTextColor",
  "itemBackground",
  // FloatingActionButton / ImageView 扩展
  "srcCompat",
  "fabSize",
  "maxImageSize",
  "behavior_overlapTop",
  // ProgressIndicator（Material）
  "indicatorColor",
  "trackColor",
  "trackThickness",
  "indicatorSize",
  // AppBarLayout / CollapsingToolbarLayout / CoordinatorLayout 行为属性
  "layout_scrollFlags",
  "layout_collapseMode",
  "layout_collapseParallaxMultiplier",
  "layout_behavior",
  "layout_anchor",
  "layout_anchorGravity",
  "layout_keyline",
  "expandedTitleMargin",
  "contentScrim",
  "statusBarScrim",
]);

/** 平台属性里**没有**这些名字，所以写成 android: 一定编译不过；
 * 但 GridLayout 的 columnCount / layout_columnWeight 等确实是平台属性，绝不能改。
 */
export const ANDROID_ONLY_ATTRS = new Set<string>([
  "columnCount",
  "rowCount",
  "alignmentMode",
  "useDefaultMargins",
  "layout_column",
  "layout_row",
  "layout_columnSpan",
  "layout_rowSpan",
  "layout_columnWeight",
  "layout_rowWeight",
]);

/** 完全不带命名空间的属性（写成 android:style 是 aapt 报错的主力） */
export const NO_NAMESPACE_ATTRS = new Set<string>(["style", "class"]);

export interface NamespaceIssue {
  /** 1 基行号 */
  line: number;
  /** 原写法，如 android:cornerRadius */
  from: string;
  /** 应该写成，如 app:cornerRadius */
  to: string;
}

/** 找出「应该用 app: 却写成了 android:」的属性（aapt 会报错的那些） */
export function namespaceIssues(src: string): NamespaceIssue[] {
  const out: NamespaceIssue[] = [];
  const lines = src.split(/\r?\n/);
  lines.forEach((text, i) => {
    for (const m of text.matchAll(/\bandroid:([A-Za-z0-9_]+)\s*=/g)) {
      const name = m[1];
      if (name === "style") {
        out.push({ line: i + 1, from: "android:style", to: "style" });
        continue;
      }
      if (ANDROIDX_ATTRS.has(name) && !ANDROID_ONLY_ATTRS.has(name)) {
        out.push({ line: i + 1, from: `android:${name}`, to: `app:${name}` });
      }
    }
  });
  return out;
}

/**
 * 自动修正命名空间，让导出的 XML 能被 aapt 编译：
 * ① android:{库属性} → app:{库属性}
 * ② android:style="…" → style="…"（style 不是带命名空间的属性）
 * ③ 用了 app: 却没声明 xmlns:app → 在根标签补一条
 */
export function fixNamespacePrefixes(src: string): string {
  let out = src.replace(/\bandroid:([A-Za-z0-9_]+)(\s*=)/g, (whole, name: string, eq: string) => {
    if (ANDROIDX_ATTRS.has(name) && !ANDROID_ONLY_ATTRS.has(name)) return `app:${name}${eq}`;
    return whole;
  });
  out = out.replace(/\bandroid:style(\s*=)/g, "style$1");
  if (/\bapp:[A-Za-z0-9_]+\s*=/.test(out) && !/xmlns:app\s*=/.test(out)) {
    out = out.replace(/<([A-Za-z_][A-Za-z0-9_.]*)(\s|>)/, (_m, tag: string, tail: string) =>
      tail === ">"
        ? `<${tag} xmlns:app="http://schemas.android.com/apk/res-auto">`
        : `<${tag} xmlns:app="http://schemas.android.com/apk/res-auto"${tail}`,
    );
  }
  return out;
}
