"use client";

// components/DrawableEditor.tsx — 通用 drawable 编辑器（M121）
//
// 和 ShapeEditor 的区别：
//   ShapeEditor 只编辑「一个形状」，所有参数都是形状自己的；
//   DrawableEditor 编辑「一棵 drawable 树」，形状只是其中一种叶子。
//
// 界面上的三个区域：
//   预览（可切状态：默认 / 按下 / 禁用）
//   结构（面包屑 + 子节点列表 + 添加菜单）
//   参数（schema 驱动的属性行 + 形状的常用参数）

import { useMemo, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { useOverlayBack } from "@/lib/overlay-back";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import { parseDrawable } from "@/lib/xml/drawable-node";
import { buildDrawable } from "@/lib/xml/drawable-build";
import { countNodes } from "@/lib/xml/drawable-node";
import { nodeAt, replaceAt, breadcrumb, type Path } from "@/lib/xml/drawable-edit";
import { validateDrawable } from "@/lib/xml/drawable-schema";
import { resNameFromValue, sanitizeResName } from "@/lib/xml/resname";
import { DrawablePreview } from "./DrawablePreview";
import { AttrRows } from "./drawable/AttrRows";
import { ShapeFields } from "./drawable/ShapeFields";
import { TreeRows } from "./drawable/TreeRows";

export interface DrawableEditorProps {
  attrName: string;
  value: string;
  existingXml?: string;
  existingNames: string[];
  onClose: () => void;
  onSave: (resourceName: string, xml: string) => void;
  /** 从形状编辑器切过来时带上当前 XML，省一次解析 */
  initialXml?: string;
}

/** 空工程的默认骨架：一层灰底圆角矩形 */
function defaultTree(): DrawableNode {
  return {
    t: "layer",
    items: [{ key: "init", node: { t: "shape", spec: { kind: "rectangle", solid: "#FFEEEEEE", radius: 8 } } }],
  };
}

const TABS: [string, string][] = [
  ["tree", "结构"],
  ["attrs", "参数"],
];

export function DrawableEditor({
  attrName,
  value,
  existingXml,
  existingNames,
  onClose,
  onSave,
}: DrawableEditorProps) {
  const [root, setRoot] = useState<DrawableNode>(() => parseDrawable(existingXml ?? "") ?? defaultTree());
  const [undoStack, setUndoStack] = useState<DrawableNode[]>([]);
  const [redoStack, setRedoStack] = useState<DrawableNode[]>([]);
  const [path, setPath] = useState<Path>([]);
  const [tab, setTab] = useState<string>("tree");
  const [sheetOpen, setSheetOpen] = useState(true);
  const [showRaw, setShowRaw] = useState(false);
  const [previewBg, setPreviewBg] = useState<"checker" | "white" | "dark">("checker");
  const [name, setName] = useState<string>(() => resNameFromValue(value) || "bg");

  const close = useOverlayBack(true, onClose);

  const xml = useMemo(() => buildDrawable(root), [root]);
  const problems = useMemo(() => validateDrawable(root), [root]);
  const errors = problems.filter((p) => p.level === "error");
  const node = nodeAt(root, path) ?? root;
  const nameConflicts = existingNames.includes(name) && !existingXml;

  const mutate = (next: DrawableNode) => {
    setUndoStack((s) => [...s, root]);
    setRedoStack([]);
    setRoot(next);
  };
  const undo = () => {
    if (undoStack.length === 0) return;
    setRedoStack((s) => [...s, root]);
    setRoot(undoStack[undoStack.length - 1]);
    setUndoStack((s) => s.slice(0, -1));
  };
  const redo = () => {
    if (redoStack.length === 0) return;
    setUndoStack((s) => [...s, root]);
    setRoot(redoStack[redoStack.length - 1]);
    setRedoStack((s) => s.slice(0, -1));
  };

  const save = () => {
    const safe = sanitizeResName(name);
    if (!safe || nameConflicts || errors.length > 0) return;
    onSave(safe, xml);
  };

  const previewBgStyle: React.CSSProperties =
    previewBg === "checker"
      ? {
          backgroundImage: "repeating-conic-gradient(#0000000a 0% 25%, transparent 0% 50%) 50% / 12px 12px",
          backgroundColor: "#f5f5f7",
        }
      : previewBg === "white"
        ? { backgroundColor: "#ffffff" }
        : { backgroundColor: "#1a1a22" };

  return (
    <div className="axv-icon-page axv-cv-page" role="dialog" aria-label={tt("drawable 编辑器")}>
      <div className="axv-shape-head">
        <button className="axv-icon-back" onClick={close} aria-label={tt("返回编辑器")} title={tt("返回")}>
          <span className="msr" aria-hidden="true">arrow_back</span>
        </button>
        <span className="axv-shape-title">{tt("drawable · {name}", { name: attrName })}</span>
        <span className="axv-cv-head-tools">
          <button
            className="axv-icon-btn"
            onClick={undo}
            disabled={undoStack.length === 0}
            title={tt("撤销")}
            aria-label={tt("撤销")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>undo</span>
          </button>
          <button
            className="axv-icon-btn"
            onClick={redo}
            disabled={redoStack.length === 0}
            title={tt("重做")}
            aria-label={tt("重做")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>redo</span>
          </button>
          <button
            className={"axv-icon-btn" + (showRaw ? " is-on" : "")}
            onClick={() => setShowRaw((v) => !v)}
            title={tt("查看生成的 XML")}
            aria-label={tt("查看生成的 XML")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code</span>
          </button>
        </span>
      </div>

      <div className="axv-icon-page-body axv-cv-body">
        <div className="axv-cv-left">
          <div className="axv-dw-bar">
            <div className="axv-shape-seg">
              {(
                [
                  ["checker", "透明"],
                  ["white", "白底"],
                  ["dark", "深色"],
                ] as const
              ).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={"axv-shape-seg-btn" + (previewBg === k ? " is-on" : "")}
                  onClick={() => setPreviewBg(k)}
                >
                  {tt(label)}
                </button>
              ))}
            </div>
          </div>

          <div className="axv-dw-preview" style={previewBgStyle}>
            <div className="axv-dw-canvas">
              <DrawablePreview
                doc={root}
                interactive
                width={220}
                height={140}
                showStateBar
              />
            </div>
          </div>

          <div className="axv-dw-meta">
            <span>{tt("共 {n} 个节点", { n: String(countNodes(root)) })}</span>
            {errors.length > 0 ? (
              <span className="axv-shape-warn">{tt("有 {n} 处需要修正", { n: String(errors.length) })}</span>
            ) : null}
          </div>
        </div>

        <div className="axv-icon-ed-form axv-cv-form">
          <div className="axv-set-group">
            <div className="axv-set-label">{tt("资源名")}</div>
            <div className="axv-shape-name-row">
              <code>@drawable/</code>
              <input
                className="axv-attr-input"
                value={name}
                spellCheck={false}
                placeholder="bg_card"
                onChange={(e) => setName(sanitizeResName(e.target.value, ""))}
              />
            </div>
            {nameConflicts ? <div className="axv-shape-warn">{tt("这个名字已被占用，换一个或改已有资源")}</div> : null}
          </div>

          {showRaw ? <pre className="axv-icon-ed-raw axv-dw-raw">{xml}</pre> : null}

          {problems.length > 0 ? (
            <div className="axv-set-group">
              <div className="axv-set-label">{tt("检查")}</div>
              <div className="axv-dw-problems">
                {problems.slice(0, 6).map((p, i) => (
                  <div key={i} className={"axv-dw-problem" + (p.level === "error" ? " is-error" : "")}>
                    <span className="axv-dw-problem-path">{p.path}</span>
                    <span>{p.message}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className={"axv-cv-sheet" + (sheetOpen ? "" : " is-collapsed")}>
          <div className="axv-cv-sheet-head" onClick={() => setSheetOpen((v) => !v)}>
            <span className="axv-cv-grabber" aria-hidden="true" />
            <span className="axv-cv-sheet-title">{tt("内容")}</span>
            <div className="axv-cv-sheet-tabs" onClick={(e) => e.stopPropagation()}>
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  className={"axv-cv-sheet-tab" + (tab === k ? " on" : "")}
                  onClick={() => {
                    setTab(k);
                    setSheetOpen(true);
                  }}
                >
                  {tt(label)}
                </button>
              ))}
            </div>
            <span className="axv-cv-sheet-chev msr" aria-hidden="true">expand_more</span>
          </div>

          <div className="axv-cv-sheet-body">
            <div className="axv-cv-sheet-pane">
              {tab === "tree" ? (
                <TreeRows root={root} path={path} onSelect={setPath} onChange={mutate} />
              ) : (
                <div className="axv-dw-attrs">
                  {/* 参数页看不到面包屑，给一个明确的上一层出口，否则在叶子里容易迷路 */}
                  {path.length > 0 ? (
                    <button
                      type="button"
                      className="axv-btn axv-ghost axv-dw-back"
                      onClick={() => setPath(path.slice(0, -1))}
                    >
                      {tt("← 上一层：{name}", { name: breadcrumb(root, path).slice(-2)[0].label })}
                    </button>
                  ) : null}
                  <AttrRows node={node} onChange={(n) => mutate(replaceAt(root, path, n))} />
                  {node.t === "shape" ? (
                    <ShapeFields
                      spec={node.spec}
                      onChange={(spec) => mutate(replaceAt(root, path, { ...node, spec }))}
                    />
                  ) : null}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="axv-icon-page-foot">
        <span>
          <span className="axv-icon-page-foot-note">
            {tt("保存后生成 res/drawable/{name}.xml，导出 res 包时一并带走。", { name: name || "…" })}
          </span>
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button className="axv-btn axv-ghost" onClick={close}>
            {tt("取消")}
          </button>
          <button
            className="axv-btn axv-btn-primary"
            onClick={save}
            disabled={!name.trim() || nameConflicts || errors.length > 0}
          >
            {tt("保存并应用")}
          </button>
        </span>
      </div>
    </div>
  );
}
