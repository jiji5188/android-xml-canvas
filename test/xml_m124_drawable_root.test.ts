// M124：解析入口（根元素识别与路由）
// 目标：任何一份 XML 都先判根，再决定交给谁；未知/只读类型绝不能被形状面板改写。
import { describe, expect, it } from "vitest";
import { isEditableRoot, rootInfo, rootTagOf } from "@/lib/xml/drawable-root";

const wrap = (tag: string, inner = "") =>
  `<?xml version="1.0" encoding="utf-8"?>\n<${tag} xmlns:android="http://schemas.android.com/apk/res/android">${inner}</${tag}>`;

describe("M124 rootTagOf", () => {
  it("跳过声明取根标签", () => {
    expect(rootTagOf(wrap("shape"))).toBe("shape");
  });

  it("跳过注释和 DOCTYPE", () => {
    expect(rootTagOf(`<!-- hi -->\n<!DOCTYPE x>\n<selector/>`)).toBe("selector");
  });

  it("剥掉命名空间前缀", () => {
    expect(rootTagOf(`<a:ripple xmlns:a="x"/>`)).toBe("ripple");
  });

  it("空内容返回空串", () => {
    expect(rootTagOf("")).toBe("");
    expect(rootTagOf("   \n  ")).toBe("");
  });
});

describe("M124 路由", () => {
  it("shape 走形状面板", () => {
    const r = rootInfo(wrap("shape"));
    expect(r.route).toBe("shape");
    expect(r.tag).toBe("shape");
  });

  it("四种组合容器走结构树", () => {
    for (const tag of ["selector", "layer-list", "ripple", "inset"]) {
      expect(rootInfo(wrap(tag)).route).toBe("tree");
    }
  });

  it("纯色根走结构树（它本身就是一个可编辑节点）", () => {
    expect(rootInfo(wrap("color", "#FFF")).route).toBe("tree");
  });

  it("vector / clip / level-list 等只读，不假装能编辑", () => {
    for (const tag of ["vector", "clip", "scale", "rotate", "level-list", "animation-list", "nine-patch"]) {
      const r = rootInfo(wrap(tag));
      expect(r.route).toBe("readonly");
      expect(r.note.length).toBeGreaterThan(4);
    }
  });

  it("不是 drawable 的文件给出更准的类型名", () => {
    expect(rootInfo(wrap("layout")).label).toBe("布局 XML");
    expect(rootInfo(wrap("manifest")).label).toBe("清单文件");
  });

  it("完全不认识的标签回落 readonly，并带上原标签名", () => {
    const r = rootInfo(wrap("my-custom-drawable"));
    expect(r.route).toBe("readonly");
    expect(r.label).toBe("my-custom-drawable");
  });

  it("空内容不算可编辑根，但也不拦着新建", () => {
    expect(rootInfo("").route).toBe("empty");
    expect(isEditableRoot("")).toBe(true);
  });

  it("isEditableRoot：shape/tree 可编辑，readonly 不可", () => {
    expect(isEditableRoot(wrap("shape"))).toBe(true);
    expect(isEditableRoot(wrap("selector"))).toBe(true);
    expect(isEditableRoot(wrap("vector"))).toBe(false);
  });
});
