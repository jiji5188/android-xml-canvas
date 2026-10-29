// lib/xml/css.ts — Android 布局语义 → CSS 映射（M1 核心引擎）
// 把「已解析」的树转成 React 可直接用的 style 对象树。
// 单位：画布 scale 默认 1dp=2px（可通过 scale 参数调）。

import type { XmlNode, ResourceTable, RenderModel, ResolvedNode } from "./types";
import { resolveNodeAttrs, resolveSize, resolveColor } from "./resolve";
import type { ResolvedAttrs } from "./resolve";
import { solveConstraintChildren, type MeasuredMap } from "./constraints";
import { solveRelativeChildren } from "./relative";
import { expandIncludes, repath } from "./include";
import { SCREEN_DP, phoneBodyDp, readableOn } from "./theme";
import { vectorToDataUrl } from "./vector-svg";

const DP = (n: number, scale = 2) => n * scale;

/** 勾选框里的白色对勾（画在 ::before 的 background-image 上） */
const CTL_CHECK_IMG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23fff' d='M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'/%3E%3C/svg%3E\")";

/** 全限定类名 → 短名：androidx.recyclerview.widget.RecyclerView → RecyclerView */
function shortTag(tag: string): string {
  return tag.includes(".") ? tag.slice(tag.lastIndexOf(".") + 1) : tag;
}

/** 控件类名（占位渲染用） */
function viewClass(rawTag: string, a: ResolvedAttrs): string {
  const tag = shortTag(rawTag);
  switch (tag) {
    case "TextView":
    case "AppCompatTextView":
    case "Button":
    case "AppCompatButton":
    case "MaterialButton":
    case "EditText":
    case "AppCompatEditText":
    case "TextInputEditText":
    case "AutoCompleteTextView":
    case "AppCompatAutoCompleteTextView":
    case "SearchView":
    case "AppCompatSearchView":
    case "MultiAutoCompleteTextView":
      return "axv-text";
    case "ImageView":
    case "AppCompatImageView":
    case "ImageButton":
    case "AppCompatImageButton":
    case "androidx.appcompat.widget.AppCompatImageButton":
      return "axv-image";
    case "ProgressBar":
      return "axv-progress";
    case "View":
    case "Space":
      return "axv-view";
    // M2a：复合 / 常用控件占位
    case "CardView":
    case "MaterialCardView":
      return "axv-card";
    case "RecyclerView":
    case "ListView":
      return "axv-list";
    case "ViewStub":
      return "axv-viewstub";
    case "Switch":
    case "SwitchMaterial":
    case "SwitchCompat":
      return "axv-switch";
    case "CheckBox":
    case "AppCompatCheckBox":
      return "axv-check";
    case "RadioButton":
    case "AppCompatRadioButton":
      return "axv-radio";
    case "SeekBar":
    case "Slider":
      return "axv-seek";
    case "ToggleButton":
    case "AppCompatToggleButton":
      return "axv-text";
    case "NumberPicker":
      return "axv-numberpicker";
    // M11x：Material 组件
    case "Chip":
      return "axv-chip";
    case "ChipGroup":
      return "axv-chipgroup";
    case "TabLayout":
      return "axv-tabs";
    case "TabItem":
      return "axv-tab";
    case "FloatingActionButton":
      return "axv-fab";
    case "ExtendedFloatingActionButton":
      return "axv-fab-ext";
    case "BottomNavigationView":
    case "NavigationBarView":
      return "axv-bottomnav";
    case "Toolbar":
    case "MaterialToolbar":
      return "axv-toolbar";
    case "CircularProgressIndicator":
    case "LinearProgressIndicator":
      return "axv-progress";
    case "Spinner":
      return "axv-spinner";
    // M11t：评分条（5 颗星，按 rating/numStars 上色）
    case "RatingBar":
      return "axv-rating";
    // M2c：ConstraintLayout 辅助节点（渲染为参考线）
    case "Guideline":
      return "axv-guideline";
    case "Barrier":
      return "axv-barrier";
    case "include":
      return "axv-include";
    default:
      return "axv-container";
  }
}

function sizeToCss(s: unknown, scale: number): string {
  if (s === null || s === undefined) return "auto";
  const spec = s as { kind: string; value?: number };
  switch (spec.kind) {
    case "match": return "100%";
    case "wrap": return "auto";
    case "zero": return "0px";
    case "px": return `${spec.value}px`;
    case "dp": return `${DP(spec.value ?? 0, scale)}px`;
    default: return "auto";
  }
}

function gravityToJustify(g: string): Record<string, string> {
  const v: Record<string, string> = {};
  if (!g) return v;
  const parts = g.split("|");
  const has = (...vals: string[]) => parts.some((p) => vals.includes(p));
  if (has("center")) {
    v.justifyContent = "center";
    v.alignItems = "center";
  } else {
    if (has("top")) v.justifyContent = "flex-start";
    if (has("bottom")) v.justifyContent = "flex-end";
    if (has("center_vertical")) v.justifyContent = "center";
    if (has("start") || has("left")) v.alignItems = "flex-start";
    if (has("end") || has("right")) v.alignItems = "flex-end";
    if (has("center_horizontal")) v.alignItems = "center";
  }
  return v;
}

/**
 * M11s：LinearLayout 的 gravity 按「主轴 / 交叉轴」正确映射。
 * Android 里 gravity 的横向分量（start/left/end/right/center_horizontal）和
 * 纵向分量（top/bottom/center_vertical）跟主轴无关，而 CSS flex 的
 * justifyContent 永远是主轴、alignItems 永远是交叉轴 —— 所以必须知道 orientation：
 *   vertical（column）：主轴=纵向，交叉轴=横向
 *   horizontal（row） ：主轴=横向，交叉轴=纵向
 * 老实现不看 orientation，导致 `center_vertical` 在横向布局里被错当成主轴居中。
 */
function gravityToFlexByOrientation(
  gRaw: string,
  vertical: boolean
): { justifyContent?: string; alignItems?: string } {
  const parts = (gRaw || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: { justifyContent?: string; alignItems?: string } = {};
  if (!parts.length) return out;
  const has = (...vals: string[]) => parts.some((p) => vals.includes(p));

  // 横向分量 → start | center | end | fill | ""
  const h = has("center", "center_horizontal")
    ? "center"
    : has("start", "left")
      ? "start"
      : has("end", "right")
        ? "end"
        : has("fill_horizontal")
          ? "fill"
          : "";
  // 纵向分量
  const v = has("center", "center_vertical")
    ? "center"
    : has("top")
      ? "start"
      : has("bottom")
        ? "end"
        : has("fill_vertical")
          ? "fill"
          : "";

  const just = (x: string) =>
    x === "center" ? "center" : x === "start" ? "flex-start" : x === "end" ? "flex-end" : undefined;
  const align = (x: string) =>
    x === "center"
      ? "center"
      : x === "start"
        ? "flex-start"
        : x === "end"
          ? "flex-end"
          : x === "fill"
            ? "stretch"
            : undefined;

  if (vertical) {
    const j = just(v);
    if (j) out.justifyContent = j;
    const a = align(h);
    if (a) out.alignItems = a;
  } else {
    const j = just(h);
    if (j) out.justifyContent = j;
    const a = align(v);
    if (a) out.alignItems = a;
  }
  return out;
}

/** 文本类控件的 gravity → text-align（Button/TextView/EditText 语义） */
function gravityToTextAlign(g: string): "left" | "center" | "right" | undefined {
  if (!g) return undefined;
  const parts = g.split("|");
  if (parts.includes("center") || parts.includes("center_horizontal")) return "center";
  if (parts.includes("start") || parts.includes("left")) return "left";
  if (parts.includes("end") || parts.includes("right")) return "right";
  return undefined;
}

/** 文本类控件的 gravity → flex 对齐（.axv-text 是 flex 容器，textAlign 管不到匿名文本项） */
function gravityToFlexAlign(g: string): Record<string, string> {
  const v: Record<string, string> = {};
  if (!g) return v;
  const parts = g.split("|");
  const has = (...vals: string[]) => parts.some((p) => vals.includes(p));
  if (has("center")) {
    v.justifyContent = "center";
    v.alignItems = "center";
    return v;
  }
  if (has("center_horizontal")) v.justifyContent = "center";
  else if (has("start", "left")) v.justifyContent = "flex-start";
  else if (has("end", "right")) v.justifyContent = "flex-end";
  if (has("center_vertical")) v.alignItems = "center";
  else if (has("top")) v.alignItems = "flex-start";
  else if (has("bottom")) v.alignItems = "flex-end";
  return v;
}

/** M4q：#RRGGBB / #AARRGGBB → "r,g,b"；用来算阴影颜色 */
function rgbOf(raw: string | undefined): string | null {
  if (!raw) return null;
  const h = raw.trim().replace(/^#/, "");
  const hex = (s: string) => parseInt(s, 16);
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;
  if (h.length === 8) return `${hex(h.slice(2, 4))},${hex(h.slice(4, 6))},${hex(h.slice(6, 8))}`;
  if (h.length === 6) return `${hex(h.slice(0, 2))},${hex(h.slice(2, 4))},${hex(h.slice(4, 6))}`;
  if (h.length === 3) return `${hex(h[0] + h[0])},${hex(h[1] + h[1])},${hex(h[2] + h[2])}`;
  return null;
}

/** M11t：flex 对齐值 → CSS Grid 的 justify-items / align-items 值（grid 不认 flex-start/flex-end） */
function gridAlign(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  if (v === "center") return "center";
  if (v === "flex-start") return "start";
  if (v === "flex-end") return "end";
  if (v === "stretch") return "stretch";
  return fallback;
}

/** M11t：GridLayout 子项的 layout_gravity → justify-self（横向）/ align-self（纵向） */
function layoutGravityToGridSelf(g: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!g) return out;
  const parts = g.split("|").map((s) => s.trim());
  const has = (...vals: string[]) => parts.some((p) => vals.includes(p));
  const h = has("center", "center_horizontal")
    ? "center"
    : has("start", "left")
      ? "start"
      : has("end", "right")
        ? "end"
        : has("fill_horizontal")
          ? "stretch"
          : "";
  const v = has("center", "center_vertical")
    ? "center"
    : has("top")
      ? "start"
      : has("bottom")
        ? "end"
        : has("fill_vertical")
          ? "stretch"
          : "";
  if (h) out.justifySelf = h;
  if (v) out.alignSelf = v;
  return out;
}

function layoutGravityToSelf(g: string): Record<string, string> {
  const v: Record<string, string> = {};
  if (!g) return v;
  if (g.includes("center")) v.alignSelf = "center";
  if (g.includes("end") || g.includes("right")) v.alignSelf = "flex-end";
  if (g.includes("start") || g.includes("left")) v.alignSelf = "flex-start";
  return v;
}

/** M2v：GridLayout 列数——显式 columnCount 优先，否则按子项最大的 layout_column+1 推，兜底 1 */
export function gridColumnCount(raw: unknown, node: { children: { attrs: Record<string, string> }[] }): number {
  const n = typeof raw === "number" ? raw : parseInt(String(raw ?? ""), 10);
  if (Number.isFinite(n) && n > 0) return Math.min(n, 24);
  let max = 0;
  for (const c of node.children) {
    const v = parseInt(c.attrs["layout_column"] ?? "", 10);
    if (Number.isFinite(v) && v + 1 > max) max = v + 1;
  }
  return Math.min(Math.max(max, 1), 24);
}

function orientationAlign(dir: string): { flexDirection: string; alignItems?: string } {
  return dir === "horizontal"
    ? { flexDirection: "row" }
    : { flexDirection: "column" };
}

export function buildRenderModel(
  root: XmlNode,
  res: ResourceTable,
  scale = 2,
  /** M2q：@layout 名 → XML 文本，供 <include> 就地展开（resdir 上传 / 内粘贴） */
  layouts?: Record<string, string>,
  /** M2r：预览屏尺寸（dp），不传走默认手机竖屏；影响 match_parent 根/CL 内容区尺寸 */
  screen?: { w: number; h: number },
  /** M2t：wrap_content 实测尺寸（path → CSS px），浏览器第二遍求解用 */
  measured?: MeasuredMap,
): RenderModel {
  const issues: import("./types").XmlIssue[] = [];
  const screenW = screen?.w ?? SCREEN_DP.w;
  const screenH = screen?.h ?? SCREEN_DP.h;
  /** 内容区高（扣状态栏/导航栏），CL/Flex 根的高度回落值 */
  const bodyH = screen ? phoneBodyDp(screen.h) : phoneBodyDp();

  // M2q：先展开 include，让 CL/RL/LinearLayout 求解器看到的是一棵完整树
  if (layouts) {
    expandIncludes(root, layouts, issues);
    repath(root);
  }

  /** isRoot：根布局在窗口里总是填满内容区，它的 layout_margin 在 Android 里也不会
   *  产生「缩进」，但会让人误以为填充不满（拖动根节点留下的残值就属于这种）。
   *  预览忽略根节点 margin，保证 match_parent 的根一定贴边填满预览框。 */
  const resolveAll = (node: XmlNode, isRoot = false): ResolvedNode => {
    const { attrs, issues: nIssues } = resolveNodeAttrs(node, res);
    issues.push(...nIssues);
    const style: Record<string, string | number> = {};
    const tag = shortTag(node.tag); // 全限定类名归一化
    /** M4s：图片控件内容图（src）单独画在 background 之上 */
    let imgSrc = "";
    let imgFit = "";
    /** M4z：scaleType=fitStart/fitEnd 的对齐（center 之外的两端） */
    let imgPos = "";
    let imgBlend = "";
    let imgTint = "";

    // 容器
    const isCL = tag === "ConstraintLayout" || tag === "ConstraintSet";
    const isRL = tag === "RelativeLayout";
    // M2v：容器分类集合（新增 CoordinatorLayout / DrawerLayout / GridLayout / NestedScrollView / TableLayout…）
    const isGrid = tag === "GridLayout";
    const FRAME_LIKE = new Set([
      "FrameLayout",
      "CoordinatorLayout",
      "DrawerLayout",
      "FragmentContainerView",
      "merge",
    ]);
    const SCROLL_V = new Set(["ScrollView", "NestedScrollView", "androidx.core.widget.NestedScrollView"]);
    const SCROLL_H = new Set(["HorizontalScrollView"]);
    const isFrameLike = FRAME_LIKE.has(tag);
    // RelativeLayout：子项位置由规则求解（见 relative.ts），容器自身仍需 position:relative
    // 作为 absolute 子项的定位基准
    if (isRL) {
      style.display = "block";
      style.position = "relative";
    } else if (isGrid) {
      // GridLayout → CSS Grid：columnCount 决定列数（缺省按子项 layout_column 推）
      style.display = "grid";
      const cols = gridColumnCount(attrs["columnCount"], node);
      style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      // M11t：GridLayout 的 android:gravity → 格子内对齐（横向→justify-items，纵向→align-items）
      const gg = gravityToFlexByOrientation((attrs["gravity"] as string) || "", false);
      style.alignItems = gridAlign(gg.alignItems, "start");
      style.justifyItems = gridAlign(gg.justifyContent, "stretch");
    } else if (tag === "LinearLayout" || isFrameLike || SCROLL_V.has(tag) || SCROLL_H.has(tag) || tag === "CardView" || tag === "MaterialCardView" || tag === "TableLayout" || tag === "TableRow" || isCL) {
      style.display = "flex";
      if (SCROLL_V.has(tag)) {
        style.flexDirection = "column";
        style.overflowY = "auto";
      } else if (SCROLL_H.has(tag)) {
        style.flexDirection = "row";
        style.overflowX = "auto";
      } else if (tag === "LinearLayout") {
        const o = orientationAlign((attrs["orientation"] as string) || "vertical");
        style.flexDirection = o.flexDirection;
        const g = gravityToFlexByOrientation(
          (attrs["gravity"] as string) || "",
          o.flexDirection === "column"
        );
        style.justifyContent = g.justifyContent ?? "flex-start";
        style.alignItems = g.alignItems ?? "stretch";
      } else if (tag === "TableRow") {
        // M11s：TableRow 是横向布局，gravity 的纵向分量 → 交叉轴
        style.flexDirection = "row";
        const g = gravityToFlexByOrientation((attrs["gravity"] as string) || "", false);
        style.justifyContent = g.justifyContent ?? "flex-start";
        style.alignItems = g.alignItems ?? "stretch";
      } else if (tag === "TableLayout") {
        style.flexDirection = "column";
        const g = gravityToFlexByOrientation((attrs["gravity"] as string) || "", true);
        style.justifyContent = g.justifyContent ?? "flex-start";
        style.alignItems = g.alignItems ?? "stretch";
      } else if (tag === "CardView" || tag === "MaterialCardView") {
        style.flexDirection = "column";
      } else {
        // FrameLayout / CoordinatorLayout / DrawerLayout / ConstraintLayout
        style.position = "relative";
      }
    }

    // 通用尺寸（所有节点）
    const w = sizeToCss(attrs["width"], scale);
    const h = sizeToCss(attrs["height"], scale);
    const weight = attrs["weight"] as number;
    if (weight > 0) {
      style.flexGrow = weight;
      style.flexShrink = 1;
      style.minWidth = 0;
      if ((attrs["width"] as { kind?: string })?.kind === "zero" || (attrs["width"] as { kind?: string })?.kind === "match") {
        style.flexBasis = "0px";
      }
    }

    // 边距（用 longhand，便于 M1b 属性面板逐边编辑 + 回写）
    // 根节点强制归零：见 resolveAll 的 isRoot 说明
    const mt = isRoot ? 0 : DP((attrs["marginT"] as number) || 0, scale);
    const mr = isRoot ? 0 : DP((attrs["marginR"] as number) || 0, scale);
    const mb = isRoot ? 0 : DP((attrs["marginB"] as number) || 0, scale);
    const ml = isRoot ? 0 : DP((attrs["marginL"] as number) || 0, scale);

    // 内边距（longhand）
    const pt = DP((attrs["paddingT"] as number) || 0, scale);
    const pr = DP((attrs["paddingR"] as number) || 0, scale);
    const pb = DP((attrs["paddingB"] as number) || 0, scale);
    const pl = DP((attrs["paddingL"] as number) || 0, scale);

    // ===== match_parent + margin：必须用 calc 扣掉，否则右侧溢出屏幕 =====
    // Android 语义：layout_width="match_parent" 的可视宽度 = 父内容宽 - 左右 margin。
    // CSS 里 `width:100%` 已经是父内容宽（父 padding 已被百分比解析扣过），而 margin 是
    // 外挂的 → 100% + margin 会超宽，所以只扣 margin。
    // ⚠ padding 不能扣：`.axv-node` 是 border-box，padding 已经在盒内，
    //   再扣一次会让盒子变窄，右侧/底部凭空出现一道间隙（根布局 match_parent 尤其明显）。
    const isMatchW = w === "100%";
    const isMatchH = h === "100%";
    let finalW = isMatchW ? "100%" : w;
    let finalH = isMatchH ? "100%" : h;
    if (isMatchW && (ml || mr)) {
      finalW = `calc(100% - ${ml + mr}px)`;
    }
    if (isMatchH && (mt || mb)) {
      finalH = `calc(100% - ${mt + mb}px)`;
    }
    // 有 padding 时显式声明 border-box（Android 的 padding 永远在盒内）
    if (pt || pr || pb || pl) style.boxSizing = "border-box";

    // 尺寸
    style.width = w === "0px" && weight === 0 ? "auto" : finalW;
    style.height = h === "0px" ? "auto" : finalH;

    if (mt) style.marginTop = `${mt}px`;
    if (mr) style.marginRight = `${mr}px`;
    if (mb) style.marginBottom = `${mb}px`;
    if (ml) style.marginLeft = `${ml}px`;

    if (pt) style.paddingTop = `${pt}px`;
    if (pr) style.paddingRight = `${pr}px`;
    if (pb) style.paddingBottom = `${pb}px`;
    if (pl) style.paddingLeft = `${pl}px`;

    // 背景 / 圆角 / 阴影
    // M4i：只接受合法 CSS 颜色（#hex / rgb() / 命名色 / transparent）
    // 以前不管三七二十一就写进 backgroundColor，一旦值是 "@drawable/x" 就会被浏览器当非法值丢掉，
    // 而后面的 Button 默认样式又拿这个原始字符串当颜色用 → 按钮背景直接没了
    const bg = (attrs["background"] as string) || "";
    const bgIsColor = /^(#|rgb\(|rgba\(|hsl\(|hsla\(|[a-zA-Z]+$)/.test(bg);
    if (bg && bgIsColor) style.backgroundColor = bg;
    const r = (attrs["radius"] as number) || 0;
    if (r) style.borderRadius = `${DP(r, scale)}px`;
    // M2w：<shape> 背景（@drawable/bg_xxx 引用的渐变/圆角/描边），覆盖上面的纯色
    const shape = attrs["bgShape"] as { gradient?: string; solid?: string; radiusDp?: number; cornersDp?: { tl: number; tr: number; br: number; bl: number }; strokeDp?: number; strokeColor?: string; oval?: boolean; shadow?: { dx: number; dy: number; blur: number; color: string }; insetDp?: { t: number; r: number; b: number; l: number } } | null;
    /** M5c：<inset> 背景：单独画一层（内缩 t/r/b/l），不裁子控件 */
    let bgInset: ResolvedNode["bgInset"];
    if (shape) {
      /** M5c：<inset> 背景画到单独的 bgInset 层（不裁子控件），不直接写节点 background */
      if (shape.insetDp && (shape.insetDp.t || shape.insetDp.r || shape.insetDp.b || shape.insetDp.l)) {
        const i = shape.insetDp;
        let radius = "0px";
        if (shape.oval) radius = "50%";
        else if (shape.cornersDp) {
          const c = shape.cornersDp;
          radius = `${DP(c.tl, scale)}px ${DP(c.tr, scale)}px ${DP(c.br, scale)}px ${DP(c.bl, scale)}px`;
        } else if (shape.radiusDp !== undefined) radius = `${DP(shape.radiusDp, scale)}px`;
        bgInset = {
          t: i.t,
          r: i.r,
          b: i.b,
          l: i.l,
          fill: shape.gradient ?? shape.solid ?? "#E0E0E0",
          radius,
          border:
            shape.strokeDp && shape.strokeColor
              ? `${DP(shape.strokeDp, scale)}px solid ${shape.strokeColor}`
              : undefined,
        };
      } else {
        if (shape.gradient) {
          style.backgroundImage = shape.gradient;
        } else if (shape.solid) {
          style.backgroundColor = shape.solid;
        }
        if (shape.oval) {
          style.borderRadius = "50%";
        } else if (shape.cornersDp) {
          const c = shape.cornersDp;
          style.borderRadius = `${DP(c.tl, scale)}px ${DP(c.tr, scale)}px ${DP(c.br, scale)}px ${DP(c.bl, scale)}px`;
        } else if (shape.radiusDp !== undefined) {
          style.borderRadius = `${DP(shape.radiusDp, scale)}px`;
        }
        if (shape.strokeDp && shape.strokeColor) {
          style.border = `${DP(shape.strokeDp, scale)}px solid ${shape.strokeColor}`;
          style.boxSizing = "border-box";
        }
      }
      // M3h-2：layer-list 阴影层（elevation 没设时才用，否则下面会覆盖）
      if (shape.shadow) {
        const sh = shape.shadow;
        style.boxShadow = `${DP(sh.dx, scale)}px ${DP(sh.dy, scale)}px ${DP(sh.blur, scale)}px ${sh.color}`;
      }
    }
    // M4i：background="@drawable/位图或矢量" —— 不是 shape 时按图片铺上去
    const bgVector = (attrs["bgVector"] as string) || "";
    let bgUrl = (attrs["bgImage"] as string) || "";
    if (!bgUrl && bgVector) {
      try {
        bgUrl = vectorToDataUrl(bgVector) || "";
      } catch {
        bgUrl = "";
      }
    }
    if (bgUrl && !bgUrl.startsWith("vector:") && !bgUrl.startsWith("missing:")) {
      style.backgroundImage = style.backgroundImage ?? `url(${bgUrl})`;
      style.backgroundSize = "100% 100%";
      style.backgroundPosition = "center";
      style.backgroundRepeat = "no-repeat";
      style.backgroundColor = style.backgroundColor ?? "transparent";
    }
    // ===== M3e：elevation / translationZ =====
    // Android 里 Z = elevation + translationZ，它不仅决定阴影大小，
    // **更决定绘制层级**：Z 高的控件会盖住 Z 低的兄弟（即使 XML 里写在前面）。
    // 所以除了 boxShadow，还必须映射成 z-index，否则重叠场景预览就是错的。
    const elAttr = attrs["elevation"] as unknown;
    const tzAttr = attrs["translationZ"] as unknown;
    /** 属性值可能是 { kind:"dp", value } 也可能是原始字符串，两种都认 */
    const dpOf = (v: unknown): number => {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const m = /^(-?\d+(?:\.\d+)?)\s*(?:dp|dip)?$/.exec(v.trim());
        return m ? Number(m[1]) : 0;
      }
      if (v && typeof v === "object") {
        const o = v as { kind?: string; value?: number };
        return o.kind === "dp" ? o.value ?? 0 : 0;
      }
      return 0;
    };
    const elDp = dpOf(elAttr);
    const tzDp = dpOf(tzAttr);
    const zDp = elDp + tzDp;
    if (zDp > 0) {
      const d = zDp * scale;
      // 双层阴影更接近 Material 的真实观感：近处实影 + 远处柔影
      // M4q：outlineSpotShadowColor / outlineAmbientShadowColor（API 28+）能改阴影颜色
      const spot = rgbOf(attrs["outlineSpotShadowColor"] as string);
      const amb = rgbOf(attrs["outlineAmbientShadowColor"] as string);
      const near = spot ? `rgba(${spot},0.20)` : "rgba(0,0,0,0.20)";
      const far = amb ? `rgba(${amb},0.10)` : "rgba(0,0,0,0.10)";
      style.boxShadow = `0 ${Math.max(1, Math.round(d * 0.5))}px ${Math.round(d)}px ${near}, 0 ${Math.round(d * 1.5)}px ${Math.round(d * 2.5)}px ${far}`;
      // z-index 阶梯化：2dp 一档，避免浮点差异；选中态的 9999 仍会盖住它
      style.zIndex = 1 + Math.min(500, Math.round(zDp / 2));
    }

    // 可见性
    const vis = (attrs["visibility"] as string) || "visible";
    if (vis === "gone") style.display = "none";
    else if (vis === "invisible") style.visibility = "hidden";

    // ===== 变换：rotation / scale / alpha / translation =====
    const rot = (attrs["rotation"] as number) || 0;
    const rotX = (attrs["rotationX"] as number) || 0;
    const rotY = (attrs["rotationY"] as number) || 0;
    const sx = attrs["scaleX"] !== undefined ? (attrs["scaleX"] as number) : 1;
    const sy = attrs["scaleY"] !== undefined ? (attrs["scaleY"] as number) : 1;
    const tx = (attrs["translationX"] as number) || 0;
    const ty = (attrs["translationY"] as number) || 0;
    const parts: string[] = [];
    if (tx || ty) parts.push(`translate(${DP(tx, scale)}px, ${DP(ty, scale)}px)`);
    if (rot) parts.push(`rotate(${rot}deg)`);
    if (rotX) parts.push(`rotateX(${rotX}deg)`);
    if (rotY) parts.push(`rotateY(${rotY}deg)`);
    if (sx !== 1 || sy !== 1) parts.push(`scale(${sx}, ${sy})`);
    if (parts.length > 0) {
      style.transform = parts.join(" ");
      const pv = (attrs["pivotX"] as string) || "50%";
      const pvY = (attrs["pivotY"] as string) || "50%";
      style.transformOrigin = `${pv} ${pvY}`;
    }
    const alpha = attrs["alpha"] !== undefined ? (attrs["alpha"] as number) : 1;
    if (alpha !== 1) style.opacity = alpha;

    // 前景（foreground 覆盖层，CardView / FrameLayout 常见）
    const fg = (attrs["foreground"] as string) || "";
    if (fg && fg.startsWith("data:")) {
      // M11v：foregroundGravity 决定前景层的铺法（默认 center，fill 才拉伸）
      const fgg = (attrs["foregroundGravity"] as string) || "";
      const fill = fgg.includes("fill");
      const hpos = fgg.includes("end") || fgg.includes("right") ? "right" : fgg.includes("start") || fgg.includes("left") ? "left" : "center";
      const vpos = fgg.includes("bottom") ? "bottom" : fgg.includes("top") ? "top" : "center";
      style.backgroundImage = `url(${fg})`;
      style.backgroundSize = fill ? "100% 100%" : "auto";
      style.backgroundRepeat = "no-repeat";
      style.backgroundPosition = `${hpos} ${vpos}`;
    }

    // 文本类
    const cls = viewClass(node.tag, attrs);
    if (cls === "axv-text") {
      style.boxSizing = "border-box";
      const ts = (attrs["textSize"] as number) || 14;
      style.fontSize = `${DP(ts, scale)}px`;
      const tc = (attrs["textColor"] as string) || "#1D1B20";
      style.color = tc;
      const align = (attrs["textAlignment"] as string) || "";
      const gRaw = (attrs["gravity"] as string) || "";
      const ga = gravityToTextAlign(gRaw);
      // flex 容器里真正决定位置的是 justify-content / align-items
      Object.assign(style, gravityToFlexAlign(gRaw));
      if (align === "center" || ga === "center") {
        style.textAlign = "center";
        style.justifyContent = style.justifyContent ?? "center";
      } else if (ga) {
        style.textAlign = ga;
      }
      // M11v：android:fontFamily（@font/xxx 需要资源文件，这里只认系统字体名）
      const ff = (attrs["fontFamily"] as string) || "";
      if (ff && !ff.startsWith("@") && !ff.startsWith("?")) {
        style.fontFamily = `${ff}, Roboto, "Noto Sans SC", sans-serif`;
      }
      if ((attrs["textAllCaps"] as boolean)) style.textTransform = "uppercase";
      if ((attrs["textStyle"] as string) === "bold") style.fontWeight = 600;
      // M4r：TextView 文字阴影（shadowColor 不写就无阴影；Dx/Dy/Radius 默认 1/1/3dp）
      const shColor = (attrs["shadowColor"] as string) || "";
      if (shColor) {
        const sdx = (attrs["shadowDx"] as number) || 0;
        const sdy = (attrs["shadowDy"] as number) || 0;
        const sr = (attrs["shadowRadius"] as number) || 0;
        style.textShadow = `${(sdx * scale).toFixed(1)}px ${(sdy * scale).toFixed(1)}px ${(sr * scale).toFixed(1)}px ${shColor}`;
      }
      // M4q：Button 家族预览对齐 Android 默认样式（minWidth 88dp / minHeight 48dp / 左右 16dp 内边距 /
      // 文字居中 / Button 默认全大写），仅在 XML 没显式写时才补
      if (tag === "Button" || tag === "AppCompatButton" || tag === "MaterialButton" || tag === "ImageButton") {
        style.minWidth = style.minWidth ?? `${DP(88, scale)}px`;
        style.minHeight = style.minHeight ?? `${DP(48, scale)}px`;
        style.paddingLeft = style.paddingLeft ?? `${DP(16, scale)}px`;
        style.paddingRight = style.paddingRight ?? `${DP(16, scale)}px`;
        style.paddingTop = style.paddingTop ?? `${DP(8, scale)}px`;
        style.paddingBottom = style.paddingBottom ?? `${DP(8, scale)}px`;
        style.textAlign = style.textAlign ?? "center";
        style.justifyContent = style.justifyContent ?? "center";
        style.alignItems = style.alignItems ?? "center";
        if (tag !== "MaterialButton" && attrs["textAllCaps"] === undefined) style.textTransform = "uppercase";
      }
      // M11x：ToggleButton 是带底色的按钮（默认 ON/OFF 文案）——复用 button 的壳子
      if (tag === "ToggleButton" || tag === "AppCompatToggleButton") {
        style.minWidth = style.minWidth ?? `${DP(88, scale)}px`;
        style.minHeight = style.minHeight ?? `${DP(48, scale)}px`;
        style.paddingLeft = style.paddingLeft ?? `${DP(16, scale)}px`;
        style.paddingRight = style.paddingRight ?? `${DP(16, scale)}px`;
        style.textAlign = style.textAlign ?? "center";
        style.justifyContent = style.justifyContent ?? "center";
        style.alignItems = style.alignItems ?? "center";
        style.backgroundColor = style.backgroundColor ?? "#E8E8EC";
        style.color = style.color ?? "#1D1B20";
        style.borderRadius = style.borderRadius ?? `${DP(4, scale)}px`;
        style.cursor = "pointer";
      }
      // 排版细节：letterSpacing / lineSpacingExtra / maxLines / ellipsize
      const fsPx = parseFloat(String(style.fontSize ?? "28")) || 28;
      const ls = attrs["letterSpacing"] as number;
      if (ls) style.letterSpacing = `${(ls * fsPx).toFixed(2)}px`;
      const lse = attrs["lineSpacingExtra"] as number;
      if (lse) style.lineHeight = `${(fsPx * 1.2 + lse * scale).toFixed(1)}px`;
      const ml = attrs["maxLines"] as number;
      const ellip = (attrs["ellipsize"] as string) || "";
      if (ml > 0 || ellip) {
        if (ml > 0) {
          // M11x：少了 -webkit-box-orient: vertical，line-clamp 完全不生效（多行照样溢出）
          style.display = "-webkit-box";
          style.WebkitBoxOrient = "vertical";
          style.WebkitLineClamp = String(ml);
          style.overflow = "hidden";
        }
        if (ellip === "end") style.textOverflow = "ellipsis";
        else if (ellip === "start") style.textAlign = "right";
      }
      // Button/EditText 默认样式
      if (tag === "Button" || tag === "MaterialButton" || tag === "AppCompatButton") {
        // M4i：显式 background 优先（颜色 / shape 填色 / 渐变 / 位图），都没有才用默认主色。
        // 以前是 style.backgroundColor = bg || "#6750A4"，会把 shape 的 solid 抹成灰色/默认色。
        const tint = (attrs["backgroundTint"] as string) || "";
        if (tint && !bg) style.backgroundColor = tint;
        if (!style.backgroundColor && !style.backgroundImage) style.backgroundColor = "#6750A4";
        // 文字色：显式 textColor > 按背景亮度自动反色（tc 有默认值不能直接拿来做判断）
        const tcRaw = (attrs["textColor"] as string) || "";
        const solidBg = typeof style.backgroundColor === "string" ? style.backgroundColor : "";
        const autoFg = solidBg && /^(#|rgb)/.test(solidBg)
          ? readableOn(solidBg).fg.includes("255,255,255")
            ? "#FFFFFF"
            : "#1D1B20"
          : "#FFFFFF";
        style.color = tcRaw || autoFg;
        style.borderRadius = style.borderRadius ?? `${DP(20, scale)}px`;
        style.fontWeight = 500;
        style.cursor = "pointer";
        // M11x：app:strokeColor + strokeWidth 的 MaterialButton 是「描边按钮」（OutlinedButton），
        // 底色应透明、文字跟描边同色 —— 以前一律涂满主色，看起来像实心按钮
        const sCol = (attrs["strokeColor"] as string) || "";
        const sW = (attrs["strokeWidth"] as number) || 0;
        if (tag === "MaterialButton" && sCol && !tint && !bg) {
          style.backgroundColor = "transparent";
          style.border = `${DP(sW || 1, scale)}px solid ${sCol}`;
          style.color = tcRaw || sCol;
        } else if (tag === "MaterialButton" && sCol && sW) {
          style.border = `${DP(sW, scale)}px solid ${sCol}`;
        }
      }
      if (tag === "EditText" || tag === "AppCompatEditText" || tag === "TextInputEditText") {
        style.border = style.border ?? "1px solid #E0D9E3";
        style.borderRadius = style.borderRadius ?? `${DP(8, scale)}px`;
        style.backgroundColor = style.backgroundColor ?? "#FFFFFF";
        if (attrs["hint"] && !(attrs["text"] as string)) {
          style.color = "#9A9AA8";
        }
      }
      style.minHeight = (attrs["minHeight"] as number) ? `${DP(attrs["minHeight"] as number, scale)}px` : style.minHeight;
    }

    if (cls === "axv-image") {
      const src = attrs["src"] as string;
      if (src && !src.startsWith("missing:")) {
        // 真图（dataURL）或矢量占位
        if (src.startsWith("vector:")) {
          // 矢量图：虚线紫框占位（真实 vector 路径不渲染，避免误导）
          style.backgroundColor = style.backgroundColor || "#EDE7F6";
          style.border = "1.5px dashed #9575CD";
        } else if (/^#[0-9a-fA-F]{3,8}$/.test(src.trim())) {
          // src 写成纯色（旧版选择器错误）——Android 当 ColorDrawable 画，预览也画底色
          style.backgroundColor = src.trim();
        } else if (/^(data:|https?:|blob:|builtin:)/.test(src)) {
          // M4s：真图不用 background 画，交给 <img> 内容层（background 在下、src 在上）
          // M4v：builtin: = @android:drawable/xxx 平台内置图标，XmlCanvas 画中性占位
          imgSrc = src;
          // M4z：Android scaleType → CSS object-fit / object-position 完整映射
          //   fitXY=fill（拉伸）  centerCrop=cover（裁切）
          //   fitCenter/centerInside=contain（等比缩放到完整可见，居中）
          //   fitStart=contain+左对齐  fitEnd=contain+右对齐
          //   center=none（原始尺寸居中，超出裁掉）  matrix=none（不做矩阵变换，近似 center）
          // M11：默认值按控件区分 —— ImageView 默认 fitCenter，ImageButton 默认 center
          const tagName = String(node.tag || "");
          const isImageButton = /ImageButton$/.test(tagName) || tagName === "ImageButton";
          const st = ((attrs["scaleType"] as string) || (isImageButton ? "center" : "fitCenter")).trim();
          switch (st) {
            case "fitXY":
              imgFit = "fill";
              break;
            case "centerCrop":
              imgFit = "cover";
              break;
            case "center":
              imgFit = "none";
              break;
            case "matrix":
              // matrix 不做任何缩放，从左上角开始绘制（近似 object-position: left top）
              imgFit = "none";
              imgPos = "left top";
              break;
            case "fitStart":
              imgFit = "contain";
              imgPos = "left center";
              break;
            case "fitEnd":
              imgFit = "contain";
              imgPos = "right center";
              break;
            case "fitCenter":
            case "centerInside":
            default:
              imgFit = "contain";
              break;
          }
          const tint = (attrs["tint"] as string) || "";
          if (tint && /^(#|rgb|hsl)/.test(tint)) {
            imgTint = tint;
            // M5a：android:tintMode → 叠加方式
            //   src_in / src_atop（默认、最常见）→ 用 mask 填色（对透明 png / vector 最准）
            //   multiply / screen / add → 保留原图，叠一层混色层（CSS mix-blend-mode）
            //   src_over → 保留原图，直接盖一层半透明色
            const tm = ((attrs["tintMode"] as string) || "src_in").trim();
            if (tm === "multiply") imgBlend = "multiply";
            else if (tm === "screen") imgBlend = "screen";
            else if (tm === "add") imgBlend = "plus-lighter";
            else if (tm === "src_over") imgBlend = "overlay";
            else imgBlend = "";
          }
        } else {
          // 其余非常见值（相对路径 / 未解析符号）不当图片画，给占位提示
          style.backgroundColor = style.backgroundColor || "#EDE7F6";
          style.border = "1.5px dashed #B0AEB8";
        }
      } else if (!src) {
        style.backgroundColor = style.backgroundColor || "#E0D9E3";
        style.minHeight = style.minHeight || `${DP(48, scale)}px`;
      } else {
        // missing:xxx —— 引用不存在的资源：红色虚线占位（不静默变空白）
        style.backgroundColor = style.backgroundColor || "#FFEBEE";
        style.border = "1.5px dashed #E57373";
      }
      if (attrs["adjustViewBounds"]) style.aspectRatio = "1 / 1";
      // CL 里的宽高比（0dp + layout_constraintDimensionRatio 在非 CL 容器时也吃）
      const ratioRaw = (attrs["dimensionRatio"] as string) || "";
      if (ratioRaw) {
        const body = ratioRaw.includes(",") ? ratioRaw.split(",").slice(1).join(",") : ratioRaw;
        const m = body.match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)/);
        if (m && parseFloat(m[2]) > 0) style.aspectRatio = `${parseFloat(m[1])} / ${parseFloat(m[2])}`;
      }
    }

    // ===== M11t：此前漏渲染的一批属性 =====
    const dpv = (v: unknown) => DP((v as number) || 0, scale);
    if (((attrs["minWidth"] as number) || 0) > 0) style.minWidth = `${dpv(attrs["minWidth"])}px`;
    if (((attrs["minHeight"] as number) || 0) > 0) style.minHeight = `${dpv(attrs["minHeight"])}px`;
    if (((attrs["maxWidth"] as number) || 0) > 0) style.maxWidth = `${dpv(attrs["maxWidth"])}px`;
    if (((attrs["maxHeight"] as number) || 0) > 0) style.maxHeight = `${dpv(attrs["maxHeight"])}px`;
    // android:enabled="false" → Material 禁用态（整体降到 0.38；已有 alpha 取更小值）
    if (attrs["enabled"] === false) {
      const cur = Number(style.opacity ?? 1) || 1;
      style.opacity = String(Math.min(cur, 0.38));
    }

    let progressRing = false;
    if (cls === "axv-progress") {
      const styleAttr = (attrs["progressStyle"] as string) || "";
      const linearTag = tag === "LinearProgressIndicator";
      const curH = String(style.height ?? "");
      if (/horizontal/i.test(styleAttr) || linearTag) {
        style.height = !curH || curH === "auto" || curH === "0px" ? `${DP(4, scale)}px` : style.height;
        style.backgroundColor = style.backgroundColor || "#E0D9E3";
        style.borderRadius = `${DP(2, scale)}px`;
        style.overflow = "hidden";
        // M11t：progress / secondaryProgress / indeterminate
        const maxP = (attrs["max"] as number) || 100;
        const curP = (attrs["progress"] as number) || 0;
        const ratio = maxP > 0 ? Math.min(1, Math.max(0, curP / maxP)) : 0;
        const secRatio = maxP > 0 ? Math.min(1, Math.max(0, ((attrs["secondaryProgress"] as number) || 0) / maxP)) : 0;
        (style as React.CSSProperties & Record<string, string>)["--axv-progress"] = String(ratio);
        (style as React.CSSProperties & Record<string, string>)["--axv-progress-color"] =
          (attrs["indicatorColor"] as string) || (attrs["progressTint"] as string) || (attrs["tint"] as string) || "#6750A4";
        if (secRatio > ratio) {
          style.backgroundImage = `linear-gradient(to right, transparent 0 ${ratio * 100}%, #C9C0F0 ${ratio * 100}% ${secRatio * 100}%, transparent ${secRatio * 100}%)`;
        }
        if (attrs["indeterminate"]) {
          (style as React.CSSProperties & Record<string, string>)["--axv-progress"] = "0.4";
        }
        // M11v：android:progressDrawable 是图片时，轨道直接用该图（含自定义底色/纹理）
        const pImg = (attrs["progressDrawable"] as string) || "";
        if (pImg.startsWith("data:")) {
          style.backgroundImage = `url(${pImg})`;
          style.backgroundSize = "100% 100%";
          style.backgroundRepeat = "no-repeat";
          style.backgroundColor = style.backgroundColor || "transparent";
        }
      } else {
        // M11w：没有 horizontal 样式就是转圈进度条 —— 画环 + 旋转，不能画成一根细条
        // M11z：wrap_content 也会给 "auto"，必须当成未设（否则环宽高 auto → 只剩 0 尺寸）
        const w0 = String(style.width ?? "");
        const h0 = String(style.height ?? "");
        if (!w0 || w0 === "auto") style.width = `${DP(32, scale)}px`;
        if (!h0 || h0 === "auto") style.height = `${DP(32, scale)}px`;
        (style as React.CSSProperties & Record<string, string>)["--axv-progress-color"] =
          (attrs["indicatorColor"] as string) || (attrs["progressTint"] as string) || (attrs["indeterminateTint"] as string) || "#6750A4";
        (style as React.CSSProperties & Record<string, string>)["--axv-ring-w"] = `${DP(3, scale)}px`;
        progressRing = true;
      }
    }

    // ===== M2a：复合 / 常用控件占位渲染 =====
    if (cls === "axv-card") {
      const cr = (attrs["cardCornerRadius"] as number) || 12;
      // M4i：background 可能是 shape/位图（backgroundColor 已由上面算好），不能无条件覆成白色
      // M11t：android:cardBackgroundColor 优先（CardView 的底色不写在 background 上）
      style.backgroundColor =
        (attrs["cardBackgroundColor"] as string) || style.backgroundColor || "#FFFFFF";
      style.borderRadius = `${DP(cr, scale)}px`;
      // 卡片没显式 elevation 时给个默认阴影（用了 elevation 就听 elevation 的；
      // M11t：android:cardElevation 也要算进来）
      if (elDp + tzDp + ((attrs["cardElevation"] as number) || 0) <= 0) {
        style.boxShadow = "0 2px 8px rgba(0,0,0,0.12)";
      }
      style.overflow = "hidden";
    }

    // M11v：contentPadding（CardView / TextInputLayout 的内容内边距）
    if (((attrs["contentPadding"] as number) || 0) > 0) {
      const cp = `${DP(attrs["contentPadding"] as number, scale)}px`;
      style.padding = cp;
      style.paddingTop = cp;
      style.paddingRight = cp;
      style.paddingBottom = cp;
      style.paddingLeft = cp;
    }

    // M11v：TextInputLayout（outline 盒子 / 描边色 / 填充色）
    if (tag === "TextInputLayout") {
      const mode = (attrs["boxBackgroundMode"] as string) || "";
      const stroke = (attrs["boxStrokeColor"] as string) || "";
      const bgBox = (attrs["boxBackgroundColor"] as string) || "";
      if (bgBox) style.backgroundColor = bgBox;
      else if (mode === "filled") style.backgroundColor = style.backgroundColor || "#F3EDF7";
      if (stroke) style.border = `${DP(1, scale)}px solid ${stroke}`;
      else if (mode === "outline") style.border = `${DP(1, scale)}px solid #79747E`;
      if (mode) style.borderRadius = `${DP(4, scale)}px`;
      // M11y：outline / filled 有内边距（左 16dp 上 8dp），否则文字贴着描边
      if (mode) {
        style.paddingLeft = style.paddingLeft === "0px" || !style.paddingLeft ? `${DP(16, scale)}px` : style.paddingLeft;
        style.paddingRight = style.paddingRight === "0px" || !style.paddingRight ? `${DP(16, scale)}px` : style.paddingRight;
        style.paddingTop = style.paddingTop === "0px" || !style.paddingTop ? `${DP(8, scale)}px` : style.paddingTop;
        style.paddingBottom = style.paddingBottom === "0px" || !style.paddingBottom ? `${DP(8, scale)}px` : style.paddingBottom;
      }
    }

    // M11y：SearchView —— 搜索框外观（圆角浅底 + 放大镜 + 左侧留位）
    if (tag === "SearchView" || tag === "AppCompatSearchView") {
      style.display = style.display ?? "flex";
      style.alignItems = "center";
      style.backgroundColor = style.backgroundColor ?? "#F3EDF7";
      style.borderRadius = style.borderRadius ?? `${DP(24, scale)}px`;
      style.paddingLeft = style.paddingLeft ?? `${DP(40, scale)}px`;
      style.paddingRight = style.paddingRight ?? `${DP(16, scale)}px`;
      style.color = style.color ?? "#49454F";
    }

    if (cls === "axv-list") {
      style.backgroundColor = style.backgroundColor || "#FFFFFF";
      style.minHeight = style.minHeight || `${DP(160, scale)}px`;
    }

    if (cls === "axv-switch" || cls === "axv-check" || cls === "axv-radio") {
      // 轨道/方框交给 ::before 画（见 globals.css），节点自身当 flex 行，
      // 这样 android:text 能显示在控件右侧（之前直接把文字丢了，「记住我」整行不见）
      const on = !!attrs["checked"];
      const cs = style as React.CSSProperties & Record<string, string>;
      style.display = "inline-flex";
      style.alignItems = "center";
      style.gap = `${DP(8, scale)}px`;
      if (!style.position || style.position === "static") style.position = "relative";
      style.boxSizing = "border-box";
      style.minWidth = "0";
      style.minHeight = "0";
      style.color = style.color || ((attrs["textColor"] as string) || "#1D1B20");
      style.fontSize = style.fontSize || `${DP((attrs["textSize"] as number) || 14, scale)}px`;
      if (cls === "axv-switch") {
        cs["--axv-ctl-w"] = `${DP(40, scale)}px`;
        cs["--axv-ctl-h"] = `${DP(22, scale)}px`;
        cs["--axv-ctl-r"] = `calc(${DP(22, scale)}px / 2)`;
        // M11t：滑块尺寸与边框宽度也要跟 scale 走（原来 CSS 里硬写 4px / 2px，2 倍图下比例不对）
        cs["--axv-ctl-thumb-d"] = `${DP(18, scale)}px`;
        cs["--axv-ctl-bw"] = "0px";
        // M11t：trackTint（轨道色）/ thumbTint（滑块色）优先于默认主题色
        const tkOn = (attrs["trackTint"] as string) || "#6750A4";
        const tkOff = (attrs["trackTint"] as string) || "#E0D9E3";
        cs["--axv-ctl-bg"] = on ? tkOn : tkOff;
        cs["--axv-ctl-ring"] = "transparent";
        cs["--axv-ctl-img"] = "none";
        cs["--axv-ctl-thumb"] = (attrs["thumbTint"] as string) || "#FFFFFF";
        cs["--axv-ctl-thumb-x"] = on ? `${DP(20, scale)}px` : `${DP(2, scale)}px`;
      } else {
        cs["--axv-ctl-w"] = `${DP(20, scale)}px`;
        cs["--axv-ctl-h"] = `${DP(20, scale)}px`;
        cs["--axv-ctl-r"] = cls === "axv-radio" ? "50%" : `${DP(3, scale)}px`;
        cs["--axv-ctl-bw"] = `${DP(2, scale)}px`;
        // M11t：buttonTint 同时作用于勾选态填充与边框色
        const bt = (attrs["buttonTint"] as string) || "#6750A4";
        cs["--axv-ctl-bg"] = cls === "axv-radio" ? "#FFFFFF" : on ? bt : "#FFFFFF";
        cs["--axv-ctl-ring"] = on ? bt : "#79747E";
        cs["--axv-ctl-img"] = on
          ? cls === "axv-radio"
            ? "radial-gradient(circle, #6750A4 0 42%, transparent 45%)"
            : CTL_CHECK_IMG
          : "none";
        cs["--axv-ctl-thumb-x"] = "0px";
      }
    }

    // M11t：RatingBar —— 星星用 mask 画（灰底 + 亮色裁剪），numStars / rating / stepSize 都生效
    if (cls === "axv-rating") {
      const stars = Math.max(1, (attrs["numStars"] as number) || 5);
      const rawRating = Math.max(0, Math.min(stars, (attrs["rating"] as number) || 0));
      const step = (attrs["stepSize"] as number) || 0.5;
      const rating = step > 0 ? Math.round(rawRating / step) * step : rawRating;
      const starPx = DP(18, scale);
      const cs = style as React.CSSProperties & Record<string, string>;
      style.display = "inline-flex";
      style.alignItems = "center";
      if (String(style.width ?? "auto") === "auto") style.width = `${starPx * stars}px`;
      if (String(style.height ?? "auto") === "auto") style.height = `${starPx}px`;
      if (!style.position || style.position === "static") style.position = "relative";
      cs["--axv-star"] = `${starPx}px`;
      cs["--axv-stars-w"] = `${starPx * stars}px`;
      cs["--axv-rating-w"] = `${starPx * Math.min(stars, rating)}px`;
      cs["--axv-star-on"] = (attrs["buttonTint"] as string) || "#F5A524";
      cs["--axv-star-off"] = "#DAD5E0";
    }

    if (cls === "axv-seek") {
      style.minWidth = `${DP(120, scale)}px`;
      style.minHeight = `${DP(24, scale)}px`;
      // M11w：SeekBar 的灰块是整个节点的背景（旧做法），Android 实际只有一条细轨道 →
      // 节点背景清空，轨道交给 ::before 画，滑块交给 ::after 画
      style.backgroundColor = (attrs["background"] as string) || "transparent";
      style.overflow = "visible";
      const p = (attrs["progress"] as number) || 0;
      const maxV = (attrs["max"] as number) || 100;
      const ratio = Math.min(1, Math.max(0, maxV > 0 ? p / maxV : 0));
      style["--axv-progress"] = String(ratio);
      style["--axv-seek-pct"] = `${(ratio * 100).toFixed(2)}%`;
      style["--axv-seek-track-h"] = `${DP(4, scale)}px`;
      style["--axv-seek-thumb-d"] = `${DP(20, scale)}px`;
      style["--axv-seek-color"] = (attrs["progressTint"] as string) || "#6750A4";
      style["--axv-seek-track-bg"] = (attrs["trackTint"] as string) || "#E0D9E3";
      // M11t：SeekBar 的滑块色（thumbTint，否则用主题色）
      style["--axv-seek-thumb"] = (attrs["thumbTint"] as string) || "#6750A4";
      // M11v：android:thumb 是图片（上传 res 后能解析成 data URL）就直接画图，颜色只做兜底
      const thumbImg = (attrs["thumb"] as string) || "";
      if (thumbImg.startsWith("data:")) {
        style["--axv-seek-thumb-img"] = `url(${thumbImg})`;
        style["--axv-seek-thumb"] = "transparent";
      }
    }

    if (cls === "axv-spinner") {
      style.minHeight = `${DP(40, scale)}px`;
      style.border = "1px solid #79747E";
      style.borderRadius = `${DP(8, scale)}px`;
      style.backgroundColor = style.backgroundColor || "#FFFFFF";
      style.paddingRight = `${DP(28, scale)}px`;
    }

    // ===== M2c：Guideline / Barrier 渲染为参考线（位置尺寸由 patchCL 求解写入） =====
    if (cls === "axv-guideline") {
      style.backgroundColor = "rgba(103,80,164,0.55)";
      style.zIndex = "2";
    } else if (cls === "axv-barrier") {
      style.backgroundColor = "rgba(255,111,0,0.45)";
      style.zIndex = "2";
    }

    if (cls === "axv-include") {
      style.minHeight = `${DP(48, scale)}px`;
      style.border = "1px dashed #B0AEB8";
      style.borderRadius = `${DP(4, scale)}px`;
    }

    // ViewStub：画个虚线占位框，标上将被填充的 layout 名
    if (cls === "axv-viewstub") {
      style.minHeight = `${DP(56, scale)}px`;
      style.border = "1px dashed #99C9A8";
      style.borderRadius = `${DP(4, scale)}px`;
      style.display = "flex";
      style.alignItems = "center";
      style.justifyContent = "center";
      style.fontStyle = "italic";
      style.color = "#6B8F7B";
      style.fontSize = "12px";
      style.backgroundColor = "rgba(153,201,168,0.08)";
    }

    // layout_gravity（FrameLayout / LinearLayout 子项）
    const lg = layoutGravityToSelf((attrs["layoutGravity"] as string) || "");
    Object.assign(style, lg);
    // FrameLayout / CoordinatorLayout / DrawerLayout 子项绝对定位（Android 这三者都是堆叠语义）
    const parentTag = shortTag(findParentTag(root, node) ?? "");
    const FRAME_PARENTS = new Set(["FrameLayout", "CoordinatorLayout", "DrawerLayout", "FragmentContainerView"]);
    if (FRAME_PARENTS.has(parentTag)) {
      style.position = "absolute";
      // 堆叠语义：基础层 1；有 elevation/translationZ 的子项已经算好更高的 z，不能覆盖
      if (style.zIndex === undefined) style.zIndex = "1";
      // M11z：FrameLayout 子项的 layout_gravity 要真的定位。
      //   绝对定位下 alignSelf 完全无效（之前 bottom|end / center 的子项全堆在左上角）
      const g = String(attrs["layoutGravity"] || "").toLowerCase().replace(/\s+/g, "|");
      if (g) {
        const hCenter = /center_horizontal/.test(g) || (/center/.test(g) && !/center_vertical/.test(g));
        const vCenter = /center_vertical/.test(g) || (/center/.test(g) && !/center_horizontal/.test(g));
        const hEnd = /end|right/.test(g) && !hCenter;
        const hStart = /start|left/.test(g) && !hCenter;
        const vBottom = /bottom/.test(g) && !vCenter;
        const vTop = /top/.test(g) && !vCenter;
        const tf: string[] = [];
        if (hCenter) {
          style.left = "50%";
          style.right = "auto";
          tf.push("translateX(-50%)");
        } else if (hEnd) {
          style.left = "auto";
          style.right = "0px";
        } else if (hStart) {
          style.left = "0px";
          style.right = "auto";
        }
        if (vCenter) {
          style.top = "50%";
          style.bottom = "auto";
          tf.push("translateY(-50%)");
        } else if (vBottom) {
          style.top = "auto";
          style.bottom = "0px";
        } else if (vTop) {
          style.top = "0px";
          style.bottom = "auto";
        }
        if (tf.length) {
          const prev = String(style.transform ?? "").trim();
          style.transform = prev ? `${prev} ${tf.join(" ")}` : tf.join(" ");
        }
        // 这两个轴已经定了，别让旧的 alignSelf 干扰
        delete (style as Record<string, unknown>).alignSelf;
      }
    }

    // M2v：GridLayout 子项落格（layout_column/layout_row 0 基 → CSS 1 基）
    if (parentTag === "GridLayout") {
      // M11t：格子内的 layout_gravity 用 justify-self / align-self（原来的 alignSelf 在 grid 里只管纵向）
      const gSelf = layoutGravityToGridSelf((attrs["layoutGravity"] as string) || "");
      // 先抹掉上面按 flex 语义算出来的 alignSelf（横向分量在 grid 里不能当纵向用）
      delete (style as Record<string, unknown>).alignSelf;
      if (gSelf.justifySelf) style.justifySelf = gSelf.justifySelf;
      if (gSelf.alignSelf) style.alignSelf = gSelf.alignSelf;
      const col = attrs["gridColumn"] as number;
      const row = attrs["gridRow"] as number;
      const cs = (attrs["gridColumnSpan"] as number) || 1;
      const rs = (attrs["gridRowSpan"] as number) || 1;
      if (col >= 0) style.gridColumn = `${col + 1} / span ${cs}`;
      else if (cs > 1) style.gridColumn = `span ${cs}`;
      if (row >= 0) style.gridRow = `${row + 1} / span ${rs}`;
      else if (rs > 1) style.gridRow = `span ${rs}`;
      style.minWidth = 0; // 防止长文本把列撑破
    }

    // 开关/勾选类不渲染文字到框里（会在 title 提示里显示）
    let text = (attrs["text"] as string) || "";
    // M11t：EditText 单行 / 最少行数（代入高度）+ hint 颜色
    if (cls === "axv-text") {
      if (attrs["singleLine"]) style.whiteSpace = "nowrap";
      if (((attrs["minLines"] as number) || 0) > 1) {
        const lh = ((attrs["textSize"] as number) || 14) * 1.3;
        style.minHeight = `${DP(lh * ((attrs["minLines"] as number) || 1), scale)}px`;
      }
    }

    // M11v：Switch / ToggleButton 写了 textOn / textOff 时展示（Android 里 Switch 默认不显示这两个），
    // 没写就不凭空造文字（否则「记住我」这类空文本开关会多出「开」）
    if (cls === "axv-switch") {
      const onNow = !!attrs["checked"];
      const onOff = (onNow ? (attrs["textOn"] as string) : (attrs["textOff"] as string)) || "";
      text = text || onOff;
    }

    if (cls === "axv-seek") {
      text = "";
    } else if (tag === "ToggleButton" || tag === "AppCompatToggleButton") {
      // Android ToggleButton：checked 时显示 textOn（默认 ON），反之 textOff（默认 OFF）
      const onNow = !!attrs["checked"];
      const onOff = (onNow ? (attrs["textOn"] as string) || "ON" : (attrs["textOff"] as string) || "OFF");
      text = text || onOff;
    } else if (tag === "NumberPicker") {
      // 只画中间那一行当前值
      const v = attrs["value"] as number;
      text = Number.isFinite(v) ? String(v) : text;
    } else if (cls === "axv-fab-ext") {
      text = text || (attrs["title"] as string) || "";
    } else if (cls === "axv-toolbar") {
      text = (attrs["title"] as string) || text;
    } else if (cls === "axv-text" && tag === "SearchView") {
      text = text || (attrs["queryHint"] as string) || (attrs["hint"] as string) || "";
    } else if (cls === "axv-include") {
      text = "⟳ include " + ((node.attrs["layout"] as string) || "");
    } else if (cls === "axv-viewstub") {
      const layoutRef = (node.attrs["layout"] as string) || "";
      const layoutName = layoutRef.startsWith("@layout/") ? layoutRef.slice(8) : layoutRef;
      text = `⚡ ViewStub → @layout/${layoutName || "?"}`;
    } else if (cls === "axv-text" && !text && (attrs["hint"] as string)) {
      text = attrs["hint"] as string;
    }

    // ===== 组合图标（drawableLeft 等）：交给渲染层画 img =====
    const cdStart = (attrs["drawableStart"] as string) || "";
    const cdEnd = (attrs["drawableEnd"] as string) || "";
    const cdTop = (attrs["drawableTop"] as string) || "";
    const cdBottom = (attrs["drawableBottom"] as string) || "";
    const compound =
      cdStart || cdEnd || cdTop || cdBottom
        ? {
            start: cdStart,
            end: cdEnd,
            top: cdTop,
            bottom: cdBottom,
            gap: DP((attrs["drawablePadding"] as number) || 4, scale),
          }
        : undefined;
    if (compound && !compound.top && !compound.bottom) {
      style.flexDirection = style.flexDirection ?? "row";
      style.alignItems = "center";
    }

    // ===== M11x：Material 组件外观默认值（以前全靠 axv-container 空壳） =====
    if (cls === "axv-chip") {
      // Chip：小胶囊（不是整宽卡片），选中态用同色系深一号底
      style.display = "inline-flex";
      style.alignItems = "center";
      style.justifyContent = "center";
      style.height = style.height === "auto" ? `${DP(32, scale)}px` : style.height;
      style.minHeight = `${DP(32, scale)}px`;
      style.paddingLeft = style.paddingLeft === "0px" || !style.paddingLeft ? `${DP(12, scale)}px` : style.paddingLeft;
      style.paddingRight = style.paddingRight === "0px" || !style.paddingRight ? `${DP(12, scale)}px` : style.paddingRight;
      style.borderRadius = style.borderRadius ?? `${DP(8, scale)}px`;
      style.backgroundColor = style.backgroundColor ?? (attrs["checked"] ? "#D0BCFF" : "#E8DEF8");
      style.color = style.color ?? "#1D192B";
      style.fontSize = style.fontSize === "28px" || !style.fontSize ? `${DP(14, scale)}px` : style.fontSize;
      style.flex = "0 0 auto";
    } else if (cls === "axv-chipgroup") {
      style.display = "flex";
      style.flexDirection = "row";
      style.flexWrap = "wrap";
      style.alignItems = "center";
      style.gap = style.gap ?? `${DP(8, scale)}px`;
    } else if (cls === "axv-tabs") {
      style.display = "flex";
      style.flexDirection = "row";
      style.alignItems = "stretch";
      style.minHeight = `${DP(48, scale)}px`;
      style.borderBottom = style.borderBottom ?? `1px solid #E0D9E3`;
    } else if (cls === "axv-tab") {
      style.display = "flex";
      style.flex = "1 1 0";
      style.alignItems = "center";
      style.justifyContent = "center";
      style.height = `${DP(48, scale)}px`;
      style.fontSize = style.fontSize === "28px" || !style.fontSize ? `${DP(14, scale)}px` : style.fontSize;
      style.fontWeight = 500;
      style.color = style.color ?? (attrs["checkedTab"] ? "#6750A4" : "#49454F");
      if (attrs["checkedTab"]) style.boxShadow = `inset 0 -${DP(3, scale)}px 0 #6750A4`;
    } else if (cls === "axv-fab" || cls === "axv-fab-ext") {
      const fabBg = (attrs["backgroundTint"] as string) || "#6750A4";
      style.backgroundColor = style.backgroundColor ?? fabBg;
      style.color = style.color ?? "#FFFFFF";
      style.flex = "0 0 auto";
      style.display = "inline-flex";
      style.alignItems = "center";
      style.justifyContent = "center";
      style.boxShadow = style.boxShadow ?? "0 4px 10px rgba(0,0,0,0.22)";
      if (cls === "axv-fab") {
        const d = DP(56, scale);
        style.width = style.width === "auto" || !style.width ? `${d}px` : style.width;
        style.height = style.height === "auto" || !style.height ? `${d}px` : style.height;
        style.borderRadius = style.borderRadius ?? "50%";
        // 图标用 padding 收成 24dp（img 层铺满内容区，padding 就是它的内缩）
        style.paddingLeft = style.paddingRight = style.paddingTop = style.paddingBottom = `${DP(16, scale)}px`;
        const fabSrc = (attrs["src"] as string) || "";
        if (fabSrc && /^(data:|builtin:)/.test(fabSrc)) imgSrc = fabSrc;
      } else {
        style.borderRadius = style.borderRadius ?? `${DP(16, scale)}px`;
        style.paddingLeft = style.paddingLeft ?? `${DP(20, scale)}px`;
        style.paddingRight = style.paddingRight ?? `${DP(20, scale)}px`;
        style.height = style.height === "auto" || !style.height ? `${DP(56, scale)}px` : style.height;
        style.fontWeight = 500;
      }
    } else if (cls === "axv-numberpicker") {
      // Android NumberPicker：上下两行淡字 + 中间选中值 + 两条分割线
      style.display = "flex";
      style.flexDirection = "column";
      style.alignItems = "center";
      style.justifyContent = "center";
      style.width = style.width === "auto" || !style.width ? `${DP(120, scale)}px` : style.width;
      style.height = style.height === "auto" || !style.height ? `${DP(120, scale)}px` : style.height;
      style.fontSize = style.fontSize === "28px" || !style.fontSize ? `${DP(16, scale)}px` : style.fontSize;
      style.color = style.color ?? "#1D1B20";
    } else if (cls === "axv-toolbar") {
      style.display = "flex";
      style.flexDirection = "row";
      style.alignItems = "center";
      style.paddingLeft = style.paddingLeft ?? `${DP(16, scale)}px`;
      style.fontSize = style.fontSize === "28px" || !style.fontSize ? `${DP(20, scale)}px` : style.fontSize;
    } else if (cls === "axv-bottomnav") {
      style.display = "flex";
      style.flexDirection = "row";
      style.alignItems = "center";
      style.justifyContent = "space-around";
      style.minHeight = `${DP(56, scale)}px`;
    }

    // M2q：include 展开的节点在渲染模型里是「只读投影」，标记来源文件（UI 据此禁用编辑）。
    // 嵌套 include 时子树自带更近的 includeFile，逐层传递。
    const sourceFile = node.includeFile;

    const resolved: ResolvedNode = {
      tag: node.tag,
      path: node.path,
      style,
      compound,
      className:
        cls +
        (attrs["checked"] ? " axv-checked" : "") +
        // M11y：SearchView 搜索框外观 / Chip 带 closeIcon 时多画个叉
        (cls === "axv-text" && (tag === "SearchView" || tag === "AppCompatSearchView") ? " axv-search" : "") +
        (cls === "axv-chip" && (attrs["closeIcon"] as string) ? " axv-chip-close" : "") +
        // M11t：不确定进度条要多一个类来挂动画
        (cls === "axv-progress" && attrs["indeterminate"] ? " axv-indet" : "") +
        (cls === "axv-progress" && progressRing ? " axv-progress-ring" : ""),
      text,
      issues: nIssues,
      children: node.children.map((c) => {
        const rc = resolveAll(c);
        // M11x：TextInputLayout 的 EditText 自己不画边框/底色（描边由外层 TIL 负责），
        // 否则预览里会套一个「框中框」
        if (shortTag(node.tag) === "TextInputLayout") {
          delete rc.style.border;
          delete rc.style.borderRadius;
          rc.style.backgroundColor = "transparent";
        }
        return rc;
      }),
      rawAttrs: node.attrs,
    };
    if (sourceFile) resolved.sourceFile = sourceFile;
    if (bgInset) resolved.bgInset = bgInset;
    if (imgSrc) resolved.imgSrc = imgSrc;
    if (imgFit) resolved.imgFit = imgFit;
    if (imgPos) resolved.imgPos = imgPos;
    if (imgTint) resolved.imgTint = imgTint;
    if (imgTint) resolved.imgTint = imgTint;
    if (imgBlend) resolved.imgBlend = imgBlend;
    return resolved;
  };

  const rootNode = resolveAll(root, true);

  // M2b：ConstraintLayout 子项约束定位（后处理：对每个 CL 节点求解直接子项）
  // M11z：算子节点可用宽高 = 本节点盒子尺寸 - 内边距。
  //   病因：CL/RL 把 100% 落实成 px 时用的是「屏幕宽」，但外面可能还有带 padding 的 LinearLayout
  //   → 子 CL 比父内容盒宽 24px，整块向右下方溢出屏幕（RelativeLayout match_parent 超宽就是它）
  const innerAvail = (n: ResolvedNode, aw: number, ah: number): { w: number; h: number } => {
    const num = (v: unknown): number => {
      const s2 = String(v ?? "");
      if (s2.endsWith("px")) return parseFloat(s2);
      return NaN;
    };
    const w = String(n.style.width ?? "");
    const h = String(n.style.height ?? "");
    let boxW = num(w);
    if (!Number.isFinite(boxW)) boxW = aw;
    let boxH = num(h);
    if (!Number.isFinite(boxH)) boxH = ah;
    const sh = (n.style.padding ?? "") as string;
    const shv = sh.endsWith("px") ? parseFloat(sh) : 0;
    const pl = num(n.style.paddingLeft);
    const pr = num(n.style.paddingRight);
    const pt = num(n.style.paddingTop);
    const pb = num(n.style.paddingBottom);
    const l = Number.isFinite(pl) ? pl : shv;
    const r = Number.isFinite(pr) ? pr : shv;
    const t = Number.isFinite(pt) ? pt : shv;
    const b = Number.isFinite(pb) ? pb : shv;
    return { w: Math.max(0, boxW - l - r), h: Math.max(0, boxH - t - b) };
  };

  const patchCL = (n: ResolvedNode, availW: number = screenW * scale, availH: number = bodyH * scale): void => {
    if (shortTag(n.tag) !== "ConstraintLayout") {
      const ia = innerAvail(n, availW, availH);
      for (const c of n.children) patchCL(c, ia.w, ia.h);
      return;
    }
    // CL 自身内容区尺寸（px）：取自身 style 的 width/height，"100%"/auto/undefined 时回落到手机屏默认
    const toPx = (v: unknown, fallback: number): number => {
      const s2 = String(v ?? "");
      if (s2.endsWith("px")) return parseFloat(s2);
      // match_parent + margin/padding 会生成 calc(100% - Npx)：用 fallback 减去 N 得到真实宽
      const mCalc = s2.match(/^calc\(100%\s*-\s*([0-9.]+)px\)$/);
      if (mCalc) return Math.max(0, fallback - parseFloat(mCalc[1]));
      if (s2 === "100%" || s2 === "" || s2 === "auto") return fallback;
      const m = s2.match(/^(-?[0-9.]+)/);
      if (m && !s2.includes("%")) return parseFloat(m[1]);
      return fallback;
    };
    const cw = toPx(n.style.width, availW);
    // 高度回落值 = 内容区高度（屏高 - 状态栏 - 导航栏），否则 CL 根会按整屏高算出
    // 比内容区还高的盒子 → 底部被导航栏遮住 / 溢出预览框
    const ch = toPx(n.style.height, availH);
    // CL 自身尺寸必须落实成 px：父级只有 min-height 时 100% 解析不出来，
    // 子项全 absolute 又撑不起来 → 容器会塔成 0 高（真 bug，会看到控件跑出屏幕）
    const wStr = String(n.style.width ?? "");
    const hStr = String(n.style.height ?? "");
    /** M11y：wrap_content 的 CL 应该由子项擑开，而不是回落到整屏高 */
    const wrapH = hStr === "auto" || hStr === "";
    if (wStr === "100%" || wStr === "auto" || wStr === "") n.style.width = `${cw}px`;
    if (hStr === "100%" || hStr === "auto" || hStr === "") n.style.height = `${ch}px`;
    // 子项定位基准是 padding box，而 Android 是在 padding 里面排
    // → 内容区扣掉 padding，坐标加上 padding 偏移
    const padL = parseFloat(String(n.style.paddingLeft ?? "0")) || 0;
    const padT = parseFloat(String(n.style.paddingTop ?? "0")) || 0;
    const padR = parseFloat(String(n.style.paddingRight ?? "0")) || 0;
    const padB = parseFloat(String(n.style.paddingBottom ?? "0")) || 0;
    const contentW = Math.max(0, cw - padL - padR);
    const contentH = Math.max(0, ch - padT - padB);
    const sourceCL = findSourceNode(root, n.path);
    if (!sourceCL) return;
    const solved = solveConstraintChildren(sourceCL, res, contentW, contentH, measured);
    issues.push(...solved.issues);
    for (const child of n.children) {
      const box = solved.boxes.get(child.path);
      if (!box) continue;
      const cTag = shortTag(child.tag);
      child.style.position = "absolute";
      // M2c：Guideline / Barrier 参考线——0 维盒子展开成 2px 线
      if (cTag === "Guideline" || cTag === "Barrier") {
        const o = (child.rawAttrs["orientation"] ?? "vertical").toLowerCase();
        const dir = (child.rawAttrs["barrierDirection"] ?? "top").toLowerCase();
        const isHorizLine = cTag === "Guideline" ? o === "horizontal" : dir === "top" || dir === "bottom";
        if (isHorizLine) {
          child.style.left = `${padL}px`;
          child.style.top = `${padT + box.top}px`;
          child.style.width = `${contentW}px`;
          child.style.height = "2px";
        } else {
          child.style.left = `${padL + box.left}px`;
          child.style.top = `${padT}px`;
          child.style.width = "2px";
          child.style.height = `${contentH}px`;
        }
        child.style.boxSizing = "border-box";
        for (const gc of child.children) patchCL(gc, availW, availH);
        continue;
      }
      child.style.left = `${padL + box.left}px`;
      child.style.top = `${padT + box.top}px`;
      // M2t：wrap 轴交给浏览器算真实内容尺寸（shrink-to-fit），实测后回填重解位置
      child.style.width = box.wrapW ? "auto" : `${box.width}px`;
      child.style.height = box.wrapH ? "auto" : `${box.height}px`;
      child.style.boxSizing = "border-box";
      delete child.style.marginTop;
      delete child.style.marginRight;
      delete child.style.marginBottom;
      delete child.style.marginLeft;
      // M11z：子 CL 的「可用宽高」是父 CL 的内容盒（不是屏幕宽）
      patchCL(child, contentW, contentH);
    }

    // M11y：CL 高度收尾
    //  - wrap_content：按子项最大下沿定高（以前回落到整屏高，底部多出一大片空白）
    //  - 固定高：子项超出就裁掉（Android ViewGroup 默认 clipChildren=true），
    //    否则超出部分会盖住下一节的标题
    let maxBottom = 0;
    for (const child of n.children) {
      const t2 = parseFloat(String(child.style.top ?? 0)) || 0;
      const h2 = parseFloat(String(child.style.height ?? 0)) || 0;
      maxBottom = Math.max(maxBottom, t2 + h2);
    }
    const fixedH = parseFloat(String(n.style.height ?? 0)) || 0;
    if (wrapH && maxBottom > 0) {
      n.style.height = `${Math.round(maxBottom + padB)}px`;
    } else if (fixedH > 0 && maxBottom > fixedH + 1) {
      n.style.overflow = "hidden";
    }
  };
  patchCL(rootNode);

  // M11y：TextInputLayout 浮动 hint 标签（Android 里 hint 会浮到框线上，占位行里不能少）
  const patchTIL = (n: ResolvedNode): void => {
    if (shortTag(n.tag) === "TextInputLayout") {
      const own = (n.rawAttrs["hint"] ?? "") as string;
      const childHint = n.children.find((c) => /EditText$/.test(String(c.tag)) && (c.text || "").trim())?.text;
      const lbl = (own || childHint || "").trim();
      if (lbl) n.label = lbl;
    }
    for (const c of n.children) patchTIL(c);
  };
  patchTIL(rootNode);

  // M2p：RelativeLayout 子项规则定位（alignParent / center / toRightOf / below / alignTop …）
  const patchRL = (n: ResolvedNode, availW: number = screenW * scale, availH: number = bodyH * scale): void => {
    if (shortTag(n.tag) !== "RelativeLayout") {
      const ia = innerAvail(n, availW, availH);
      for (const c of n.children) patchRL(c, ia.w, ia.h);
      return;
    }
    const toPx = (v: unknown, fallback: number): number => {
      const s2 = String(v ?? "");
      if (s2.endsWith("px")) return parseFloat(s2);
      const mCalc = s2.match(/^calc\(100%\s*-\s*([0-9.]+)px\)$/);
      if (mCalc) return Math.max(0, fallback - parseFloat(mCalc[1]));
      if (s2 === "100%" || s2 === "" || s2 === "auto") return fallback;
      const m = s2.match(/^(-?[0-9.]+)/);
      if (m && !s2.includes("%")) return parseFloat(m[1]);
      return fallback;
    };
    const cw = toPx(n.style.width, availW);
    const ch = toPx(n.style.height, availH);
    // 容器自身尺寸要落实成 px：子项全 absolute 撑不起来，否则整个 RelativeLayout 塔成 0 高
    const wStr = String(n.style.width ?? "");
    const hStr = String(n.style.height ?? "");
    if (wStr === "100%" || wStr === "auto" || wStr === "") n.style.width = `${cw}px`;
    if (hStr === "100%" || hStr === "auto" || hStr === "") n.style.height = `${ch}px`;
    // 同 CL：Android 在 padding 内排子项，CSS absolute 不认 padding → 手动扣/偏移
    const padL = parseFloat(String(n.style.paddingLeft ?? "0")) || 0;
    const padT = parseFloat(String(n.style.paddingTop ?? "0")) || 0;
    const padR = parseFloat(String(n.style.paddingRight ?? "0")) || 0;
    const padB = parseFloat(String(n.style.paddingBottom ?? "0")) || 0;
    const contentW = Math.max(0, cw - padL - padR);
    const contentH = Math.max(0, ch - padT - padB);
    const sourceRL = findSourceNode(root, n.path);
    if (!sourceRL) return;
    const solved = solveRelativeChildren(sourceRL, res, contentW, contentH, measured);
    issues.push(...solved.issues);
    for (const child of n.children) {
      const box = solved.boxes.get(child.path);
      if (!box) continue;
      child.style.position = "absolute";
      child.style.left = `${padL + box.left}px`;
      child.style.top = `${padT + box.top}px`;
      // M2t：wrap 轴交给浏览器算真实内容尺寸，实测后回填重解位置
      child.style.width = box.wrapW ? "auto" : `${box.width}px`;
      child.style.height = box.wrapH ? "auto" : `${box.height}px`;
      child.style.boxSizing = "border-box";
      // margin 已折进 left/top（与 CL 一致），否则会重复位移
      delete child.style.marginTop;
      delete child.style.marginRight;
      delete child.style.marginBottom;
      delete child.style.marginLeft;
      patchRL(child, contentW, contentH);
    }
  };
  patchRL(rootNode);

  // M2d：FrameLayout 子项定位修正——absolute 子项补默认 left/top，父容器补明确宽高
  const patchFrame = (n: ResolvedNode): void => {
    const st = shortTag(n.tag);
    if (st === "FrameLayout" || st === "ScrollView" || st === "HorizontalScrollView") {
      // 父容器宽高留空时补 100%（match_parent 子项百分比需要父有确定尺寸）
      if (String(n.style.width ?? "") === "") n.style.width = "100%";
      if (String(n.style.height ?? "") === "") n.style.height = "100%";
      for (const c of n.children) {
        if (c.style.position === "absolute") {
          if (c.style.left === undefined || c.style.left === "") c.style.left = "0px";
          if (c.style.top === undefined || c.style.top === "") c.style.top = "0px";
        }
        patchFrame(c);
      }
      return;
    }
    for (const c of n.children) patchFrame(c);
  };
  patchFrame(rootNode);

  // M4k：flex 容器里 wrap_content 的交叉轴尺寸不能被拉满
  // 病因：LinearLayout 竖直方向 = CSS flex column，而 flex 默认 align-items: stretch，
  // 子项 width:auto（= wrap_content）会被拉成父宽 → 按钮/文字看着像 match_parent。
  // Android 里 wrap_content 的交叉轴永远是内容尺寸，所以显式 align-self: flex-start。
  // 已带 layout_gravity / alignSelf 的不动。
  // M11r：容器如果已经用 gravity 指定了交叉轴对齐（alignItems: center / flex-end …），
  // 就不能再强推 flex-start —— 这正是「LinearLayout gravity=center 时图片居中了、文字没居中」的原因。
  const patchWrapCross = (n: ResolvedNode): void => {
    const st = shortTag(n.tag);
    // TableLayout/TableRow 在 Android 里子项行为是表格列宽，不是 flex 交叉轴，跳过
    if (n.style.display === "flex" && st !== "TableLayout" && st !== "TableRow") {
      const col = String(n.style.flexDirection ?? "row") === "column";
      const ai = String(n.style.alignItems ?? "");
      const containerPinsCross = ai !== "" && ai !== "stretch";
      if (!containerPinsCross) {
        for (const c of n.children) {
          if (c.style.position === "absolute" || c.style.alignSelf) continue;
          const cross = col ? String(c.style.width ?? "") : String(c.style.height ?? "");
          if (cross === "auto" || cross === "") c.style.alignSelf = "flex-start";
        }
      }
    }
    for (const c of n.children) patchWrapCross(c);
  };
  patchWrapCross(rootNode);

  // M11v：android:divider + android:showDividers —— 给中间子项补边框当作分割线
  const patchDividers = (n: ResolvedNode): void => {
    const raw = n.rawAttrs || {};
    const show = String(raw["showDividers"] || "");
    const dRaw = String(raw["divider"] || "");
    if (show && show !== "none" && dRaw) {
      const color = resolveColor(dRaw, res, [], "", "divider") || dRaw;
      const hDp = parseFloat(String(raw["dividerHeight"] || "")) || 1;
      const px = Math.max(1, DP(hDp, scale));
      const vertical = String(n.style.flexDirection ?? "column") !== "row";
      n.children.forEach((c, i) => {
        if (c.style.position === "absolute") return;
        const first = i === 0;
        const last = i === n.children.length - 1;
        const want =
          show.includes("middle") && !first ? true : show.includes("beginning") && first ? true : false;
        if (!want) return;
        if (vertical) c.style.borderTop = `${px}px solid ${color}`;
        else c.style.borderLeft = `${px}px solid ${color}`;
        void last;
      });
    }
    n.children.forEach(patchDividers);
  };
  patchDividers(rootNode);

  return { root: rootNode, issues };
}

/** 按 path 在源 XML 树里找节点（ConstraintLayout 求解需要 XmlNode.attrs） */
function findSourceNode(root: XmlNode, path: string): XmlNode | null {
  const walk = (n: XmlNode): XmlNode | null => {
    if (n.path === path) return n;
    for (const c of n.children) {
      const r = walk(c);
      if (r) return r;
    }
    return null;
  };
  return walk(root);
}

/** 从 root 找某 node 的父节点 tag（M1 简化：FrameLayout 子项绝对定位判断） */
function findParentTag(root: XmlNode, target: XmlNode): string | null {
  const walk = (n: XmlNode, parent: string | null): string | null => {
    if (n.path === target.path) return parent;
    for (const c of n.children) {
      const r = walk(c, n.tag);
      if (r !== null) return r;
    }
    return null;
  };
  return walk(root, null);
}
