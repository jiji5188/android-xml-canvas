// lib/xml/drawable-root-convert.ts — 根标签互转（M137）
//
// 用户场景：drawable 文件根标签写错了（该用 <selector> 写成了 <layer-list>），
// 以前只能「只读 + 原样保存」，或者自己把整个文件重写一遍。
//
// 模型说明（重要）：inset/clip/scale/rotate 这些包装类标签不当节点，解析时压进
// transform 链。所以「根是 `<inset>`」在模型里 = 某个节点带着 transform[0]=inset。
// 转换时按「根标签 + 里面那坨内容」来理解，改根就等于换外壳。
//
// 转换原则：
//   1. 能不丢就不丢 —— 原内容整体塞进目标根能装的位置（装不下的包一层 layer-list）
//   2. 丢了一定要说 —— 返回 lost[] 列出会失效的东西，UI 直接展示
//   3. 纯函数 + 深拷贝 —— 不改入参，调用方自己压 undo 栈

import type {
  DrawableNode,
  LayerItem,
  LayerNode,
  RippleNode,
  SelectorNode,
  Transform,
} from "./drawable-node";
import { withTransform } from "./drawable-node";
import { ROOT_TAGS, type RootTag } from "./drawable-root";

export interface ConvertResult {
  next: DrawableNode;
  /** 转换后失效的东西（人话），空数组 = 尽量无损 */
  lost: string[];
}

let seq = 0;
const key = () => `c${(seq++).toString(36)}`;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** 把若干层原样收成一个 layer 节点（偏移/尺寸/对齐/不透明度全保留） */
function asLayer(items: LayerItem[]): LayerNode {
  return { t: "layer", items: items.map((it) => ({ ...clone(it), key: key() })) };
}

function asDrawable(items: LayerItem[]): DrawableNode {
  if (items.length === 0) return { t: "color", color: "#00000000" };
  if (items.length === 1) return clone(items[0].node);
  return asLayer(items);
}

function asStateItems(items: LayerItem[]): SelectorNode["items"] {
  return items.map((it) => ({ key: key(), states: {}, node: clone(it.node) }));
}

/** 当前根的本质标签（先看 transform 链头：<inset> 这类外壳不占节点） */
export function rootTagOfNode(n: DrawableNode): RootTag | null {
  const head = n.transform?.[0];
  if (head && head.kind === "inset") return "inset";
  if (n.t === "selector") return "selector";
  if (n.t === "layer") return "layer-list";
  if (n.t === "ripple") return "ripple";
  return null;
}

/** 剥掉最外层的内缩外壳，拿到里面真正的 drawable + 内缩参数 */
function stripInset(n: DrawableNode): { inner: DrawableNode; params: Record<string, string> } {
  const head = n.transform?.[0];
  if (!head || head.kind !== "inset") return { inner: n, params: {} };
  const rest = (n.transform ?? []).slice(1);
  const inner = { ...n, transform: rest.length > 0 ? rest : undefined } as DrawableNode;
  if (!rest.length) delete (inner as { transform?: Transform[] }).transform;
  return { inner, params: head.params };
}

/** 根节点拍平成「层清单」——四种组合类都能落到这个中间形态，再往目标转 */
function toLayers(n: DrawableNode): { items: LayerItem[]; extra: string[] } {
  switch (n.t) {
    case "layer":
      return { items: n.items, extra: [] };

    case "selector": {
      const hasStates = n.items.some((s) => Object.keys(s.states).length > 0);
      return {
        items: n.items.map((s) => ({ key: key(), node: s.node })),
        extra: hasStates ? ["状态条件"] : [],
      };
    }

    case "ripple": {
      const items: LayerItem[] = [];
      if (n.content) items.push({ key: key(), node: n.content });
      if (n.mask) items.push({ key: key(), node: n.mask });
      if (items.length === 0) {
        items.push({ key: key(), node: { t: "color", color: n.color ?? "#00000000" } });
      }
      const extra: string[] = [];
      if (n.color) extra.push("波纹色");
      if (n.radius) extra.push("扩散半径");
      if (n.mask) extra.push("遮罩项（会变成普通一层）");
      return { items, extra };
    }

    default: {
      // 走到这儿说明根是 inset（或奇形怪状），剥掉外壳当一层
      const { inner, params } = stripInset(n);
      const extra: string[] = [];
      const hasInset = ["insetLeft", "insetTop", "insetRight", "insetBottom"].some(
        (k) => params[k] !== undefined && params[k] !== "",
      );
      if (hasInset) extra.push("内缩距离");
      return { items: [{ key: key(), node: inner }], extra };
    }
  }
}

/**
 * 转换根标签。同标签返回原样拷贝；不是可转换的根会抛错（调用方不该走到这儿）。
 */
export function convertRoot(current: DrawableNode, target: RootTag): ConvertResult {
  const from = rootTagOfNode(current);
  if (!from) throw new Error("不是可转换的根节点");
  if (!ROOT_TAGS.includes(target)) throw new Error("目标根不认识");
  if (from === target) return { next: clone(current), lost: [] };

  const { items, extra } = toLayers(current);
  const lost = [...extra];

  if (target === "layer-list") {
    const next: LayerNode = { t: "layer", items: items.map((it) => ({ ...clone(it), key: key() })) };
    return { next, lost };
  }

  if (target === "selector") {
    const next: SelectorNode = { t: "selector", items: asStateItems(items) };
    if (items.length > 1) lost.push("各层之间没有状态区分（都成了兜底项，只有第一个会显示）");
    return { next, lost };
  }

  if (target === "ripple") {
    const next: RippleNode = { t: "ripple" };
    if (items.length <= 1) {
      next.content = asDrawable(items);
    } else if (items.length === 2) {
      next.content = clone(items[0].node);
      next.mask = clone(items[1].node);
      lost.push("第 2 层被当成遮罩（不直接显示，只在按下时参与裁切）");
    } else {
      next.content = asLayer(items);
      lost.push("所有层整体并进内容层");
    }
    return { next, lost };
  }

  // target === "inset"：外面套一层内缩，距离默认 0
  const t: Transform = { kind: "inset", params: {} };
  const next = withTransform(asDrawable(items), t);
  lost.push("内缩距离重置为 0");
  return { next, lost };
}
