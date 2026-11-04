"use client";

// components/ShapeEditor.tsx — M135：入口统一到新版 drawable 编辑器
//
// 历史：M3h 这里是「形状参数面板」（填充 / 圆角 / 描边 / 效果 / 图层 五个 sub-tab +
// 状态切换 + 预设），M121 起它退化成路由器：纯 <shape> 进旧面板，其余进结构树。
// 现在两套 UI 维护成本太高（同一件事两个入口、两处 bug），而且旧面板改不了
// `<item>` 上的东西（偏移 / 状态 / 遮罩），所以 M135 直接淘汰旧面板：
//
//   所有 drawable（shape / selector / layer-list / ripple / inset / 只读类型）
//   一律进 <DrawableEditor>，其中：
//     · 结构页：树 + 同级插入 + 增删改
//     · 参数页：这一层的 item 属性 + 节点自身属性 + 变换
//     · 形状页：完整 ShapeFields（填充 / 渐变 / 圆角 / 描边 / 环宽）
//     · 边距页：宽高 + 内边距
//     · 预设、XML 预览、校验、撤销重做都在同一个界面里
//
// 保留这个文件与同名导出，是为了不再动所有历史调用点（XmlEditor / AttrPanel 十多处）。

import { DrawableEditor } from "./DrawableEditor";

export interface ShapeEditorProps {
  /** 正在编辑的属性名（background / foreground …） */
  attrName: string;
  /** 当前属性值（@drawable/xxx），用于预填名字 */
  value: string;
  /** 若该资源是「本工具生成」的，传原文进来 → 打开即回填 */
  existingXml?: string;
  /** 已有资源名（防重名） */
  existingNames: string[];
  onClose: () => void;
  /** 保存：资源名 + XML */
  onSave: (name: string, xml: string) => void;
  /** @deprecated M135 起始终是结构树视图，这个参数保留只为兼容老调用点 */
  forceTree?: boolean;
}

export function ShapeEditor({
  attrName,
  value,
  existingXml,
  existingNames,
  onClose,
  onSave,
}: ShapeEditorProps) {
  return (
    <DrawableEditor
      attrName={attrName}
      value={value}
      existingXml={existingXml}
      existingNames={existingNames}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
