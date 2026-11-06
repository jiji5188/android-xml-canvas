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

/** M157：ref 节点的完整引用（区分 drawable / mipmap / color） */
const refValue = (node: DrawableNode): string =>
  node.t === "ref"
    ? (node.mipmap ? "@mipmap/" : "@drawable/") + node.name.replace(/^@(?:drawable|mipmap)\//, "")
    : "";

/** 能直接写成 <item android:drawable="…"/> 的节点（引用 / @color 引用） */
const inlineItemRef = (node: DrawableNode): string | null => {
  if (node.t === "ref") return refValue(node);
  if (node.t === "color" && /^@color\//.test(node.color)) return node.color;
  return null;
};

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

function transformAttrs(t: import("./drawable-node").Transform): string {
  const keys = Object.keys(t.params).sort();
  return joinAttrs(keys.map((k) => attr(k, t.params[k])));
}

/** M127：把变换链包回去（外→内顺序 = 数组顺序 = 标签从外到内嵌套） */
function wrapTransforms(node: DrawableNode, lines: string[], level: number): string[] {
  const chain = (node as { transform?: import("./drawable-node").Transform[] }).transform;
  if (!chain?.length) return lines;
  const out = [...lines];
  for (let i = chain.length - 1; i >= 0; i--) {
    const pad = IND.repeat(level + i);
    const t = chain[i];
    out.splice(0, 0, `${pad}<${t.kind}${transformAttrs(t)}>`);
    out.push(`${pad}</${t.kind}>`);
  }
  return out;
}

/** 不带 xmlns 的片段（嵌在 <item> 里时用），已按 level 缩进 */
export function buildDrawableFragment(node: DrawableNode, level = 0): string[] {
  return emit(node, level);
}

function emit(node: DrawableNode, level: number): string[] {
  switch (node.t) {
    case "shape": {
      const out = indent(shapeElementLines(node.spec), level);
      return wrapTransforms(node, out, level);
    }

    case "color": {
      const pad = IND.repeat(level);
      // 源文件是文本写法就照原样写回，别硬改成属性
      const line = node.asText
        ? `${pad}<color>${esc(node.color)}</color>`
        : `${pad}<color android:color="${esc(node.color)}"/>`;
      return wrapTransforms(node, [line], level);
    }

    case "ref": {
      // 只有出现在容器子位才有意义；根位置也按 item 输出，且交给校验去报错
      const pad = IND.repeat(level);
      const line = `${pad}<item${joinAttrs([attr("drawable", refValue(node))])}/>`;
      return wrapTransforms(node, [line], level);
    }

    case "layer": {
      const out: string[] = [`${IND.repeat(level)}<layer-list>`];
      node.items.forEach((item, i) => {
        out.push(...emitItem(item, level + 1, itemAttrs(item), `item-${i}`));
      });
      out.push(`${IND.repeat(level)}</layer-list>`);
      return wrapTransforms(node, out, level);
    }

    case "selector": {
      const out: string[] = [`${IND.repeat(level)}<selector>`];
      node.items.forEach((item, i) => {
        out.push(...emitItem(item, level + 1, stateAttrs(item), `state-${i}`));
      });
      out.push(`${IND.repeat(level)}</selector>`);
      return wrapTransforms(node, out, level);
    }

    case "ripple": {
      const out: string[] = [
        `${IND.repeat(level)}<ripple${joinAttrs([attr("color", node.color), attr("radius", node.radius)])}>`,
      ];
      // M157：ripple 的 item 也能写 android:drawable（引用），不能套成一个 item 里再包 item
      const rippleItem = (child: DrawableNode, extra: (string | null)[]) => {
        const ref = inlineItemRef(child);
        if (ref) return [`${IND.repeat(level + 1)}<item${joinAttrs([...extra, attr("drawable", ref)])}/>`];
        return [
          `${IND.repeat(level + 1)}<item${joinAttrs(extra)}>`,
          ...emit(child, level + 2),
          `${IND.repeat(level + 1)}</item>`,
        ];
      };
      if (node.content) out.push(...rippleItem(node.content, []));
      if (node.mask) out.push(...rippleItem(node.mask, [attr("id", "@android:id/mask")]));
      out.push(`${IND.repeat(level)}</ripple>`);
      return wrapTransforms(node, out, level);
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
        return wrapTransforms(node, lines, level);
      }
      return wrapTransforms(node, [`${pad}<${tag}/>`], level);
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
  const ref = inlineItemRef(node);
  if (ref) {
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
