// lib/xml/types.ts — Android 布局 XML 归一化树（M1 基础布局子集）
// 纯数据，不碰 React/DOM，便于单测。

/** 归一化后的节点 */
export interface XmlNode {
  tag: string;                 // LinearLayout / TextView / ...
  attrs: Record<string, string>; // 原始属性（未解析引用）
  children: XmlNode[];
  path: string;                // 节点路径（#0/1/0 风格，writeback 定位用）
}

/** 解析错误/警告（不阻断渲染） */
export interface XmlIssue {
  level: 'error' | 'warn';
  nodePath: string;
  message: string;
}

/** 资源表：string/dimen/color 三类 */
export interface ResourceTable {
  strings: Record<string, string>;
  dimens: Record<string, number>;   // 统一存 dp 数值
  colors: Record<string, string>;   // css 颜色值
}

/** 解析完成、引用已展开的节点（供 css.ts 用） */
export interface ResolvedNode {
  tag: string;
  path: string;
  style: Record<string, string | number>; // css.ts 生成的样式
  className: string;                      // 控件类名（渲染占位用）
  text: string;                           // TextView/Button/EditText 文本
  issues: XmlIssue[];
  children: ResolvedNode[];
  /** 回写定位用的原始属性 */
  rawAttrs: Record<string, string>;
}

/** 根结果 */
export interface RenderModel {
  root: ResolvedNode;
  issues: XmlIssue[];
}
