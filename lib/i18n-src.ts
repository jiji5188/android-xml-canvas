// lib/i18n-src.ts — M95：以「中文原文」为 key 的译文表 + 全局 t()
//
// 背景：编辑器里 1000+ 条文案散在 30 多个组件里，逐条起 key 再补 4 种语言不现实。
// 这里的做法是：组件里直接写成 t("保存")，中文原文就是 key；只要本表里有对应译文
// 就切过去，没有就原样显示中文（不会出现 ??? 或空串）。
//
// 因此回填是「按页面、增量」的：先给哪个页面补译文，哪个页面就支持多语言。
// zh-Hant / ja 目前会被英文表兜底（见 SRC_FALLBACK），以后再按需补。

export type SrcDict = Record<string, string>;

/** 英文 —— 简体中文原文 → English */
export const SRC_EN: SrcDict = {
  // ---- 已生成资源面板（GenAssetsPanel）----
  "已生成资源": "Generated assets",
  "搜索资源名…": "Search asset name…",
  "搜索资源名": "Search assets",
  "未引用": "Unused",
  "引用 {n}": "{n} ref(s)",
  "确定": "OK",
  "取消": "Cancel",
  "关闭": "Close",
  "删除": "Delete",
  "删除资源": "Delete asset",
  "改名": "Rename",
  "改名（会同步改布局里的引用）": "Rename (layout references update too)",
  "复制 xml": "Copy XML",
  "下载 xml 文件": "Download XML file",
  "下载 xml": "Download XML",
  "双击编辑形状内容": "Double-click to edit the shape",
  "双击编辑图标（颜色 / 尺寸 / 路径 / 旋转）": "Double-click to edit the icon (color / size / path / rotation)",
  "没有匹配「{q}」的资源": "No assets match “{q}”",
  "还没有生成过资源。用属性面板的": "No generated assets yet. Use the",
  "选图标 /": "icon picker /",
  "建形状，生成后会出现在这里。": "shape builder in the attribute panel; generated assets show up here.",
  "再点一次确认删除（{n} 处引用会变缺失）": "Click again to confirm ({n} reference(s) will break)",
  "改名 / 删除只影响编辑器里生成的资源；已上传 res 目录里的同名文件不会被改动。":
    "Rename / delete only affect assets generated in the editor; same-named files in the uploaded res/ folder are untouched.",
  "形状资源双击可直接改内容。": "Double-click a shape asset to edit its content.",
  "资源名不能为空（只能用 a-z 0-9 _，且字母开头）": "Asset name cannot be empty (a-z 0-9 _ only, must start with a letter)",
  "矢量图": "Vector",
  "形状": "Shape",
  "状态选择": "State list",
  "图层": "Layers",
  "水波纹": "Ripple",
  "内嵌": "Inset",
  "其它": "Other",
  "已按 aapt 规则纠正为 {name}，再点一次「确定」": "Corrected to {name} per aapt rules — click OK again",
  "已存在同名资源 {name}": "An asset named {name} already exists",
  "已改名 {from} → {to}，布局里 {n} 处引用已同步": "Renamed {from} → {to}; {n} reference(s) in the layout updated",
  "已改名 {from} → {to}": "Renamed {from} → {to}",
  "已删除 {name}（布局里 {n} 处引用会变成缺失资源）": "Deleted {name} ({n} reference(s) in the layout are now missing)",
  "已删除 {name}": "Deleted {name}",
  "已复制 {name} 的 xml": "Copied the XML of {name}",
  "复制失败（浏览器不允许写剪贴板）": "Copy failed (the browser blocked clipboard access)",
  "已写入《{project}》app/src/main/res/drawable/{name}.xml": "Written to 《{project}》app/src/main/res/drawable/{name}.xml",
  "写入项目失败：{reason}": "Failed to write into the project: {reason}",
  "项目": "project",
  "目录不可写": "directory is not writable",
  // ---- 图标画布编辑器（IconCanvasEditor）----
  " · 选中 {n}": " · {n} selected",
  "Android vector 不支持 <text>：保存时会自动把文字追踪成 path（可撤销），也可以现在手动转。": "Android vector doesn't support <text>: on save the text is traced into paths automatically (undoable), or convert it manually now.",
  "{done} 个文字已转成 path，{failed} 个转换失败": "{done} text item(s) converted to path, {failed} failed",
  "· viewport {w}×{h}，改尺寸会等比缩放图形": "· viewport {w}×{h}; resizing scales shapes proportionally",
  "· {name}（导出为 <group>）": "· {name} (exported as <group>)",
  "· 保存写回 drawable/{name}.xml": "· saves back to drawable/{name}.xml",
  "· 先在画布或图层页选一个图形": "· select a shape on the canvas or in the Layers tab first",
  "· 可直接手改": "· you can edit it by hand",
  "· 旋转/镜像写进 &lt;group&gt;": "· rotation/mirroring is written into &lt;group&gt;",
  "· 未选中：这里改的是下一个新图形的初值": "· nothing selected: these are the defaults for the next shape",
  "· 点一行选中，Shift 多选": "· click a row to select, Shift-click for multi-select",
  "· 背景会导出成底层矩形": "· the background is exported as a bottom rectangle",
  "· 选中 1 个按画布对齐，≥2 个互相对齐，均分需 ≥3 个": "· with 1 shape aligns to canvas, with ≥2 aligns to each other, distribute needs ≥3",
  "· 选中 {n} 个": "· {n} selected",
  "· 选中 {n} 个，单位 viewport": "· {n} selected, in viewport units",
  "上移一层": "Bring forward",
  "下移一层": "Send backward",
  "不透明度": "Opacity",
  "个图形": "shape(s)",
  "从图标库换字形（替换整个图标）": "Pick a glyph from the icon library (replaces the whole icon)",
  "从空白画布开始": "Start from a blank canvas",
  "位置": "Position",
  "保存": "Save",
  "保存后立即写回 drawable/{name}.xml，布局里所有引用同步生效。": "Saves straight into drawable/{name}.xml; every reference in the layout updates.",
  "先在画布上框选或用「图层」多选（Shift 点）两个以上图形。": "Marquee-select on the canvas, or Shift-click two or more shapes in Layers.",
  "内容": "Content",
  "内径": "Inner radius",
  "几何图形请直接拖拽 / 改上面的参数；想手改路径就先「转为路径」。": "Drag out geometric shapes or tweak the fields above; to hand-edit the path, convert it to a path first.",
  "分组变换": "Group transform",
  "删除选中图形 (Delete)": "Delete selected (Delete)",
  "取色": "Pick color",
  "取色（这条）": "Pick color (this shape)",
  "右对齐": "Align right",
  "名称": "Name",
  "图层属性": "Layer properties",
  "图形（{n}）": "Shapes ({n})",
  "图标编辑器": "Icon editor",
  "圆形": "Circle",
  "圆角": "Corner radius",
  "圆角矩形": "Rounded rect",
  "垂直均分": "Distribute vertically",
  "垂直居中": "Center vertically",
  "垂直镜像": "Flip vertically",
  "填充": "Fill",
  "填充颜色": "Fill color",
  "复位缩放": "Reset zoom",
  "复制": "Duplicate",
  "复制一条（选中优先）": "Duplicate one (selected first)",
  "外观": "Appearance",
  "多边形": "Polygon",
  "大小": "Size",
  "字号": "Font size",
  "宽": "W",
  "展开参数面板": "Show properties",
  "展开组": "Expand group",
  "属性": "Props",
  "左对齐": "Align left",
  "平移": "Offset",
  "底对齐": "Align bottom",
  "归零": "Reset",
  "折叠组": "Collapse group",
  "拖动排序": "Drag to reorder",
  "排列": "Arrange",
  "描边": "Stroke",
  "描边粗细（viewport 单位）": "Stroke width (viewport units)",
  "描边粗细（viewport 单位，0 = 无）": "Stroke width (viewport units, 0 = none)",
  "描边颜色": "Stroke color",
  "插入": "Insert",
  "插入图标": "Insert icon",
  "插入图标（追加成新图层）": "Insert icon (added as a new layer)",
  "撤销": "Undo",
  "撤销 (Ctrl+Z)": "Undo (Ctrl+Z)",
  "收起 XML": "Hide XML",
  "收起参数面板": "Hide properties",
  "放大": "Zoom in",
  "整体变换": "Transform",
  "文字": "Text",
  "文字转 path": "Text to path",
  "文字转 path 失败（画布不可用或内容为空）": "Text-to-path failed (canvas unavailable or content empty)",
  "新图形默认填充 {c}": "Default fill for new shapes: {c}",
  "新图形默认样式": "New-shape defaults",
  "旋转": "Rotation",
  "旋转 {deg}°": "Rotation {deg}°",
  "旋转角度（度）": "Rotation (degrees)",
  "无": "None",
  "无填充": "No fill",
  "无描边": "No stroke",
  "无衬线": "Sans serif",
  "星形": "Star",
  "显示": "Show",
  "显示网格": "Show grid",
  "查看生成的 XML": "View generated XML",
  "样式": "Style",
  "椭圆": "Ellipse",
  "楷体": "Kai",
  "比例": "Scale",
  "水平均分": "Distribute horizontally",
  "水平居中": "Center horizontally",
  "水平镜像": "Flip horizontally",
  "画布": "Canvas",
  "画布尺寸": "Canvas size",
  "画布是空的，先画点东西": "The canvas is empty — draw something first",
  "画布是空的：选左边工具画一个，或从图标库挑一个字形。": "The canvas is empty: pick a tool on the left, or choose a glyph from the icon library.",
  "画布背景色": "Canvas background",
  "画布还是空的：选个工具，在左边拖一下": "Canvas is still empty: pick a tool and drag on the left",
  "画布里只有文字，而且转换失败：先改成图形再保存": "The canvas only has text and the conversion failed: convert it to shapes before saving",
  "画笔": "Pen",
  "直线": "Line",
  "矩形": "Rectangle",
  "等宽": "Monospace",
  "粗细": "Width",
  "组名（导出为 android:name）": "Group name (exported as android:name)",
  "组里有旋转：解组没法把旋转烘回图形，请先把「旋转」调回 0°": "The group is rotated: ungrouping can't bake rotation into shapes — set rotation back to 0° first",
  "绘制工具": "Drawing tools",
  "编组": "Group",
  "编组 (Ctrl+G)": "Group (Ctrl+G)",
  "编辑图标": "Edit icon",
  "缩小": "Zoom out",
  "缩放": "Scale",
  "网格": "Grid",
  "背景": "Background",
  "自定义": "Custom",
  "衬线": "Serif",
  "角度归零": "Reset angle",
  "解组": "Ungroup",
  "解组 (Ctrl+Shift+G)": "Ungroup (Ctrl+Shift+G)",
  "解锁": "Unlock",
  "资源": "Resources",
  "资源名不能为空": "Asset name cannot be empty",
  "路径": "Path",
  "转为路径": "Convert to path",
  "边数": "Sides",
  "返回": "Back",
  "返回编辑器": "Back to editor",
  "这个文件不是标准 <vector>，暂时只能原样查看。可以点下面的按钮改用图标库里的字形。": "This file isn't a standard <vector>; it can only be viewed as-is. Use the button below to pick a glyph from the icon library instead.",
  "这是普通图片（png / jpg 等位图），不是矢量图标 —— 图标编辑器只能改 <vector> 资源。位图请直接用图片资源，或点下面的按钮从图标库重新选一个。": "This is a bitmap (png / jpg), not a vector icon — the icon editor only edits <vector> resources. Use the bitmap as an image directly, or pick another icon from the library below.",
  "逆时针 1 度": "Rotate -1°",
  "逆时针 1°": "-1°",
  "选一个图形后可精确调 X / Y、宽 / 高和旋转角度。": "Select a shape to adjust X / Y, width / height and rotation precisely.",
  "选中图形填 {c}": "Fill of selected shapes: {c}",
  "选中整组": "Select whole group",
  "选择": "Select",
  "选择图标": "Choose icon",
  "选择填充色": "Choose fill color",
  "选择描边色": "Choose stroke color",
  "选择背景色": "Choose background color",
  "透明": "Transparent",
  "透明背景": "Transparent background",
  "重做": "Redo",
  "重做 (Ctrl+Shift+Z)": "Redo (Ctrl+Shift+Z)",
  "锁定": "Lock",
  "锁定宽高比（取消后会拉伸）": "Lock aspect ratio (unlocks stretching)",
  "隐藏": "Hide",
  "顶对齐": "Align top",
  "顺时针 1 度": "Rotate +1°",
  "顺时针 1°": "+1°",
  "高": "H",
  "图层列表": "Layer list",
};

/** 繁體 —— 只登记与简体不同的；没登记的会先试英文兜底 */
export const SRC_HANT: SrcDict = {};

/** 日本語 */
export const SRC_JA: SrcDict = {};

export const SRC_DICTS: Record<string, SrcDict> = {
  en: SRC_EN,
  "zh-Hant": SRC_HANT,
  ja: SRC_JA,
};

// ---- 当前语言（模块级）----
// 组件不必都接 lang prop：语言切换时 XmlEditor 会重渲染整棵树，子组件跟着重渲染，
// 读模块级变量即可。memo 过的组件需要额外传 lang，见 useLangTick()。

let currentLang: string = "zh-Hans";

export function setI18nLang(lang: string): void {
  currentLang = lang;
}

export function getI18nLang(): string {
  return currentLang;
}

/**
 * 取译文：与 tr(key, fallback) 的区别是不需要 key。
 * 用法：t("保存") → Save / 保存 / 保存（中文环境原样返回）
 */
export function t(zh: string, vars?: Record<string, string | number>): string {
  if (currentLang === "zh-Hans") {
    if (!vars) return zh;
  }
  const raw =
    (currentLang !== "zh-Hans" ? SRC_DICTS[currentLang]?.[zh] : undefined) ?? zh;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

/** 组件内可选用：拿到当前语言，便于把 lang 放进依赖里 */
export function useLangValue(): string {
  return currentLang;
}
