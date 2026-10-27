// lib/xml/widget-docs.ts — 控件属性文档（选中控件时侧栏展示的说明，纯数据 + 纯函数）
// 定位：给「不熟 Android XML」的人看的中文速查，不是完整 API 文档。
// 结构：通用属性（所有 View 共有）+ 各控件专属属性；标签做全限定名归一化。

export interface AttrDoc {
  /** 属性名（不带 android: 前缀） */
  name: string;
  /** 属性类型：尺寸 / 颜色 / 文本 / 枚举 / 布尔 / 数值 / 引用 / drawable */
  type: string;
  /** 一句话说明 */
  desc: string;
  /** 常见取值（可省略） */
  values?: string[];
}

export interface WidgetDoc {
  /** 控件中文名 */
  title: string;
  /** 一句话定位 */
  summary: string;
  /** 归属分类 */
  category: "布局" | "文本" | "输入" | "图片" | "选择" | "列表" | "容器" | "其他";
  /** 专属属性 */
  attrs: AttrDoc[];
  /** 使用要点（渲染/约束相关的坑） */
  notes?: string[];
}

/** 所有 View 通用属性 */
export const COMMON_ATTRS: AttrDoc[] = [
  { name: "id", type: "引用", desc: "控件唯一标识，代码里 findViewById / ViewBinding 用它找控件", values: ["@+id/xxx"] },
  { name: "layout_width", type: "尺寸", desc: "宽度：match_parent 撑满父级 / wrap_content 包住内容 / 具体值如 120dp", values: ["match_parent", "wrap_content", "120dp"] },
  { name: "layout_height", type: "尺寸", desc: "高度：规则同 layout_width", values: ["match_parent", "wrap_content", "48dp"] },
  { name: "layout_weight", type: "数值", desc: "LinearLayout 里的剩余空间权重（配合 0dp 使用）", values: ["1", "2"] },
  { name: "layout_margin", type: "尺寸", desc: "四边外边距（控件与父级/兄弟之间的距离）", values: ["8dp", "16dp"] },
  { name: "layout_marginStart", type: "尺寸", desc: "起始侧外边距（中文/英文环境都是左边）" },
  { name: "layout_marginEnd", type: "尺寸", desc: "结束侧外边距（中文/英文环境都是右边）" },
  { name: "layout_marginTop", type: "尺寸", desc: "上外边距" },
  { name: "layout_marginBottom", type: "尺寸", desc: "下外边距" },
  { name: "layout_gravity", type: "枚举", desc: "自己在父容器里的对齐方式（对照父级 gravity）", values: ["center", "top|end", "center_vertical"] },
  { name: "padding", type: "尺寸", desc: "四边内边距（内容与控件边框之间的距离）", values: ["8dp", "16dp"] },
  { name: "paddingStart", type: "尺寸", desc: "起始侧内边距" },
  { name: "paddingEnd", type: "尺寸", desc: "结束侧内边距" },
  { name: "background", type: "颜色", desc: "背景：颜色值、@color/xxx 或 @drawable/xxx（形状/选择器）", values: ["#FFFFFF", "@color/bg", "@drawable/bg_card"] },
  { name: "backgroundTint", type: "颜色", desc: "给背景着色（保留 drawable 形状，只换颜色）" },
  { name: "foreground", type: "drawable", desc: "前景层（画在内容和子控件之上，FrameLayout/LinearLayout 可用）" },
  { name: "elevation", type: "尺寸", desc: "阴影高度（Material 卡片感，需要背景不透明才明显）", values: ["2dp", "4dp"] },
  { name: "alpha", type: "数值", desc: "整体透明度 0~1", values: ["0.5"] },
  { name: "visibility", type: "枚举", desc: "可见性：visible 显示 / invisible 隐藏但占位 / gone 隐藏且不占位", values: ["visible", "invisible", "gone"] },
  { name: "enabled", type: "布尔", desc: "是否可交互（false 变灰且不能点）", values: ["true", "false"] },
  { name: "clickable", type: "布尔", desc: "是否响应点击" },
  { name: "minWidth", type: "尺寸", desc: "最小宽度" },
  { name: "minHeight", type: "尺寸", desc: "最小高度" },
  { name: "contentDescription", type: "文本", desc: "无障碍朗读文本（图标类控件必填）" },
  { name: "tag", type: "文本", desc: "任意标记文本，代码里可取（常用于列表复用标识）" },
];

const TEXT_ATTRS: AttrDoc[] = [
  { name: "text", type: "文本", desc: "显示文字，可直接写或 @string/xxx", values: ["@string/title", "确定"] },
  { name: "textSize", type: "尺寸", desc: "字号，单位 sp（会跟随系统字体大小缩放）", values: ["14sp", "@dimen/text_size_medium"] },
  { name: "textColor", type: "颜色", desc: "文字颜色", values: ["#1D1B20", "@color/on_surface"] },
  { name: "textStyle", type: "枚举", desc: "字形：normal / bold / italic", values: ["normal", "bold", "italic"] },
  { name: "textAllCaps", type: "布尔", desc: "是否全部大写（Material Button 默认 true）" },
  { name: "maxLines", type: "数值", desc: "最多显示几行", values: ["1", "2"] },
  { name: "ellipsize", type: "枚举", desc: "超长截断方式：end 省略号 / middle / marquee 跑马灯", values: ["end", "middle", "marquee"] },
  { name: "gravity", type: "枚举", desc: "文字在控件内的对齐：left/center/right + top/center_vertical/bottom", values: ["center", "center_vertical|start", "end"] },
  { name: "lineSpacingExtra", type: "尺寸", desc: "行间距额外增加值", values: ["4dp"] },
  { name: "textAppearance", type: "引用", desc: "文字样式（字号/颜色等成套定义）", values: ["?attr/textAppearanceBody1"] },
];

const DRAWABLE_POS_ATTRS: AttrDoc[] = [
  { name: "drawableStart", type: "drawable", desc: "文字起始侧图标（左）", values: ["@drawable/ic_star"] },
  { name: "drawableEnd", type: "drawable", desc: "文字结束侧图标（右）" },
  { name: "drawableTop", type: "drawable", desc: "文字上方图标" },
  { name: "drawableBottom", type: "drawable", desc: "文字下方图标" },
  { name: "drawablePadding", type: "尺寸", desc: "图标与文字间距", values: ["4dp", "8dp"] },
];

const CL_ATTRS: AttrDoc[] = [
  { name: "layout_constraintTop_toTopOf", type: "引用", desc: "自己的上边贴着谁的上边", values: ["parent", "@id/xxx"] },
  { name: "layout_constraintTop_toBottomOf", type: "引用", desc: "自己的上边贴着谁的下边" },
  { name: "layout_constraintBottom_toTopOf", type: "引用", desc: "自己的下边贴着谁的上边" },
  { name: "layout_constraintBottom_toBottomOf", type: "引用", desc: "自己的下边贴着谁的下边", values: ["parent"] },
  { name: "layout_constraintStart_toStartOf", type: "引用", desc: "自己的起始边贴着谁的起始边", values: ["parent"] },
  { name: "layout_constraintStart_toEndOf", type: "引用", desc: "自己的起始边贴着谁的结束边" },
  { name: "layout_constraintEnd_toStartOf", type: "引用", desc: "自己的结束边贴着谁的起始边" },
  { name: "layout_constraintEnd_toEndOf", type: "引用", desc: "自己的结束边贴着谁的结束边", values: ["parent"] },
  { name: "layout_constraintHorizontal_bias", type: "数值", desc: "左右约束之间的水平位置 0~1（0.5 居中）", values: ["0", "0.5", "1"] },
  { name: "layout_constraintVertical_bias", type: "数值", desc: "上下约束之间的垂直位置 0~1" },
  { name: "layout_constraintDimensionRatio", type: "文本", desc: "宽高比（宽或高设 0dp 时生效）", values: ["16:9", "1:1"] },
  { name: "layout_constraintHorizontal_chainStyle", type: "枚举", desc: "横向链样式：spread 均分 / spread_inside / packed 挤在一起", values: ["spread", "spread_inside", "packed"] },
  { name: "layout_constraintGuide_percent", type: "数值", desc: "Guideline 位置（0~1 百分比）", values: ["0.5"] },
  { name: "layout_constraintGuide_begin", type: "尺寸", desc: "Guideline 距起始边距离" },
  { name: "layout_constraintCircle", type: "引用", desc: "围绕某控件做圆周定位" },
];

const LINEAR_ATTRS: AttrDoc[] = [
  { name: "orientation", type: "枚举", desc: "排列方向：vertical 竖排（默认）/ horizontal 横排", values: ["vertical", "horizontal"] },
  { name: "gravity", type: "枚举", desc: "子控件整体对齐方式", values: ["center", "center_horizontal", "start|center_vertical"] },
  { name: "divider", type: "drawable", desc: "子项之间的分隔线 drawable" },
  { name: "showDividers", type: "枚举", desc: "分隔线显示位置：none / beginning / middle / end", values: ["middle"] },
  { name: "dividerPadding", type: "尺寸", desc: "分隔线内边距" },
  { name: "baselineAligned", type: "布尔", desc: "横排时是否按文字基线对齐（默认 true）" },
];

const FRAME_ATTRS: AttrDoc[] = [
  { name: "foregroundGravity", type: "枚举", desc: "前景层的对齐方式", values: ["fill", "center"] },
  { name: "measureAllChildren", type: "布尔", desc: "是否测量 gone 的子控件" },
  { name: "clipChildren", type: "布尔", desc: "是否裁剪超出边界的内容" },
];

const RELATIVE_ATTRS: AttrDoc[] = [
  { name: "layout_alignParentTop", type: "布尔", desc: "贴住父级顶部", values: ["true"] },
  { name: "layout_alignParentBottom", type: "布尔", desc: "贴住父级底部" },
  { name: "layout_alignParentStart", type: "布尔", desc: "贴住父级起始边" },
  { name: "layout_alignParentEnd", type: "布尔", desc: "贴住父级结束边" },
  { name: "layout_centerInParent", type: "布尔", desc: "在父级正中" },
  { name: "layout_below", type: "引用", desc: "放在某控件下方", values: ["@id/xxx"] },
  { name: "layout_toEndOf", type: "引用", desc: "放在某控件右侧" },
  { name: "layout_alignTop", type: "引用", desc: "上边与某控件对齐" },
];

const INPUT_ATTRS: AttrDoc[] = [
  { name: "hint", type: "文本", desc: "占位提示文字（有内容时消失）", values: ["@string/hint", "请输入手机号"] },
  { name: "inputType", type: "枚举", desc: "键盘与输入限制：text / number / phone / textPassword / textEmailAddress", values: ["text", "number", "phone", "textPassword"] },
  { name: "maxLength", type: "数值", desc: "最大输入长度（需配合代码设置，预览仅作提示）", values: ["11"] },
  { name: "singleLine", type: "布尔", desc: "单行输入（替代已废弃的 lines=1）" },
  { name: "imeOptions", type: "枚举", desc: "软键盘回车键样式：actionDone / actionSearch / actionNext", values: ["actionDone", "actionSearch"] },
  { name: "textColorHint", type: "颜色", desc: "占位文字颜色" },
];

const IMAGE_ATTRS: AttrDoc[] = [
  { name: "src", type: "drawable", desc: "图片资源：@drawable/xxx / @mipmap/xxx", values: ["@drawable/ic_logo", "@mipmap/ic_launcher"] },
  { name: "scaleType", type: "枚举", desc: "图片缩放方式：centerCrop 裁切填满 / fitCenter 完整显示 / fitXY 拉伸", values: ["centerCrop", "fitCenter", "fitXY", "centerInside"] },
  { name: "tint", type: "颜色", desc: "给图片着色" },
  { name: "adjustViewBounds", type: "布尔", desc: "是否按图片比例调整控件边界" },
];

const SELECTION_ATTRS: AttrDoc[] = [
  { name: "checked", type: "布尔", desc: "是否处于选中状态", values: ["true", "false"] },
  { name: "buttonTint", type: "颜色", desc: "勾选框/开关的颜色" },
  { name: "textOn", type: "文本", desc: "开关打开时的文字" },
  { name: "textOff", type: "文本", desc: "开关关闭时的文字" },
  { name: "thumbTint", type: "颜色", desc: "滑块颜色（SeekBar/Switch）" },
  { name: "progressTint", type: "颜色", desc: "进度条已完成部分的颜色" },
];

const PROGRESS_ATTRS: AttrDoc[] = [
  { name: "progress", type: "数值", desc: "当前进度值（0~max）", values: ["50"] },
  { name: "max", type: "数值", desc: "最大进度值（默认 100）", values: ["100"] },
  { name: "indeterminate", type: "布尔", desc: "不确定进度（转圈动画）" },
  { name: "progressDrawable", type: "drawable", desc: "自定义进度条外观" },
];

const CONTAINER_LIST_ATTRS: AttrDoc[] = [
  { name: "layoutManager", type: "枚举", desc: "列表布局方式：linear（线性）/ grid（网格）/ staggered（瀑布流）" },
  { name: "spanCount", type: "数值", desc: "网格列数（配合 grid）", values: ["2", "3"] },
  { name: "orientation", type: "枚举", desc: "列表滚动方向", values: ["vertical", "horizontal"] },
  { name: "itemSpacing", type: "尺寸", desc: "列表项间距" },
];

const PARSED: Record<string, WidgetDoc> = {
  LinearLayout: {
    title: "线性布局",
    summary: "子控件按一个方向依次排列（竖排或横排），最常用；配合 layout_weight 做比例分配。",
    category: "布局",
    attrs: LINEAR_ATTRS,
    notes: [
      "子控件 layout_weight 配合 0dp 才会按比例分剩余空间",
      "嵌套超过 3 层建议换 ConstraintLayout（性能与可读性都更好）",
    ],
  },
  FrameLayout: {
    title: "帧布局",
    summary: "子控件层层堆叠在左上角，后写的盖住先写的；常用于叠放遮罩、角标、加载层。",
    category: "布局",
    attrs: FRAME_ATTRS,
    notes: ["只有一个子控件时最省性能；要对齐用 layout_gravity"],
  },
  ConstraintLayout: {
    title: "约束布局",
    summary: "用「谁的边贴谁的边」来描述位置，一层就能画出复杂界面，Android 官方推荐首选。",
    category: "布局",
    attrs: CL_ATTRS,
    notes: [
      "宽或高设 0dp 表示「由约束撑开」（match_constraint），不是没宽度",
      "没有任何约束的控件会停在左上角（0,0）",
      "两边都约束 + bias 控制位置，0.5 是居中",
    ],
  },
  RelativeLayout: {
    title: "相对布局",
    summary: "以兄弟控件或父级为参照定位（在某控件右边/下方/居中等），现多用 ConstraintLayout 替代。",
    category: "布局",
    attrs: RELATIVE_ATTRS,
    notes: ["引用兄弟控件要用 @id/xxx（不是 @+id/）"],
  },
  GridLayout: {
    title: "网格布局",
    summary: "按行列网格摆放子控件，子项用 layout_row / layout_column 落格，可跨格。",
    category: "布局",
    attrs: [
      { name: "columnCount", type: "数值", desc: "网格列数（-1 表示自动）", values: ["2", "3", "-1"] },
      { name: "rowCount", type: "数值", desc: "网格行数（-1 表示自动）" },
      { name: "layout_row", type: "数值", desc: "子项所在行（从 0 开始）", values: ["0", "1"] },
      { name: "layout_column", type: "数值", desc: "子项所在列" },
      { name: "layout_columnSpan", type: "数值", desc: "横向跨几格", values: ["2"] },
      { name: "layout_rowSpan", type: "数值", desc: "纵向跨几行" },
    ],
  },
  TableLayout: {
    title: "表格布局",
    summary: "由若干 TableRow 组成的表格；列宽由内容或 stretchColumns 决定。",
    category: "布局",
    attrs: [
      { name: "stretchColumns", type: "数值", desc: "要拉伸填满剩余宽度的列序号（0 开始，逗号分隔）", values: ["0", "1,2"] },
      { name: "shrinkColumns", type: "数值", desc: "空间不足时要压缩的列" },
      { name: "collapseColumns", type: "数值", desc: "要隐藏的列" },
    ],
  },
  TableRow: {
    title: "表格行",
    summary: "TableLayout 的直接子项，内部子控件横向排列成一行的各列。",
    category: "布局",
    attrs: [{ name: "layout_column", type: "数值", desc: "指定该子项放在第几列（跳过中间列用）" }],
  },
  ScrollView: {
    title: "滚动视图（竖）",
    summary: "内容超过一屏时可纵向滚动；只能有一个直接子控件（通常里面再放 LinearLayout）。",
    category: "容器",
    attrs: [
      { name: "fillViewport", type: "布尔", desc: "内容不足一屏时是否撑满（true 时子布局可 match_parent）" },
      { name: "scrollbars", type: "枚举", desc: "滚动条显示：vertical / none" },
    ],
    notes: ["只能有一个子控件；多个子控件会被包一层外层容器或被忽略"],
  },
  HorizontalScrollView: {
    title: "滚动视图（横）",
    summary: "内容超过一屏宽时可横向滚动，同样只允许一个直接子控件。",
    category: "容器",
    attrs: [{ name: "fillViewport", type: "布尔", desc: "内容不足一屏宽时是否撑满" }],
  },
  NestedScrollView: {
    title: "嵌套滚动视图",
    summary: "可滚动 + 内部列表（RecyclerView）也能一起滚的 ScrollView，Material 场景替代 ScrollView。",
    category: "容器",
    attrs: [{ name: "fillViewport", type: "布尔", desc: "内容不足一屏时撑满" }],
  },
  CoordinatorLayout: {
    title: "协调布局",
    summary: "能协调子控件联动的容器（如滚动时 AppBar 收起），常配 AppBarLayout + CollapsingToolbarLayout。",
    category: "布局",
    attrs: [
      { name: "layout_behavior", type: "文本", desc: "指定该子项的联动行为类名（如 @string/appbar_scrolling_view_behavior）" },
      { name: "layout_scrollFlags", type: "枚举", desc: "AppBarLayout 子项的收起方式：scroll / enterAlways / exitUntilCollapsed" },
    ],
  },
  DrawerLayout: {
    title: "抽屉布局",
    summary: "侧滑抽屉容器：主内容 + 一到两个抽屉（layout_gravity=start/end）。",
    category: "布局",
    attrs: [{ name: "layout_gravity", type: "枚举", desc: "抽屉放在哪一侧：start / end", values: ["start", "end"] }],
  },
  merge: {
    title: "合并标签",
    summary: "include 时用它当根，把子控件直接并进父容器，少一层嵌套（只能用于被 include）。",
    category: "其他",
    attrs: [],
  },
  TextView: {
    title: "文本",
    summary: "显示一行或多行文字，几乎所有文字内容的基础控件。",
    category: "文本",
    attrs: [...TEXT_ATTRS, ...DRAWABLE_POS_ATTRS],
  },
  Button: {
    title: "按钮",
    summary: "可点击的文字按钮；Material 主题下自带背景、圆角与全大写。",
    category: "文本",
    attrs: [...TEXT_ATTRS, ...DRAWABLE_POS_ATTRS, { name: "minHeight", type: "尺寸", desc: "按钮最小高度（Material 默认 48dp）" }],
  },
  MaterialButton: {
    title: "Material 按钮",
    summary: "Material 组件按钮，支持描边款、图标、圆角自定义。",
    category: "文本",
    attrs: [
      ...TEXT_ATTRS,
      { name: "cornerRadius", type: "尺寸", desc: "圆角半径", values: ["4dp", "20dp"] },
      { name: "strokeWidth", type: "尺寸", desc: "描边宽度（配 strokeColor 做描边按钮）" },
      { name: "strokeColor", type: "颜色", desc: "描边颜色" },
      { name: "icon", type: "drawable", desc: "按钮内图标" },
      { name: "iconGravity", type: "枚举", desc: "图标位置：textStart / textEnd" },
    ],
  },
  ImageView: {
    title: "图片",
    summary: "展示图片资源（也常用来放图标）。",
    category: "图片",
    attrs: IMAGE_ATTRS,
    notes: ["宽高设 wrap_content + adjustViewBounds=true 可保持原图比例"],
  },
  ImageButton: {
    title: "图片按钮",
    summary: "可点击的图片，默认无文字（要文字用 Button + drawableStart）。",
    category: "图片",
    attrs: IMAGE_ATTRS,
  },
  EditText: {
    title: "输入框",
    summary: "用户输入文本的控件；样式由主题或 backgroundTint 控制。",
    category: "输入",
    attrs: [...TEXT_ATTRS, ...INPUT_ATTRS],
    notes: ["inputType 决定弹哪种键盘，别只靠代码限制"],
  },
  TextInputLayout: {
    title: "输入框容器",
    summary: "Material 输入框外壳：带浮动标签、错误提示、字数统计。",
    category: "输入",
    attrs: [
      { name: "hint", type: "文本", desc: "浮动标签文字（获得焦点时上浮）" },
      { name: "boxBackgroundMode", type: "枚举", desc: "外观：none / filled / outline", values: ["filled", "outline"] },
      { name: "boxStrokeColor", type: "颜色", desc: "描边颜色" },
      { name: "counterEnabled", type: "布尔", desc: "是否显示字数统计" },
      { name: "errorEnabled", type: "布尔", desc: "是否显示错误提示区" },
    ],
    notes: ["里面必须再放一个 TextInputEditText 才是实际输入控件"],
  },
  TextInputEditText: {
    title: "Material 输入框",
    summary: "配合 TextInputLayout 使用的输入控件本体。",
    category: "输入",
    attrs: [...TEXT_ATTRS, ...INPUT_ATTRS],
  },
  CheckBox: {
    title: "复选框",
    summary: "多选：可同时勾选多项。",
    category: "选择",
    attrs: [...TEXT_ATTRS, ...SELECTION_ATTRS],
  },
  RadioButton: {
    title: "单选按钮",
    summary: "单选：同一 RadioGroup 内互斥。",
    category: "选择",
    attrs: [...TEXT_ATTRS, ...SELECTION_ATTRS],
  },
  RadioGroup: {
    title: "单选组",
    summary: "把多个 RadioButton 包起来，组内自动互斥。",
    category: "选择",
    attrs: [
      { name: "orientation", type: "枚举", desc: "排列方向", values: ["vertical", "horizontal"] },
      { name: "checkedButton", type: "引用", desc: "默认选中的子项 id" },
    ],
  },
  Switch: {
    title: "开关",
    summary: "开/关二态切换，常用于设置项。",
    category: "选择",
    attrs: [...SELECTION_ATTRS],
  },
  SwitchMaterial: {
    title: "Material 开关",
    summary: "Material 风格开关（MaterialSwitch 同义）。",
    category: "选择",
    attrs: [...SELECTION_ATTRS],
  },
  SeekBar: {
    title: "拖动条",
    summary: "拖动选择数值范围（音量、进度等）。",
    category: "选择",
    attrs: [...PROGRESS_ATTRS, { name: "thumb", type: "drawable", desc: "滑块外观" }],
  },
  ProgressBar: {
    title: "进度条",
    summary: "水平或环形进度显示；indeterminate 时是转圈动画。",
    category: "其他",
    attrs: [
      ...PROGRESS_ATTRS,
      { name: "indeterminateTint", type: "颜色", desc: "转圈动画颜色" },
      { name: "style", type: "枚举", desc: "外观样式：?android:attr/progressBarStyleHorizontal 等", values: ["?android:attr/progressBarStyleHorizontal"] },
    ],
  },
  Spinner: {
    title: "下拉选择",
    summary: "点击弹出列表单项选择（Material 推荐用 ExposedDropdownMenu）。",
    category: "选择",
    attrs: [
      { name: "entries", type: "引用", desc: "选项文字数组资源", values: ["@array/options"] },
      { name: "spinnerMode", type: "枚举", desc: "展开方式：dropdown 下拉 / dialog 弹窗", values: ["dropdown", "dialog"] },
      { name: "prompt", type: "文本", desc: "弹窗模式的标题" },
    ],
  },
  RecyclerView: {
    title: "列表",
    summary: "高性能可复用列表（长列表必用），需要 Adapter + LayoutManager。",
    category: "列表",
    attrs: [...CONTAINER_LIST_ATTRS],
    notes: ["预览里只画占位条纹，真实内容要跑起来才看得到", "不要放进 ScrollView 里（会失去复用与滚动优化）"],
  },
  ListView: {
    title: "列表（旧）",
    summary: "旧版列表控件，新项目请用 RecyclerView。",
    category: "列表",
    attrs: [
      { name: "divider", type: "drawable", desc: "列表项分隔线" },
      { name: "dividerHeight", type: "尺寸", desc: "分隔线高度" },
      { name: "entries", type: "引用", desc: "直接绑定字符串数组" },
    ],
  },
  CardView: {
    title: "卡片",
    summary: "带圆角与阴影的卡片容器（MaterialCardView 是其升级版）。",
    category: "容器",
    attrs: [
      { name: "cardCornerRadius", type: "尺寸", desc: "卡片圆角", values: ["8dp", "16dp"] },
      { name: "cardElevation", type: "尺寸", desc: "卡片阴影高度", values: ["2dp", "4dp"] },
      { name: "cardBackgroundColor", type: "颜色", desc: "卡片背景色" },
      { name: "cardUseCompatPadding", type: "布尔", desc: "5.0 之前版本是否补充阴影边距" },
      { name: "contentPadding", type: "尺寸", desc: "卡片内边距" },
    ],
  },
  MaterialCardView: {
    title: "Material 卡片",
    summary: "支持描边、选中态的 Material 卡片。",
    category: "容器",
    attrs: [
      { name: "cardCornerRadius", type: "尺寸", desc: "卡片圆角" },
      { name: "cardElevation", type: "尺寸", desc: "阴影高度" },
      { name: "strokeWidth", type: "尺寸", desc: "描边宽度" },
      { name: "strokeColor", type: "颜色", desc: "描边颜色" },
      { name: "checkable", type: "布尔", desc: "是否可选中（做可勾选卡片用）" },
    ],
  },
  View: {
    title: "空白视图",
    summary: "不画内容的基础方块，常用来做分隔线、占位、遮罩。",
    category: "其他",
    attrs: [],
    notes: ["做分隔线：layout_height=1dp + background=#E0E0E0 即可"],
  },
  Space: {
    title: "占位",
    summary: "只占位置不绘制（比 View 更轻），用于间距。",
    category: "其他",
    attrs: [],
  },
  Guideline: {
    title: "参考线",
    summary: "ConstraintLayout 辅助线，只存在约束里、不显示，用来对齐别的控件。",
    category: "其他",
    attrs: [
      { name: "orientation", type: "枚举", desc: "vertical 竖线 / horizontal 横线", values: ["vertical", "horizontal"] },
      { name: "layout_constraintGuide_percent", type: "数值", desc: "按百分比定位", values: ["0.5"] },
      { name: "layout_constraintGuide_begin", type: "尺寸", desc: "距起始边固定距离" },
      { name: "layout_constraintGuide_end", type: "尺寸", desc: "距结束边固定距离" },
    ],
  },
  Barrier: {
    title: "屏障",
    summary: "把多个控件的边取最值形成一条虚拟边，让别的控件贴着这条边对齐。",
    category: "其他",
    attrs: [
      { name: "barrierDirection", type: "枚举", desc: "屏障方向：start / end / top / bottom", values: ["end", "bottom"] },
      { name: "constraint_referenced_ids", type: "文本", desc: "参与计算的控件 id，逗号分隔", values: ["title,subtitle"] },
    ],
  },
  include: {
    title: "引用布局",
    summary: "把另一个布局文件整块嵌进来复用（预览里会被展开成实际内容）。",
    category: "其他",
    attrs: [{ name: "layout", type: "引用", desc: "被引用的布局文件", values: ["@layout/header"] }],
    notes: ["include 上写的属性会覆盖被引用布局根节点的同名属性"],
  },
  ViewStub: {
    title: "延迟加载占位",
    summary: "默认不渲染内容，代码里 inflate() 时才真正加载，用于加速首页。",
    category: "其他",
    attrs: [{ name: "layout", type: "引用", desc: "要延迟加载的布局" }],
  },
};

/** 全限定类名 → 短名（androidx.cardview.widget.CardView → CardView） */
export function shortDocTag(tag: string): string {
  const t = (tag || "").trim();
  return t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t;
}

/** 别名：同一控件的不同写法归一 */
const ALIAS: Record<string, string> = {
  MaterialSwitch: "SwitchMaterial",
  SwitchCompat: "SwitchMaterial",
  AppCompatEditText: "EditText",
  AppCompatTextView: "TextView",
  AppCompatButton: "Button",
  AppCompatImageView: "ImageView",
  AppCompatCheckBox: "CheckBox",
  AppCompatRadioButton: "RadioButton",
  ConstraintHelper: "Barrier",
  androidxConstraintLayoutHelper: "Barrier",
};

/** 取控件文档；未知控件返回兜底（仅通用属性说明） */
export function getWidgetDoc(tag: string): WidgetDoc {
  const short = shortDocTag(tag);
  const key = ALIAS[short] ?? short;
  const found = PARSED[key];
  if (found) return found;
  return {
    title: short || "未知控件",
    summary: "这个控件还没有收录说明；下面列出所有 View 通用的属性。",
    category: "其他",
    attrs: [],
  };
}

/** 文档里的全部属性（专属 + 通用，专属优先；同名只留一份） */
export function docAttrs(tag: string): AttrDoc[] {
  const own = getWidgetDoc(tag).attrs;
  const seen = new Set(own.map((a) => a.name));
  return [...own, ...COMMON_ATTRS.filter((a) => !seen.has(a.name))];
}

/** 单条属性说明（先查专属，再查通用）；查不到返回 null */
export function docForAttr(tag: string, attrName: string): AttrDoc | null {
  const name = (attrName || "").trim();
  if (!name) return null;
  const own = getWidgetDoc(tag).attrs.find((a) => a.name === name);
  if (own) return own;
  return COMMON_ATTRS.find((a) => a.name === name) ?? null;
}

/** 当前节点上「已有但文档里有说明」的属性（属性页 ? 气泡用） */
export function attrHint(tag: string, attrName: string): string | null {
  const d = docForAttr(tag, attrName);
  if (!d) return null;
  return d.values?.length ? `${d.desc}（${d.values.slice(0, 3).join(" / ")}）` : d.desc;
}
