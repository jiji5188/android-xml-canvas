// lib/xml/types.ts — Android 布局 XML 归一化树（M1 基础布局子集）
// 纯数据，不碰 React/DOM，便于单测。

/** 归一化后的节点 */
export interface XmlNode {
  tag: string;                 // LinearLayout / TextView / ...
  attrs: Record<string, string>; // 原始属性（未解析引用）
  /** 命名空间声明（xmlns:android="..."），writeback 序列化时补回，不进 attrs */
  nsDecls?: Record<string, string>;
  /** M2y：源文件行号（1 基，标签 < 所在行），用于代码 → 画布反跳 */
  line?: number;
  children: XmlNode[];
  path: string;                // 节点路径（#0/1/0 风格，writeback 定位用）
  /** M2q：该子树是从哪个 include 展开来的（文件名，如 "header.xml"）。
   *  渲染模型里存在，但回写主 XML 时这些节点不可编辑。 */
  includeFile?: string;
}

/** 解析错误/警告（不阻断渲染） */
export interface XmlIssue {
  level: 'error' | 'warn';
  nodePath: string;
  message: string;
}

/** 资源表：string/dimen/color 三类 + 上传的 res/ 目录附加资源 */
export interface ResourceTable {
  strings: Record<string, string>;
  dimens: Record<string, number>;   // 统一存 dp 数值
  colors: Record<string, string>;   // css 颜色值
  /** 可选：上传 res/ 目录后填充（@drawable/@mipmap 名 → dataURL，矢量名列表） */
  drawables?: Record<string, string>;
  vectorNames?: string[];
  /** 可选：styles.xml 解析后的展开样式（@style/xxx → attrs） */
  styles?: Record<string, { name: string; parent?: string; attrs: Record<string, string> }>;
  /** M2x：?attr/xxx 主题属性（主题样式里收集到的 名 → 原始值），颜色引用在 resolve 时再展开 */
  themeAttrs?: Record<string, string>;
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
  /** M2q：子树来自 include 展开的源文件（如 "header.xml"）；存在时 UI 应标记只读 */
  sourceFile?: string;
  /** M4s：图片控件的内容图（android:src）——单独用 <img> 画，保证在 background 之上 */
  imgSrc?: string;
  /** M4s：scaleType 对应的 CSS object-fit */
  imgFit?: string;
  /** M4s：tint 颜色（图片着色，优先用 mask） */
  imgTint?: string;
}

/** 根结果 */
export interface RenderModel {
  root: ResolvedNode;
  issues: XmlIssue[];
}
