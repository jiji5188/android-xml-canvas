// components/XmlEditor.tsx — M1a 主入口（v4：桌面端按 M3E 原版三栏布局拓展功能 + 移动端 75% 侧滑 + 蒙版）
// 桌面：左 320 停靠（52px 图标条：组件/图层 + 代码/资源）| 中间画布 | 右 320 属性
// 工具栏：☰ 撤销 重做 打开 保存（中段），最右 ⇔ 属性
// 移动端（≤840px 或粗指针+≤1024px）：两侧滑面板宽 75vw，背后加蒙版，点蒙版关闭；
// 画布区顶部 tab 切换 XML 代码 / 预览

"use client";

import { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue } from "react";
import { parseLayoutXml, findNode, serialize } from "@/lib/xml/parser";
import { buildRenderModel } from "@/lib/xml/css";
import { mergeResourceFragment, DEFAULT_RESOURCES } from "@/lib/xml/resources";
import type { ResolvedNode, ResourceTable, XmlNode } from "@/lib/xml/types";
import { writebackAttrs } from "@/lib/xml/writeback";
import { insertChild, insertSiblingAfter, insertAt, moveSibling, isContainerTag, applyConstraintDefaults } from "@/lib/xml/insert";
import { formatXml } from "@/lib/xml/format";
import { lintXml } from "@/lib/xml/lint";
import { XmlCanvas } from "./XmlCanvas";
import { XmlCodeEditor } from "./XmlCodeEditor";
import { AttrPanel } from "./AttrPanel";
import { AddAttrModal } from "./AddAttrModal";
import { defaultFor } from "./attr-catalog";
import { WidgetPalette } from "./WidgetPalette";
import { ConstraintPanel, type SibOption } from "./ConstraintPanel";
import { autoConstrain, hasConstraints, nextViewId, type CBox, type SibInfo } from "@/lib/xml/autoconstrain";
import { LayerTree } from "./LayerTree";
import { WIDGET_MAP, DRAG_WIDGET_MIME, type WidgetDef } from "./widget-catalog";
import "./xml-canvas.css";

const SAMPLES: Record<string, string> = {
  cl: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#FFFFFF">

  <TextView
      android:id="@+id/tvTitle"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="约束布局示例"
      android:textSize="20sp"
      android:textStyle="bold"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toTopOf="parent" />

  <TextView
      android:id="@+id/tvSub"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="8dp"
      android:text="选中控件后在右侧编辑四条边的约束"
      android:textColor="#6B7280"
      android:textSize="13sp"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/tvTitle" />

  <View
      android:id="@+id/bar"
      android:layout_width="0dp"
      android:layout_height="120dp"
      android:layout_marginStart="16dp"
      android:layout_marginTop="20dp"
      android:layout_marginEnd="16dp"
      android:background="#E8EEFA"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/tvSub" />

  <Button
      android:id="@+id/btnOk"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginEnd="16dp"
      android:layout_marginBottom="24dp"
      android:text="确定"
      app:layout_constraintBottom_toBottomOf="parent"
      app:layout_constraintEnd_toEndOf="parent" />

  <TextView
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="我没约束（选中我点「自动约束」）"
      android:textSize="13sp" />

</androidx.constraintlayout.widget.ConstraintLayout>`,
  list: `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@color/card_bg"
    android:padding="16dp">

  <TextView
      android:id="@+id/tvTitle"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:text="@string/app_name"
      android:textSize="18sp"
      android:textStyle="bold"/>

  <View
      android:layout_width="match_parent"
      android:layout_height="1dp"
      android:layout_marginTop="8dp"
      android:background="@color/divider"/>

  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="16dp"
      android:padding="12dp"
      android:text="项目一"/>

  <Button
      android:id="@+id/btnConfirm"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="24dp"
      android:text="@string/button_ok"
      android:background="@color/primary"
      android:textColor="@color/white"/>
</LinearLayout>`,
};

const SCALE = 2; // 1dp = 2px

function findResolvedNode(root: ResolvedNode, path: string): ResolvedNode | null {
  if (root.path === path) return root;
  for (const c of root.children ?? []) {
    const r = findResolvedNode(c, path);
    if (r) return r;
  }
  return null;
}

/** 把 path 拆成父级 + 索引 */
function splitPath(path: string): { parentPath: string; index: number } {
  const segs = path.split("/").filter(Boolean);
  const index = Number(segs[segs.length - 1]);
  const parentPath = "#" + segs.slice(0, -1).join("/");
  return { parentPath, index };
}

/** 去掉片段里的 xmlns 声明（根节点已有；否则序列化会重复写） */
const stripNs = (frag: string) => frag.replace(/\s+xmlns:android="[^"]*"/g, "");

export function XmlEditor() {
  const [xml, setXml] = useState(SAMPLES.list);
  /** 解析用（低优先级）：敲代码时让输入不卡，解析滞后几帧 */
  const parsedXml = useDeferredValue(xml);
  const [resourceFragment, setResourceFragment] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftView, setLeftView] = useState<"parts" | "layers" | "code" | "res">("parts");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"preview" | "xml">("preview");
  const [history, setHistory] = useState<string[]>([SAMPLES.list]);
  const [histIdx, setHistIdx] = useState(0);

  /* ===== 撤销 / 重做 =====
     用 ref 存栈，避开 setState 异步导致连续操作串位置的问题。
     结构变更立即入栈；手动敲代码则防抖 500ms 合并成一步。 */
  const histRef = useRef<{ stack: string[]; idx: number }>({ stack: [SAMPLES.list], idx: 0 });
  const textTimer = useRef<number | null>(null);

  const syncHist = () => {
    setHistory(histRef.current.stack);
    setHistIdx(histRef.current.idx);
  };
  const commitHistory = useCallback((next: string) => {
    const h = histRef.current;
    if (h.stack[h.idx] === next) return;
    const kept = h.stack.slice(0, h.idx + 1);
    kept.push(next);
    const capped = kept.length > 60 ? kept.slice(kept.length - 60) : kept;
    histRef.current = { stack: capped, idx: capped.length - 1 };
    syncHist();
  }, []);
  const flushTextTimer = useCallback(() => {
    if (textTimer.current !== null) {
      window.clearTimeout(textTimer.current);
      textTimer.current = null;
    }
  }, []);

  const canUndo = histIdx > 0;
  const canRedo = histIdx < history.length - 1;
  const undo = () => {
    flushTextTimer();
    const h = histRef.current;
    if (h.idx <= 0) return;
    h.idx -= 1;
    setXml(h.stack[h.idx]);
    syncHist();
  };
  const redo = () => {
    flushTextTimer();
    const h = histRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx += 1;
    setXml(h.stack[h.idx]);
    syncHist();
  };

  // 移动端判定（与 M3E 原版同口径：max-width:840 或 粗指针且 max-width:1024）
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 840px), (pointer: coarse) and (max-width: 1024px)");
    const apply = () => {
      const m = mq.matches;
      setIsMobile(m);
      // 进移动端：两侧面板收起，默认看预览 tab
      if (m) {
        setLeftOpen(false);
        setRightOpen(false);
        setMobileTab("preview");
      } else {
        setLeftOpen(true);
        setRightOpen(true);
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const resources: ResourceTable = useMemo(
    () => (resourceFragment.trim() ? mergeResourceFragment(resourceFragment) : DEFAULT_RESOURCES),
    [resourceFragment],
  );

  const { model, issues, parseErr } = useMemo(() => {
    const { root, issues } = parseLayoutXml(parsedXml);
    if (!root) return { model: null, issues, parseErr: true };
    return { model: buildRenderModel(root, resources, SCALE), issues, parseErr: false };
  }, [parsedXml, resources]);

  /** 图层树用的原始节点树（不经渲染模型） */
  const treeRoot = useMemo(() => (parseErr ? null : parseLayoutXml(parsedXml).root), [parsedXml, parseErr]);

  /** 代码视图的结构检查（带行号，标红用） */
  const lints = useMemo(() => lintXml(parsedXml), [parsedXml]);

  /** 一键格式化：重排缩进，保留注释，可撤销 */
  const doFormat = () => {
    const next = formatXml(xml, 2);
    if (next !== xml) setXmlAndTrack(next);
  };

  /* ===== ConstraintLayout 约束编辑（一期：表单 + 自动推断） ===== */
  const [autoNotes, setAutoNotes] = useState<string[]>([]);
  useEffect(() => setAutoNotes([]), [selectedPath]);

  /** 选中节点的父节点（XmlNode） */
  const selectedParent = useMemo(() => {
    if (!selectedPath || selectedPath === "#0" || !treeRoot) return null;
    const segs = selectedPath.slice(1).split("/").filter(Boolean);
    return findNode(treeRoot, "#" + segs.slice(0, -1).join("/"));
  }, [selectedPath, treeRoot]);

  const isChildOfCL = !!selectedParent && shortTag(selectedParent.tag) === "ConstraintLayout";

  const clSiblings: SibOption[] = useMemo(() => {
    if (!isChildOfCL || !selectedParent) return [];
    return selectedParent.children
      .filter((c) => c.path !== selectedPath && !!c.attrs.id)
      .map((c) => ({
        ref: c.attrs.id as string,
        label: `${(c.attrs.id as string).replace(/^@\+?id\//, "")} · ${shortTag(c.tag)}`,
      }));
  }, [isChildOfCL, selectedParent, selectedPath]);

  /** 批量提交属性（一次 rewrite，历史里只算一步） */
  const commitMany = (changes: [string, string | null][]) => {
    if (!selectedPath) return;
    const set: Record<string, string> = {};
    const del: string[] = [];
    for (const [k, v] of changes) {
      if (v === null) del.push(k);
      else set[k] = v;
    }
    if (Object.keys(set).length === 0 && del.length === 0) return;
    const res = writebackAttrs(xml, selectedPath, set, del);
    if (res.changed) setXmlAndTrack(res.xml);
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
    let xml2 = xml;
    let targetIdToWrite: [string, string] | null = null;

    if (targetPath !== "CL") {
      const tn: XmlNode | null = treeRoot ? findNode(treeRoot, targetPath) : null;
      const tid = tn ? (tn.attrs.id ?? "").trim() : "";
      if (tid) {
        ref = tid;
      } else if (tn) {
        // 目标没 id：同一次操作里补一个
        const nid = nextViewId(collectIds(treeRoot, []));
        ref = nid;
        targetIdToWrite = [nid, targetPath];
      }
    }

    const childNode: XmlNode | null = treeRoot ? findNode(treeRoot, childPath) : null;
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
    if (r.changed) setXmlAndTrack(r.xml);
  };

  /** 自动约束：按当前渲染位置就近推断（无约束时智能堆叠） */
  const runAutoConstrain = () => {
    if (!selectedPath || !selectedParent || !model) return;
    const nodeRes = findResolved(model.root, selectedPath);
    const parentRes = findResolved(model.root, selectedParent.path);
    const box = boxOf(nodeRes);
    const pbox = boxOf(parentRes);
    if (!box || !pbox) {
      setAutoNotes(["该控件还拿不到布局坐标，先切到预览看一眼再试"]);
      return;
    }
    const attrs = { ...(nodeRes?.rawAttrs ?? {}) };
    const changes: [string, string | null][] = [];
    if (!attrs.id) {
      const ids = collectIds(treeRoot, []);
      const nid = nextViewId(ids);
      attrs.id = nid;
      changes.push(["id", nid]);
    }

    const sibs: SibInfo[] = [];
    for (const c of selectedParent.children) {
      if (c.path === selectedPath) continue;
      if (!c.attrs.id) continue;
      const rb = boxOf(findResolved(model.root, c.path));
      if (!rb) continue;
      sibs.push({ ref: c.attrs.id, tag: shortTag(c.tag), box: rb });
    }
    const idx = selectedParent.children.findIndex((c) => c.path === selectedPath);
    const prevNode = idx > 0 ? selectedParent.children[idx - 1] : null;
    const prev = prevNode && prevNode.attrs.id ? sibs.find((s) => s.ref === prevNode.attrs.id) ?? null : null;

    const res = autoConstrain({ attrs, box, parent: pbox, siblings: sibs, prev, scale: SCALE });
    commitMany([...changes, ...res.changes]);
    setAutoNotes(res.notes);
  };

  /** 清除该控件所有约束 */
  const clearConstraints = () => {
    if (!selectedNode) return;
    const del = Object.keys(selectedNode.rawAttrs).filter((k) => k.startsWith("layout_constraint"));
    if (del.length === 0) return;
    commitMany(del.map((k) => [k, null] as [string, null]));
    setAutoNotes([]);
  };

  // ===== 组件插入（点击 / 拖放）=====
  // 有选中节点：插到它的同级（兄弟）；否则插到根节点末尾
  const setXmlAndTrack = useCallback(
    (next: string) => {
      flushTextTimer();
      setXml(next);
      commitHistory(next);
    },
    [flushTextTimer, commitHistory],
  );

  /** 手敲代码：立即上屏，历史防抖 500ms 合并 */
  const onChangeXmlText = useCallback(
    (next: string) => {
      setXml(next);
      flushTextTimer();
      textTimer.current = window.setTimeout(() => {
        textTimer.current = null;
        commitHistory(next);
      }, 500);
    },
    [flushTextTimer, commitHistory],
  );

  const insertWidget = (w: WidgetDef) => {
    const frag = stripNs(w.xml);
    const target = selectedPath && selectedPath !== "#0" ? selectedPath : "#0";
    const res =
      target !== "#0"
        ? insertSiblingAfter(xml, target, frag, w.label)
        : insertChild(xml, "#0", frag, w.label);
    if (res.ok) {
      const withDef = res.insertedPath ? applyConstraintDefaults(res.xml, res.insertedPath) : res.xml;
      setXmlAndTrack(withDef);
      if (res.insertedPath) setSelectedPath(res.insertedPath);
    }
  };

  /** 画布拖放：容器→追加为子节点；普通控件→插到它后面作为兄弟 */
  const onDropWidget = (path: string, key: string, isContainer: boolean) => {
    const w = WIDGET_MAP[key];
    if (!w) return;
    const frag = stripNs(w.xml);
    if (isContainer) {
      const { root } = parseLayoutXml(xml);
      const target = root ? findNode(root, path) : null;
      const r = insertAt(xml, path, target ? target.children.length : 0, frag, w.label);
      if (r.ok) {
        const withDef = r.insertedPath ? applyConstraintDefaults(r.xml, r.insertedPath) : r.xml;
        setXmlAndTrack(withDef);
        if (r.insertedPath) setSelectedPath(r.insertedPath);
      }
      return;
    }
    const r = insertSiblingAfter(xml, path, frag, w.label);
    if (r.ok) {
      const withDef = r.insertedPath ? applyConstraintDefaults(r.xml, r.insertedPath) : r.xml;
      setXmlAndTrack(withDef);
      if (r.insertedPath) setSelectedPath(r.insertedPath);
    }
  };

  /** 画布空白处拖放（手机屏背景）：追加到根末尾 */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const key = e.dataTransfer.getData(DRAG_WIDGET_MIME);
    setDropHint(null);
    if (!key) return;
    const w = WIDGET_MAP[key];
    if (w) insertWidget(w);
  };

  // ===== 图层操作 =====
  const onMoveSibling = (targetPath: string, toIndex: number) => {
    const r = moveSibling(xml, targetPath, toIndex);
    if (r.ok) {
      setXmlAndTrack(r.xml);
      if (r.newPath) setSelectedPath(r.newPath);
    }
  };

  const onRemoveNode = (path: string) => {
    if (path === "#0") return;
    const { parentPath, index } = splitPath(path);
    const { root } = parseLayoutXml(xml);
    if (!root) return;
    const parent = findNode(root, parentPath);
    if (!parent) return;
    parent.children.splice(index, 1);
    for (let i = 0; i < parent.children.length; i++) {
      const fix = (n: import("@/lib/xml/types").XmlNode, p: string) => {
        n.path = p;
        n.children.forEach((c, j) => fix(c, `${p}/${j}`));
      };
      fix(parent.children[i], `${parentPath}/${i}`);
    }
    const out = serialize(root);
    const decl = xml.match(/^<\?xml[\s\S]*?\?>/i);
    setXmlAndTrack((decl ? decl[0] + "\n" : "") + out);
    setSelectedPath(null);
  };

  // ===== 属性回写（M1b 双向）=====
  const commitAttr = (name: string, value: string) => {
    if (!selectedPath) return;
    const r = writebackAttrs(xml, selectedPath, { [name]: value });
    if (r.changed) setXmlAndTrack(r.xml);
  };

  const removeAttr = (name: string) => {
    if (!selectedPath) return;
    const r = writebackAttrs(xml, selectedPath, {}, [name]);
    if (r.changed) setXmlAndTrack(r.xml);
  };

  const addAttr = (name: string) => {
    if (!selectedPath) return;
    const r = writebackAttrs(xml, selectedPath, { [name]: defaultFor(name) });
    if (r.changed) setXmlAndTrack(r.xml);
  };

  const selectedNode: ResolvedNode | null = useMemo(() => {
    if (!selectedPath || !model) return null;
    return findResolvedNode(model.root, selectedPath);
  }, [selectedPath, model]);

  const widthPx = Math.round(412 * SCALE * scale);
  const heightPx = Math.round(892 * SCALE * scale);

  /** 窄屏：把 824px 的机屏等比缩到可视宽度内（保留 dp→px 内部尺寸不变） */
  const [vw, setVw] = useState(0);
  useEffect(() => {
    const onResize = () => setVw(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const fitRatio = (() => {
    if (!vw) return 1;
    const panels = isMobile ? 0 : (leftOpen ? 320 : 0) + (rightOpen ? 320 : 0);
    const avail = vw - panels - (isMobile ? 28 : 48);
    return Math.min(1, avail / widthPx);
  })();

  function shortTag(t: string): string {
  return t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t;
}

/** style 里的 "123px" / 123 → 数字；百分比、auto 返回 null */
const pxNum = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "").trim();
  if (/^-?[0-9.]+$/.test(s)) return parseFloat(s);
  const m = /^(-?[0-9.]+)px$/.exec(s);
  return m ? parseFloat(m[1]) : null;
};

/** 从渲染模型取绝对盒子（仅当 style 里有 px 定位，即 ConstraintLayout 子项） */
function boxOf(n: ResolvedNode | null | undefined): CBox | null {
  if (!n) return null;
  const width = pxNum(n.style.width);
  const height = pxNum(n.style.height);
  if (width === null || height === null) return null;
  // 未约束的 CL 子项没有 left/top（按静态位置渲染）→ 当 0 处理
  const left = pxNum(n.style.left) ?? 0;
  const top = pxNum(n.style.top) ?? 0;
  return { left, top, width, height };
}

/** 在渲染模型里按 path 找节点 */
function findResolved(n: ResolvedNode, path: string): ResolvedNode | null {
  if (n.path === path) return n;
  for (const c of n.children) {
    const f = findResolved(c, path);
    if (f) return f;
  }
  return null;
}

/** 收集全文档的 id 引用（生成不重复 id 用） */
function collectIds(n: { attrs: Record<string, string>; children: unknown[] } | null, out: string[]): string[] {
  if (!n) return out;
  if (n.attrs.id) out.push(n.attrs.id);
  for (const c of n.children as { attrs: Record<string, string>; children: unknown[] }[]) collectIds(c, out);
  return out;
}
  const openProject = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
      f.text().then((txt) => setXmlAndTrack(txt));
    };
    input.click();
  };

  const saveProject = () => {
    const blob = new Blob([xml], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "layout.xml";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="axv-editor">
      <div className="axv-main">
      {/* 移动端：两侧滑面板背后的蒙版（点蒙版关闭对应面板） */}
      {isMobile && leftOpen && (
        <div className="axv-backdrop" onClick={() => setLeftOpen(false)} aria-hidden="true" />
      )}
      {isMobile && rightOpen && (
        <div className="axv-backdrop" onClick={() => setRightOpen(false)} aria-hidden="true" />
      )}

      {/* 画布区顶部 tab 切换「预览 / XML 代码」（桌面 + 移动端均可用） */}
      {(!isMobile || (!leftOpen && !rightOpen)) && (
        <div className="axv-mob-tabs" role="tablist" aria-label="视图">
          <button
            role="tab"
            aria-selected={mobileTab === "preview"}
            className={mobileTab === "preview" ? "on" : ""}
            onClick={() => setMobileTab("preview")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>phone_android</span>
            预览
          </button>
          <button
            role="tab"
            aria-selected={mobileTab === "xml"}
            className={mobileTab === "xml" ? "on" : ""}
            onClick={() => setMobileTab("xml")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code</span>
            XML 代码
          </button>
        </div>
      )}

      {/* 画布舞台 */}
      {mobileTab === "preview" && (
        <div className={"axv-stage" + (leftOpen ? " pad-l" : "") + (rightOpen ? " pad-r" : "")}>
          {parseErr ? (
            <div className="axv-canvas-empty">XML 解析失败，请检查结构</div>
          ) : model ? (
            <div
              style={{
                width: widthPx * fitRatio,
                height: heightPx * fitRatio,
                flex: "0 0 auto",
              }}
            >
            <div
              className={"axv-phone" + (dropHint ? " axv-drop-target" : "")}
              style={{
                width: widthPx,
                minHeight: heightPx,
                background: model.root.style.background || model.root.style.backgroundColor || "#fff",
                transform: fitRatio < 1 ? `scale(${fitRatio})` : undefined,
                transformOrigin: "top left",
              }}
              onDragOver={(e) => {
                if (e.dataTransfer.types.includes(DRAG_WIDGET_MIME)) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "copy";
                  setDropHint("drop");
                }
              }}
              onDragLeave={() => setDropHint(null)}
              onDrop={onDrop}
            >
              <XmlCanvas
                node={model.root}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onDropWidget={onDropWidget}
                onConstraintDraw={onConstraintDraw}
              />
            </div>
            </div>
          ) : null}
          {issues.length > 0 && (
            <div className="axv-issues">
              <strong>{issues.length} 条提示：</strong>
              {issues.slice(0, 8).map((i, idx) => (
                <div key={idx}>[{i.level}] {i.nodePath} {i.message}</div>
              ))}
              {issues.length > 8 && <div>… 共 {issues.length} 条</div>}
            </div>
          )}
        </div>
      )}

      {/* XML 代码视图（tab 切过来的全屏编辑器） */}
      {mobileTab === "xml" && (
        <div
          className="axv-mob-xml"
          style={
            isMobile
              ? undefined
              : {
                  left: (leftOpen ? 320 : 0) + 16,
                  right: (rightOpen ? 320 : 0) + 16,
                  transition: "left 0.22s, right 0.22s",
                }
          }
        >
          <XmlCodeEditor
            className="axv-code-fill"
            value={xml}
            onChange={onChangeXmlText}
            errors={lints}
          />
          <div className="axv-mob-xml-tools">
            <button className="axv-mob-tool-btn axv-ghost" onClick={doFormat} title="重排缩进（保留注释）">
              格式化
            </button>
            <select
              className="axv-tb-select"
              title="载入示例"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (v && SAMPLES[v]) setXmlAndTrack(SAMPLES[v]);
              }}
            >
              <option value="">示例…</option>
              <option value="cl">约束布局</option>
              <option value="list">竖列表</option>
            </select>
            <button className="axv-mob-tool-btn" onClick={saveProject} title="保存">保存</button>
          </div>
        </div>
      )}

      {/* 左侧滑面板：52px 图标条 + 内容列（M3E 同款布局；移动端宽 75vw） */}
      <aside className={"axv-slide-left" + (leftOpen ? " axv-open" : "")}>
        <div className="axv-rail">
          <button
            className={"axv-rail-btn" + (leftView === "parts" ? " on" : "")}
            title="组件"
            aria-label="组件"
            aria-pressed={leftView === "parts"}
            onClick={() => {
              setLeftView("parts");
              setLeftOpen(true);
            }}
          >
            <span className="msr" aria-hidden="true" data-fill={leftView === "parts" ? "1" : "0"} style={{ fontSize: 24 }}>
              widgets
            </span>
          </button>
          <button
            className={"axv-rail-btn" + (leftView === "layers" ? " on" : "")}
            title="图层"
            aria-label="图层"
            aria-pressed={leftView === "layers"}
            onClick={() => {
              setLeftView("layers");
              setLeftOpen(true);
            }}
          >
            <span className="msr" aria-hidden="true" data-fill={leftView === "layers" ? "1" : "0"} style={{ fontSize: 24 }}>
              account_tree
            </span>
          </button>
          <div className="axv-rail-gap" />
          <button
            className={"axv-rail-btn" + (leftView === "res" ? " on" : "")}
            title="资源"
            aria-label="资源"
            aria-pressed={leftView === "res"}
            onClick={() => {
              setLeftView("res");
              setLeftOpen(true);
            }}
          >
            <span className="msr" aria-hidden="true" data-fill={leftView === "res" ? "1" : "0"} style={{ fontSize: 24 }}>
              folder_open
            </span>
          </button>
        </div>

        <div className="axv-rail-body">
          <div className="axv-rail-head">
            <span className="axv-rail-title">
              {leftView === "parts" ? "组件" : leftView === "layers" ? "图层" : "资源"}
            </span>
            <button
              className="axv-icon-btn"
              title="关闭面板"
              aria-label="关闭面板"
              onClick={() => setLeftOpen(false)}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 24 }}>left_panel_close</span>
            </button>
          </div>

          {leftView === "parts" && (
            <div className="axv-rail-scroll">
              <WidgetPalette onInsert={insertWidget} hasSelection={!!selectedPath} />
            </div>
          )}
          {leftView === "layers" && (
            <div className="axv-rail-scroll">
              <LayerTree
                root={treeRoot}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onMove={onMoveSibling}
                onRemove={onRemoveNode}
              />
            </div>
          )}
          {leftView === "res" && (
            <div className="axv-res-box">
              <textarea
                value={resourceFragment}
                onChange={(e) => setResourceFragment(e.target.value)}
                placeholder={'<resources>\n  <string name="app_name">My App</string>\n  <dimen name="margin_small">8dp</dimen>\n  <color name="primary">#FF0000</color>\n</resources>'}
              />
            </div>
          )}
        </div>
      </aside>

      {/* 右侧滑面板：属性（移动端宽 75vw） */}
      <aside className={"axv-slide-right" + (rightOpen ? " axv-open" : "")}>
        <div className="axv-slide-head">
          <span>属性</span>
          <button
            className="axv-icon-btn"
            title="关闭面板"
            aria-label="关闭面板"
            onClick={() => setRightOpen(false)}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 24 }}>right_panel_close</span>
          </button>
        </div>
        <div className="axv-slide-body">
          {selectedNode ? (
            <div className="axv-panel-stack">
              {isChildOfCL && (
                <ConstraintPanel
                  node={selectedNode}
                  siblings={clSiblings}
                  onCommitMany={commitMany}
                  onAuto={runAutoConstrain}
                  onClear={clearConstraints}
                  autoNotes={autoNotes}
                />
              )}
              <AttrPanel
                node={selectedNode}
                onCommit={commitAttr}
                onRemove={removeAttr}
                onAddAttr={() => setAddModalOpen(true)}
              />
            </div>
          ) : (
            <div className="axv-attr-hint">在画布或图层树上点任意控件查看并编辑属性</div>
          )}
        </div>
      </aside>

      {/* 添加属性弹窗 */}
      <AddAttrModal
        open={addModalOpen}
        existing={selectedNode ? Object.keys(selectedNode.rawAttrs) : []}
        tag={selectedNode ? shortTag(selectedNode.tag) : undefined}
        onClose={() => setAddModalOpen(false)}
        onPick={(name) => addAttr(name)}
      />

      {/* 顶部工具栏（桌面端只占两侧面板之间的画布区，不重叠侧栏） */}
      <div
        className="axv-toolbar-v2"
        style={
          isMobile
            ? undefined
            : {
                left: leftOpen ? 320 : 0,
                right: rightOpen ? 320 : 0,
                transition: "left 0.22s, right 0.22s",
              }
        }
      >
        <div className="axv-tb-group" style={{ visibility: leftOpen ? "hidden" : "visible" }}>
          <button
            className="axv-tb-btn"
            title="展开左侧面板"
            aria-label="展开左侧面板"
            aria-pressed={false}
            onClick={() => setLeftOpen(true)}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>left_panel_open</span>
          </button>
        </div>

        <div className="axv-tb-group">
          <button
            className="axv-tb-btn"
            title="撤销"
            aria-label="撤销"
            disabled={!canUndo}
            onClick={undo}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>undo</span>
          </button>
          <button
            className="axv-tb-btn"
            title="重做"
            aria-label="重做"
            disabled={!canRedo}
            onClick={redo}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>redo</span>
          </button>
          <button className="axv-tb-btn" title="打开 XML 文件" aria-label="打开" onClick={openProject}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>folder_open</span>
          </button>
          <button className="axv-tb-btn" title="保存为 XML 文件" aria-label="保存" onClick={saveProject}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>save</span>
          </button>
          <select
            className="axv-tb-select"
            title="载入示例"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v && SAMPLES[v]) setXmlAndTrack(SAMPLES[v]);
            }}
          >
            <option value="">示例…</option>
            <option value="cl">约束布局</option>
            <option value="list">竖列表</option>
          </select>
          <button
            className="axv-tb-btn"
            title="格式化代码（重排缩进，保留注释）"
            aria-label="格式化"
            onClick={doFormat}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 22 }}>format_shapes</span>
          </button>
        </div>

        <div className="axv-tb-group axv-tb-zoom">
          <div className="axv-zoom">
            <input
              type="range"
              min={0.4}
              max={1.5}
              step={0.1}
              value={scale}
              onChange={(e) => setScale(parseFloat(e.target.value))}
              aria-label="缩放"
            />
            <span>{scale.toFixed(2)}×</span>
          </div>
        </div>

        <div className="axv-tb-group" style={{ visibility: rightOpen ? "hidden" : "visible" }}>
          <button
            className="axv-tb-btn"
            title="展开右侧属性面板"
            aria-label="右侧属性面板"
            aria-pressed={false}
            onClick={() => setRightOpen(true)}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>right_panel_open</span>
          </button>
        </div>
      </div>
      </div>
      </div>
  );
}
