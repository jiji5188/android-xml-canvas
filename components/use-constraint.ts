// components/use-constraint.ts — M366 step17（路线 2 拆解）：ConstraintLayout 约束编辑域
//
// 从 XmlEditor.tsx 抽出（原 ~1245-1370 区域）：
//   autoNotes（state）/ commitMany / onConstraintDraw / runAutoConstrain / clearConstraints
//
// 依赖壳 derived（selectedPath/xml/treeRoot/selectedParent/model/shortTag/SCALE 等）+ 纯 lib。
// deps-getter + 延迟 Proxy（与 use-canvas-ops.ts 同款）。
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { writebackAttrs } from "@/lib/xml/writeback";
import { findNode } from "@/lib/xml/parser";
import { collectIds, findResolvedNode } from "@/lib/xml/paths";
import { autoConstrain, nextViewId, type SibInfo } from "@/lib/xml/autoconstrain";
import { boxOf } from "@/lib/xml/geom";
import type { XmlNode, ResolvedNode } from "@/lib/xml/types";

export interface ConstraintDeps {
  selectedPath: string | null;
  xml: string;
  setXmlAndTrack: (next: string, mergeKey?: string) => void;
  treeRoot: XmlNode | null;
  selectedParent: XmlNode | null;
  selectedNode: ResolvedNode | null;
  model: { root?: ResolvedNode } | null;
  shortTag: (t: string) => string;
  SCALE: number;
}

export interface ConstraintResult {
  autoNotes: string[];
  setAutoNotes: React.Dispatch<React.SetStateAction<string[]>>;
  commitMany: (changes: [string, string | null][]) => void;
  onConstraintDraw: (
    childPath: string,
    side: "start" | "end" | "top" | "bottom",
    targetPath: string,
    targetSide: "start" | "end" | "top" | "bottom",
  ) => void;
  runAutoConstrain: () => void;
  clearConstraints: () => void;
}

export function useConstraint(selectedPath: string | null, getDeps: () => ConstraintDeps): ConstraintResult {
  const depsRef = useRef<ConstraintDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as ConstraintDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /* ===== ConstraintLayout 约束编辑（一期：表单 + 自动推断） ===== */
  const [autoNotes, setAutoNotes] = useState<string[]>([]);
  useEffect(() => setAutoNotes([]), [selectedPath]);

  const commitMany = (changes: [string, string | null][]) => {
    if (!selectedPath) return;
    const set: Record<string, string> = {};
    const del: string[] = [];
    for (const [k, v] of changes) {
      if (v === null) del.push(k);
      else set[k] = v;
    }
    if (Object.keys(set).length === 0 && del.length === 0) return;
    const res = writebackAttrs(D.xml, selectedPath, set, del);
    if (res.changed) D.setXmlAndTrack(res.xml);
  };

  /**
   * M2c：画布拖手柄建约束。
   * side=被拖的子控件边；targetPath="CL" 表示父容器，否则是兄弟节点 path。
   * 写入 app:layout_constraint<Side>_to<TargetSide>Of，并清掉同侧另一种写法。
   */
  const onConstraintDraw = (
    childPath: string,
    side: "start" | "end" | "top" | "bottom",
    targetPath: string,
    targetSide: "start" | "end" | "top" | "bottom",
  ) => {
    const Cap = (s2: string) => s2.charAt(0).toUpperCase() + s2.slice(1);
    const attrKey = `layout_constraint${Cap(side)}_to${Cap(targetSide)}Of`;
    const marginKey =
      side === "start" ? "layout_marginStart" : side === "end" ? "layout_marginEnd" : side === "top" ? "layout_marginTop" : "layout_marginBottom";
    // 同侧另一种写法（toStartOf vs toEndOf）必须清掉，否则过度约束
    const otherKey =
      side === "start"
        ? `layout_constraintStart_to${targetSide === "start" ? "End" : "Start"}Of`
        : side === "end"
          ? `layout_constraintEnd_to${targetSide === "start" ? "End" : "Start"}Of`
          : side === "top"
            ? `layout_constraintTop_to${targetSide === "top" ? "Bottom" : "Top"}Of`
            : `layout_constraintBottom_to${targetSide === "top" ? "Bottom" : "Top"}Of`;

    let ref = "parent";
    let xml2 = D.xml;
    let targetIdToWrite: [string, string] | null = null;

    if (targetPath !== "CL") {
      const tn: XmlNode | null = D.treeRoot ? findNode(D.treeRoot, targetPath) : null;
      const tid = tn ? (tn.attrs.id ?? "").trim() : "";
      if (tid) {
        ref = tid;
      } else if (tn) {
        // 目标没 id：同一次操作里补一个
        const nid = nextViewId(collectIds(D.treeRoot, []));
        ref = nid;
        targetIdToWrite = [nid, targetPath];
      }
    }

    const childNode: XmlNode | null = D.treeRoot ? findNode(D.treeRoot, childPath) : null;
    if (!childNode) return;
    const changes: [string, string | null][] = [[attrKey, ref], [otherKey, null]];
    // 该侧没 margin 时给 8dp，和插入控件时的默认约束保持一致
    if (childNode.attrs[marginKey] === undefined && childNode.attrs["layout_margin"] === undefined) {
      changes.push([marginKey, "8dp"]);
    }

    if (targetIdToWrite) {
      const r0 = writebackAttrs(xml2, targetIdToWrite[1], { id: targetIdToWrite[0] }, []);
      if (r0.changed) xml2 = r0.xml;
    }
    const set: Record<string, string> = {};
    const del: string[] = [];
    for (const [k, v] of changes) {
      if (v === null) del.push(k);
      else set[k] = v;
    }
    const r = writebackAttrs(xml2, childPath, set, del);
    if (r.changed) D.setXmlAndTrack(r.xml);
  };

  /** 自动约束：按当前渲染位置就近推断（无约束时智能堆叠） */
  const runAutoConstrain = () => {
    if (!selectedPath || !D.selectedParent || !D.model) return;
    const nodeRes = findResolvedNode(D.model.root, selectedPath);
    const parentRes = findResolvedNode(D.model.root, D.selectedParent.path);
    const box = boxOf(nodeRes);
    const pbox = boxOf(parentRes);
    if (!box || !pbox) {
      setAutoNotes([tt("该控件还拿不到布局坐标，先切到预览看一眼再试")]);
      return;
    }
    const attrs = { ...(nodeRes?.rawAttrs ?? {}) };
    const changes: [string, string | null][] = [];
    if (!attrs.id) {
      const ids = collectIds(D.treeRoot, []);
      const nid = nextViewId(ids);
      attrs.id = nid;
      changes.push(["id", nid]);
    }

    const sibs: SibInfo[] = [];
    for (const c of D.selectedParent.children) {
      if (c.path === selectedPath) continue;
      if (!c.attrs.id) continue;
      const rb = boxOf(findResolvedNode(D.model.root, c.path));
      if (!rb) continue;
      sibs.push({ ref: c.attrs.id, tag: D.shortTag(c.tag), box: rb });
    }
    const idx = D.selectedParent.children.findIndex((c) => c.path === selectedPath);
    const prevNode = idx > 0 ? D.selectedParent.children[idx - 1] : null;
    const prev = prevNode && prevNode.attrs.id ? sibs.find((s) => s.ref === prevNode.attrs.id) ?? null : null;

    const res = autoConstrain({ attrs, box, parent: pbox, siblings: sibs, prev, scale: D.SCALE });
    commitMany([...changes, ...res.changes]);
    setAutoNotes(res.notes);
  };

  /** 清除该控件所有约束 */
  const clearConstraints = () => {
    if (!D.selectedNode) return;
    const del = Object.keys(D.selectedNode.rawAttrs).filter((k) => k.startsWith("layout_constraint"));
    if (del.length === 0) return;
    commitMany(del.map((k) => [k, null] as [string, null]));
    setAutoNotes([]);
  };

  return { autoNotes, setAutoNotes, commitMany, onConstraintDraw, runAutoConstrain, clearConstraints };
}
