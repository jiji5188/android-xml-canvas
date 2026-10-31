// lib/xml/doc-kind.ts — M37b：判断「这个文件是布局，还是只读代码」
//
// 背景：AndroidManifest.xml / res/values/*.xml / menu / drawable 形状 等都不是布局，
// 以前一律塞进 parseLayoutXml + buildRenderModel + 布局 lint → 预览报错、校验乱叫。
// 现在先判类型：layout 走老路（预览 + 校验 + 拖拽），code 只做代码查看/编辑（不解析布局）。
//
// 判定优先级：文件路径/文件名（最可靠）> 根标签（用户直接把 manifest 粘进来也能认出来）。

export type DocKind = "layout" | "code";

/** 明显不是「布局」的 XML 根标签 */
const NON_LAYOUT_ROOTS = new Set([
  "manifest",
  "resources",
  "menu",
  "vector",
  "animated-vector",
  "shape",
  "selector",
  "layer-list",
  "ripple",
  "inset",
  "clip",
  "scale",
  "rotate",
  "animated-rotate",
  "level-list",
  "transition",
  "animation-list",
  "set",
  "objectAnimator",
  "animator",
  "adaptive-icon",
  "bitmap",
  "nine-patch",
  "navigation",
  "preference-screen",
  "PathInterpolator",
  "gradient",
  "declare-styleable",
  "font-family",
  "plurals",
]);

/** 明显是「布局」的根标签（fragment / include 之类太边缘，不列） */
const LAYOUT_ROOTS = new Set([
  "LinearLayout",
  "FrameLayout",
  "RelativeLayout",
  "ConstraintLayout",
  "ConstraintHelper",
  "Guideline",
  "Barrier",
  "GridLayout",
  "TableLayout",
  "TableRow",
  "ScrollView",
  "HorizontalScrollView",
  "NestedScrollView",
  "DrawerLayout",
  "CoordinatorLayout",
  "AppBarLayout",
  "CollapsingToolbarLayout",
  "SwipeRefreshLayout",
  "RecyclerView",
  "ViewPager",
  "ViewPager2",
  "merge",
  "layout",
  "include",
  "view",
  "View",
  "androidx.constraintlayout.widget.ConstraintLayout",
]);

/** 第一个真实标签名（跳过 <?xml ?> / <!-- --> / <!DOCTYPE>） */
export function rootTagOf(xml: string): string | null {
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) return null;
    const rest = xml.slice(lt, lt + 12);
    if (rest.startsWith("<?")) {
      const end = xml.indexOf("?>", lt);
      if (end < 0) return null;
      i = end + 2;
      continue;
    }
    if (rest.startsWith("<!--")) {
      const end = xml.indexOf("-->", lt);
      if (end < 0) return null;
      i = end + 3;
      continue;
    }
    if (rest.startsWith("<!")) {
      const end = xml.indexOf(">", lt);
      if (end < 0) return null;
      i = end + 1;
      continue;
    }
    const m = /^<([A-Za-z_][\w.:-]*)/.exec(xml.slice(lt, lt + 120));
    return m ? m[1] : null;
  }
  return null;
}

/** 去掉命名空间前缀：androidx.constraintlayout.widget.ConstraintLayout → 原名保持不变由调用方判断 */
export function localTag(tag: string): string {
  const s = tag.includes(":") ? tag.slice(tag.indexOf(":") + 1) : tag;
  return s;
}

/** 只看路径：能确定的返回类型，判断不了返回 null */
export function kindOfPath(relOrName: string | null | undefined): DocKind | null {
  if (!relOrName) return null;
  const p = relOrName.replace(/\\/g, "/");
  const name = p.slice(p.lastIndexOf("/") + 1);
  if (/\.(java|kt|gradle|properties|md|txt|json)$/i.test(name)) return "code";
  if (name === "AndroidManifest.xml") return "code";
  if (/\/res\/layout[^/]*\//i.test(p) || /^res\/layout[^/]*\//i.test(p)) return "layout";
  if (/\/(values|menu|xml|drawable|mipmap|anim|animator|color|font|raw)[^/]*\//i.test(p)) return "code";
  // 原生绝对路径：…/app/src/main/AndroidManifest.xml 之类已由上面覆盖
  return null;
}

/** 综合判定：路径可信就用路径，否则看根标签，最后兜底按布局处理（保持老行为） */
export function detectDocKind(
  xml: string,
  relOrName?: string | null,
  fallbackName?: string | null,
): DocKind {
  const byPath = kindOfPath(relOrName) ?? kindOfPath(fallbackName);
  if (byPath) return byPath;
  const tag = rootTagOf(xml);
  if (!tag) return "layout";
  const bare = localTag(tag);
  if (NON_LAYOUT_ROOTS.has(tag) || NON_LAYOUT_ROOTS.has(bare)) return "code";
  if (LAYOUT_ROOTS.has(tag) || LAYOUT_ROOTS.has(bare)) return "layout";
  return "layout";
}

/** M39：是不是 res/values*\/*.xml（有可视化编辑的那种） */
export function isValuesPath(relOrName?: string | null): boolean {
  if (!relOrName) return false;
  const p = relOrName.replace(/\\/g, "/");
  return /(^|\/)res\/values[^/]*\/[^/]+\.xml$/i.test(p) || /(^|\/)values[^/]*\/[^/]+\.xml$/i.test(p);
}

/** 给界面用的人话说明 */export function codeOnlyNotice(name: string): { title: string; msg: string } {
  const n = (name || "").replace(/\\/g, "/").split("/").pop() || "该文件";
  if (n === "AndroidManifest.xml") {
    return {
      title: "AndroidManifest.xml · 仅代码编辑",
      msg: "这是应用清单文件，不是布局，画布不渲染它。改完直接保存即可（会写回原路径）。",
    };
  }
  return {
    title: `${n} · 仅代码编辑`,
    msg: "这个文件不是布局（资源/清单/动画等），画布不渲染。改完直接保存即可。",
  };
}
