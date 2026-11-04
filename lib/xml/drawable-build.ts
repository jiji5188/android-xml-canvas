// lib/xml/drawable-build.ts — drawable 树 → XML（M120）
//
// 和 drawable-node.parseDrawable 凑成双向：parse → build → parse 应当完全等价。
// <item> 不建节点，这里按父容器类型自动补出包装（slot 字段在子节点旁边）：
//   layer-list 的 item  → 偏移/尺寸/对齐/alpha
//   selector 的 item    → android:state_*
//   ripple 的 item      → 没有附加属性；遮罩加 android:id="@android:id/mask"
//
// 稳定性约定：属性顺序固定、缩进固定、根节点统一声明 xmlns，
// 这样「打开再保存」不会因为格式化产生大段 diff。

import { serializeXmlNode, type DrawableNode, type LayerItem, type StateItem } from "./drawable-node";
import { shapeElementLines } from "./shape-gen";

const NS = "http://schemas.android.com/apk/res/android";
const IND = "    ";

const esc = (v: string) =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const indent = (lines: string[], level: number): string[] =>
  lines.map((l) => (l ? IND.repeat(level) + l : l));

const attr = (name: string, value: string | number | undefined): string | null =>
  value === undefined || value === "" ? null : `android:${name}="${esc(String(value))}"`;

const joinAttrs = (parts: (string | null)[]): string => {
  const list = parts.filter((p): p is string => !!p);
  return list.length ? " " + list.join(" ") : "";
};

const dpNum = (n: number): string => `${Math.round(n * 100) / 100}dp`;

/** 主入口：树 → 完整 XML 文本（末尾带换行） */
export function buildDrawable(node: DrawableNode): string {
  const lines = emit(node, 0);
  if (lines.length === 0) return "";
  // 根节点补 xmlns（内层不重复声明）
  lines[0] = lines[0].replace(/^<([A-Za-z][\w.-]*)/, (_m, tag: string) => `<${tag} xmlns:android="${NS}"`);
  // M126：源文件有 XML 声明就原样放回去（以前会被丢掉）
  const decl = (node as { decl?: string }).decl;
  return (decl ? decl + "\n" : "") + lines.join("\n") + "\n";
}

/** 不带 xmlns 的片段（嵌在 <item> 里时用），已按 level 缩进 */
export function buildDrawableFragment(node: DrawableNode, level = 0): string[] {
  return emit(node, level);
}

function emit(node: DrawableNode, level: number): string[] {
  switch (node.t) {
    case "shape":
      return indent(shapeElementLines(node.spec), level);

    case "color": {
      const pad = IND.repeat(level);
      // 源文件是文本写法就照原样写回，别硬改成属性
      if (node.asText) return [`${pad}<color>${esc(node.color)}</color>`];
      return [`${pad}<color android:color="${esc(node.color)}"/>`];
    }

    case "ref": {
      // 只有出现在容器子位才有意义；根位置也按 item 输出，且交给校验去报错
      const pad = IND.repeat(level);
      return [`${pad}<item${joinAttrs([attr("drawable", `@drawable/${node.name.replace(/^@drawable\//, "")}`)])}/>`];
    }

    case "layer": {
      const out: string[] = [`${IND.repeat(level)}<layer-list>`];
      node.items.forEach((item, i) => {
        out.push(...emitItem(item, level + 1, itemAttrs(item), `item-${i}`));
      });
      out.push(`${IND.repeat(level)}</layer-list>`);
      return out;
    }

    case "selector": {
      const out: string[] = [`${IND.repeat(level)}<selector>`];
      node.items.forEach((item, i) => {
        out.push(...emitItem(item, level + 1, stateAttrs(item), `state-${i}`));
      });
      out.push(`${IND.repeat(level)}</selector>`);
      return out;
    }

    case "ripple": {
      const out: string[] = [
        `${IND.repeat(level)}<ripple${joinAttrs([attr("color", node.color), attr("radius", node.radius)])}>`,
      ];
      if (node.content) {
        out.push(`${IND.repeat(level + 1)}<item>`);
        out.push(...emit(node.content, level + 2));
        out.push(`${IND.repeat(level + 1)}</item>`);
      }
      if (node.mask) {
        out.push(`${IND.repeat(level + 1)}<item android:id="@android:id/mask">`);
        out.push(...emit(node.mask, level + 2));
        out.push(`${IND.repeat(level + 1)}</item>`);
      }
      out.push(`${IND.repeat(level)}</ripple>`);
      return out;
    }

    case "inset": {
      const out: string[] = [
        `${IND.repeat(level)}<inset${joinAttrs([
          attr("insetLeft", node.left ? dpNum(node.left) : undefined),
          attr("insetTop", node.top ? dpNum(node.top) : undefined),
          attr("insetRight", node.right ? dpNum(node.right) : undefined),
          attr("insetBottom", node.bottom ? dpNum(node.bottom) : undefined),
        ])}>`,
      ];
      out.push(...emit(node.node, level + 1));
      out.push(`${IND.repeat(level)}</inset>`);
      return out;
    }

    default: {
      // M126：不认识的标签：有原始字节就**整体平移**（内部注释/换行/缩进全保留），没有就输出自闭合占位
      const raw = (node as { raw?: string }).raw;
      const tag = (node as { tag?: string }).tag ?? "shape";
      const pad = IND.repeat(level);
      if (raw && raw.trim()) {
        const rawLines = raw.split("\n");
        const first = rawLines.find((l) => l.trim());
        const base = first ? first.length - first.trimStart().length : 0;
        const lines = rawLines.map((l) => {
          if (!l.trim()) return "";
          // 去掉每行自带的 base 缩进，再加上新位置的同名 base，保留相对缩进
          const stripped = l.slice(base).replace(/\s+$/, "");
          return pad + stripped;
        });
        // 去掉首尾空行
        while (lines.length && lines[0] === "") lines.shift();
        while (lines.length && lines[lines.length - 1] === "") lines.pop();
        return lines;
      }
      return [`${pad}<${tag}/>`];
    }
  }
}

/** 一层/一个状态项：引用型写成单行，内嵌型写成 item 包子树 */
function emitItem(
  item: LayerItem | StateItem,
  level: number,
  slotAttrs: (string | null)[],
  key: string,
): string[] {
  void key;
  const pad = IND.repeat(level);
  const node = item.node;
  if (node.t === "ref") {
    const ref = `@drawable/${node.name.replace(/^@drawable\//, "")}`;
    return [`${pad}<item${joinAttrs([attr("drawable", ref), ...slotAttrs])}/>`];
  }
  const out = [`${pad}<item${joinAttrs(slotAttrs)}>`];
  out.push(...emit(node, level + 1));
  out.push(`${pad}</item>`);
  return out;
}

function itemAttrs(item: LayerItem): (string | null)[] {
  const off = item.offset ?? {};
  const size = item.size ?? {};
  return [
    attr("left", off.l ? dpNum(off.l) : undefined),
    attr("top", off.t ? dpNum(off.t) : undefined),
    attr("right", off.r ? dpNum(off.r) : undefined),
    attr("bottom", off.b ? dpNum(off.b) : undefined),
    attr("width", size.w !== undefined ? dpNum(size.w) : undefined),
    attr("height", size.h !== undefined ? dpNum(size.h) : undefined),
    attr("gravity", item.gravity),
    attr("alpha", item.alpha !== undefined && item.alpha !== 1 ? round2(item.alpha) : undefined),
  ];
}

function stateAttrs(item: StateItem): (string | null)[] {
  // 状态属性顺序固定：先 true 后 false，同类按原顺序
  const entries = Object.entries(item.states);
  const on = entries.filter(([, v]) => v === "true");
  const off = entries.filter(([, v]) => v !== "true");
  return [...on, ...off].map(([k, v]) => attr(k, v));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 给「另存为 / 预览」用：把不支持的子树原文也带出来（调试用） */
export function dumpUnsupported(node: DrawableNode, level = 0): string[] {
  const pad = IND.repeat(level);
  if (node.t === "unsupported" && node.raw) return [pad + node.raw.trim()];
  return [];
}

export { serializeXmlNode };
