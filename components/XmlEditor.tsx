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
import type { ResolvedNode, ResourceTable } from "@/lib/xml/types";
import { writebackAttrs } from "@/lib/xml/writeback";
import { insertChild, insertSiblingAfter, insertAt, moveSibling, isContainerTag } from "@/lib/xml/insert";
import { XmlCanvas } from "./XmlCanvas";
import { XmlCodeEditor } from "./XmlCodeEditor";
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
      setXmlAndTrack(res.xml);
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
        setXmlAndTrack(r.xml);
        if (r.insertedPath) setSelectedPath(r.insertedPath);
      }
      return;
    }
    const r = insertSiblingAfter(xml, path, frag, w.label);
    if (r.ok) {
      setXmlAndTrack(r.xml);
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

  const shortTag = (t: string) => (t.includes(".") ? t.slice(t.lastIndexOf(".") + 1) : t);
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
          />
          <div className="axv-mob-xml-tools">
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
