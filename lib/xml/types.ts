// lib/xml/types.ts — Android 布局 XML 归一化树（M1 基础布局子集）
// 纯数据，不碰 React/DOM，便于单测。

/** 归一化后的节点 */
export interface XmlNode {
  tag: string;                 // LinearLayout / TextView / ...
  attrs: Record<string, string>; // 原始属性（未解析引用）
  /** 命名空间声明（xmlns:android="..."），writeback 序列化时补回，不进 attrs */
  nsDecls?: Record<string, string>;
  /** M12：每个属性原本用的前缀（android / app / …），序列化时原样还原。
   *  之前只存 localName + 靠 APP_ATTR_RE 猜前缀，用户写的 app:cardCornerRadius
   *  导出后会变成 android:cardCornerRadius → aapt 报 No resource identifier found */
  attrNs?: Record<string, string>;
  /** M2y：源文件行号（1 基，标签 < 所在行），用于代码 → 画布反跳 */
  line?: number;
  children: XmlNode[];
  path: string;                // 节点路径（#0/1/0 风格，writeback 定位用）
  /** M2q：该子树是从哪个 include 展开来的（文件名，如 "header.xml"）。
   *  渲染模型里存在，但回写主 XML 时这些节点不可编辑。 */
  includeFile?: string;
  /** M126：该元素在去声明后的源文本里的字节区间 [srcStart, srcEnd)。
   *  drawable 结构树用它把「不认识的子树」原样切片回写（注释/缩进/换行全保留）。 */
  srcStart?: number;
  srcEnd?: number;
}

/** 解析错误/警告（不阻断渲染） */
export interface XmlIssue {
  level: 'error' | 'warn';
  nodePath: string;
  message: string;
}

/** 资源表：string/dimen/color 三类 + 上传的 res/ 目录附加资源 */
export interface ThemePalette {
  /** 主色（MaterialButton 底色、选中态） */
  primary: string;
  /** 主色上的文字/图标色 */
  onPrimary: string;
  /** 页面/窗口底色 */
  surface: string;
  /** 表面上的默认文字色 */
  onSurface: string;
  /** 是否来自工程主题（false = 工具默认中性色，旧观感不变） */
  fromProject: boolean;
}

export interface ResourceTable {
  strings: Record<string, string>;
  dimens: Record<string, number>;   // 统一存 dp 数值
  colors: Record<string, string>;   // css 颜色值
  /** 可选：上传 res/ 目录后填充（@drawable/@mipmap 名 → dataURL，矢量名列表） */
  drawables?: Record<string, string>;
  vectorNames?: string[];
  /** 可选：styles.xml 解析后的展开样式（@style/xxx → attrs） */
  styles?: Record<string, { name: string; parent?: string; attrs: Record<string, string> }>;
  /** M19：string-array（@array/xxx → 项），Spinner 等下拉控件用它取候选 */
  stringArrays?: Record<string, string[]>;
  /** M2x：?attr/xxx 主题属性（主题样式里收集到的 名 → 原始值），颜色引用在 resolve 时再展开 */
  themeAttrs?: Record<string, string>;
  /** M92：深色模式主题属性（values-night），预览切夜间时优先于 themeAttrs */
  themeAttrsNight?: Record<string, string>;
  /** M92：values-night/colors.xml（名称 → 原始色值），深色下优先于 colors */
  colorsNight?: Record<string, string>;
  /** M92：预览是否深色模式 */
  nightMode?: boolean;
  /** M93：多语言文案表（限定符 → 名 → 值），如 { en: { app_name: "Demo" } } */
  stringsByLocale?: Record<string, Record<string, string>>;
  /** M93：当前预览语言限定符（"en" / "zh-rCN"）；空 = 默认 values */
  locale?: string;
  /** M92：从工程主题算出的预览调色板（按钮主色/窗口底色/文字色） */
  palette?: ThemePalette;
  /** M2w：res/drawable/*.xml 里的 <shape> 原文（名 → xml），用来还原渐变/圆角/描边背景 */
  drawableXml?: Record<string, string>;
}

/** 解析完成、引用已展开的节点（供 css.ts 用） */
export interface ResolvedNode {
  tag: string;
  path: string;
  style: Record<string, string | number>; // css.ts 生成的样式
  /** 组合图标（drawableLeft/Top/Right/Bottom 解析结果，渲染层画 img） */
  compound?: { start?: string; end?: string; top?: string; bottom?: string; gap: number };
  className: string;                      // 控件类名（渲染占位用）
  text: string;                           // TextView/Button/EditText 文本
  issues: XmlIssue[];
  children: ResolvedNode[];
  /** 回写定位用的原始属性 */
  rawAttrs: Record<string, string>;
  /** M149：解析后的 hint（@string/xxx 已展开成真实文字） */
  hint?: string;
  /** M2q：子树来自 include 展开的源文件（如 "header.xml"）；存在时 UI 应标记只读 */
  sourceFile?: string;
  /** M4s：图片控件的内容图（android:src）——单独用 <img> 画，保证在 background 之上 */
  imgSrc?: string;
  /** M4s：scaleType 对应的 CSS object-fit */
  imgFit?: string;
  /** M4z：scaleType=fitStart/fitEnd 的对齐（left/right；缺省居中） */
  imgPos?: string;
  /** M4s：tint 颜色（图片着色，优先用 mask） */
  imgTint?: string;
  /** M5a：tintMode 的混色方式（multiply/screen/plus-lighter/overlay；空 = 用 mask 填色） */
  imgBlend?: string;
  /** M11y：TextInputLayout 的浮动 hint 标签（行外绝对定位，压在框线上） */
  label?: string;
  /** M150：selector 命中 state_pressed 时的样式（运行态按下时贴到元素上，松开还原） */
  pressStyle?: Record<string, string>;
  /** M150：selector 命中 state_checked 时的样式（CheckBox/Radio/Switch 勾选态） */
  checkStyle?: Record<string, string>;
  /** M150：<ripple> 的点按水波色 */
  rippleColor?: string;
  /** M5c：<inset> 背景——背景图内缩绘制（不裁子控件，单独画一层） */
  bgInset?: {
    t: number;
    r: number;
    b: number;
    l: number;
    fill?: string;
    radius?: string;
    border?: string;
  };
}

/** 根结果 */
export interface RenderModel {
  root: ResolvedNode;
  issues: XmlIssue[];
}
