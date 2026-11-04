// lib/xml/drawable-focus.ts — 预览「只看选中层」（M125）
//
// 场景：layer-list 叠了几层，想单独确认「第 2 层」长什么样。把选中节点
// 连同它的插槽属性（偏移 / 不透明度 / 状态）重新包成一个单子项容器，
// 交给 flattenDrawable —— 走的还是同一条渲染路径，不存在“预览特例”。
import type { DrawableNode } from "./drawable-node";
import { nodeAt, type Path } from "./drawable-edit";

export function focusDoc(root: DrawableNode, path: Path): DrawableNode {
  if (path.length === 0) return root;
  const parentPath = path.slice(0, -1);
  const idx = path[path.length - 1];
  const parent = nodeAt(root, parentPath);
  const child = nodeAt(root, path);
  if (!parent || !child) return root;

  switch (parent.t) {
    case "layer": {
      const item = parent.items[idx];
      if (!item) return root;
      // 只保留这一层：偏移/尺寸/alpha/gravity 原样带过来
      return { t: "layer", items: [{ ...item, key: "focus", node: child }] };
    }
    case "selector": {
      const item = parent.items[idx];
      if (!item) return root;
      return { t: "selector", items: [{ key: "focus", states: {}, node: child }] };
    }
    case "ripple": {
      return idx === 1 ? { t: "ripple", color: parent.color, radius: parent.radius, mask: child } : { t: "ripple", color: parent.color, radius: parent.radius, content: child };
    }
    default:
      return child;
  }
}
