// M121：drawable 树编辑（纯逻辑）
import { describe, expect, it } from "vitest";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import {
  addChild,
  breadcrumb,
  childAt,
  childCount,
  moveChild,
  nodeAt,
  removeChild,
  replaceAt,
  setSlot,
  slotOf,
} from "@/lib/xml/drawable-edit";

const shape = (color: string): DrawableNode => ({ t: "shape", spec: { kind: "rectangle", solid: color } });

const layerTree = (): DrawableNode => ({
  t: "layer",
  items: [
    { key: "a", node: shape("#FF000001") },
    { key: "b", node: shape("#FF000002") },
  ],
});

describe("M121 drawable-edit：读", () => {
  it("nodeAt / childAt / childCount 按容器语义工作", () => {
    const t = layerTree();
    expect(childCount(t)).toBe(2);
    expect(nodeAt(t, [1])).toEqual(shape("#FF000002"));
    expect(nodeAt(t, [5])).toBeNull();

    const ripple: DrawableNode = {
      t: "ripple",
      content: shape("#FF111111"),
      mask: shape("#FF222222"),
    };
    expect(childCount(ripple)).toBe(2);
    expect(nodeAt(ripple, [0])).toEqual(shape("#FF111111"));
    expect(nodeAt(ripple, [1])).toEqual(shape("#FF222222"));

    const inset: DrawableNode = { t: "inset", left: 4, top: 4, right: 4, bottom: 4, node: shape("#FF333333") };
    expect(childCount(inset)).toBe(1);
    expect(childAt(inset, 0)).toEqual(shape("#FF333333"));
  });

  it("面包屑把 item 说成人话，不出现 item 这个词", () => {
    const t: DrawableNode = {
      t: "layer",
      items: [{ key: "a", node: shape("#FF000000") }],
    };
    const crumbs = breadcrumb(t, [0]);
    expect(crumbs.length).toBe(2);
    expect(crumbs[0].label).toBe("图层叠加");
    expect(crumbs[1].label).toContain("第 1 层");
    expect(crumbs[1].label).toContain("矩形");
    expect(crumbs[1].label).not.toContain("item");
  });
});

describe("M121 drawable-edit：增删改序", () => {
  it("加子节点返回新路径，原树不被改", () => {
    const t = layerTree();
    const res = addChild(t, [], shape("#FF000003"))!;
    expect(res.root).not.toBe(t);
    expect(childCount(t)).toBe(2); // 不可变
    expect(childCount(res.root)).toBe(3);
    expect(res.path).toEqual([2]);
    expect(nodeAt(res.root, res.path)).toEqual(shape("#FF000003"));
  });

  it("ripple 先补内容、再补遮罩、满了返回 null", () => {
    const empty: DrawableNode = { t: "ripple", color: "#33FFFFFF" };
    const one = addChild(empty, [], shape("#FF000000"))!;
    expect(one.path).toEqual([0]);
    const two = addChild(one.root, [], shape("#FFFFFFFF"))!;
    expect(two.path).toEqual([1]);
    expect(addChild(two.root, [], shape("#FF000000"))).toBeNull();

    const r = two.root;
    expect(r.t).toBe("ripple");
    if (r.t === "ripple") {
      expect(r.content?.t).toBe("shape");
      expect(r.mask?.t).toBe("shape");
    }
  });

  it("inset 只有一个内容位，加不了第二个", () => {
    const inset: DrawableNode = { t: "inset", left: 0, top: 0, right: 0, bottom: 0, node: shape("#FF000000") };
    expect(addChild(inset, [], shape("#FFFFFFFF"))).toBeNull();
  });

  it("叶子节点加不了子节点", () => {
    expect(addChild(shape("#FF000000"), [], shape("#FFFFFFFF"))).toBeNull();
  });

  it("删除与排序", () => {
    let t = layerTree();
    t = removeChild(t, [], 0);
    expect(childCount(t)).toBe(1);
    expect((childAt(t, 0) as { spec: { solid: string } }).spec.solid).toBe("#FF000002");

    let t2 = layerTree();
    t2 = moveChild(t2, [], 1, -1);
    expect((childAt(t2, 0) as { spec: { solid: string } }).spec.solid).toBe("#FF000002");
    // 越界不动
    expect(moveChild(t2, [], 0, -1)).toBe(t2);
    expect(moveChild(t2, [], 1, 1)).toBe(t2);
  });

  it("replaceAt 只换目标节点，兄弟不动", () => {
    const t = layerTree();
    const next = replaceAt(t, [0], shape("#FF999999"));
    expect((childAt(next, 0) as { spec: { solid: string } }).spec.solid).toBe("#FF999999");
    expect(childAt(next, 1)).toEqual(shape("#FF000002"));
  });
});

describe("M121 drawable-edit：插槽属性", () => {
  it("layer 子节点的偏移/尺寸/alpha/gravity 读写", () => {
    const t = layerTree();
    const withOffset = setSlot(t, [1], { offset: { l: 4, t: 2 }, alpha: 0.5, gravity: "center" });
    expect(slotOf(withOffset, [1])).toEqual({
      offset: { l: 4, t: 2 },
      alpha: 0.5,
      gravity: "center",
    });
    // alpha=1 等于没设，应被清掉
    const cleared = setSlot(withOffset, [1], { alpha: 1 });
    expect(slotOf(cleared, [1]).alpha).toBeUndefined();
    // 偏移全 0 也应被清掉
    const cleared2 = setSlot(withOffset, [1], { offset: { l: 0, t: 0 } });
    expect(slotOf(cleared2, [1]).offset).toBeUndefined();
  });

  it("selector 子节点的状态位可加可删", () => {
    const sel: DrawableNode = {
      t: "selector",
      items: [{ key: "a", states: {}, node: shape("#FF000000") }],
    };
    const pressed = setSlot(sel, [0], { states: { state_pressed: "true" } });
    expect(slotOf(pressed, [0]).states).toEqual({ state_pressed: "true" });

    const off = setSlot(pressed, [0], { states: { state_pressed: undefined } });
    expect(slotOf(off, [0]).states).toEqual({});
  });

  it("ripple 第二个子节点被识别为遮罩", () => {
    const r: DrawableNode = { t: "ripple", content: shape("#FF000000"), mask: shape("#FFFFFFFF") };
    expect(slotOf(r, [0]).mask).toBe(false);
    expect(slotOf(r, [1]).mask).toBe(true);
  });
});
