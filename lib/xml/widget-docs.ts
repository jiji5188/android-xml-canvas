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

/** 控件分类（文档面板里按这个分组；M3f 拆成 Material / 平台两组） */
export type WidgetCategory =
  | "布局"
  | "文本"
  | "输入"
  | "图片"
  | "选择"
  | "列表"
  | "容器"
  | "Material"
  | "其他";

export interface WidgetDoc {
  /** 控件中文名 */
  title: string;
  /** 一句话定位 */
  summary: string;
  /** 归属分类 */
  category: WidgetCategory;
  /** 专属属性 */
  attrs: AttrDoc[];
  /** 使用要点（渲染/约束相关的坑） */
  notes?: string[];
  /** 官方文档链接（developer.android.com 或 androidx/m3 文档） */
  officialDoc?: string;
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
  // ===== M11v：补齐此前缺失的通用属性 =====
  { name: "paddingTop", type: "尺寸", desc: "上内边距" },
  { name: "paddingBottom", type: "尺寸", desc: "下内边距" },
  { name: "paddingLeft", type: "尺寸", desc: "左内边距（不随语言方向翻转，一般用 paddingStart）" },
  { name: "paddingRight", type: "尺寸", desc: "右内边距（不随语言方向翻转，一般用 paddingEnd）" },
  { name: "paddingHorizontal", type: "尺寸", desc: "左右内边距一次设置（等于同时设 Start + End）" },
  { name: "paddingVertical", type: "尺寸", desc: "上下内边距一次设置（等于同时设 Top + Bottom）" },
  { name: "layout_marginLeft", type: "尺寸", desc: "左外边距（不随语言方向翻转）" },
  { name: "layout_marginRight", type: "尺寸", desc: "右外边距（不随语言方向翻转）" },
  { name: "layout_marginHorizontal", type: "尺寸", desc: "左右外边距一次设置" },
  { name: "layout_marginVertical", type: "尺寸", desc: "上下外边距一次设置" },
  { name: "maxWidth", type: "尺寸", desc: "最大宽度（wrap_content 时限制上限）", values: ["320dp"] },
  { name: "maxHeight", type: "尺寸", desc: "最大高度" },
  { name: "foregroundGravity", type: "枚举", desc: "前景层的对齐方式（fill 才拉伸）", values: ["center", "fill", "bottom|end"] },
  { name: "rotation", type: "数值", desc: "旋转角度（度，顺时针）" },
  { name: "rotationX", type: "数值", desc: "沿 X 轴翻转角度（3D 变换）" },
  { name: "rotationY", type: "数值", desc: "沿 Y 轴翻转角度（3D 变换）" },
  { name: "scaleX", type: "数值", desc: "横向缩放倍数（1 = 原始大小）", values: ["0.5", "1.2"] },
  { name: "scaleY", type: "数值", desc: "纵向缩放倍数" },
  { name: "translationX", type: "尺寸", desc: "横向平移（不影响布局占位）" },
  { name: "translationY", type: "尺寸", desc: "纵向平移（不影响布局占位）" },
  { name: "translationZ", type: "尺寸", desc: "Z 轴抬升（跟 elevation 相加，决定压谁上面）" },
  { name: "pivotX", type: "数值", desc: "变换中心点 X（默认 50%）" },
  { name: "pivotY", type: "数值", desc: "变换中心点 Y（默认 50%）" },
  { name: "backgroundTintMode", type: "枚举", desc: "背景着色的混色方式", values: ["src_over", "multiply", "screen", "add"] },
  { name: "outlineSpotShadowColor", type: "颜色", desc: "聚光阴影颜色（API 28+）" },
  { name: "outlineAmbientShadowColor", type: "颜色", desc: "环境阴影颜色（API 28+）" },
  { name: "fontFamily", type: "文本", desc: "字体（系统字体名，如 sans-serif-medium）" },
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

const MATERIAL_FAB_ATTRS: AttrDoc[] = [
  { name: "srcCompat", type: "drawable", desc: "图标（推荐用 vector drawable）", values: ["@drawable/ic_add"] },
  { name: "backgroundTint", type: "颜色", desc: "按钮底色（默认取主题 primaryContainer）", values: ["?attr/colorPrimaryContainer"] },
  { name: "tint", type: "颜色", desc: "图标颜色", values: ["?attr/colorOnPrimaryContainer"] },
  { name: "fabSize", type: "枚举", desc: "尺寸：normal 56dp / mini 40dp", values: ["normal", "mini"] },
  { name: "app:layout_anchor", type: "引用", desc: "在 CoordinatorLayout 里锚定到某个控件", values: ["@id/xxx"] },
];

const APP_BAR_ATTRS: AttrDoc[] = [
  { name: "layout_scrollFlags", type: "枚举", desc: "随滚动行为：scroll 跟着滚 / enterAlways 下拉即现 / exitUntilCollapsed 折叠留一部分", values: ["scroll|enterAlways", "scroll|exitUntilCollapsed"] },
  { name: "liftOnScroll", type: "布尔", desc: "滚动时自动加阴影（Material 3 常用）", values: ["true"] },
];

const TOOLBAR_ATTRS: AttrDoc[] = [
  { name: "title", type: "文本", desc: "标题文字", values: ["@string/app_name", "订单详情"] },
  { name: "subtitle", type: "文本", desc: "副标题" },
  { name: "titleTextColor", type: "颜色", desc: "标题颜色" },
  { name: "navigationIcon", type: "drawable", desc: "左侧导航图标（通常是返回箭头或汉堡菜单）", values: ["@drawable/ic_menu"] },
  { name: "logo", type: "drawable", desc: "Logo 图标" },
  { name: "app:menu", type: "引用", desc: "菜单资源（右上角动作按钮）", values: ["@menu/main"] },
  { name: "app:titleCentered", type: "布尔", desc: "标题是否居中（MaterialToolbar 专有）" },
];

const COLLAPSING_ATTRS: AttrDoc[] = [
  { name: "layout_collapseMode", type: "枚举", desc: "子控件的折叠方式：pin 固定在顶上 / parallax 视差滚动", values: ["pin", "parallax"] },
  { name: "layout_collapseParallaxMultiplier", type: "数值", desc: "视差系数 0~1", values: ["0.5"] },
  { name: "contentScrim", type: "颜色", desc: "完全折叠后盖上的颜色", values: ["?attr/colorPrimary"] },
  { name: "expandedTitleTextAppearance", type: "引用", desc: "展开时大标题样式" },
  { name: "collapsedTitleTextAppearance", type: "引用", desc: "折叠后小标题样式" },
];

const BOTTOM_NAV_ATTRS: AttrDoc[] = [
  { name: "app:menu", type: "引用", desc: "底部菜单资源（每项一个图标 + 文字）", values: ["@menu/bottom_nav"] },
  { name: "app:itemIconTint", type: "颜色", desc: "图标颜色（常配合 selector）" },
  { name: "app:itemTextColor", type: "颜色", desc: "文字颜色（常配合 selector）" },
  { name: "app:itemActiveIndicatorStyle", type: "引用", desc: "选中项的胶囊底色样式（Material 3）" },
  { name: "app:labelVisibilityMode", type: "枚举", desc: "文字显示策略：labeled 总显示 / unlabeled 只显示选中 / auto 自动", values: ["labeled", "auto"] },
];

const NAV_VIEW_ATTRS: AttrDoc[] = [
  { name: "app:menu", type: "引用", desc: "侧边抽屉菜单资源", values: ["@menu/drawer"] },
  { name: "app:headerLayout", type: "引用", desc: "菜单顶部的头部布局", values: ["@layout/nav_header"] },
  { name: "app:itemIconTint", type: "颜色", desc: "菜单项图标颜色" },
  { name: "app:itemBackground", type: "drawable", desc: "菜单项背景" },
];

const TAB_ATTRS: AttrDoc[] = [
  { name: "app:tabMode", type: "枚举", desc: "标签模式：fixed 平分宽度 / scrollable 可滚动", values: ["fixed", "scrollable"] },
  { name: "app:tabGravity", type: "枚举", desc: "标签对齐：fill 撑满 / center 居中", values: ["fill", "center"] },
  { name: "app:tabIndicatorColor", type: "颜色", desc: "底部指示条颜色" },
  { name: "app:tabTextColor", type: "颜色", desc: "标签文字颜色" },
  { name: "app:tabSelectedTextColor", type: "颜色", desc: "选中标签的文字颜色" },
  { name: "app:tabIndicatorFullWidth", type: "布尔", desc: "指示条是否撑满整个标签宽度" },
];

const CHIP_ATTRS: AttrDoc[] = [
  { name: "text", type: "文本", desc: "芯片文字", values: ["已发货"] },
  { name: "chipIcon", type: "drawable", desc: "左侧图标" },
  { name: "app:checkedIcon", type: "drawable", desc: "选中态图标（可勾选的 chip）" },
  { name: "app:chipBackgroundColor", type: "颜色", desc: "芯片底色", values: ["#FF0000"] },
  { name: "app:chipStrokeWidth", type: "尺寸", desc: "描边宽度", values: ["1dp"] },
  { name: "app:chipStrokeColor", type: "颜色", desc: "描边颜色" },
  { name: "app:checkable", type: "布尔", desc: "是否可勾选（筛选场景常用）" },
  { name: "app:closeIcon", type: "drawable", desc: "右侧删除图标（可删除的标签）" },
  { name: "app:chipSpacingHorizontal", type: "尺寸", desc: "ChipGroup 里芯片横向间距", values: ["8dp"] },
];

const SWIPE_REFRESH_ATTRS: AttrDoc[] = [
  { name: "app:refreshing", type: "布尔", desc: "是否正在刷新（预览里显示转圈）" },
  { name: "app:progressBackgroundColor", type: "颜色", desc: "转圈底色" },
  { name: "app:progressViewStartOffset", type: "尺寸", desc: "转圈起始位置偏移" },
];

const VIEWPAGER_ATTRS: AttrDoc[] = [
  { name: "app:orientation", type: "枚举", desc: "滑动方向：horizontal 横滑 / vertical 竖滑", values: ["horizontal", "vertical"] },
  { name: "app:offscreenPageLimit", type: "数值", desc: "左右各预加载几页", values: ["1", "2"] },
  { name: "app:userInputEnabled", type: "布尔", desc: "是否允许手指滑动翻页" },
];

const AUTOCOMPLETE_ATTRS: AttrDoc[] = [
  { name: "app:simpleItems", type: "文本", desc: "简单下拉候选列表（字符串数组资源）", values: ["@array/cities"] },
  { name: "completionThreshold", type: "数值", desc: "输几个字符开始提示", values: ["1", "2"] },
  { name: "dropDownWidth", type: "尺寸", desc: "下拉框宽度" },
  { name: "dropDownHeight", type: "尺寸", desc: "下拉框高度" },
];

const RATING_ATTRS: AttrDoc[] = [
  { name: "numStars", type: "数值", desc: "总共几颗星（默认 5）", values: ["5"] },
  { name: "rating", type: "数值", desc: "当前评分（可为小数）", values: ["3.5"] },
  { name: "stepSize", type: "数值", desc: "每次调整的步长", values: ["0.5", "1"] },
  { name: "isIndicator", type: "布尔", desc: "只展示不可点（评分展示场景）" },
];

const PICKER_ATTRS: AttrDoc[] = [
  { name: "android:datePickerMode", type: "枚举", desc: "日历还是滚轮：calendar / spinner", values: ["calendar"] },
  { name: "android:firstDayOfWeek", type: "数值", desc: "一周从周几开始（1=周日）" },
  { name: "android:timePickerMode", type: "枚举", desc: "时钟样式：clock 表盘 / spinner 滚轮", values: ["clock", "spinner"] },
  { name: "android:is24HourView", type: "布尔", desc: "是否 24 小时制" },
  { name: "android:calendarViewShown", type: "布尔", desc: "是否显示日历视图" },
  { name: "android:showWeekNumber", type: "布尔", desc: "是否显示周数" },
];

const TOGGLE_ATTRS: AttrDoc[] = [
  { name: "textOn", type: "文本", desc: "打开时显示的文字", values: ["开"] },
  { name: "textOff", type: "文本", desc: "关闭时显示的文字", values: ["关"] },
  { name: "disabledAlpha", type: "数值", desc: "禁用状态下的透明度" },
];

const WEB_ATTRS: AttrDoc[] = [
  { name: "android:initialUrl", type: "文本", desc: "初始网址（实际项目里多在代码里 loadUrl）" },
  { name: "android:javascriptEnabled", type: "布尔", desc: "是否开启 JS（需代码 WebSettings 设置）" },
  { name: "android:allowFileAccess", type: "布尔", desc: "是否允许访问本地文件" },
];

const VIDEO_ATTRS: AttrDoc[] = [
  { name: "android:src", type: "drawable", desc: "视频资源（raw 或 uri），实际多在代码里 setVideoPath" },
  { name: "android:keepScreenOn", type: "布尔", desc: "播放时保持屏幕常亮" },
];

const FLIPPER_ATTRS: AttrDoc[] = [
  { name: "android:inAnimation", type: "引用", desc: "切入动画", values: ["@android:anim/fade_in"] },
  { name: "android:outAnimation", type: "引用", desc: "切出动画" },
  { name: "android:autoStart", type: "布尔", desc: "是否自动开始切换" },
  { name: "android:flipInterval", type: "数值", desc: "自动切换间隔（毫秒）", values: ["3000"] },
];

const MOTION_ATTRS: AttrDoc[] = [
  { name: "app:layoutDescription", type: "引用", desc: "场景文件（描述动画怎么走的 XML）", values: ["@xml/scene"] },
  { name: "app:motionProgress", type: "数值", desc: "动画进度 0~1（预览停在某帧很有用）", values: ["0", "0.5", "1"] },
  { name: "app:layout_constraintTop_toTopOf", type: "引用", desc: "MotionLayout 继承 ConstraintLayout，约束属性全都可用" },
];

const FLOW_ATTRS: AttrDoc[] = [
  { name: "app:constraint_referenced_ids", type: "文本", desc: "参与流式排布的控件 id（逗号分隔）", values: ["tv1,tv2,tv3"] },
  { name: "app:flow_wrapMode", type: "枚举", desc: "换行模式：none / chain / align", values: ["chain", "align"] },
  { name: "app:flow_horizontalGap", type: "尺寸", desc: "水平间距", values: ["8dp"] },
  { name: "app:flow_verticalGap", type: "尺寸", desc: "垂直间距", values: ["8dp"] },
  { name: "app:flow_maxElementsWrap", type: "数值", desc: "每行最多几个", values: ["3"] },
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
  AbsoluteLayout: {
    title: "绝对布局",
    summary:
      "子控件按 layout_x / layout_y 的绝对坐标摆放（单位 dp）。已废弃，官方不推荐，但老工程里常见；屏幕尺寸一变位置就错。",
    category: "布局",
    attrs: [
      { name: "layout_x", type: "尺寸", desc: "左上角距容器左边（dp）", values: ["0dp", "16dp"] },
      { name: "layout_y", type: "尺寸", desc: "左上角距容器上边（dp）", values: ["0dp", "16dp"] },
      { name: "—", type: "—", desc: "子控件仍可写 layout_width/height，但位置完全由 x/y 决定，与兄弟控件无关" },
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
    category: "Material",
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
    category: "Material",
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
    category: "Material",
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
    category: "Material",
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

  /* ===== Material Components（M3f 补全） ===== */
  Slider: {
    title: "滑块",
    summary: "Material 3 的滑动选值控件（取代 SeekBar），常用于音量、价格区间。",
    category: "Material",
    attrs: [
      { name: "android:value", type: "数值", desc: "当前值", values: ["50"] },
      { name: "android:valueFrom", type: "数值", desc: "最小值", values: ["0"] },
      { name: "android:valueTo", type: "数值", desc: "最大值", values: ["100"] },
      { name: "android:stepSize", type: "数值", desc: "每次调整的步长", values: ["1", "5"] },
      { name: "app:labelBehavior", type: "枚举", desc: "拖动时数值气泡：floating 悬浮 / gone 不显示 / withinBounds 限制在轨道内", values: ["floating", "gone"] },
      { name: "app:thumbColor", type: "颜色", desc: "滑块颜色" },
      { name: "app:trackColorActive", type: "颜色", desc: "已选轨道颜色" },
      { name: "app:trackColorInactive", type: "颜色", desc: "未选轨道颜色" },
    ],
    notes: ["Material 3 项目用 Slider，不要再新写 SeekBar"],
  },
  FloatingActionButton: {
    title: "浮动按钮",
    summary: "屏幕右下角的圆形主操作按钮（新建/添加），一个界面最多一个。",
    category: "Material",
    attrs: MATERIAL_FAB_ATTRS,
    notes: [
      "默认尺寸 56dp，图标 24dp；用 FrameLayout/CoordinatorLayout 包起来并加 layout_gravity=\"bottom|end\"",
      "周围留 16dp 外边距才不贴边",
    ],
  },
  ExtendedFloatingActionButton: {
    title: "带文字的浮动按钮",
    summary: "胶囊形浮动按钮，图标 + 文字，适合文字较长的主操作。",
    category: "Material",
    attrs: [
      ...MATERIAL_FAB_ATTRS,
      { name: "android:text", type: "文本", desc: "按钮文字", values: ["新建订单"] },
      { name: "app:icon", type: "drawable", desc: "左侧图标", values: ["@drawable/ic_add"] },
      { name: "app:iconPadding", type: "尺寸", desc: "图标与文字间距" },
    ],
  },
  MaterialButtonToggleGroup: {
    title: "按钮切换组",
    summary: "多个 MaterialButton 互斥或可多选的分段控件（相当于一组 RadioButton）。",
    category: "Material",
    attrs: [
      { name: "app:singleSelection", type: "布尔", desc: "是否只能选一个", values: ["true"] },
      { name: "app:selectionRequired", type: "布尔", desc: "是否必须保留一个选中" },
      { name: "app:checkedButton", type: "引用", desc: "默认选中的按钮 id", values: ["@id/btn1"] },
    ],
    notes: ["子项必须是 MaterialButton，普通 Button 无效"],
  },
  Toolbar: {
    title: "工具栏",
    summary:
      "应用顶部的标题栏（android.widget.Toolbar，API 21+，替代旧 ActionBar），可放返回、标题、菜单。不需要任何库依赖。",
    category: "布局",
    attrs: TOOLBAR_ATTRS,
    notes: [
      "高度一般用 ?android:attr/actionBarSize（56dp）；放在 AppBarLayout（Material）里才能随滚动收起",
      "android:title / android:subtitle / android:navigationIcon 都是平台属性",
    ],
  },
  MaterialToolbar: {
    title: "Material 工具栏",
    summary: "Material 风格的 Toolbar，额外支持标题居中、副标题样式。",
    category: "Material",
    attrs: TOOLBAR_ATTRS,
  },
  AppBarLayout: {
    title: "应用栏容器",
    summary: "装 Toolbar / TabLayout 的竖向容器，负责随列表滚动收起展开。",
    category: "Material",
    attrs: APP_BAR_ATTRS,
    notes: ["子控件要写 app:layout_scrollFlags 才会跟着滚动；父级必须是 CoordinatorLayout 才生效"],
  },
  CollapsingToolbarLayout: {
    title: "可折叠标题栏",
    summary: "顶部大图随滚动收成小标题栏（详情页经典效果）。",
    category: "Material",
    attrs: COLLAPSING_ATTRS,
    notes: [
      "外层必须是 AppBarLayout，且自己是 AppBarLayout 的子项",
      "里面放 ImageView 用 layout_collapseMode=\"parallax\"，Toolbar 用 \"pin\"",
    ],
  },
  BottomNavigationView: {
    title: "底部导航",
    summary: "底部 3~5 个页签的主导航（首页/订单/我的）。",
    category: "Material",
    attrs: BOTTOM_NAV_ATTRS,
    notes: ["菜单项上限 5 个，超过会挤压变形；高度固定 80dp"],
  },
  NavigationView: {
    title: "侧边抽屉菜单",
    summary: "左侧滑出的菜单（配合 DrawerLayout 用）。",
    category: "Material",
    attrs: NAV_VIEW_ATTRS,
    notes: ["必须放在 DrawerLayout 里并写 layout_gravity=\"start\"，否则会铺满整屏"],
  },
  TabLayout: {
    title: "标签页",
    summary: "顶部横排标签（页签切换），常配合 ViewPager2 左右滑动。",
    category: "Material",
    attrs: TAB_ATTRS,
  },
  TabItem: {
    title: "标签项",
    summary: "TabLayout 里的单个标签（也可以用代码添加）。",
    category: "其他",
    attrs: [
      { name: "android:text", type: "文本", desc: "标签文字", values: ["待处理"] },
      { name: "android:icon", type: "drawable", desc: "标签图标" },
    ],
  },
  Chip: {
    title: "芯片",
    summary: "圆角小标签，用于状态标识、筛选条件、多选标签。",
    category: "Material",
    attrs: CHIP_ATTRS,
    notes: ["多个 Chip 要放 ChipGroup 里才会自动换行排列"],
  },
  ChipGroup: {
    title: "芯片组",
    summary: "多个 Chip 的容器，自动换行/横排排列。",
    category: "Material",
    attrs: [
      { name: "app:singleSelection", type: "布尔", desc: "是否只能选一个（筛选场景常用）", values: ["true"] },
      { name: "app:chipSpacingHorizontal", type: "尺寸", desc: "横向间距", values: ["8dp"] },
      { name: "app:chipSpacingVertical", type: "尺寸", desc: "纵向间距", values: ["8dp"] },
      { name: "app:selectionRequired", type: "布尔", desc: "是否必须保留一个选中" },
    ],
  },
  SwipeRefreshLayout: {
    title: "下拉刷新",
    summary: "包住列表，下拉时出现转圈刷新（只允许一个直接子控件）。",
    category: "Material",
    attrs: SWIPE_REFRESH_ATTRS,
    notes: ["只能包一个子控件（通常是 RecyclerView/ScrollView）"],
  },
  ViewPager2: {
    title: "滑动翻页容器",
    summary: "左右滑动的页面容器（引导页、轮播图、配合 TabLayout）。",
    category: "Material",
    attrs: VIEWPAGER_ATTRS,
    notes: ["每个子项通常用 FragmentContainerView，适配器用 FragmentStateAdapter"],
  },

  /* ===== 平台常用控件（M3f 补全） ===== */
  AutoCompleteTextView: {
    title: "自动补全输入框",
    summary: "输入时弹出候选列表的输入框（选城市、选商品）。",
    category: "输入",
    attrs: [...INPUT_ATTRS, ...AUTOCOMPLETE_ATTRS],
  },
  CheckedTextView: {
    title: "带勾选的文本",
    summary: "一行文字 + 右侧勾选框，常用于列表多选（配合 ListView 的 choiceMode）。",
    category: "选择",
    attrs: [
      { name: "android:text", type: "文本", desc: "文字内容" },
      { name: "android:checkMark", type: "drawable", desc: "勾选标记图标", values: ["?android:attr/listChoiceIndicatorMultiple"] },
      { name: "android:checked", type: "布尔", desc: "是否勾选" },
    ],
  },
  ToggleButton: {
    title: "开关按钮",
    summary: "带开启/关闭两种文字的开关（现在多用 Switch 代替）。",
    category: "选择",
    attrs: TOGGLE_ATTRS,
  },
  RatingBar: {
    title: "星级评分",
    summary: "五星评分控件，可只展示也可让用户点选。",
    category: "选择",
    attrs: RATING_ATTRS,
  },
  NumberPicker: {
    title: "数字滚轮",
    summary: "上下滚动的数字选择器（数量、年龄）。",
    category: "选择",
    attrs: [
      { name: "android:minValue", type: "数值", desc: "最小值", values: ["1"] },
      { name: "android:maxValue", type: "数值", desc: "最大值", values: ["99"] },
      { name: "android:value", type: "数值", desc: "当前值" },
      { name: "android:wrapSelectorWheel", type: "布尔", desc: "到头后是否循环" },
    ],
  },
  SearchView: {
    title: "搜索框",
    summary: "带放大镜图标的搜索输入框，可配搜索建议。",
    category: "输入",
    attrs: [
      { name: "android:queryHint", type: "文本", desc: "搜索提示文字", values: ["搜索订单号"] },
      { name: "android:iconifiedByDefault", type: "布尔", desc: "默认是否收成图标", values: ["false"] },
      { name: "android:submitButtonEnabled", type: "布尔", desc: "是否显示搜索按钮" },
    ],
  },
  WebView: {
    title: "网页视图",
    summary: "内嵌浏览器，用于展示 HTML 页面（协议、帮助文档）。",
    category: "其他",
    attrs: WEB_ATTRS,
    notes: ["预览里只能画占位框，真实网页需在代码里 loadUrl"],
  },
  VideoView: {
    title: "视频播放器",
    summary: "播放本地/网络视频的简单控件（无自定义控制条）。",
    category: "其他",
    attrs: VIDEO_ATTRS,
  },
  SurfaceView: {
    title: "绘图表面",
    summary: "独立绘图层，用于相机预览、游戏、视频（异线程绘制）。",
    category: "其他",
    attrs: [
      { name: "android:type", type: "枚举", desc: "表面类型：surface / texture" },
      { name: "android:zOrderOnTop", type: "布尔", desc: "是否画在窗口最上层" },
    ],
  },
  ViewFlipper: {
    title: "轮播容器",
    summary: "多个子控件轮番显示（公告轮播、广告位），可自动定时切换。",
    category: "容器",
    attrs: FLIPPER_ATTRS,
    notes: ["每个子控件占满一屏，靠 showNext() 或 flipInterval 自动切换"],
  },
  MotionLayout: {
    title: "动效布局",
    summary: "ConstraintLayout 的动画版，一个场景文件描述控件从状态 A 走到状态 B。",
    category: "布局",
    attrs: MOTION_ATTRS,
    notes: ["本质就是 ConstraintLayout，约束属性全都可用；复杂动效才需要它"],
  },
  Flow: {
    title: "流式布局助手",
    summary: "ConstraintLayout 的虚拟布局，把一堆控件自动按行排（类似 Flexbox 换行）。",
    category: "布局",
    attrs: FLOW_ATTRS,
    notes: ["自己不画东西，靠 constraint_referenced_ids 收集别的控件来排"],
  },
  FragmentContainerView: {
    title: "Fragment 容器",
    summary: "专门装 Fragment 的容器（比 FrameLayout 更安全，官方推荐）。",
    category: "容器",
    attrs: [
      { name: "android:name", type: "文本", desc: "要加载的 Fragment 全限定类名", values: ["com.xxx.HomeFragment"] },
      { name: "android:tag", type: "文本", desc: "Fragment 标识" },
    ],
  },
  DatePicker: {
    title: "日期选择",
    summary: "日历或滚轮式日期选择器。",
    category: "选择",
    attrs: PICKER_ATTRS,
    notes: ["实际项目里常用 DatePickerDialog 弹窗而不是直接摆控件"],
  },
  TimePicker: {
    title: "时间选择",
    summary: "表盘或滚轮式时间选择器。",
    category: "选择",
    attrs: PICKER_ATTRS,
  },
  CalendarView: {
    title: "日历",
    summary: "可滚动翻月的日历，用于选日期或展示有数据的日期。",
    category: "选择",
    attrs: PICKER_ATTRS,
  },
  ExpandableListView: {
    title: "可展开列表",
    summary: "分组可折叠的列表（旧控件，新项目多用 RecyclerView 多类型实现）。",
    category: "列表",
    attrs: [
      { name: "android:groupIndicator", type: "drawable", desc: "分组展开/折叠图标" },
      { name: "android:childDivider", type: "drawable", desc: "子项分隔线" },
      { name: "android:indicatorStart", type: "尺寸", desc: "展开图标距起始边距离" },
    ],
  },
  CircularProgressIndicator: {
    title: "圆形进度（Material 3）",
    summary: "Material 3 的转圈进度，可确定百分比也可不确定。",
    category: "Material",
    attrs: [
      { name: "android:indeterminate", type: "布尔", desc: "是否无限转圈" },
      { name: "app:indicatorSize", type: "尺寸", desc: "圆环直径", values: ["48dp"] },
      { name: "app:trackThickness", type: "尺寸", desc: "圆环粗细", values: ["4dp"] },
      { name: "app:indicatorColor", type: "颜色", desc: "进度颜色" },
    ],
  },
  LinearProgressIndicator: {
    title: "条形进度（Material 3）",
    summary: "Material 3 的水平进度条。",
    category: "Material",
    attrs: [
      { name: "android:progress", type: "数值", desc: "当前进度 0~100", values: ["60"] },
      { name: "android:indeterminate", type: "布尔", desc: "是否不确定进度" },
      { name: "app:trackThickness", type: "尺寸", desc: "条的高度", values: ["4dp"] },
      { name: "app:trackCornerRadius", type: "尺寸", desc: "条的圆角" },
    ],
  },

  /* ===== 平台常用控件补全（M3f2） ===== */
  Chronometer: {
    title: "计时器",
    summary: "实时走时的文本（倒计时、运动计时），可设为从过去某时刻开始累计。",
    category: "其他",
    attrs: [
      { name: "android:countDown", type: "布尔", desc: "是否倒着走", values: ["true"] },
      { name: "android:format", type: "文本", desc: "时间格式（如 %s 占位）", values: ["已用 %s"] },
      { name: "android:minWidth", type: "尺寸", desc: "最小宽度（防止时间变化时抖动）" },
      { name: "android:tag", type: "文本", desc: "业务标识（代码里找哪个计时器）" },
    ],
    notes: ["预览里画成静态文本，实际走时要代码调用 setBase()"],
  },
  TextClock: {
    title: "数字时钟",
    summary: "自动显示当前时间（无需代码），可配 12h/24h、时区。",
    category: "其他",
    attrs: [
      { name: "android:format12Hour", type: "文本", desc: "12 小时制格式", values: ["HH:mm:ss a"] },
      { name: "android:format24Hour", type: "文本", desc: "24 小时制格式", values: ["HH:mm:ss"] },
      { name: "android:timeZone", type: "文本", desc: "时区", values: ["Asia/Shanghai", "UTC"] },
      { name: "android:showSoftKeyboardOnFocus", type: "布尔", desc: "是否可点击编辑" },
    ],
  },
  AnalogClock: {
    title: "模拟时钟",
    summary: "表盘式时钟（已不推荐，新场景用 Material 时钟或 Chronometer）。",
    category: "其他",
    attrs: [
      { name: "android:dial", type: "drawable", desc: "表盘背景" },
      { name: "android:hourHandColor", type: "颜色", desc: "时针颜色" },
      { name: "android:minuteHandColor", type: "颜色", desc: "分针颜色" },
      { name: "android:seconds", type: "数值", desc: "初始秒数" },
    ],
  },
  DigitalClock: {
    title: "数字时钟（旧）",
    summary: "纯文本时钟（已不推荐，新场景用 Chronometer/TextClock）。",
    category: "其他",
    attrs: [
      { name: "android:startOnBoot", type: "布尔", desc: "开机后是否立即启动" },
    ],
  },
  MultiAutoCompleteTextView: {
    title: "多行自动补全",
    summary: "支持多候选并存的自动补全输入框（搜索历史、多人选择）。",
    category: "输入",
    attrs: [
      { name: "android:completionThreshold", type: "数值", desc: "输几个字符开始提示", values: ["1"] },
      { name: "android:dropDownHorizontalOffset", type: "尺寸", desc: "下拉框水平偏移" },
      { name: "android:dropDownVerticalOffset", type: "尺寸", desc: "下拉框垂直偏移" },
      { name: "android:dropDownWidth", type: "尺寸", desc: "下拉框宽度" },
    ],
  },
  TextureView: {
    title: "纹理视图",
    summary: "可缩放/旋转的独立绘制层（相机预览、视频，比 SurfaceView 更灵活）。",
    category: "其他",
    attrs: [
      { name: "android:zOrderMediaOverlay", type: "布尔", desc: "是否画在普通 UI 之上" },
      { name: "android:zOrderOnTop", type: "布尔", desc: "是否画在最上层" },
    ],
  },
  GridView: {
    title: "网格列表",
    summary: "网格布局的列表（老控件，新项目建议用 RecyclerView + 网格 LayoutManager）。",
    category: "列表",
    attrs: [
      { name: "android:numColumns", type: "枚举", desc: "列数：具体数字 或 auto_fit / auto_size", values: ["2", "auto_fit"] },
      { name: "android:stretchMode", type: "枚举", desc: "列的拉伸方式：columnWidth 按列宽 / spacingWidth 按间距", values: ["columnWidth"] },
      { name: "android:columnWidth", type: "尺寸", desc: "列宽", values: ["100dp"] },
      { name: "android:horizontalSpacing", type: "尺寸", desc: "横向间距", values: ["8dp"] },
      { name: "android:verticalSpacing", type: "尺寸", desc: "纵向间距", values: ["8dp"] },
      { name: "android:gravity", type: "枚举", desc: "整列的对齐", values: ["center"] },
    ],
  },
  ViewPager: {
    title: "滑动翻页容器（v1）",
    summary: "左右滑动的页面容器（老版，新项目用 ViewPager2）。",
    category: "容器",
    attrs: [
      { name: "android:offscreenPageLimit", type: "数值", desc: "左右各保留几页", values: ["1"] },
      { name: "android:scrollFormat", type: "文本", desc: "页码显示格式" },
      { name: "android:scrollGranularity", type: "尺寸", desc: "每次滚动的距离", values: ["?attr/scrollMinVelocity"] },
    ],
    notes: ["新项目用 ViewPager2，v1 只为了兼容老代码"],
  },
  PagerTabStrip: {
    title: "页签条（v1）",
    summary: "ViewPager 顶部的页签指示（老版，可点击跳页）。",
    category: "其他",
    attrs: [
      { name: "android:layout_gravity", type: "枚举", desc: "对齐位置", values: ["top", "bottom"] },
      { name: "android:textColor", type: "颜色", desc: "页签文字颜色" },
      { name: "android:tabStripLocation", type: "枚举", desc: "显示在顶还是底", values: ["top", "bottom"] },
    ],
  },
  PagerTitleStrip: {
    title: "页标题条（v1）",
    summary: "ViewPager 顶部只显示当前/相邻页标题（老版，不可点）。",
    category: "其他",
    attrs: [
      { name: "android:layout_gravity", type: "枚举", desc: "对齐位置", values: ["top", "bottom"] },
      { name: "android:textColor", type: "颜色", desc: "标题文字颜色" },
    ],
  },
  Group: {
    title: "约束组（ConstraintLayout）",
    summary: "把多个 ConstraintLayout 子控件绑成一个组，批量启用/停用它们的可见性。",
    category: "其他",
    attrs: [
      { name: "android:constraint_referenced_ids", type: "文本", desc: "组里包含的控件 id（逗号分隔）", values: ["btn1,btn2,btn3"] },
      { name: "android:visibility", type: "枚举", desc: "控制整组显隐", values: ["visible", "invisible", "gone"] },
    ],
    notes: ["本身不画东西，靠 referenced_ids 控制子控件；父级必须是 ConstraintLayout"],
  },
  ViewAnimator: {
    title: "视图动画器",
    summary: "同一位置多个子控件轮番显示（ViewFlipper 的扩展，支持动画监听）。",
    category: "容器",
    attrs: FLIPPER_ATTRS,
    notes: ["每个子控件占满整屏，代码里 showNext() 切换"],
  },
  TabHost: {
    title: "旧版页签宿主",
    summary: "老版 Tab 页签容器（新项目用 TabLayout + ViewPager2）。",
    category: "容器",
    attrs: [
      { name: "android:foreground", type: "drawable", desc: "页签上层的遮罩" },
      { name: "android:measureWithLargestChild", type: "布尔", desc: "是否按最大子项测量" },
    ],
  },
  TabWidget: {
    title: "旧版页签条",
    summary: "TabHost 里的标签条（新项目用 TabLayout）。",
    category: "选择",
    attrs: [
      { name: "android:tabStripLeft", type: "尺寸", desc: "标签条左侧间距" },
      { name: "android:tabStripRight", type: "尺寸", desc: "标签条右侧间距" },
    ],
  },
};

/**
 * M11v：补充属性表。
 * 单独放一张表、查询时合并（按属性名去重），这样既不动 88 个控件已有的条目，
 * 又能把「常用但文档没写 / 预览已经开始渲染」的属性补齐。
 */
const EXTRA_ATTRS: Record<string, AttrDoc[]> = {
  LinearLayout: [
    { name: "divider", type: "drawable", desc: "子项之间的分割线（颜色或 @drawable/xxx）", values: ["#E0E0E0", "@drawable/divider"] },
    { name: "dividerHeight", type: "尺寸", desc: "分割线粗细", values: ["1dp"] },
    { name: "showDividers", type: "枚举", desc: "在哪里画分割线", values: ["none", "beginning", "middle", "end"] },
    { name: "baselineAligned", type: "布尔", desc: "横排时是否按文字基线对齐（false 更好控高度）" },
    { name: "measureWithLargestChild", type: "布尔", desc: "按最大子项测量宽度" },
  ],
  FrameLayout: [
    { name: "foregroundGravity", type: "枚举", desc: "前景遮罩的对齐方式", values: ["fill", "center", "bottom"] },
    { name: "clipChildren", type: "布尔", desc: "是否裁掉超出边界的子控件" },
    { name: "clipToPadding", type: "布尔", desc: "子控件是否被 padding 区域裁切" },
  ],
  ConstraintLayout: [
    { name: "layout_constraintWidth_percent", type: "数值", desc: "宽度占父级百分比（需配合 layout_width=0dp）", values: ["0.5"] },
    { name: "layout_constraintHeight_percent", type: "数值", desc: "高度占父级百分比（需配合 layout_height=0dp）", values: ["0.3"] },
    { name: "layout_constraintHorizontal_bias", type: "数值", desc: "左右约束之间的偏移比例 0~1（0.5 居中）", values: ["0", "0.5", "1"] },
    { name: "layout_constraintVertical_bias", type: "数值", desc: "上下约束之间的偏移比例 0~1" },
    { name: "layout_constraintDimensionRatio", type: "文本", desc: "宽高比，如 16:9 或 W,16:9", values: ["16:9", "1:1"] },
    { name: "layout_constraintHorizontal_chainStyle", type: "枚举", desc: "链式排列样式", values: ["spread", "spread_inside", "packed"] },
    { name: "layout_optimizationLevel", type: "枚举", desc: "编译期优化级别", values: ["none", "standard", "all"] },
  ],
  GridLayout: [
    { name: "columnCount", type: "数值", desc: "列数（预览用它均分宽度）", values: ["2", "3"] },
    { name: "rowCount", type: "数值", desc: "行数" },
    { name: "orientation", type: "枚举", desc: "排布方向（影响先填行还是先填列）", values: ["horizontal", "vertical"] },
    { name: "useDefaultMargins", type: "布尔", desc: "自动加默认间距" },
    { name: "layout_column", type: "数值", desc: "放在第几列（从 0 开始）" },
    { name: "layout_row", type: "数值", desc: "放在第几行（从 0 开始）" },
    { name: "layout_columnSpan", type: "数值", desc: "横跨几列" },
    { name: "layout_rowSpan", type: "数值", desc: "纵跨几行" },
    { name: "layout_columnWeight", type: "数值", desc: "列宽权重（等分卡片常用）", values: ["1"] },
    { name: "layout_rowWeight", type: "数值", desc: "行高权重" },
  ],
  TableLayout: [
    { name: "stretchColumns", type: "文本", desc: "要拉伸填满的列（0 基，逗号分隔）", values: ["0", "0,1"] },
    { name: "shrinkColumns", type: "文本", desc: "内容超宽时压缩的列" },
    { name: "collapseColumns", type: "文本", desc: "要隐藏的列" },
  ],
  TableRow: [
    { name: "layout_column", type: "数值", desc: "强制放到第几列（默认按顺序）" },
    { name: "layout_span", type: "数值", desc: "横跨几列" },
    { name: "gravity", type: "枚举", desc: "单元格内容的对齐方式", values: ["center_vertical", "center"] },
  ],
  ScrollView: [
    { name: "fillViewport", type: "布尔", desc: "内容不足一屏时也撑满（配合 weight 用）" },
    { name: "scrollbars", type: "枚举", desc: "滚动条方向（预览不显示滚动条）", values: ["vertical", "none"] },
    { name: "fadeScrollbars", type: "布尔", desc: "滚动条自动淡出" },
  ],
  TextView: [
    { name: "maxLines", type: "数值", desc: "最多显示几行（超出按 ellipsize 处理）" },
    { name: "minLines", type: "数值", desc: "最少占几行高度" },
    { name: "ellipsize", type: "枚举", desc: "超长文本的省略方式", values: ["end", "middle", "marquee"] },
    { name: "lineSpacingExtra", type: "尺寸", desc: "行间距（额外增加值）", values: ["4dp"] },
    { name: "lineSpacingMultiplier", type: "数值", desc: "行间距倍数", values: ["1.2"] },
    { name: "letterSpacing", type: "数值", desc: "字间距（em 为单位）", values: ["0.02"] },
    { name: "textStyle", type: "枚举", desc: "字体样式", values: ["normal", "bold", "italic", "bold|italic"] },
    { name: "textAllCaps", type: "布尔", desc: "全部显示为大写" },
    { name: "shadowColor", type: "颜色", desc: "文字阴影颜色", values: ["#40000000"] },
    { name: "shadowDx", type: "尺寸", desc: "文字阴影横向偏移" },
    { name: "shadowDy", type: "尺寸", desc: "文字阴影纵向偏移" },
    { name: "shadowRadius", type: "尺寸", desc: "文字阴影模糊半径" },
    { name: "textAlignment", type: "枚举", desc: "文本对齐（view 级，跟 gravity 类似但只管文字）", values: ["viewStart", "center", "viewEnd"] },
    { name: "autoSizeTextType", type: "枚举", desc: "自动缩放字号", values: ["none", "uniform"] },
  ],
  Button: [
    { name: "textAllCaps", type: "布尔", desc: "文字全大写（Material 主题默认 true）" },
    { name: "gravity", type: "枚举", desc: "文字在按钮内的对齐", values: ["center", "start|center_vertical"] },
  ],
  MaterialButton: [
    { name: "app:cornerRadius", type: "尺寸", desc: "按钮圆角", values: ["8dp"] },
    { name: "app:strokeColor", type: "颜色", desc: "描边颜色（无填充按钮用）" },
    { name: "app:strokeWidth", type: "尺寸", desc: "描边宽度", values: ["1dp"] },
    { name: "app:icon", type: "drawable", desc: "按钮左侧图标" },
    { name: "app:iconGravity", type: "枚举", desc: "图标位置", values: ["textStart", "textEnd", "start"] },
    { name: "app:iconPadding", type: "尺寸", desc: "图标与文字间距", values: ["8dp"] },
  ],
  EditText: [
    { name: "inputType", type: "枚举", desc: "键盘类型 / 内容类型", values: ["text", "number", "textPassword", "phone"] },
    { name: "singleLine", type: "布尔", desc: "单行显示（回车不换行）" },
    { name: "minLines", type: "数值", desc: "最少行数" },
    { name: "maxLines", type: "数值", desc: "最多行数（配合 inputType=textMultiLine）" },
    { name: "textColorHint", type: "颜色", desc: "提示文字颜色" },
    { name: "imeOptions", type: "枚举", desc: "软键盘右下角按钮", values: ["actionSearch", "actionDone", "actionNext"] },
    { name: "hint", type: "文本", desc: "输入为空时的提示文字" },
  ],
  ImageView: [
    { name: "srcCompat", type: "drawable", desc: "图片资源（矢量图推荐用这个，兼容低版本）" },
    { name: "scaleType", type: "枚举", desc: "图片缩放方式", values: ["fitCenter", "centerCrop", "fitXY", "center"] },
    { name: "tint", type: "颜色", desc: "给图片着色（保留透明度）" },
    { name: "tintMode", type: "枚举", desc: "着色混色方式", values: ["src_in", "src_atop", "multiply", "screen", "add"] },
    { name: "adjustViewBounds", type: "布尔", desc: "按图片比例调整自身尺寸" },
  ],
  Switch: [
    { name: "checked", type: "布尔", desc: "初始是否打开" },
    { name: "thumbTint", type: "颜色", desc: "滑块颜色" },
    { name: "trackTint", type: "颜色", desc: "轨道颜色" },
    { name: "textOn", type: "文本", desc: "打开时的文字（Switch 一般不显示，用 text 更常见）" },
    { name: "textOff", type: "文本", desc: "关闭时的文字" },
    { name: "showText", type: "布尔", desc: "是否显示开/关文字" },
    { name: "switchMinWidth", type: "尺寸", desc: "轨道最小宽度" },
    { name: "splitTrack", type: "布尔", desc: "滑块下方是否留出轨道缝隙" },
  ],
  CheckBox: [
    { name: "checked", type: "布尔", desc: "初始是否勾选" },
    { name: "buttonTint", type: "颜色", desc: "勾选框颜色" },
  ],
  RadioButton: [
    { name: "checked", type: "布尔", desc: "初始是否选中（同一 RadioGroup 内互斥）" },
    { name: "buttonTint", type: "颜色", desc: "圆形选中色" },
  ],
  RadioGroup: [
    { name: "orientation", type: "枚举", desc: "排列方向", values: ["vertical", "horizontal"] },
    { name: "checkedButton", type: "引用", desc: "默认选中的那个 RadioButton 的 id" },
  ],
  SeekBar: [
    { name: "max", type: "数值", desc: "最大值（进度条范围）", values: ["100"] },
    { name: "progress", type: "数值", desc: "当前进度", values: ["30"] },
    { name: "thumbTint", type: "颜色", desc: "滑块颜色" },
    { name: "progressTint", type: "颜色", desc: "已走过部分的颜色" },
    { name: "splitTrack", type: "布尔", desc: "滑块下方留缝" },
  ],
  ProgressBar: [
    { name: "progress", type: "数值", desc: "当前进度（配合 max）", values: ["50"] },
    { name: "max", type: "数值", desc: "最大值", values: ["100"] },
    { name: "secondaryProgress", type: "数值", desc: "第二层进度（缓冲进度）" },
    { name: "indeterminate", type: "布尔", desc: "不确定进度（转圈/来回跑）" },
    { name: "progressTint", type: "颜色", desc: "进度颜色" },
    { name: "indeterminateTint", type: "颜色", desc: "不确定态颜色" },
  ],
  RatingBar: [
    { name: "numStars", type: "数值", desc: "星星数量", values: ["5"] },
    { name: "rating", type: "数值", desc: "当前评分", values: ["3.5"] },
    { name: "stepSize", type: "数值", desc: "每颗星的步进", values: ["0.5"] },
    { name: "isIndicator", type: "布尔", desc: "只显示不给点（true 常用于展示评分）" },
    { name: "buttonTint", type: "颜色", desc: "星星颜色" },
  ],
  CardView: [
    { name: "cardCornerRadius", type: "尺寸", desc: "卡片圆角", values: ["12dp"] },
    { name: "cardElevation", type: "尺寸", desc: "卡片阴影高度", values: ["2dp"] },
    { name: "cardBackgroundColor", type: "颜色", desc: "卡片底色（CardView 的底色写这里，不是 background）" },
    { name: "cardUseCompatPadding", type: "布尔", desc: "低版本也加阴影留白（各版本视觉一致）" },
    { name: "contentPadding", type: "尺寸", desc: "卡片内容内边距" },
  ],
  MaterialCardView: [
    { name: "app:cardCornerRadius", type: "尺寸", desc: "卡片圆角", values: ["12dp"] },
    { name: "app:strokeColor", type: "颜色", desc: "卡片描边颜色" },
    { name: "app:strokeWidth", type: "尺寸", desc: "卡片描边宽度" },
    { name: "app:cardElevation", type: "尺寸", desc: "卡片阴影" },
    { name: "app:checkable", type: "布尔", desc: "卡片是否可选中（带勾选态）" },
  ],
  TextInputLayout: [
    { name: "boxBackgroundMode", type: "枚举", desc: "输入框盒子样式", values: ["outline", "filled", "none"] },
    { name: "boxStrokeColor", type: "颜色", desc: "outline 模式的边框色（聚焦时用它）" },
    { name: "boxBackgroundColor", type: "颜色", desc: "filled 模式的底色" },
    { name: "hint", type: "文本", desc: "浮动标签文字" },
    { name: "counterEnabled", type: "布尔", desc: "显示字数计数" },
    { name: "errorEnabled", type: "布尔", desc: "显示错误提示位" },
    { name: "contentPadding", type: "尺寸", desc: "内容内边距" },
  ],
  Toolbar: [
    { name: "title", type: "文本", desc: "标题文字" },
    { name: "subtitle", type: "文本", desc: "副标题" },
    { name: "navigationIcon", type: "drawable", desc: "左侧导航图标（返回/菜单）" },
    { name: "logo", type: "drawable", desc: "左侧 logo" },
    { name: "titleTextColor", type: "颜色", desc: "标题颜色" },
    { name: "subtitleTextColor", type: "颜色", desc: "副标题颜色" },
  ],
  RecyclerView: [
    { name: "layoutManager", type: "文本", desc: "布局管理器类名（linear / grid）" },
    { name: "spanCount", type: "数值", desc: "网格列数（GridLayoutManager）" },
    { name: "itemAnimator", type: "文本", desc: "增删动画" },
  ],
  Spinner: [
    { name: "entries", type: "引用", desc: "下拉选项数组（@array/xxx）" },
    { name: "spinnerMode", type: "枚举", desc: "弹出方式", values: ["dropdown", "dialog"] },
    { name: "prompt", type: "文本", desc: "dialog 模式的标题" },
  ],
  View: [
    { name: "background", type: "颜色", desc: "分隔线/色块最常用：直接给颜色 + 1dp 高度" },
  ],
  Space: [
    { name: "layout_weight", type: "数值", desc: "当弹簧用：占满剩余空间", values: ["1"] },
  ],
  Chip: [
    { name: "app:chipIcon", type: "drawable", desc: "标签左侧图标" },
    { name: "app:closeIcon", type: "drawable", desc: "右侧关闭图标" },
    { name: "app:checkable", type: "布尔", desc: "是否可选（filter chip）" },
    { name: "app:chipBackgroundColor", type: "颜色", desc: "标签底色" },
  ],
  ToggleButton: [
    { name: "textOn", type: "文本", desc: "选中时显示的文字", values: ["开"] },
    { name: "textOff", type: "文本", desc: "未选中时显示的文字", values: ["关"] },
    { name: "disabledAlpha", type: "数值", desc: "禁用态透明度" },
  ],
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
  // M3f：Material / 平台变体归一
  MaterialTextView: "TextView",
  MaterialCheckBox: "CheckBox",
  MaterialRadioButton: "RadioButton",
  MaterialAutoCompleteTextView: "AutoCompleteTextView",
  LinearLayoutCompat: "LinearLayout",
};

/** 取控件文档；未知控件返回兜底（仅通用属性说明） */
export function getWidgetDoc(tag: string): WidgetDoc {
  const short = shortDocTag(tag);
  const key = ALIAS[short] ?? short;
  const found = PARSED[key];
  if (found) {
    // M11v：合并补充属性（按名字去重，已有的优先）
    const extra = EXTRA_ATTRS[key];
    if (!extra || extra.length === 0) return found;
    const seen = new Set(found.attrs.map((a) => a.name));
    return { ...found, attrs: [...found.attrs, ...extra.filter((a) => !seen.has(a.name))] };
  }
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

// 变体名共用同一份补充属性（ALIAS 归一后可能落到这些 key 上）
EXTRA_ATTRS.SwitchMaterial = EXTRA_ATTRS.Switch;
EXTRA_ATTRS.Slider = EXTRA_ATTRS.SeekBar;
EXTRA_ATTRS.MaterialToolbar = EXTRA_ATTRS.Toolbar;
EXTRA_ATTRS.MaterialTextView = EXTRA_ATTRS.TextView;
EXTRA_ATTRS.AppCompatButton = EXTRA_ATTRS.Button;
