// components/XmlEditor.tsx — M1a 主入口（v3：M3E 式三栏）
// 左滑面板：[组件 | 图层] 两页 + 底部 [代码 | 资源] 两个 tab
// 画布：手机屏（可接收组件面板拖放）
// 右滑面板：选中节点的属性面板

"use client";

import { useEffect, useMemo, useState } from "react";
import { parseLayoutXml, findNode, serialize } from "@/lib/xml/parser";
import { buildRenderModel } from "@/lib/xml/css";
import { mergeResourceFragment, DEFAULT_RESOURCES } from "@/lib/xml/resources";
import type { ResolvedNode, ResourceTable } from "@/lib/xml/types";
import { writebackAttrs } from "@/lib/xml/writeback";
import { insertChild, insertSiblingAfter, moveSibling } from "@/lib/xml/insert";
import { XmlCanvas } from "./XmlCanvas";
import { AttrPanel } from "./AttrPanel";
import { AddAttrModal } from "./AddAttrModal";
import { defaultFor } from "./attr-catalog";
import { WidgetPalette } from "./WidgetPalette";
import { LayerTree } from "./LayerTree";
import { WIDGET_MAP, DRAG_WIDGET_MIME, type WidgetDef } from "./widget-catalog";
import "./xml-canvas.css";

const SAMPLES: Record<string, string> = {
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
  const [resourceFragment, setResourceFragment] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftView, setLeftView] = useState<"parts" | "layers" | "code" | "res">("parts");
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);

  // 窄屏默认收起两个面板
  useEffect(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1100) {
      setLeftOpen(false);
      setRightOpen(false);
    }
  }, []);

  const resources: ResourceTable = useMemo(
    () => (resourceFragment.trim() ? mergeResourceFragment(resourceFragment) : DEFAULT_RESOURCES),
    [resourceFragment],
  );

  const { model, issues, parseErr } = useMemo(() => {
    const { root, issues } = parseLayoutXml(xml);
    if (!root) return { model: null, issues, parseErr: true };
    return { model: buildRenderModel(root, resources, SCALE), issues, parseErr: false };
  }, [xml, resources]);

  /** 图层树用的原始节点树（不经渲染模型） */
  const treeRoot = useMemo(() => (parseErr ? null : parseLayoutXml(xml).root), [xml, parseErr]);

  // ===== 组件插入（点击 / 拖放）=====
  // 有选中节点：插到它的同级（兄弟）；否则插到根节点末尾
  const insertWidget = (w: WidgetDef) => {
    const frag = stripNs(w.xml);
    const target = selectedPath && selectedPath !== "#0" ? selectedPath : "#0";
    const res =
      target !== "#0"
        ? insertSiblingAfter(xml, target, frag, w.label)
        : insertChild(xml, "#0", frag, w.label);
    if (res.ok) {
      setXml(res.xml);
      if (res.insertedPath) setSelectedPath(res.insertedPath);
    }
  };

  /** 画布拖放：简化走同级 / 根逻辑，精确落位后续 M2c */
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
      setXml(r.xml);
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
    setXml((decl ? decl[0] + "\n" : "") + out);
    setSelectedPath(null);
  };

  // ===== 属性回写（M1b 双向）=====
  const commitAttr = (name: string, value: string) => {
    if (!selectedPath) return;
    const r = writebackAttrs(xml, selectedPath, { [name]: value });
    if (r.changed) setXml(r.xml);
  };

  const removeAttr = (name: string) => {
    if (!selectedPath) return;
    const r = writebackAttrs(xml, selectedPath, {}, [name]);
    if (r.changed) setXml(r.xml);
  };

  const addAttr = (name: string) => {
    if (!selectedPath) return;
    const r = writebackAttrs(xml, selectedPath, { [name]: defaultFor(name) });
    if (r.changed) setXml(r.xml);
  };

  const selectedNode: ResolvedNode | null = useMemo(() => {
    if (!selectedPath || !model) return null;
    return findResolvedNode(model.root, selectedPath);
  }, [selectedPath, model]);

  const widthPx = Math.round(412 * SCALE * scale);
  const heightPx = Math.round(892 * SCALE * scale);

  const shortTag = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t);
  return (
    <div className="axv-editor">
      <div className="axv-main">
        {/* 画布舞台 */}
        <div className={"axv-stage" + (leftOpen ? " pad-l" : "") + (rightOpen ? " pad-r" : "")}>
          {parseErr ? (
            <div className="axv-canvas-empty">XML 解析失败，请检查结构</div>
          ) : model ? (
            <div
              className={"axv-phone" + (dropHint ? " axv-drop-target" : "")}
              style={{
                width: widthPx,
                minHeight: heightPx,
                background: model.root.style.background || model.root.style.backgroundColor || "#fff",
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
              <XmlCanvas node={model.root} selectedPath={selectedPath} onSelect={setSelectedPath} />
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

      {/* 左侧滑面板：52px 图标条 + 内容列（M3E 同款布局） */}
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
            className={"axv-rail-btn" + (leftView === "code" ? " on" : "")}
            title="XML 代码"
            aria-label="XML 代码"
            aria-pressed={leftView === "code"}
            onClick={() => {
              setLeftView("code");
              setLeftOpen(true);
            }}
          >
            <span className="msr" aria-hidden="true" data-fill={leftView === "code" ? "1" : "0"} style={{ fontSize: 24 }}>
              code
            </span>
          </button>
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
              {leftView === "parts"
                ? "组件"
                : leftView === "layers"
                  ? "图层"
                  : leftView === "code"
                    ? "XML 代码"
                    : "资源"}
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
          {leftView === "code" && (
            <textarea
              className="axv-pane"
              value={xml}
              spellCheck={false}
              onChange={(e) => setXml(e.target.value)}
            />
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

      {/* 右侧滑面板：属性 */}
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
            <AttrPanel
              node={selectedNode}
              onCommit={commitAttr}
              onRemove={removeAttr}
              onAddAttr={() => setAddModalOpen(true)}
            />
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

      {/* 顶部工具栏（M3E 式悬浮胶囊组：最左 ☰，最右属性） */}
      <div className="axv-toolbar-v2">
        <div className="axv-tb-group">
          <button
            className={"axv-tb-btn" + (leftOpen ? " on" : "")}
            title="显示 / 隐藏左侧面板"
            aria-label="左侧面板"
            aria-pressed={leftOpen}
            onClick={() => setLeftOpen((v) => !v)}
          >
            <span className="msr" aria-hidden="true" data-fill={leftOpen ? "1" : "0"} style={{ fontSize: 23 }}>
              menu_open
            </span>
          </button>
        </div>

        <div className="axv-tb-group">
          <div className="axv-seg" role="radiogroup" aria-label="视图">
            <button
              className={"axv-seg-btn" + (leftView === "parts" ? " on" : "")}
              role="radio"
              aria-checked={leftView === "parts"}
              title="组件"
              onClick={() => {
                setLeftView("parts");
                setLeftOpen(true);
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 20 }}>widgets</span>
            </button>
            <button
              className={"axv-seg-btn" + (leftView === "code" ? " on" : "")}
              role="radio"
              aria-checked={leftView === "code"}
              title="XML 代码"
              onClick={() => {
                setLeftView("code");
                setLeftOpen(true);
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 20 }}>code</span>
            </button>
          </div>
          <select
            className="axv-tb-select"
            title="载入示例"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v && SAMPLES[v]) setXml(SAMPLES[v]);
            }}
          >
            <option value="">示例…</option>
            <option value="list">竖列表</option>
          </select>
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

        <div className="axv-tb-group">
          <button
            className={"axv-tb-btn" + (rightOpen ? " on" : "")}
            title="显示 / 隐藏右侧属性面板"
            aria-label="右侧属性面板"
            aria-pressed={rightOpen}
            onClick={() => setRightOpen((v) => !v)}
          >
            <span className="msr" aria-hidden="true" data-fill={rightOpen ? "1" : "0"} style={{ fontSize: 23 }}>
              tune
            </span>
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
