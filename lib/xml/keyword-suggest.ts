// lib/xml/keyword-suggest.ts — M45：输入关键词检索弹窗（autocomplete 数据层）
//
// 给定「文档 + 光标位置（行/列）」，算出：
//   - 触发词（光标左边这段连续的可识别字符）
//   - 上下文类型（tag / attr / value / resource / plain）
//   - 候选词列表（文档 token + 白名单 + 资源名，按前缀过滤 + 排序，上限 12 条）
//
// 纯函数，Node / 浏览器都能测。

export type SuggestKind = "tag" | "attr" | "value" | "resource" | "plain";

export interface SuggestContext {
  line: number;
  col: number;
  prefix: string;
  kind: SuggestKind;
  items: string[];
}

/** 高频 Android 标签 */
const TAG_WHITELIST = [
  "LinearLayout", "FrameLayout", "ConstraintLayout", "RelativeLayout",
  "ScrollView", "HorizontalScrollView", "NestedScrollView", "RecyclerView",
  "TextView", "EditText", "Button", "ImageButton", "CheckBox", "RadioButton",
  "Switch", "ToggleButton", "ProgressBar", "SeekBar", "ImageView",
  "CardView", "MaterialCardView", "Spinner", "AutoCompleteTextView",
  "TabLayout", "View", "ViewStub", "Space", "Divider",
  "GridLayout", "TableLayout", "TableRow", "DrawerLayout", "CoordinatorLayout",
  "MaterialButton", "TextInputLayout", "TextInputEditText",
];

/** 高频属性名 */
const ATTR_WHITELIST = [
  "android:id", "android:layout_width", "android:layout_height",
  "android:layout_margin", "android:layout_marginLeft", "android:layout_marginRight",
  "android:layout_marginTop", "android:layout_marginBottom",
  "android:layout_gravity", "android:gravity", "android:orientation",
  "android:background", "android:padding", "android:paddingLeft",
  "android:paddingRight", "android:paddingTop", "android:paddingBottom",
  "android:text", "android:textSize", "android:textColor", "android:textStyle",
  "android:fontFamily", "android:maxLines", "android:singleLine",
  "android:visibility", "android:alpha", "android:scaleType", "android:src",
  "android:tint", "android:tintMode", "android:elevation",
  "android:clickable", "android:focusable", "android:enabled", "android:tag",
  "app:layout_constraintLeft_toLeftOf", "app:layout_constraintRight_toRightOf",
  "app:layout_constraintTop_toTopOf", "app:layout_constraintBottom_toBottomOf",
  "app:layout_constraintStart_toStartOf", "app:layout_constraintEnd_toEndOf",
  "app:layout_constraintHorizontal_bias", "app:layout_constraintVertical_bias",
  "app:cardCornerRadius", "app:cardElevation", "app:strokeWidth",
  "app:strokeColor", "app:rippleColor", "app:tint", "app:tintMode",
  "app:srcCompat", "app:src", "app:drawableStart", "app:drawableEnd",
  "tools:context", "tools:ignore", "xmlns:android", "xmlns:app", "xmlns:tools",
];

/** 高频属性值 */
const VALUE_WHITELIST = [
  "match_parent", "wrap_content", "0dp", "4dp", "8dp", "12dp", "16dp",
  "24dp", "32dp", "48dp", "64dp", "8sp", "12sp", "14sp", "16sp", "18sp",
  "gone", "invisible", "visible", "left", "right", "top", "bottom", "center",
  "start", "end", "center_vertical", "center_horizontal", "center_vertical|start",
  "clip", "marquee", "middle", "normal", "bold", "italic", "bold|italic",
  "centerCrop", "centerInside", "fitCenter", "fitStart", "fitEnd", "fitXY",
  "tile", "fade", "infinite", "accelerate", "decelerate", "anticipate",
];

/** 可组成「当前词」的字符（光标左边的连续段） */
const WORD_RE = /[A-Za-z0-9_.:@#+\/-]/;

/** 光标左边有没有"<"还没闭合——正在写标签 */
function inTag(lineText: string, col: number): boolean {
  const left = lineText.slice(0, col - 1);
  const lt = left.lastIndexOf("<");
  const gt = left.lastIndexOf(">");
  return lt !== -1 && (gt === -1 || lt > gt);
}

/** 光标在 "..." / '...' 里（奇数个引号 = 未闭合） */
function inAttrValue(lineText: string, col: number): boolean {
  const left = lineText.slice(0, col - 1);
  const dqCount = (left.match(/"/g) || []).length;
  const sqCount = (left.match(/'/g) || []).length;
  return dqCount % 2 === 1 || sqCount % 2 === 1;
}

/** 标签名 / 属性名 上下文："<" 后有没有空过（空过 = 属性区） */
function tagVsAttr(lineText: string, col: number): "tag" | "attr" {
  const left = lineText.slice(0, col - 1);
  const lt = left.lastIndexOf("<");
  if (lt < 0) return "tag";
  const after = left.slice(lt + 1);
  if (/^\/[A-Za-z]/.test(after)) return "tag";
  const tagMatch = /^([A-Za-z_][\w.:-]*)\s/.exec(after);
  if (tagMatch) {
    const cursorInAttr = col > lt + 1 + tagMatch[1].length + 1;
    return cursorInAttr ? "attr" : "tag";
  }
  return "tag";
}

/** 提取文档里所有 token：标签名、属性名、资源引用、id 值、字符串值 */
export function extractDocumentTokens(doc: string): string[] {
  const out = new Set<string>();

  // 1. 标签名：<Tag 或 </Tag
  for (const m of doc.matchAll(/<\/?([A-Za-z_][\w.:-]*)/g)) out.add(m[1]);

  // 2. 属性名：空格 + name + =
  for (const m of doc.matchAll(/\s([A-Za-z_][\w.:-]*)\s*=/g)) out.add(m[1]);

  // 3. 资源引用 @+id/xxx, @drawable/xxx, @string/xxx …
  for (const m of doc.matchAll(/@(\+?)(?:id|drawable|string|color|dimen|style|layout|menu|raw|anim|animator|xml|font|mipmap)\/([A-Za-z_][\w.:-]*)/g)) {
    out.add(m[0]); // 完整引用 @drawable/ic_logo
    out.add(m[2]); // 资源名 ic_logo
  }

  // 4. android:id="..." 的值
  for (const m of doc.matchAll(/android:id\s*=\s*"([^"]+)"/g)) out.add(m[1]);

  // 5. 带引号的字符串值（排除 @ / # 开头的资源/颜色引用，排除含 < > " 的畸形片段）
  for (const m of doc.matchAll(/"([^"]{2,60})"/g)) {
    const v = m[1];
    if (v.startsWith("@") || v.startsWith("#")) continue;
    if (v.includes("<") || v.includes(">")) continue;
    out.add(v);
  }

  return [...out];
}

/** 资源引用：前缀形如 @drawable/xx，从 resNames 里找 */
export function resourceMatches(prefix: string, resNames: string[]): string[] {
  if (!prefix.startsWith("@")) return [];
  const slash = prefix.lastIndexOf("/");
  if (slash < 0) return [];
  const namePrefix = prefix.slice(slash + 1);
  const lower = namePrefix.toLowerCase();
  return resNames
    .filter((n) => n.toLowerCase().startsWith(lower))
    .slice(0, 20)
    .map((n) => prefix.slice(0, slash + 1) + n);
}

/** 排候选：文档 token + 白名单，按前缀过滤 + 长度/字母排序，上限 12 */
function rankItems(prefix: string, docTokens: string[], kind: SuggestKind): string[] {
  const p = prefix.toLowerCase();
  const pool = new Set<string>(docTokens);
  if (kind === "tag") for (const t of TAG_WHITELIST) pool.add(t);
  if (kind === "attr") for (const a of ATTR_WHITELIST) pool.add(a);
  if (kind === "value") for (const v of VALUE_WHITELIST) pool.add(v);
  const out: string[] = [];
  for (const t of pool) {
    if (t.length < prefix.length) continue;
    if (p && !t.toLowerCase().startsWith(p)) continue;
    out.push(t);
  }
  out.sort((a, b) => {
    const al = a.toLowerCase(), bl = b.toLowerCase();
    if (al.startsWith(p) !== bl.startsWith(p)) return al.startsWith(p) ? -1 : 1;
    if (a.length !== b.length) return a.length - b.length;
    return al.localeCompare(bl, "en");
  });
  return out.slice(0, 12);
}

/** 光标是否在 XML 注释里（<!-- 之后、--> 之前） */
function inComment(doc: string, lineIdx: number, col: number): boolean {
  let offset = 0;
  const lines = doc.split("\n");
  for (let i = 0; i < lineIdx; i++) offset += lines[i].length + 1;
  offset += col - 1;
  const before = doc.slice(0, offset);
  const open = before.lastIndexOf("<!--");
  const close = before.lastIndexOf("-->");
  return open !== -1 && open > close;
}

/** 主入口 */
export function computeSuggest(
  doc: string,
  cursor: { line: number; col: number },
  resNames?: string[],
): SuggestContext | null {
  const lines = doc.split("\n");
  const li = Math.max(0, Math.min(cursor.line - 1, lines.length - 1));
  const lineText = lines[li] ?? "";
  const col = Math.max(1, Math.min(cursor.col, lineText.length + 1));

  // 取光标左边「当前词」
  const left = lineText.slice(0, col - 1);
  let start = left.length;
  while (start > 0 && WORD_RE.test(left[start - 1])) start--;
  const prefix = left.slice(start);
  if (prefix.length < 2) return null;

  // 注释里不弹（写注释时列表很烦）
  if (inComment(doc, li, col)) return null;

  const docTokens = extractDocumentTokens(doc);

  // 上下文判定（优先级：resource > value > tag/attr > plain）
  let kind: SuggestKind = "plain";
  if (prefix.startsWith("@")) kind = "resource";
  else if (inAttrValue(lineText, col)) kind = "value";
  else if (inTag(lineText, col)) kind = tagVsAttr(lineText, col);

  let items: string[];
  if (kind === "resource") {
    if (resNames && resNames.length > 0) {
      items = resourceMatches(prefix, resNames);
    } else {
      items = rankItems(prefix, docTokens, "value");
    }
    if (items.length === 0) items = rankItems(prefix, docTokens, "plain");
  } else {
    items = rankItems(prefix, docTokens, kind);
  }
  if (items.length === 0) return null;

  return { line: cursor.line, col, prefix, kind, items };
}
