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

import { useEffect, useMemo, useRef, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { useOverlayBack } from "@/lib/overlay-back";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import { parseDrawable } from "@/lib/xml/drawable-node";
import { rootInfo } from "@/lib/xml/drawable-root";
import { buildDrawable } from "@/lib/xml/drawable-build";
import { countNodes } from "@/lib/xml/drawable-node";
import { nodeAt, replaceAt, breadcrumb, parentOf, setSlot, slotOf, type Path } from "@/lib/xml/drawable-edit";
import { validateDrawable } from "@/lib/xml/drawable-schema";
import { DRAWABLE_PRESETS } from "@/lib/xml/drawable-presets";
import { resNameFromValue, sanitizeResName } from "@/lib/xml/resname";
import { DrawablePreview } from "./DrawablePreview";
import { focusDoc } from "@/lib/xml/drawable-focus";
import { AttrRows } from "./drawable/AttrRows";
import { SlotRows } from "./drawable/SlotRows";
import { ShapeFields } from "./drawable/ShapeFields";
import { DrawableTree } from "./drawable/DrawableTree";
import { TransformTabs } from "./drawable/TransformTabs";

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

/** 手机/窄屏（≤840px）：结构树放进底部抽屉；宽屏只在右侧面板里画一份，避免同屏两棵一样的树 */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 840px)");
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

const TABS: [string, string][] = [
  ["tree", "结构"],
  ["attrs", "参数"],
  ["shape", "形状"],
  ["margin", "边距"],
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
  /** 初始树引用：没动过任何编辑时保存原样写回（注释、换行、声明全保留，一个字节都不碰） */
  const initialRef = useRef(root);
  /** existingXml 是否解析成功（解析失败 = 别拿默认树去覆盖用户文件） */
  const parsedOk = useMemo(() => (existingXml ? parseDrawable(existingXml) !== null : true), [existingXml]);
  /** 根元素识别：决定是「能编辑」还是「只读但原样保存」（M124） */
  const info = useMemo(() => rootInfo(existingXml), [existingXml]);
  const readonly = info.route === "readonly";
  const [undoStack, setUndoStack] = useState<DrawableNode[]>([]);
  const [redoStack, setRedoStack] = useState<DrawableNode[]>([]);
  const [path, setPath] = useState<Path>([]);
  const [tab, setTab] = useState<string>("tree");
  const [sheetOpen, setSheetOpen] = useState(true);
  /** M135：XML 代码框不再可收起，默认一直显示（只读类型也只读展示） */
  const showRaw = true;
  const [previewBg, setPreviewBg] = useState<"checker" | "white" | "dark">("checker");
  /** 手机端右栏是滑面板，必须给开关，否则 selector 等类型打开后拦住了预览又关不掉（M130） */
  const [formOpen, setFormOpen] = useState(true);
  const [name, setName] = useState<string>(() => resNameFromValue(value) || "bg");
  const [presetOpen, setPresetOpen] = useState(false);
  /** 窄屏：底部抽屉里再画一棵结构树；宽屏只在右侧面板画一份 */
  const narrow = useNarrow();
  // M135：宽屏抽屉是浮层，量出它实际占的高度把左右两栏顶上去，
  // 否则右栏底部的 XML 代码框会被抽屉压掉一半（抽屉高度随页签内容变，写死数值不准）
  const sheetRef = useRef<HTMLDivElement>(null);
  const [sheetH, setSheetH] = useState(0);
  useEffect(() => {
    const el = sheetRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setSheetH(el.offsetHeight));
    ro.observe(el);
    setSheetH(el.offsetHeight);
    return () => ro.disconnect();
  }, []);
  /** 收起时只露 45px 的标题条 */
  const sheetSpace = sheetH > 0 ? (sheetOpen ? sheetH + 6 : 51) : 0;
  // M135：窄屏默认收起右栏（75vw 的面板一打开就把预览盖掉），先看预览，要调参数再拉出来
  useEffect(() => {
    setFormOpen(!narrow);
  }, [narrow]);

  const close = useOverlayBack(true, onClose);

  const xml = useMemo(() => buildDrawable(root), [root]);
  const problems = useMemo(() => validateDrawable(root), [root]);
  const errors = problems.filter((p) => p.level === "error");
  const node = nodeAt(root, path) ?? root;
  /** M134：当前节点在父容器里的位置参数（item 上的属性） */
  const parentNode = path.length > 0 ? parentOf(root, path) : null;
  /** 选中某一层时就只看它（同样的 flatten 路径，不是另画一套） */
  const focus = useMemo(() => focusDoc(root, path), [root, path]);
  const focused = path.length > 0;
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

  /** 套预设：预设给的是真 XML，走 parseDrawable 进来的东西和手搭的完全一样 */
  const applyPreset = (xmlText: string) => {
    const doc = parseDrawable(xmlText);
    if (!doc) return;
    mutate(doc);
    setPath([]);
    setPresetOpen(false);
  };

  const save = () => {
    const safe = sanitizeResName(name);
    if (!safe || nameConflicts) return;
    // 只读类型：原样写回，一个字节都不改（格式化、属性顺序、未知标签全保留）
    if (readonly) {
      onSave(safe, existingXml ?? "");
      return;
    }
    if (errors.length > 0) return;
    // M126 保真：existingXml 解析失败时不许存（默认树不能覆盖用户文件）；
    // 用户一点没改时直接写回原文，注释/换行/XML 声明全部原样
    if (existingXml && !parsedOk) return;
    if (existingXml && root === initialRef.current) {
      onSave(safe, existingXml);
      return;
    }
    onSave(safe, xml);
  };

  /** M132：棋盘格回到外层 .axv-dw-preview 上，内层 .axv-dp-box 只负责画内容 */
  const previewBgStyle: React.CSSProperties =
    previewBg === "checker"
      ? {
          backgroundImage:
            "repeating-conic-gradient(rgb(217, 217, 217) 0%, rgb(217, 217, 217) 25%, rgb(244, 244, 244) 0%, rgb(244, 244, 244) 50%)",
          backgroundPosition: "50% center",
          backgroundSize: "16px 16px",
        }
      : previewBg === "white"
        ? { background: "#ffffff" }
        : { background: "#1a1a22" };

  return (
    <div className="axv-icon-page axv-cv-page" role="dialog" aria-label={tt("drawable 编辑器")}>
      <div className="axv-shape-head">
        <button className="axv-icon-back" onClick={close} aria-label={tt("返回编辑器")} title={tt("返回")}>
          <span className="msr" aria-hidden="true">arrow_back</span>
        </button>
        <span className="axv-shape-title">
          {tt("drawable · {name}", { name: attrName })}
          {info.route !== "empty" && info.tag !== "shape" ? (
            <span className="axv-dt-head-tag">{tt(info.label)}</span>
          ) : null}
        </span>
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
        </span>
      </div>

      <div
        className="axv-icon-page-body axv-cv-body"
        style={sheetSpace && !narrow ? { paddingBottom: sheetSpace } : undefined}
      >
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
            <button
              type="button"
              className={"axv-btn axv-ghost axv-dw-preset-btn" + (presetOpen ? " is-on" : "")}
              onClick={() => setPresetOpen((v) => !v)}
            >
              {tt("预设")}
            </button>
          </div>

          {presetOpen ? (
            <div className="axv-dw-presets">
              {DRAWABLE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="axv-dw-preset-item"
                  onClick={() => applyPreset(p.xml)}
                >
                  <span className="axv-dw-preset-name">{tt(p.name)}</span>
                  <span className="axv-dw-preset-hint">{tt(p.hint)}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="axv-dw-stage">
            <DrawablePreview
              doc={focus}
              interactive
              width={220}
              height={140}
              showStateBar
              showBounds
              backdrop="none"
              frame={previewBgStyle}
            />
          </div>

          {focused ? (
            <div className="axv-dw-stage axv-dw-stage-focus">
              <button className="axv-dw-focus" onClick={() => setPath([])}>
                <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>layers</span>
                {tt("只看选中层")}
              </button>
            </div>
          ) : null}

          <div className="axv-dw-meta">
            <span>{tt("共 {n} 个节点", { n: String(countNodes(root)) })}</span>
            {errors.length > 0 ? (
              <span className="axv-shape-warn">{tt("有 {n} 处需要修正", { n: String(errors.length) })}</span>
            ) : null}
          </div>
        </div>

        {formOpen ? (
          <div
            className="axv-cv-form-mask"
            onClick={() => setFormOpen(false)}
            aria-hidden="true"
          />
        ) : null}
        <button
          type="button"
          className={"axv-cv-form-toggle" + (formOpen ? "" : " is-closed")}
          onClick={() => setFormOpen((v) => !v)}
          aria-label={formOpen ? tt("收起参数面板") : tt("展开参数面板")}
          title={formOpen ? tt("收起参数面板") : tt("展开参数面板")}
        >
          <span className="msr" aria-hidden="true">{formOpen ? "chevron_right" : "chevron_left"}</span>
        </button>
        <div className={"axv-icon-ed-form axv-cv-form axv-cv-form-drawable" + (formOpen ? "" : " is-closed")}>
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

          {readonly ? null : (
            <div className="axv-set-group axv-dt-group">
              <div className="axv-set-label">{tt("结构")}</div>
              <div className="axv-dt-inline">
                <DrawableTree root={root} path={path} onSelect={setPath} onChange={mutate} />
              </div>
            </div>
          )}

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

        <div className={"axv-cv-sheet" + (sheetOpen ? "" : " is-collapsed")} ref={sheetRef}>
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
                <>
                  {readonly ? (
                    <div className="axv-dt-ro">
                      <div className="axv-dt-ro-title">
                        {tt("根元素：{tag}（{label}）", { tag: `<${info.tag}>`, label: tt(info.label) })}
                      </div>
                      <div className="axv-dt-ro-note">{tt(info.note)}</div>
                    </div>
                  ) : narrow ? (
                    <DrawableTree root={root} path={path} onSelect={setPath} onChange={mutate} />
                  ) : (
                    <div className="axv-dt-ro">
                      <div className="axv-dt-ro-title">{tt("结构树在右侧面板里")}</div>
                      <div className="axv-dt-ro-note">
                        {tt("宽屏时结构树固定显示在右边，这里不重复画一份；手机上会出现在这个抽屉里。")}
                      </div>
                    </div>
                  )}
                </>
              ) : tab === "attrs" ? (
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
                  {/* M134：这一层自己的插槽参数（offset / 宽高 / 对齐 / 不透明度 / 状态位）
                      放在节点属性前面：它描述「这一层怎么摆」，比节点自身的属性更外层 */}
                  {!readonly && path.length > 0 ? (
                    <SlotRows
                      parent={parentNode ?? root}
                      index={path[path.length - 1]}
                      slot={slotOf(root, path)}
                      onChange={(patch) => mutate(setSlot(root, path, patch))}
                    />
                  ) : null}
                  <AttrRows
                    node={node}
                    onChange={(n) => mutate(replaceAt(root, path, n))}
                    refNames={existingNames}
                  />
                  {readonly ? (
                    <div className="axv-dt-ro-note" style={{ marginTop: 8 }}>
                      {tt("只读类型，只能查看。要改内容请直接改 XML，或换支持的根元素。")}
                    </div>
                  ) : (
                    <TransformTabs node={node} onChange={(n) => mutate(replaceAt(root, path, n))} />
                  )}
                </div>
              ) : (
                <div className="axv-dw-attrs">
                  {/* 形状 / 边距两页都作用于「当前选中的形状叶子」，没选中就退回结构页挑一个 */}
                  <div className="axv-dw-who">
                    <span className="axv-dw-who-path">{breadcrumb(root, path).map((b) => b.label).join(" › ")}</span>
                  </div>
                  {readonly ? (
                    <div className="axv-dt-ro-note">
                      {tt("只读类型，只能查看。要改内容请直接改 XML，或换支持的根元素。")}
                    </div>
                  ) : node.t === "shape" ? (
                    <ShapeFields
                      part={tab === "shape" ? "shape" : "margin"}
                      spec={node.spec}
                      onChange={(spec) => mutate(replaceAt(root, path, { ...node, spec }))}
                    />
                  ) : (
                    <div className="axv-dt-ro-note">
                      {tt("当前节点不是形状（{tag}）。先回「结构」页选中一个形状，再回来调形状与边距。", {
                        tag: `<${node.t === "ref" ? "item" : node.t}>`,
                      })}
                    </div>
                  )}
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
            disabled={!name.trim() || nameConflicts || (!readonly && errors.length > 0)}
          >
            {tt("保存并应用")}
          </button>
        </span>
      </div>
    </div>
  );
}
