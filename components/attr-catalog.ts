// components/attr-catalog.ts — 属性编辑目录
// 给属性面板 / “添加属性”弹窗用：每个已知 Android 属性声明编辑器类型与选项。

export type AttrEditor =
  | "enum" // 下拉选择
  | "size" // match_parent / wrap_content / 0dp / 自定义 dp
  | "size_input" // 可编辑尺寸输入（input + datalist 预设过滤），替代纯 select
  | "dimen" // 带单位数值（8dp / 16sp）
  | "number"
  | "color"
  | "string"
  | "ref" // 约束目标（@+id/xxx 或 parent）
  | "bool";

export interface AttrSpec {
  name: string;
  editor: AttrEditor;
  options?: string[];
  default?: string;
  /** 弹窗里分组显示 */
  group: "布局" | "约束" | "文本" | "外观" | "控件" | "其他";
  desc?: string;
  /** 仅这些标签常见（弹窗里默认排前；不限则全通用） */
  tags?: string[];
}

export const ATTR_CATALOG: AttrSpec[] = [
  // ===== 布局 =====
  { name: "layout_width", editor: "size_input", options: ["match_parent", "wrap_content", "0dp"], default: "wrap_content", group: "布局", desc: "宽度" },
  { name: "layout_height", editor: "size_input", options: ["match_parent", "wrap_content", "0dp"], default: "wrap_content", group: "布局", desc: "高度" },
  { name: "layout_margin", editor: "dimen", default: "8dp", group: "布局", desc: "四周边距" },
  { name: "layout_marginTop", editor: "dimen", default: "8dp", group: "布局" },
  { name: "layout_marginBottom", editor: "dimen", default: "8dp", group: "布局" },
  { name: "layout_marginStart", editor: "dimen", default: "8dp", group: "布局" },
  { name: "layout_marginEnd", editor: "dimen", default: "8dp", group: "布局" },
  { name: "layout_marginLeft", editor: "dimen", default: "8dp", group: "布局" },
  { name: "layout_marginRight", editor: "dimen", default: "8dp", group: "布局" },
  { name: "padding", editor: "dimen", default: "8dp", group: "布局", desc: "四边内边距" },
  { name: "paddingTop", editor: "dimen", default: "8dp", group: "布局" },
  { name: "paddingBottom", editor: "dimen", default: "8dp", group: "布局" },
  { name: "paddingStart", editor: "dimen", default: "8dp", group: "布局" },
  { name: "paddingEnd", editor: "dimen", default: "8dp", group: "布局" },
  { name: "layout_weight", editor: "number", default: "1", group: "布局", desc: "LinearLayout 权重", tags: ["LinearLayout"] },
  { name: "orientation", editor: "enum", options: ["horizontal", "vertical"], default: "vertical", group: "布局", tags: ["LinearLayout"] },
  { name: "layout_gravity", editor: "enum", options: ["top", "bottom", "left", "right", "start", "end", "center", "top|start", "top|end", "bottom|start", "bottom|end", "center_vertical", "center_horizontal"], default: "center", group: "布局", desc: "自身在父容器中的位置（FrameLayout/LinearLayout）" },
  { name: "visibility", editor: "enum", options: ["visible", "invisible", "gone"], default: "visible", group: "布局" },
  { name: "id", editor: "string", default: "@+id/", group: "布局", desc: "控件 id（@+id/xxx）" },

  // ===== 约束（ConstraintLayout）=====
  { name: "layout_constraintStart_toStartOf", editor: "ref", default: "parent", group: "约束" },
  { name: "layout_constraintStart_toEndOf", editor: "ref", default: "parent", group: "约束" },
  { name: "layout_constraintEnd_toStartOf", editor: "ref", default: "parent", group: "约束" },
  { name: "layout_constraintEnd_toEndOf", editor: "ref", default: "parent", group: "约束" },
  { name: "layout_constraintTop_toTopOf", editor: "ref", default: "parent", group: "约束" },
  { name: "layout_constraintTop_toBottomOf", editor: "ref", default: "parent", group: "约束" },
  { name: "layout_constraintBottom_toTopOf", editor: "ref", default: "parent", group: "约束" },
  { name: "layout_constraintBottom_toBottomOf", editor: "ref", default: "parent", group: "约束" },
  { name: "layout_constraintHorizontal_bias", editor: "number", default: "0.5", group: "约束" },
  { name: "layout_constraintVertical_bias", editor: "number", default: "0.5", group: "约束" },

  // ===== 文本 =====
  { name: "text", editor: "string", default: "文本", group: "文本" },
  { name: "hint", editor: "string", default: "提示文字", group: "文本", tags: ["EditText"] },
  { name: "textSize", editor: "dimen", default: "16sp", group: "文本", desc: "字号" },
  { name: "textColor", editor: "color", default: "#1D1B20", group: "文本" },
  { name: "textStyle", editor: "enum", options: ["normal", "bold", "italic", "bolditalic"], default: "normal", group: "文本" },
  { name: "textAllCaps", editor: "bool", default: "false", group: "文本" },
  { name: "gravity", editor: "enum", options: ["start", "end", "center", "top", "bottom", "center_vertical", "center_horizontal", "left", "right", "center_vertical|start", "center_vertical|end", "top|start", "bottom|end"], default: "center", group: "文本", desc: "内容/文字对齐" },
  { name: "maxLines", editor: "number", default: "1", group: "文本" },
  { name: "ellipsize", editor: "enum", options: ["end", "start", "middle", "marquee"], default: "end", group: "文本" },

  // ===== 外观 =====
  { name: "background", editor: "color", default: "#FFFFFF", group: "外观", desc: "背景色" },
  { name: "elevation", editor: "dimen", default: "2dp", group: "外观" },
  { name: "src", editor: "string", default: "@drawable/", group: "外观", desc: "图片资源", tags: ["ImageView"] },
  { name: "tint", editor: "color", default: "#000000", group: "外观", desc: "着色（图片框/图片按钮特有，颜色值或 @color/xxx）", tags: ["ImageView", "ImageButton", "FloatingActionButton", "CheckBox", "RadioButton"] },
  { name: "tintMode", editor: "enum", options: ["src_in", "src_over", "src_atop", "multiply", "screen", "add"], default: "src_in", group: "外观", desc: "着色混合模式", tags: ["ImageView", "ImageButton"] },
  { name: "adjustViewBounds", editor: "bool", default: "true", group: "外观", tags: ["ImageView"] },
  { name: "scaleType", editor: "enum", options: ["fitCenter", "centerCrop", "fitXY", "center", "fitStart", "fitEnd"], default: "fitCenter", group: "外观", tags: ["ImageView"] },

  // ===== 控件 =====
  { name: "checked", editor: "bool", default: "true", group: "控件", desc: "Switch / CheckBox / RadioButton", tags: ["Switch", "SwitchCompat", "CheckBox", "RadioButton", "Slider"] },
  { name: "progress", editor: "number", default: "50", group: "控件", tags: ["ProgressBar", "SeekBar", "Slider"] },
  { name: "max", editor: "number", default: "100", group: "控件", tags: ["ProgressBar", "SeekBar", "Slider"] },
  { name: "progressStyle", editor: "string", default: "?android:attr/progressBarStyleHorizontal", group: "控件", tags: ["ProgressBar"] },
  { name: "cardCornerRadius", editor: "dimen", default: "8dp", group: "控件", tags: ["CardView", "MaterialCardView"] },
  { name: "cardElevation", editor: "dimen", default: "4dp", group: "控件", tags: ["CardView", "MaterialCardView"] },
  { name: "layout", editor: "string", default: "@layout/", group: "控件", desc: "include 引用的布局", tags: ["include"] },
  { name: "inputType", editor: "enum", options: ["text", "number", "phone", "textEmailAddress", "textPassword", "textWebEditText"], default: "text", group: "控件", tags: ["EditText"] },

  // ===== 其他 =====
  { name: "tag", editor: "string", default: "", group: "其他" },
];

/** 弹窗里的展示顺序：已知属性按分组排；未知属性（已在节点上但不在目录里）走自由文本 */
export function editorFor(name: string, current?: string): { editor: AttrEditor; options?: string[] } {
  const spec = ATTR_CATALOG.find((a) => a.name === name);
  if (spec) {
    let options = spec.options;
    // 当前值不在预设里时补一个选项，避免选框“丢失”当前值
    if (options && current && !options.includes(current)) options = [...options, current];
    return { editor: spec.editor, options };
  }
  // 未收录属性：启发式
  if (current === "true" || current === "false") return { editor: "bool", options: ["true", "false"] };
  if (/^#[0-9a-fA-F]{3,8}$/.test(current ?? "")) return { editor: "color" };
  if (name === "layout_width" || name === "layout_height") return { editor: "size_input", options: ["match_parent", "wrap_content", "0dp"] };
  if (name.includes("constraint") && name.endsWith("Of")) return { editor: "ref" };
  if (/margin|padding|TextSize$|elevation/i.test(name) || name === "textSize") return { editor: "dimen" };
  if (name.endsWith("bias") || name === "weight" || name === "maxLines" || name === "max") return { editor: "number" };
  return { editor: "string" };
}

export function defaultFor(name: string): string {
  return ATTR_CATALOG.find((a) => a.name === name)?.default ?? "";
}
