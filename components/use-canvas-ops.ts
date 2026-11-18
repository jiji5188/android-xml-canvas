// components/use-canvas-ops.ts — M366 step12（路线 2 拆解）：画布编辑操作域
//
// 从 XmlEditor.tsx 抽出（原 ~1537-1810 区域）：
//   onChangeXmlText（手敲防抖）/ onRenameAsset/onDeleteAsset/assetsNote（资源）/
//   insertWidget/onDropWidget/onDrop（控件插入）/ structureBroken/onMoveSibling/onDragMoveNode（层级）/
//   onRemoveNode / commitAttr+commitAttrRef（属性回写）/ onGeometryChange（几何）/ removeAttr/addAttr
//
// deps-getter + 延迟 Proxy（与 use-xml-project-fns.ts 同款）：壳内 liveXmlRef/xmlSyncTimer/textTimer 等
// 声明晚于本 hook 调用点，渲染期不 evaluate getter，回调执行时才解引用。纯 lib 直接 import。
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { renameAsset, renameReferences } from "@/lib/xml/asset-refs";
import { defaultFor } from "./attr-catalog";
import {
  insertChild, insertSiblingAfter, insertAt, moveSibling, applyConstraintDefaults, canAcceptChild, childLimitOf,
} from "@/lib/xml/insert";
import { moveNodeRaw, scanElements } from "@/lib/xml/reorder";
import { parseLayoutXml, findNode, serialize } from "@/lib/xml/parser";
import { findResolvedNode, splitPath, stripNs } from "@/lib/xml/paths";
import { writebackAttrs } from "@/lib/xml/writeback";
import { t as tt } from "@/lib/i18n-src";
import { WIDGET_MAP, DRAG_WIDGET_MIME, type WidgetDef } from "./widget-catalog";
import type { ResolvedNode, XmlNode } from "@/lib/xml/types";

export interface CanvasOpsDeps {
  // 编辑核心共享（E）
  xml: string;
  setXml: (v: string) => void;
  setXmlAndTrack: (next: string, mergeKey?: string) => void;
  flushTextTimer: () => void;
  commitHistory: (next: string, mergeKey?: string) => void;
  liveXmlRef: React.MutableRefObject<string | null>;
  xmlSyncTimer: React.MutableRefObject<number | null>;
  textTimer: React.MutableRefObject<number | null>;
  // 选中
  selectedPath: string | null;
  setSelectedPath: (v: string | null) => void;
  // 资源
  generatedDrawables: Record<string, string>;
  setGeneratedDrawables: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  // 提示
  setExportNote: (v: string) => void;
  // 拖放
  setDropHint: (v: string | null) => void;
}

export interface CanvasOpsResult {
  onChangeXmlText: (next: string) => void;
  onRenameAsset: (oldName: string, newName: string) => void;
  onDeleteAsset: (name: string) => void;
  assetsNote: (text: string) => void;
  insertWidget: (w: WidgetDef) => void;
  onDropWidget: (path: string, key: string, isContainer: boolean) => void;
  onDrop: (e: React.DragEvent) => void;
  structureBroken: () => boolean;
  onMoveSibling: (targetPath: string, toIndex: number) => void;
  onDragMoveNode: (fromPath: string, target: { path: string; zone: "before" | "inside" | "after" }) => void;
  onRemoveNode: (path: string) => void;
  commitAttr: (name: string, value: string) => void;
  commitAttrRef: React.MutableRefObject<(name: string, value: string) => void>;
  onGeometryChange: (path: string, g: { x?: number; y?: number; w?: number; h?: number }) => void;
  removeAttr: (name: string) => void;
  addAttr: (name: string) => void;
}

export function useCanvasOps(getDeps: () => CanvasOpsDeps): CanvasOpsResult {
  const depsRef = useRef<CanvasOpsDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as CanvasOpsDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** 手敲代码：最新文本先进 ref（不阻塞输入），状态防抖 250ms 落一次，历史 500ms 合并 */
  const onChangeXmlText = useCallback(
    (next: string) => {
      D.liveXmlRef.current = next;
      if (D.xmlSyncTimer.current !== null) window.clearTimeout(D.xmlSyncTimer.current);
      D.xmlSyncTimer.current = window.setTimeout(() => {
        D.xmlSyncTimer.current = null;
        const v = D.liveXmlRef.current;
        if (v !== null) D.setXml(v);
      }, 250);
      D.flushTextTimer();
      D.textTimer.current = window.setTimeout(() => {
        D.textTimer.current = null;
        D.commitHistory(next);
      }, 500);
    },
    [D],
  );

  /** M5b：资源改名 —— 同步改布局里的 @drawable/x 引用（依赖 setXmlAndTrack，故定义在此） */
  const onRenameAsset = (oldName: string, newName: string) => {
    const next = renameAsset(D.generatedDrawables, oldName, newName);
    if (!next) return;
    D.setGeneratedDrawables(next);
    if (D.xml.includes(`@drawable/${oldName}`) || D.xml.includes(`@mipmap/${oldName}`)) {
      D.setXmlAndTrack(renameReferences(D.xml, oldName, newName));
    }
  };

  /** M5b：删除生成资源（布局里的引用变成缺失资源占位） */
  const onDeleteAsset = (name: string) => {
    D.setGeneratedDrawables((m) => {
      if (!(name in m)) return m;
      const next = { ...m };
      delete next[name];
      return next;
    });
  };

  /** 资源面板 / 图标选完后的提示条 */
  const assetsNote = (text: string) => {
    D.setExportNote(text);
    window.setTimeout(() => D.setExportNote(" "), 3600);
  };

  const insertWidget = (w: WidgetDef) => {
    const frag = stripNs(w.xml);
    const { root } = parseLayoutXml(D.xml);
    const targetNode = D.selectedPath && D.selectedPath !== "#0" && root ? findNode(root, D.selectedPath) : null;
    // 优先：选中的是容器且还能接收子控件 → 插入为它的子节点
    if (targetNode) {
      const chk = canAcceptChild(targetNode.tag, targetNode.children.length);
      if (chk.ok) {
        const res = insertChild(D.xml, D.selectedPath!, frag, w.label);
        if (res.ok) {
          const withDef = res.insertedPath ? applyConstraintDefaults(res.xml, res.insertedPath) : res.xml;
          D.setXmlAndTrack(withDef);
          if (res.insertedPath) D.setSelectedPath(res.insertedPath);
          return;
        }
        // 插入失败（理论上 chk.ok 时不会，但保险）：提示后退回兄弟插入
        D.setExportNote(res.issues[0]?.message || tt("插入失败"));
        window.setTimeout(() => D.setExportNote(""), 3000);
      } else {
        // 选中叶子节点 / 单 child 容器已满 → 作为兄弟插到它后面
        const res = insertSiblingAfter(D.xml, D.selectedPath!, frag, w.label);
        if (res.ok) {
          const withDef = res.insertedPath ? applyConstraintDefaults(res.xml, res.insertedPath) : res.xml;
          D.setXmlAndTrack(withDef);
          if (res.insertedPath) D.setSelectedPath(res.insertedPath);
          return;
        }
        D.setExportNote(res.issues[0]?.message || tt("插入失败"));
        window.setTimeout(() => D.setExportNote(""), 3000);
        return;
      }
    }
    // 无选中 / 选中是根节点 / 选中叶子但兄弟插入失败 → 插入到根末尾
    const res = insertChild(D.xml, "#0", frag, w.label);
    if (res.ok) {
      const withDef = res.insertedPath ? applyConstraintDefaults(res.xml, res.insertedPath) : res.xml;
      D.setXmlAndTrack(withDef);
      if (res.insertedPath) D.setSelectedPath(res.insertedPath);
    } else if (res.issues[0]) {
      D.setExportNote(res.issues[0].message);
      window.setTimeout(() => D.setExportNote(""), 3000);
    }
  };

  /** 画布拖放：落到容器上→校验能否接收后追加为子节点；落到叶子→插到它后面作为兄弟 */
  const onDropWidget = (path: string, key: string, isContainer: boolean) => {
    const w = WIDGET_MAP[key];
    if (!w) return;
    const frag = stripNs(w.xml);
    if (isContainer) {
      const { root } = parseLayoutXml(D.xml);
      const target = root ? findNode(root, path) : null;
      // 校验：该容器还能接收子控件吗？
      if (target) {
        const chk = canAcceptChild(target.tag, target.children.length);
        if (!chk.ok) {
          D.setExportNote(chk.reason || tt("无法插入"));
          window.setTimeout(() => D.setExportNote(""), 3000);
          return;
        }
      }
      const r = insertAt(D.xml, path, target ? target.children.length : 0, frag, w.label);
      if (r.ok) {
        const withDef = r.insertedPath ? applyConstraintDefaults(r.xml, r.insertedPath) : r.xml;
        D.setXmlAndTrack(withDef);
        if (r.insertedPath) D.setSelectedPath(r.insertedPath);
      } else if (r.issues[0]) {
        D.setExportNote(r.issues[0].message);
        window.setTimeout(() => D.setExportNote(""), 3000);
      }
      return;
    }
    const r = insertSiblingAfter(D.xml, path, frag, w.label);
    if (r.ok) {
      const withDef = r.insertedPath ? applyConstraintDefaults(r.xml, r.insertedPath) : r.xml;
      D.setXmlAndTrack(withDef);
      if (r.insertedPath) D.setSelectedPath(r.insertedPath);
    } else if (r.issues[0]) {
      D.setExportNote(r.issues[0].message);
      window.setTimeout(() => D.setExportNote(""), 3000);
    }
  };

  /** 画布空白处拖放（手机屏背景）：追加到根末尾 */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData(DRAG_WIDGET_MIME);
    D.setDropHint(null);
    if (!key) return;
    const w = WIDGET_MAP[key];
    if (w) insertWidget(w);
  };

  /** 结构自检：标签没闭合 / 有多个根时，按 path 切片会切到错的区间（历史上因此丢节点、重复节点）。
   *  这种时候宁可不改，也不要把文档弄得更乱——顺手把提示挂在底部提示条上。 */
  const structureBroken = (): boolean => {
    const root = scanElements(D.xml);
    const broken = !root || !!D.xml.slice(root.end).trim();
    if (broken) D.setExportNote(tt("当前 XML 结构不完整（有标签没闭合），层级调整已暂停；请先在代码里补齐闭合标签"));
    return broken;
  };

  const onMoveSibling = (targetPath: string, toIndex: number) => {
    if (structureBroken()) return;
    const r = moveSibling(D.xml, targetPath, toIndex);
    if (r.ok) {
      D.setXmlAndTrack(r.xml);
      if (r.newPath) D.setSelectedPath(r.newPath);
    }
  };

  /** M3d：拖拽调整层级（三种落点：上一兄弟 / 作为子项 / 下一兄弟） */
  const onDragMoveNode = (fromPath: string, target: { path: string; zone: "before" | "inside" | "after" }) => {
    if (structureBroken()) return;
    const { root } = parseLayoutXml(D.xml);
    if (!root) return;
    const targetNode = findNode(root, target.path);
    if (!targetNode) return;

    const segs = target.path.replace(/^#/, "").split("/");
    const targetIndex = Number(segs[segs.length - 1]);
    const targetParent = "#" + segs.slice(0, -1).join("/");

    let parentPath: string;
    let index: number;
    let maxChildren: number | undefined;

    if (target.zone === "inside") {
      parentPath = target.path;
      index = targetNode.children.length;
      maxChildren = childLimitOf(targetNode.tag);
    } else {
      parentPath = targetParent;
      index = target.zone === "before" ? targetIndex : targetIndex + 1;
      const parentNode = findNode(root, targetParent);
      maxChildren = parentNode ? childLimitOf(parentNode.tag) : undefined;
    }

    const r = moveNodeRaw(D.xml, fromPath, { parentPath, index, maxChildren });
    if (r.ok) {
      D.setXmlAndTrack(r.xml);
      if (r.newPath) D.setSelectedPath(r.newPath);
    } else if (r.issues.length) {
      D.setExportNote(r.issues[0].message);
    }
  };

  const onRemoveNode = (path: string) => {
    if (path === "#0") return;
    const { parentPath, index } = splitPath(path);
    const { root } = parseLayoutXml(D.xml);
    if (!root) return;
    const parent = findNode(root, parentPath);
    if (!parent) return;
    parent.children.splice(index, 1);
    for (let i = 0; i < parent.children.length; i++) {
      const fix = (n: XmlNode, p: string) => {
        n.path = p;
        n.children.forEach((c, j) => fix(c, `${p}/${j}`));
      };
      fix(parent.children[i], `${parentPath}/${i}`);
    }
    const out = serialize(root);
    const decl = D.xml.match(/^<\?xml[\s\S]*?\?>/i);
    D.setXmlAndTrack((decl ? decl[0] + "\n" : "") + out);
    D.setSelectedPath(null);
  };

  // ===== 属性回写（M1b 双向）=====
  const commitAttrRef = useRef<(name: string, value: string) => void>(() => {});
  const commitAttr = (name: string, value: string) => {
    if (!D.selectedPath) return;
    // 设四周边距简写 layout_margin 时，顺手清掉可能残留的单边 margin（Start/End/Left/Right/Top/Bottom）。
    // 否则单边值会覆盖简写（Android 语义）→ 视觉上左右间隙不对称，非常迷惑。
    const remove: string[] = [];
    if (name === "layout_margin") {
      remove.push(
        "layout_marginTop",
        "layout_marginBottom",
        "layout_marginStart",
        "layout_marginEnd",
        "layout_marginLeft",
        "layout_marginRight",
      );
    }
    // 反之：单独设某一边时，若简写存在也不动它（单边优先，符合 Android 语义）
    const r = writebackAttrs(D.xml, D.selectedPath, { [name]: value }, remove);
    // M2u：属性面板连续改同一属性（拖动滑杆/输入）合并成一步撤销
    if (r.changed) D.setXmlAndTrack(r.xml, `attr:${D.selectedPath}:${name}`);
  };
  commitAttrRef.current = commitAttr;

  /** M2d：画布自由拖动 / 四角拉伸 → 写回 layout_marginStart/Top（XY）或 layout_width/height（宽高，dp）
   *  move 手柄只改 x/y（不碰 w/h）；四角 resize 只改 w/h（不碰 x/y） */
  const onGeometryChange = (
    path: string,
    g: { x?: number; y?: number; w?: number; h?: number },
  ) => {
    const r1 = (n: number) => Math.round(n);
    const set: Record<string, string> = {};
    if (g.x !== undefined) set.layout_marginStart = `${r1(g.x)}dp`;
    if (g.y !== undefined) set.layout_marginTop = `${r1(g.y)}dp`;
    if (g.w !== undefined) set.layout_width = `${r1(g.w)}dp`;
    if (g.h !== undefined) set.layout_height = `${r1(g.h)}dp`;
    if (Object.keys(set).length === 0) return;
    const r = writebackAttrs(D.xml, path, set, []);
    // M2u：同一节点连续拖动/拉伸（900ms 内）合并成一步撤销；换节点则重新计数
    if (r.changed) D.setXmlAndTrack(r.xml, `geom:${path}`);
  };

  const removeAttr = (name: string) => {
    if (!D.selectedPath) return;
    const r = writebackAttrs(D.xml, D.selectedPath, {}, [name]);
    if (r.changed) D.setXmlAndTrack(r.xml);
  };

  const addAttr = (name: string) => {
    if (!D.selectedPath) return;
    const r = writebackAttrs(D.xml, D.selectedPath, { [name]: defaultFor(name) });
    if (r.changed) D.setXmlAndTrack(r.xml);
  };

  return {
    onChangeXmlText, onRenameAsset, onDeleteAsset, assetsNote,
    insertWidget, onDropWidget, onDrop,
    structureBroken, onMoveSibling, onDragMoveNode,
    onRemoveNode, commitAttr, commitAttrRef, onGeometryChange, removeAttr, addAttr,
  };
}
