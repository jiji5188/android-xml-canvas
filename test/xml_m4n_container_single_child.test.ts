// test/xml_m4n_container_single_child.test.ts — 拖进自闭合容器 + CardView 只许 1 个子控件
// 用户 2026-10-28 报的两个问题：
//  1) 从组件面板加的 CardView 是自闭合 <CardView ... />，往它里面拖子控件「加不了」——
//     因为插入点在 "/>" 之后，实际变成了兄弟节点；必须先把标签改成成对形式。
//  2) CardView / MaterialCardView 只允许 1 个子控件，要加限制。
import { describe, it, expect } from "vitest";
import { moveNodeRaw, scanElements } from "../lib/xml/reorder";
import { insertChild, canAcceptChild, isSingleChildTag } from "../lib/xml/insert";
import { parseLayoutXml } from "../lib/xml/parser";

const XML = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

  <androidx.cardview.widget.CardView
      android:id="@+id/card"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_margin="8dp"
      android:radius="8dp" />

  <TextView
      android:id="@+id/tv"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="要拖进卡片" />

</LinearLayout>`;

const CHILD_SNIPPET = `<TextView
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="卡片里的文字" />`;

function structureErrors(xml: string): string[] {
  const root = scanElements(xml);
  if (!root) return ["无根节点"];
  const out: string[] = [];
  if (xml.slice(root.end).trim()) out.push("根节点后还有内容");
  const opens = (xml.match(/<androidx\.cardview\.widget\.CardView\b/g) || []).length;
  const closes = (xml.match(/<\/androidx\.cardview\.widget\.CardView>/g) || []).length;
  const selfClosed = (xml.match(/<androidx\.cardview\.widget\.CardView\b[^>]*\/>/g) || []).length;
  if (opens !== closes + selfClosed) out.push(`CardView 标签不配平 open=${opens} close=${closes} self=${selfClosed}`);
  return out;
}

function childIds(xml: string): string[] {
  const { root } = parseLayoutXml(xml);
  if (!root) return [];
  return root.children.map((c) => c.attrs["id"] ?? c.tag);
}

function cardChildTags(xml: string): string[] {
  const { root } = parseLayoutXml(xml);
  const card = root?.children.find((c) => (c.attrs["id"] ?? "").includes("card"));
  return card ? card.children.map((c) => c.tag) : [];
}

describe("M4n 拖进自闭合容器", () => {
  it("拖进自闭合 CardView：自动改成成对标签，子控件落在里面", () => {
    const r = moveNodeRaw(XML, "#0/1", { parentPath: "#0/0", index: 0, maxChildren: 1 });
    expect(r.ok).toBe(true);
    expect(structureErrors(r.xml)).toEqual([]);
    // CardView 不再是自闭合
    expect((r.xml.match(/<androidx\.cardview\.widget\.CardView\b[^>]*\/>/g) || []).length).toBe(0);
    expect(r.xml).toContain("</androidx.cardview.widget.CardView>");
    // 子控件真的进了 CardView，而不是变成兄弟
    expect(cardChildTags(r.xml)).toEqual(["TextView"]);
    expect(childIds(r.xml)).toEqual(["@+id/card"]);
    // 缩进合理：子控件行在 CardView 内多一级（至少 4 空格），且闭合标签之后才会出现兄弟控件
    const cardOpen = r.xml.indexOf("<androidx.cardview.widget.CardView");
    const childLine = r.xml.slice(cardOpen).split("\n").find((l) => l.trim().startsWith("<TextView")) ?? "";
    expect(childLine.length - childLine.trimStart().length).toBeGreaterThanOrEqual(4);
  });

  it("组件面板插入到自闭合 CardView：同样变成成对标签", () => {
    const r = insertChild(XML, "#0/0", CHILD_SNIPPET, "TextView");
    expect(r.ok).toBe(true);
    expect(structureErrors(r.xml)).toEqual([]);
    expect(cardChildTags(r.xml)).toEqual(["TextView"]);
    expect(childIds(r.xml)).toEqual(["@+id/card", "@+id/tv"]);
  });
});

describe("M4n CardView 只允许 1 个子控件", () => {
  it("isSingleChildTag 认识 CardView / MaterialCardView", () => {
    expect(isSingleChildTag("CardView")).toBe(true);
    expect(isSingleChildTag("androidx.cardview.widget.CardView")).toBe(true);
    expect(isSingleChildTag("MaterialCardView")).toBe(true);
    expect(isSingleChildTag("com.google.android.material.card.MaterialCardView")).toBe(true);
    expect(isSingleChildTag("LinearLayout")).toBe(false);
  });

  it("canAcceptChild：CardView 空着能加，有 1 个就拒", () => {
    expect(canAcceptChild("CardView", 0)).toEqual({ ok: true });
    const full = canAcceptChild("androidx.cardview.widget.CardView", 1);
    expect(full.ok).toBe(false);
    expect(full.reason).toContain("只支持 1 个子控件");
    expect(canAcceptChild("MaterialCardView", 1).ok).toBe(false);
    // 普通容器不受影响
    expect(canAcceptChild("LinearLayout", 5).ok).toBe(true);
  });

  it("组件面板往已有子项的 CardView 再加一个会被拒绝", () => {
    const withChild = insertChild(XML, "#0/0", CHILD_SNIPPET, "TextView").xml;
    const r = insertChild(withChild, "#0/0", CHILD_SNIPPET, "Button");
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain("只支持 1 个子控件");
    expect(r.xml).toBe(withChild);
  });

  it("图层拖拽往已满的 CardView 里拖会被拒绝（maxChildren=1）", () => {
    const withChild = insertChild(XML, "#0/0", CHILD_SNIPPET, "TextView").xml;
    const r = moveNodeRaw(withChild, "#0/1", { parentPath: "#0/0", index: 1, maxChildren: 1 });
    expect(r.ok).toBe(false);
    expect(r.issues[0].message).toContain("已满");
    expect(r.xml).toBe(withChild);
  });
});
