// test/xml_m166_drawable_ref.test.ts — M166 drawable 引用资源改造回归
// @vitest-environment node

import { describe, it, expect } from "vitest";
import { editableAttrs, readAttr } from "../lib/xml/drawable-attrs";
import { NODE_DEFS } from "../lib/xml/drawable-schema";
import { flattenDrawable } from "../lib/xml/drawable-node";
import type { DrawableNode } from "../lib/xml/drawable-node";

describe("M166 · 参数面板不再重复「引用资源」", () => {
  it("ref 节点没有可编辑属性（避免与 SlotRows 的输入框重复）", () => {
    const ref: DrawableNode = { t: "ref", name: "bg_card" };
    expect(editableAttrs(ref)).toEqual([]);
    // schema 里也不再登记 reference 属性
    expect(NODE_DEFS.ref.attrs).toEqual([]);
  });

  it("readAttr 仍能读到 drawable 值（导出/摘要用）", () => {
    const ref: DrawableNode = { t: "ref", name: "bg_card" };
    expect(readAttr(ref, "drawable")).toBe("@drawable/bg_card");
  });
});

describe("M166 · 引用资源找不到时不静默", () => {
  const tree: DrawableNode = {
    t: "layer",
    items: [{ key: "k0", node: { t: "ref", name: "missing_res" } }],
  };

  it("resolveRef/resolveImage 都失败 → 扫出 unsupported 层，能定位到资源名", () => {
    const layers = flattenDrawable(tree);
    const bad = layers.filter((l) => l.kind === "unsupported");
    expect(bad.length).toBe(1);
    expect(bad[0].path).toContain("@drawable/missing_res");
    // key 以 .ref 结尾 = 这是「引用没解析出来」，不是其它不支持的类型
    expect(bad[0].key.endsWith(".ref")).toBe(true);
  });

  it("资源存在（图片）→ 正常出 image 层，没有 unsupported", () => {
    const layers = flattenDrawable(tree, {
      resolveImage: (n) => (n === "missing_res" ? "data:image/png;base64,AAA" : null),
    });
    expect(layers.some((l) => l.kind === "image")).toBe(true);
    expect(layers.some((l) => l.kind === "unsupported")).toBe(false);
  });

  it("资源存在（XML）→ 递归展开，没有 unsupported", () => {
    const layers = flattenDrawable(tree, {
      resolveRef: (n) =>
        n === "missing_res"
          ? '<shape xmlns:android="http://schemas.android.com/apk/res/android"><solid android:color="#FF112233"/></shape>'
          : null,
    });
    expect(layers.some((l) => l.kind === "shape")).toBe(true);
    expect(layers.some((l) => l.kind === "unsupported")).toBe(false);
  });
});
