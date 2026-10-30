// components/XmlEditor.tsx — M1a 主入口（v4：桌面端按 M3E 原版三栏布局拓展功能 + 移动端 75% 侧滑 + 蒙版）
// 桌面：左 320 停靠（52px 图标条：组件/图层 + 代码/资源）| 中间画布 | 右 320 属性
// 工具栏：☰ 撤销 重做 打开 保存（中段），最右 ⇔ 属性
// 移动端（≤840px 或粗指针+≤1024px）：两侧滑面板宽 75vw，背后加蒙版，点蒙版关闭；
// 画布区顶部 tab 切换 XML 代码 / 预览

"use client";

import AiPanel from "@/components/AiPanel";
import { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue } from "react";
import { parseLayoutXml, findNode, serialize, nodeAtLine } from "@/lib/xml/parser";
import { pathChainOf } from "@/lib/xml/path-chain";
import { buildRenderModel } from "@/lib/xml/css";
import type { MeasuredMap } from "@/lib/xml/constraints";
import { commitHistoryState, EMPTY_MARK, type MergeMark } from "@/lib/xml/history";
import { mergeResourceFragment, DEFAULT_RESOURCES } from "@/lib/xml/resources";
import { buildResourceExtras, backfillDrawableXml, type ResourceExtras } from "@/lib/xml/resdir";
import type { ResolvedNode, ResourceTable, XmlNode, XmlIssue, RenderModel } from "@/lib/xml/types";
import { writebackAttrs } from "@/lib/xml/writeback";
import { insertChild, insertSiblingAfter, insertAt, moveSibling, isContainerTag, applyConstraintDefaults, canAcceptChild, childLimitOf } from "@/lib/xml/insert";
import { moveNodeRaw, scanElements } from "@/lib/xml/reorder";
import { formatXml } from "@/lib/xml/format";
import { lintXml } from "@/lib/xml/lint";
import { vectorToDataUrl } from "@/lib/xml/vector-svg";
import { buildResBundle, missingDrawables } from "@/lib/xml/bundle";
import { sanitizeResName } from "@/lib/xml/resname";
import { repairGeneratedVectors } from "@/lib/xml/icon-vectors";
import { getIconVectorWysiwyg, looksLikeGlyfVector } from "@/lib/xml/font-glyph";
import { hasIcon } from "@/lib/xml/icon-vectors";
import { makeZip, downloadBytes } from "@/lib/xml/zip";
import { saveTextNative, workspaceLabel, chooseWorkspace, nativeAvailable, copyTextNative, writeTextNative } from "@/lib/xml/native-save";
import { saveBundleAnywhere, pickXmlFile, type SaveFileSpec } from "@/lib/xml/save-as";
import { writeHandleText } from "@/lib/xml/workspace-fs";
import {
  THEME_PRESETS,
  DEFAULT_PRESET_ID,
  themeTokens,
  applyThemeToDom,
  type ThemeMode,
} from "@/lib/xml/theme-presets";
import {
  wsInfo,
  wsListProjects,
  wsOpenProject,
  wsPickCustom,
  wsUseDefault,
  wsRequestAllFiles,
  type WsInfo,
  type WsProject,
} from "@/lib/xml/workspace";
import { SAMPLE_PROJECTS, SAMPLE_BLANKS, sampleProjectByKey } from "@/lib/xml/sample-projects";
import {
  activeFile,
  addFile,
  createProject,
  guessFileName,
  parseProject,
  removeFile,
  renameFile,
  serializeProject,
  switchFile,
  updateFileXml,
  MAX_FILES,
  type Project,
} from "@/lib/xml/multi-file";
import { exportLayoutXml, exportChecks } from "@/lib/xml/export";
import { toCompatXml } from "@/lib/xml/compat";
import { fixNamespacePrefixes } from "@/lib/xml/namespace";
import { ExportCheckModal, type ExportReport, type ExportMode } from "./ExportCheckModal";
import { ExportImageModal } from "./ExportImageModal";
import type { ExportTarget } from "@/lib/xml/export-image";
import { XmlCanvas } from "./XmlCanvas";
import CanvasBoundary from "@/components/CanvasBoundary";
import { LANG_OPTIONS, loadLangPref, saveLangPref, resolveLang, makeT, type LangPref } from "@/lib/i18n";
import { XmlCodeEditor } from "./XmlCodeEditor";
import { AttrPanel } from "./AttrPanel";
import { AddAttrModal } from "./AddAttrModal";
import { defaultFor } from "./attr-catalog";
import { WidgetPalette } from "./WidgetPalette";
import { ConstraintPanel, type SibOption } from "./ConstraintPanel";
import { autoConstrain, hasConstraints, nextViewId, type CBox, type SibInfo } from "@/lib/xml/autoconstrain";
import { ResTree } from "./ResTree";
import { ResImagePreview } from "./ResImagePreview";
import { ShapeEditor } from "./ShapeEditor";
import { GenAssetsPanel } from "./GenAssetsPanel";
import IconEditor from "./IconEditor";
import { renameAsset, renameReferences } from "@/lib/xml/asset-refs";
import { findResolvedNode, splitPath, stripNs, collectIds } from "@/lib/xml/paths";
import { LS_KEY_XML, LS_KEY_HIST, LS_KEY_RES, LS_KEY_ICONS, LS_KEY_PROJECT, lsGet, lsSet } from "@/lib/xml/storage";
import { RunPreview } from "./RunPreview";
import { ViewSettingsMenu } from "./ViewSettingsMenu";
import { LayerTree } from "./LayerTree";
import { WIDGET_MAP, DRAG_WIDGET_MIME, type WidgetDef } from "./widget-catalog";
import "./xml-canvas.css";
import { readableOn, deviceById } from "@/lib/xml/theme";
import { DEFAULT_RENDER_THEME, RENDER_THEMES, type RenderTheme } from "@/lib/xml/theme";
import { CREDITS, UPSTREAM, PROJECT_NAME, PROJECT_TAGLINE } from "@/lib/xml/credits";

const SAMPLES: Record<string, string> = {
  /** M2s：新建空白 ConstraintLayout 骨架（一行注释 + 空 CL，拖控件进来即可开建） */
  "blank-cl": `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- 从左侧「组件」把控件拖进来，或选中后在右侧加约束 -->

</androidx.constraintlayout.widget.ConstraintLayout>
`,
  /** M2s：新建空白 LinearLayout（竖） */
  "blank-ll": `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

  <!-- 从左侧「组件」把控件拖进来 -->

</LinearLayout>
`,
  /** M2s：新建空白 FrameLayout */
  "blank-frame": `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- 从左侧「组件」把控件拖进来 -->

</FrameLayout>
`,
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
  chain: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#FFFFFF">

  <TextView
      android:id="@+id/tvHead"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="chain 链式排布 + Guideline"
      android:textSize="18sp"
      android:textStyle="bold"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toTopOf="parent" />

  <androidx.constraintlayout.widget.Guideline
      android:id="@+id/guide10"
      android:orientation="horizontal"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      app:layout_constraintGuide_percent="0.12" />

  <Button
      android:id="@+id/b1"
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:text="一"
      app:layout_constraintHorizontal_chainStyle="spread"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintEnd_toStartOf="@+id/b2"
      app:layout_constraintTop_toBottomOf="@+id/guide10"
      android:layout_marginStart="16dp"
      android:layout_marginEnd="8dp" />

  <Button
      android:id="@+id/b2"
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:text="二"
      app:layout_constraintStart_toEndOf="@+id/b1"
      app:layout_constraintEnd_toStartOf="@+id/b3"
      app:layout_constraintTop_toTopOf="@+id/b1"
      android:layout_marginStart="8dp"
      android:layout_marginEnd="8dp" />

  <Button
      android:id="@+id/b3"
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:text="三"
      app:layout_constraintStart_toEndOf="@+id/b2"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintTop_toTopOf="@+id/b1"
      android:layout_marginStart="8dp"
      android:layout_marginEnd="16dp" />

  <TextView
      android:id="@+id/tvNote"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="24dp"
      android:text="三个 0dp 按钮在 spread 链里平分宽度"
      android:textSize="13sp"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/b1" />

</androidx.constraintlayout.widget.ConstraintLayout>`,
  barrier: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#FFFFFF">

  <TextView
      android:id="@+id/tvL"
      android:layout_width="120dp"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="左边一段较长的说明文字，会把高度撑高"
      android:textSize="14sp"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toTopOf="parent" />

  <TextView
      android:id="@+id/tvR"
      android:layout_width="120dp"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="右边短"
      android:textSize="14sp"
      app:layout_constraintStart_toEndOf="@+id/tvL"
      app:layout_constraintTop_toTopOf="parent" />

  <androidx.constraintlayout.widget.Barrier
      android:id="@+id/barBottom"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      app:barrierDirection="bottom"
      app:constraint_referenced_ids="tvL,tvR" />

  <Button
      android:id="@+id/btnBelow"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="16dp"
      android:text="我跟着较高的那个往下排"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/barBottom" />

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


/** M20n：工作目录多级列表的树节点 */
interface WsNode {
  name: string;
  rel: string;
  kind: "dir" | "file";
  layoutCount: number;
  item: WsProject;
  children: WsNode[];
}

/** 把「相对路径扁平列表」还原成树（后端按 DFS 顺序返回，rel 带 / 分隔） */
function buildWsTree(items: WsProject[]): WsNode[] {
  const root: WsNode = {
    name: "",
    rel: "",
    kind: "dir",
    layoutCount: 0,
    item: null as unknown as WsProject,
    children: [],
  };
  const map = new Map<string, WsNode>();
  for (const it of items) {
    const parts = it.rel.split("/").filter(Boolean);
    const parentRel = parts.slice(0, Math.max(0, parts.length - 1)).join("/");
    const parent = parentRel ? map.get(parentRel) ?? root : root;
    const node: WsNode = {
      name: it.name,
      rel: it.rel,
      kind: it.kind,
      layoutCount: it.layoutCount,
      item: it,
      children: [],
    };
    map.set(it.rel, node);
    parent.children.push(node);
  }
  return root.children;
}

const APP_VERSION = "1.13";
const SCALE = 2; // 1dp = 2px

export function XmlEditor() {
  /** 启动引导：项目（多文件）优先，没有存档时从上次的 xml 建一个单文件项目 */
  const bootRef = useRef<{ project: Project; xml: string } | null>(null);
  if (bootRef.current === null) {
    const saved = parseProject(lsGet(LS_KEY_PROJECT));
    const raw = lsGet(LS_KEY_XML) ?? SAMPLES.list;
    if (saved) {
      const f = activeFile(saved);
      bootRef.current = { project: saved, xml: f?.xml ?? raw };
    } else {
      bootRef.current = {
        project: createProject("我的项目", { name: guessFileName(raw), xml: raw }),
        xml: raw,
      };
    }
  }
  const [xml, setXml] = useState<string>(() => bootRef.current!.xml);
  /** 多文件项目：文件列表 + 当前激活文件（内容以 xml 为准，切换时回写） */
  const [project, setProject] = useState<Project>(() => bootRef.current!.project);

  /** M9：文件切换器下拉框（桌面/移动共用的一个 select）：
   *  选项 = 项目里的文件 + 4 个操作项；选中操作项立即执行并弹回当前文件 */
  const fileSelectValue = "";
  const onFileSelect = (v: string) => {
    if (v === "") return;
    if (v === "action:new") { newFile(); return; }
    if (v === "action:rename") { renameActiveFile(); return; }
    if (v === "action:delete") { deleteActiveFile(); return; }
    selectFile(v);
  };
  const currentFile = activeFile(project);
  /** M9：文件切换下拉框（桌面/移动共用）：项目里的文件 + 3 个操作项 */
  const fileSelect = (
    <select
      className="axv-tb-select"
      title="项目文件（多文件切换）"
      value=""
      onChange={(e) => {
        const v = e.target.value;
        if (!v) return;
        if (v === "action:new") newFile();
        else if (v === "action:rename") renameActiveFile();
        else if (v === "action:delete") deleteActiveFile();
        else selectFile(v);
      }}
    >
      <option value="">{`${currentFile?.name ?? "文件"} ▾`}</option>
      <optgroup label="项目文件">
        {project.files.map((f) => (
          <option key={f.id} value={f.id}>
            {f.id === project.activeId ? "● " : "○ "} {f.name}
          </option>
        ))}
      </optgroup>
      <optgroup label="文件操作">
        <option value="action:new">＋ 新建文件…</option>
        <option value="action:rename">✎ 重命名当前文件…</option>
        <option value="action:delete">🗑 删除当前文件</option>
      </optgroup>
    </select>
  );
  /** 解析用（低优先级）：敲代码时让输入不卡，解析滞后几帧 */
  const parsedXml = useDeferredValue(xml);
  const [resourceFragment, setResourceFragment] = useState("");
  /** 示例项目自带的 values（@color/@string）——单独存，不抢用户自己贴的片段；用户片段优先 */
  const [sampleValues, setSampleValues] = useState("");
  /** 上传 res/ 目录解析出的附加资源（drawable/vector/styles/values 原文） */
  const [resExtras, setResExtras] = useState<ResourceExtras | null>(null);
  /** M3g/M3h：本工具生成的 drawable 资源：资源名 → xml 原文（图标 vector + 自定义 shape/ripple 共用） */
  const [generatedDrawables, setGeneratedDrawables] = useState<Record<string, string>>({});
  /** 矢量 → data URL（让画布能真渲染而不是占位框） */
  const generatedDataUrls = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [name, xml] of Object.entries(generatedDrawables)) {
      const u = vectorToDataUrl(xml);
      if (u) out[name] = u;
    }
    return out;
  }, [generatedDrawables]);
  /** 只包含真矢量的名字（shape 不算，避免误判） */
  const generatedVectorNames = useMemo(
    () => Object.entries(generatedDrawables).filter(([, xml]) => /<vector[\s>]/.test(xml)).map(([n]) => n),
    [generatedDrawables],
  );
  /** 只包含 shape/ripple 的 xml（供 resolve 当背景解析） */
  const generatedShapeXml = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [name, xml] of Object.entries(generatedDrawables)) {
      if (/<(shape|ripple)[\s>]/.test(xml)) out[name] = xml;
    }
    return out;
  }, [generatedDrawables]);
  const resDirRef = useRef<HTMLInputElement | null>(null);
  /** 双保险：mount 后 setAttribute 强制写入 webkitdirectory/directory，
   *  避免 React 渲染空字符串属性时某些浏览器不识别（导致弹出文件选择器而非目录选择器） */
  useEffect(() => {
    const el = resDirRef.current;
    if (el) {
      el.setAttribute("webkitdirectory", "");
      el.setAttribute("directory", "");
    }
  }, []);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
 const [exportNote, setExportNote] = useState<string>(" ");
  /** M11j：正在编辑的生成图标（vector） */
  const [resIcon, setResIcon] = useState<{ name: string; xml: string; attr?: string } | null>(
    null
  );
  /** M4u：从资源树里直接打开的「绘制编辑器」（drawable/*.xml） */
  const [resShape, setResShape] = useState<{ name: string; xml: string } | null>(null);
  /** M4u：从资源树里点开的图片预览 */
  const [resImage, setResImage] = useState<{ rel: string; name: string; url: string } | null>(null);
  const [scale, setScale] = useState(1);
  /** M6g：缩放锚点（Ctrl+滚轮/双指捻合后把鼠标下的点维持在原位） */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;
  const zoomAnchor = useRef<{ cx: number; cy: number; px: number; py: number } | null>(null);
  const [zoomHud, setZoomHud] = useState<number | null>(null);
  /** M2r：预览设备尺寸（手机竖屏/横屏/平板…），持久化到 localStorage */
  const [deviceId, setDeviceId] = useState<string>(
    () => (typeof window !== "undefined" ? window.localStorage.getItem("axv.device") ?? "phone" : "phone"),
  );
  const device = deviceById(deviceId);

  const changeDevice = (id: string) => {
    setDeviceId(id);
    try { window.localStorage.setItem("axv.device", id); } catch { /* 静默 */ }
  };

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftView, setLeftView] = useState<
    "parts" | "layers" | "ai" | "code" | "res" | "assets" | "settings" | "about"
  >("parts");
  /* ===== M20m：图层锁定（锁定后画布点不中、不能拖动/上下移） ===== */
  const [lockedPaths, setLockedPaths] = useState<Set<string>>(new Set());
  const toggleLockPath = useCallback((path: string) => {
    setLockedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  /** 自己或任一祖先被锁定 → 视为锁定（路径形如 #0/1/2） */
  const isPathLocked = useCallback(
    (path: string) => {
      let cur = path;
      for (;;) {
        if (lockedPaths.has(cur)) return true;
        const i = cur.lastIndexOf("/");
        if (i < 0) return false;
        cur = cur.slice(0, i);
      }
    },
    [lockedPaths],
  );

  /* ===== M16i：工作目录 ===== */
  const [projectTab, setProjectTab] = useState<"workspace" | "current">("current");
  const [wsState, setWsState] = useState<WsInfo | null>(null);
  const [wsProjects, setWsProjects] = useState<WsProject[]>([]);
  /** M21：当前编辑内容的来源 —— 决定「保存」是写回原路还是弹选择器 */
  const [saveOrigin, setSaveOrigin] = useState<
    { kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null
  >(null);
  /** M23：界面语言（默认跟随系统） */
  const [langPref, setLangPref] = useState<LangPref>(() => loadLangPref());
  const lang = useMemo(() => resolveLang(langPref), [langPref]);
  const tr = useMemo(() => makeT(lang), [lang]);
  useEffect(() => {
    saveLangPref(langPref);
    // 让 <html lang> 跟着走（影响字距/断行规则，也便于辅助技术识别）
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [langPref, lang]);

  /** M21：另存对话框（新建文件时先确认文件名） */
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("activity_main.xml");
  /* ===== M20n：工作目录多级树（默认全展开） ===== */
  const wsTree = useMemo(() => buildWsTree(wsProjects), [wsProjects]);
  const [wsOpen, setWsOpen] = useState<Set<string>>(new Set());
  useEffect(() => {
    // 目录变化后默认把文件夹全展开（安卓工程层数不多，先让用户看到全貌）
    setWsOpen(new Set(wsProjects.filter((p) => p.kind === "dir").map((p) => p.rel)));
  }, [wsProjects]);
  const toggleWsOpen = useCallback((rel: string) => {
    setWsOpen((prev) => {
      const next = new Set(prev);
      if (next.has(rel)) next.delete(rel);
      else next.add(rel);
      return next;
    });
  }, []);

  const [wsBusy, setWsBusy] = useState(false);
  const [wsMsg, setWsMsg] = useState<string>("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  /** M2s：导出前检查面板 */
  const [exportOpen, setExportOpen] = useState(false);
  const [exportReport, setExportReport] = useState<ExportReport | null>(null);
  /** M13：导出模式（localStorage 记住），compat = 纯平台控件、AIDE 可编译 */
  const [exportMode, setExportMode] = useState<ExportMode>(() => {
    try {
      return window.localStorage.getItem("axv.exportMode") === "compat" ? "compat" : "modern";
    } catch {
      return "modern";
    }
  });
  /** 兼容模式的转换摘要（选 compat 时重算） */
  const [compatNotes, setCompatNotes] = useState<string[]>([]);
  /** M6a：导出预览图（PNG / SVG）弹窗 */
  const [imgExportOpen, setImgExportOpen] = useState(false);
  /** 手机壳 DOM（导出图片要拿它做 DOM → SVG/PNG） */
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const [exportAction, setExportAction] = useState<"download" | "copy">("download");
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  /** M5b：已生成资源管理面板 */
  // M11：设置 / 关于面板
  // M16h：界面主题改成「预设配色方案 + 亮/暗」，token 见 lib/xml/theme-presets.ts
  const [theme, setTheme] = useState<ThemeMode>(() => {
    try {
      return window.localStorage.getItem("axv.theme") === "dark" ? "dark" : "light";
    } catch {
      return "light";
    }
  });
  const [themePreset, setThemePreset] = useState<string>(() => {
    try {
      const p = window.localStorage.getItem("axv.themePreset");
      return p && THEME_PRESETS.some((x) => x.id === p) ? p : DEFAULT_PRESET_ID;
    } catch {
      return DEFAULT_PRESET_ID;
    }
  });
  /** M16d：预览渲染主题（默认 AppCompat，跟 AIDE 真机一致） */
  const [renderTheme, setRenderTheme] = useState<RenderTheme>(() => {
    try {
      const rt = window.localStorage.getItem("axv.renderTheme");
      return rt === "material3" || rt === "appcompat" ? rt : DEFAULT_RENDER_THEME;
    } catch {
      return DEFAULT_RENDER_THEME;
    }
  });
  const [showSystemBars, setShowSystemBars] = useState(true);
  const [showIssues, setShowIssues] = useState(true);

  // M16h：应用配色方案（只影响编辑器外壳，不影响导出/预览）
  useEffect(() => {
    applyThemeToDom(themePreset, theme);
    try {
      window.localStorage.setItem("axv.theme", theme);
      window.localStorage.setItem("axv.themePreset", themePreset);
    } catch {
      /* ignore */
    }
  }, [theme, themePreset]);

  // M11：启动时恢复主题（兼容旧 key：axv.theme=dark）
  // 注意：读 localStorage 必须在 useState 初始化里做，不能放 effect——
  // 否则「持久化 effect」会先一步把默认值写回去，刚存的主题被自己覆盖。

  // M16d：渲染主题持久化
  useEffect(() => {
    try {
      window.localStorage.setItem("axv.renderTheme", renderTheme);
    } catch {
      /* ignore */
    }
  }, [renderTheme]);

  /* ===== M16i：工作目录（默认 /AndroidUIIDE/Project）===== */
  const refreshWorkspace = useCallback(async () => {
    setWsBusy(true);
    try {
      const info = await wsInfo();
      setWsState(info);
      if (info.mode === "unsupported") {
        setWsProjects([]);
      } else if (info.mode === "native" || info.custom) {
        setWsProjects(await wsListProjects());
      } else {
        setWsProjects([]);
      }
    } catch (e) {
      setWsMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setWsBusy(false);
    }
  }, []);

  useEffect(() => {
    if (leftView === "res" || leftView === "settings") void refreshWorkspace();
  }, [leftView, refreshWorkspace]);

  const pickCustomDir = useCallback(async () => {
    const ok = await wsPickCustom();
    if (!ok) {
      setWsMsg(wsState?.mode === "unsupported" ? "当前浏览器不支持，请用 Chrome / Edge 或 APK" : "已取消选择");
      return;
    }
    setWsMsg("");
    // 原生选择器是异步回调，给系统一点时间落盘
    window.setTimeout(() => void refreshWorkspace(), 600);
  }, [refreshWorkspace, wsState?.mode]);

  const useDefaultDir = useCallback(async () => {
    await wsUseDefault();
    setWsMsg("已恢复默认工作目录");
    window.setTimeout(() => void refreshWorkspace(), 400);
  }, [refreshWorkspace]);

  const [mobileTab, setMobileTab] = useState<"preview" | "xml">("preview");


  /** M6g：统一的缩放入口（带钳位 + 锚点）。anchor 传鼠标/双指中心的视口坐标 */
  const ZOOM_MIN = 0.25;
  const ZOOM_MAX = 2;
  const ZOOM_STEP = 0.1;
  const applyZoom = useCallback(
    (next: number, anchor?: { cx: number; cy: number }) => {
      const z = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(next * 100) / 100));
      const ph = phoneRef.current;
      if (anchor && ph) {
        const r = ph.getBoundingClientRect();
        if (r.width > 4 && r.height > 4) {
          zoomAnchor.current = {
            cx: anchor.cx,
            cy: anchor.cy,
            px: (anchor.cx - r.left) / r.width,
            py: (anchor.cy - r.top) / r.height,
          };
        }
      }
      setScale(z);
      setZoomHud(z);
    },
    [],
  );

  /** 缩放后纠正滚动位置：把锚点那个内容点拉回鼠标处 */
  useEffect(() => {
    const a = zoomAnchor.current;
    zoomAnchor.current = null;
    const st = stageRef.current;
    const ph = phoneRef.current;
    if (!a || !st || !ph) return;
    const r = ph.getBoundingClientRect();
    st.scrollLeft += r.left + a.px * r.width - a.cx;
    st.scrollTop += r.top + a.py * r.height - a.cy;
  }, [scale]);

  /** 缩放百分比浮层：停手 900ms 后自动消失 */
  useEffect(() => {
    if (zoomHud === null) return;
    const t = window.setTimeout(() => setZoomHud(null), 900);
    return () => window.clearTimeout(t);
  }, [zoomHud]);

  /** M6g：Ctrl/Cmd+滚轮、双指捏合（必须原生非 passive 监听才能 preventDefault） */
  useEffect(() => {
    if (mobileTab !== "preview") return;
    const st = stageRef.current;
    if (!st) return;
    let pinch0 = 0;
    let pinchScale0 = 1;
    const dist = (t: TouchList) =>
      Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t: TouchList) => ({
      cx: (t[0].clientX + t[1].clientX) / 2,
      cy: (t[0].clientY + t[1].clientY) / 2,
    });
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const mag = Math.abs(e.deltaY * unit);
      const step = ZOOM_STEP * Math.min(3, Math.max(0.5, mag / 100));
      applyZoom(scaleRef.current - Math.sign(e.deltaY) * step, { cx: e.clientX, cy: e.clientY });
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      pinch0 = dist(e.touches);
      pinchScale0 = scaleRef.current;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinch0 <= 0) return;
      e.preventDefault();
      applyZoom(pinchScale0 * (dist(e.touches) / pinch0), mid(e.touches));
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch0 = 0;
    };
    st.addEventListener("wheel", onWheel, { passive: false });
    st.addEventListener("touchstart", onTouchStart, { passive: true });
    st.addEventListener("touchmove", onTouchMove, { passive: false });
    st.addEventListener("touchend", onTouchEnd, { passive: true });
    st.addEventListener("touchcancel", onTouchEnd, { passive: true });
    return () => {
      st.removeEventListener("wheel", onWheel);
      st.removeEventListener("touchstart", onTouchStart);
      st.removeEventListener("touchmove", onTouchMove);
      st.removeEventListener("touchend", onTouchEnd);
      st.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [mobileTab, applyZoom]);

  /** M6g：快捷键 Ctrl/Cmd + = / - / 0 控制画布缩放 */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key;
      if (k === "=" || k === "+") {
        e.preventDefault();
        applyZoom(scaleRef.current + ZOOM_STEP);
      } else if (k === "-" || k === "_") {
        e.preventDefault();
        applyZoom(scaleRef.current - ZOOM_STEP);
      } else if (k === "0") {
        e.preventDefault();
        applyZoom(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [applyZoom]);
  const [history, setHistory] = useState<string[]>(() => {
    const raw = lsGet(LS_KEY_HIST);
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0 && arr.every((x) => typeof x === "string")) {
          return arr;
        }
      } catch {
        /* 损坏则用默认 */
      }
    }
    return [lsGet(LS_KEY_XML) ?? SAMPLES.list];
  });
  const [histIdx, setHistIdx] = useState(() => {
    const raw = lsGet(LS_KEY_HIST);
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length > 0) return Math.max(arr.length - 1, 0);
      } catch {
        /* 损坏则用默认 */
      }
    }
    return 0;
  });

  /* ===== 撤销 / 重做 =====
     用 ref 存栈，避开 setState 异步导致连续操作串位置的问题。
     结构变更立即入栈；手动敲代码则防抖 500ms 合并成一步。 */
  const histRef = useRef<{ stack: string[]; idx: number }>({
    stack: history,
    idx: histIdx,
  });
  const textTimer = useRef<number | null>(null);

  const syncHist = () => {
    setHistory(histRef.current.stack);
    setHistIdx(histRef.current.idx);
  };
  /** M2u：合并窗口——同一手势 key 在 900ms 内连续提交 → 只覆盖栈顶，不新增撤销点 */
  const lastCommitRef = useRef<MergeMark>(EMPTY_MARK);
  const commitHistory = useCallback((next: string, key = "") => {
    const res = commitHistoryState(histRef.current, next, {
      key,
      now: Date.now(),
      mark: lastCommitRef.current,
    });
    if (res.unchanged) return;
    histRef.current = res.state;
    lastCommitRef.current = res.mark;
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
    lastCommitRef.current = EMPTY_MARK; // M2u：撤销后断开合并链，新操作必须新建撤销点
    setXml(h.stack[h.idx]);
    syncHist();
  };
  const redo = () => {
    flushTextTimer();
    const h = histRef.current;
    if (h.idx >= h.stack.length - 1) return;
    h.idx += 1;
    lastCommitRef.current = EMPTY_MARK;
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

  // ===== 键盘快捷键：Ctrl/⌘ + Z 撤销 / Y 重做 / S 保存 / F 格式化 =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === "y") {
        e.preventDefault();
        redo();
      } else if (k === "s") {
        e.preventDefault();
        saveProject();
      } else if (k === "f") {
        e.preventDefault();
        doFormat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ===== 自动保存：xml / 历史 / 资源 / 项目 变更即写 localStorage（防抖 400ms） =====
  useEffect(() => {
    const t = window.setTimeout(() => {
      lsSet(LS_KEY_XML, xml);
      // M9：当前编辑内容回写进项目（对象引用不变时不产生新对象，下面的持久化 effect 不会空转）
      setProject((p) => updateFileXml(p, p.activeId, xml));
    }, 400);
    return () => window.clearTimeout(t);
  }, [xml]);
  // M9：项目持久化（含全部文件的 xml；超配额就放弃，不影响编辑）
  useEffect(() => {
    const t = window.setTimeout(() => {
      lsSet(LS_KEY_PROJECT, serializeProject(project));
    }, 600);
    return () => window.clearTimeout(t);
  }, [project]);
  useEffect(() => {
    const t = window.setTimeout(() => {
      lsSet(LS_KEY_HIST, JSON.stringify(history));
    }, 600);
    return () => window.clearTimeout(t);
  }, [history]);
  useEffect(() => {
    // resExtras 里 dataURL 可能很大，写前检查配额
    if (!resExtras) return;
    try {
      const blob = JSON.stringify({ extras: resExtras, fragment: resourceFragment });
      if (blob.length < 4_500_000) lsSet(LS_KEY_RES, blob);
    } catch {
      /* 超配额放弃 */
    }
  }, [resExtras, resourceFragment]);

  // 启动时恢复资源（一次性）
  useEffect(() => {
    const raw = lsGet(LS_KEY_RES);
    if (!raw) return;
    try {
      const { extras, fragment } = JSON.parse(raw);
      if (extras && typeof extras === "object" && extras.drawables) {
        // M4v：老缓存里 vector 只有名字、没全文 → 从 tree 回填，不用重新导入 res
        try {
          backfillDrawableXml(extras as ResourceExtras);
        } catch {
          /* 结构异常就当没回填 */
        }
        setResExtras(extras);
      }
      if (typeof fragment === "string" && fragment) setResourceFragment(fragment);
    } catch {
      /* 损坏忽略 */
    }
  }, []);

  // M3g：图标矢量 自动保存 + 恢复
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        lsSet(LS_KEY_ICONS, JSON.stringify(generatedDrawables));
      } catch {
        /* 超配额放弃 */
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [generatedDrawables]);
  useEffect(() => {
    const raw = lsGet(LS_KEY_ICONS);
    if (!raw) return;
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      if (obj && typeof obj === "object") {
        // M4t：丢掉非法资源名（旧版本可能存了 "#E8EEFA" 这种；aapt 只认小写字母数字下划线）
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(obj)) {
          if (typeof v === "string" && /^[a-z][a-z0-9_]*$/.test(k)) clean[k] = v;
        }
        // M4w：旧版生成的图标 y 全落在视口外（画出来是空白）→ 载入时自动归位到 0–24
        const fixed = repairGeneratedVectors(clean);
        setGeneratedDrawables(fixed.map);
        // M4y：旧版图标是 opentype glyf 直出（实心样式），与选择器列表的样式不一致。
        // 这里按「列表同款渲染」重描一遍，只动 ic_* 且确实是图标名的条目。
        void (async () => {
          const stale = Object.entries(fixed.map).filter(([k, v]) => {
            const iconName = k.replace(/^ic_/, "");
            return hasIcon(iconName) && looksLikeGlyfVector(v);
          });
          if (stale.length === 0) return;
          const next = { ...fixed.map };
          let n = 0;
          for (const [res, xml] of stale) {
            try {
              const vec = await getIconVectorWysiwyg(res.replace(/^ic_/, ""));
              if (vec) {
                next[res] = vec;
                n++;
              }
            } catch {
              /* 单个失败不影响其它 */
            }
          }
          if (n > 0) {
            setGeneratedDrawables(next);
            setExportNote(`已按选择器同款样式重建 ${n} 个图标`);
            window.setTimeout(() => setExportNote(""), 4200);
          }
        })();
        if (fixed.repaired.length > 0) {
          setExportNote(`已修正 ${fixed.repaired.length} 个旧图标的坐标（之前预览是空白）`);
          window.setTimeout(() => setExportNote(""), 4200);
        }
      }
    } catch {
      /* 损坏忽略 */
    }
  }, []);

  /** M3g：选中图标 → 存矢量原文 + 把属性写成 @drawable/资源名 */
  const onPickIcon = useCallback(
    (attrName: string, resourceName: string, vectorXml: string) => {
      // M4f：资源名必须是 aapt 合法的 a-z0-9_，否则会落成 #00c853.xml 之类编译不过的文件
      const safe = sanitizeResName(resourceName, "ic");
      setGeneratedDrawables((m) => ({ ...m, [safe]: vectorXml }));
      if (selectedPath) {
        // 通过 commitAttr 把属性改成 @drawable/<资源名>
        commitAttrRef.current(attrName, `@drawable/${safe}`);
      }
      setExportNote(`已生成 res/drawable/${safe}.xml，属性指向它（导出 res 包时会自动包含）`);
      window.setTimeout(() => setExportNote(""), 3600);
    },
    [selectedPath],
  );

  /** M3h：形状 → 存 xml + 把属性写成 @drawable/资源名（与图标同一存储） */
  const onSaveShape = useCallback(
    (attrName: string, resourceName: string, shapeXml: string) => {
      const safe = sanitizeResName(resourceName, "bg");
      setGeneratedDrawables((m) => ({ ...m, [safe]: shapeXml }));
      if (selectedPath) commitAttrRef.current(attrName, `@drawable/${safe}`);
      setExportNote(`已生成 res/drawable/${safe}.xml（含水波纹？${shapeXml.includes("<ripple") ? "是" : "否"}），属性指向它`);
      window.setTimeout(() => setExportNote(""), 3600);
    },
    [selectedPath],
  );

  const resources: ResourceTable = useMemo(() => {
    // 顺序：内置默认 → 上传 res/ 里的 values（真实 color/dimen/string）→ 用户手贴片段（最高优先）
    let base: ResourceTable = DEFAULT_RESOURCES;
    const fragment = [resExtras?.valuesXml ?? "", sampleValues, resourceFragment]
      .filter((x) => x.trim())
      .join("\n");
    if (fragment.trim()) base = mergeResourceFragment(fragment);
    base = {
      ...base,
      drawables: { ...(resExtras?.drawables || {}), ...(base.drawables || {}), ...generatedDataUrls },
      vectorNames: [...(resExtras?.vectorNames || []), ...(base.vectorNames || []), ...generatedVectorNames],
      drawableXml: { ...(resExtras?.drawableXml || {}), ...(base.drawableXml || {}), ...generatedShapeXml },
    };
    if (resExtras) {
      base = {
        ...base,
        themeAttrs: resExtras.themeAttrs,
        styles: resExtras.styles,
      };
    }
    return base;
  }, [resourceFragment, sampleValues, resExtras, generatedDataUrls, generatedVectorNames, generatedShapeXml]);

  /** M3g/M3h：把已生成资源（图标矢量 + 自定义形状）也并进 resExtras，导出 res 包时能带上 */
  const resExtrasAll = useMemo(() => {
    if (!resExtras && Object.keys(generatedDrawables).length === 0) return null;
    return {
      drawables: { ...(resExtras?.drawables || {}), ...generatedDataUrls },
      vectorNames: [...(resExtras?.vectorNames || []), ...generatedVectorNames],
      drawableXml: { ...(resExtras?.drawableXml || {}), ...generatedShapeXml },
      themeAttrs: resExtras?.themeAttrs ?? {},
      styles: resExtras?.styles ?? {},
      valuesXml: resExtras?.valuesXml ?? "",
      sourceFiles: resExtras?.sourceFiles ?? [],
      counts: resExtras?.counts ?? { images: 0, vectors: 0, values: 0, styles: 0, shapes: 0 },
      tree: resExtras?.tree,
      layouts: resExtras?.layouts,
    };
  }, [resExtras, generatedDrawables, generatedDataUrls]);

  const [measured, setMeasured] = useState<MeasuredMap | null>(null);
  /** M2t：实测收敛计数器（避免 auto ↔ px 互推无限循环） */
  const measurePass = useRef(0);

  /** M20：画布缩放要进布局本身（不能只改外壳）。
   *  否则字号/padding/dp 全是 1x 尺寸、只有百分比宽度跟着长 → 缩放后「格子宽了、字没变大」；
   *  match_parent 被算成固定 px 的节点（CL/RL/表格里的）更是完全不动。
   *  DPX = 1dp 对应的 px = SCALE(2) × 用户缩放 × 视觉补偿因子。
   *  M20h→用户手动：缩小档 ×3、放大档 ÷3（原 1.3 太温和，用户直接改成 3 试试）；1:1 不变 */
  /** M20i：回退到今天之前的实现（用户要求）。
   *  布局模型固定用 SCALE（不随用户缩放），缩放只作用于外壳/状态栏/导航栏。
   *  DPX = 1dp 对应 px（含用户缩放），仅用于状态栏/导航栏高度与圆角。 */
  const DPX = SCALE * scale;

  const { model, issues, parseErr, parseReason } = useMemo((): {
    model: RenderModel | null;
    issues: XmlIssue[];
    parseErr: boolean;
    parseReason: string;
  } => {
    // M22：解析 / 约束求解全程兜住异常 —— 半个 XML、错标签、坏属性都不能让整个页面白屏
    try {
      const parsed = parseLayoutXml(parsedXml);
      if (!parsed.root) {
        const first = parsed.issues.find((i) => i.level === "error");
        return {
          model: null,
          issues: parsed.issues,
          parseErr: true,
          parseReason: first ? first.message : "没有可识别的根布局节点",
        };
      }
      // M2q：把上传 res/layout 里的布局传进去，供 <include> 就地展开
      // M2r：屏幕尺寸传入，影响 match_parent 根 / CL 内容区回落值
      // M2t：wrap 实测表传入，CL/RL 求解的 wrap 维度不再靠 estSize 估
      return {
        model: buildRenderModel(
          parsed.root,
          resources,
          SCALE,
          resExtras?.layouts,
          { w: device.w, h: device.h },
          measured ?? undefined,
          renderTheme,
        ),
        issues: parsed.issues,
        parseErr: false,
        parseReason: "",
      };
    } catch (e) {
      console.error("[axv] 渲染模型构建失败", e);
      return {
        model: null,
        issues: [],
        parseErr: true,
        parseReason: `渲染失败：${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }, [parsedXml, resources, resExtras?.layouts, device, measured, renderTheme]);

  /** M2t：XML / 设备变了 → 旧 path 可能指向别的节点，实测表作废重测 */
  useEffect(() => {
    measurePass.current = 0;
    setMeasured((m) => (m ? null : m));
  }, [parsedXml, device]);

  /**
   * M2t：wrap_content 真实尺寸回填。
   * CL/RL 的子项是 absolute（wrap 轴已写成 width/height:auto），渲染后读 offsetWidth/Height
   * 就是浏览器按真实文字/图标算出的尺寸 → 回填给下一个渲染循环，兄弟锚点/居中/bias 才准。
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const host = document.querySelector(".axv-phone-body");
    if (!host) return;
    const next: MeasuredMap = new Map();
    host.querySelectorAll<HTMLElement>("[data-path]").forEach((el) => {
      if (el.style.position !== "absolute") return; // 只看 CL/RL 直接子项
      const p = el.dataset.path;
      if (!p) return;
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (w > 0 && h > 0) next.set(p, { w, h });
    });
    if (next.size === 0) return;
    let changed = false;
    if (!measured || measured.size !== next.size) changed = true;
    else {
      for (const [k, v] of next) {
        const o = measured.get(k);
        if (!o || Math.abs(o.w - v.w) > 1 || Math.abs(o.h - v.h) > 1) {
          changed = true;
          break;
        }
      }
    }
    if (!changed) return;
    if (measurePass.current >= 4) return; // 收敛护栏：最多重排 4 轮
    measurePass.current += 1;
    setMeasured(next);
  }, [model, measured]);

  /** 图层树用的原始节点树（不经渲染模型） */
  const treeRoot = useMemo(() => {
    if (parseErr) return null;
    try {
      return parseLayoutXml(parsedXml).root;
    } catch (e) {
      console.error("[axv] 解析图层树失败", e);
      return null;
    }
  }, [parsedXml, parseErr]);

  /** 代码视图的结构检查（带行号，标红用） */
  const lints = useMemo(() => {
    try {
      return lintXml(parsedXml);
    } catch (e) {
      console.error("[axv] 结构检查失败", e);
      return [] as ReturnType<typeof lintXml>;
    }
  }, [parsedXml]);
  /** M22：能渲染但有结构错误时，画布上给一条可跳转的提示（不阻断预览） */
  const lintErrCount = useMemo(() => {
    try {
      return lints.filter((l) => l.level === "error").length;
    } catch {
      return 0;
    }
  }, [lints]);

  /** M2y：代码编辑器光标行 → 选中对应画布节点（反跳，和画布 → 行号正跳对称） */
  const onCodeCursorLine = useCallback(
    (line: number) => {
      if (!treeRoot || line < 1) return;
      const n = nodeAtLine(treeRoot, line);
      if (n && n.path !== selectedPath) setSelectedPath(n.path);
    },
    [treeRoot, selectedPath],
  );

  /** 一键格式化：重排缩进，保留注释，可撤销 */
  const doFormat = () => {
    const next = formatXml(xml, 2);
    if (next !== xml) setXmlAndTrack(next);
  };

  /* ===== ConstraintLayout 约束编辑（一期：表单 + 自动推断） ===== */
  const [autoNotes, setAutoNotes] = useState<string[]>([]);
  useEffect(() => setAutoNotes([]), [selectedPath]);

  /** M16e：根 → 当前节点的层级链（右侧属性面板顶部展示，可点击跳层） */
  const pathChain = useMemo(() => pathChainOf(treeRoot, selectedPath), [treeRoot, selectedPath]);

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
    (next: string, /** M2u：同一手势 key 在 900ms 内合并成一步撤销 */ mergeKey?: string) => {
      flushTextTimer();
      setXml(next);
      commitHistory(next, mergeKey ?? "");
    },
    [flushTextTimer, commitHistory],
  );

  /** M16i：从工作目录打开项目（依赖 setXmlAndTrack，必须放在它后面） */
  const openWsProject = useCallback(
    async (p: WsProject) => {
      try {
        const r = await wsOpenProject(p);
        if (!r) {
          setWsMsg(`打不开《${p.name}》：没有可读的 layout xml，或目录权限已被收回`);
          return;
        }
        setXmlAndTrack(r.text);
        // M21：记住来源，保存时优先写回原路径
        if (p.target) setSaveOrigin({ kind: "native", target: p.target, name: p.name });
        else if (p.handle) setSaveOrigin({ kind: "handle", handle: p.handle, name: p.name });
        else setSaveOrigin(null);
        setWsMsg(`已打开 ${r.name}`);
      } catch (e) {
        setWsMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [setXmlAndTrack],
  );

  /** M20n：把树拍平成行（文件夹可折叠，缩进表示层级） */
  const renderWsRows = (nodes: WsNode[], depth: number): React.ReactNode[] => {
    const rows: React.ReactNode[] = [];
    for (const n of nodes) {
      const isDir = n.kind === "dir";
      const open = wsOpen.has(n.rel);
      rows.push(
        <li key={n.rel + ":" + n.kind}>
          <div className="axv-ws-row" style={{ paddingLeft: depth * 14 }}>
            {isDir ? (
              <button
                className="axv-ws-caret"
                title={open ? "折叠" : "展开"}
                aria-label={open ? "折叠" : "展开"}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleWsOpen(n.rel);
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
                  {open ? "expand_more" : "chevron_right"}
                </span>
              </button>
            ) : (
              <span className="axv-ws-caret" aria-hidden="true" />
            )}
            <button className="axv-ws-item" onClick={() => void openWsProject(n.item)} title={n.rel}>
              <span className="msr axv-ws-item-icon" aria-hidden="true">
                {isDir ? (open ? "folder_open" : "folder") : "description"}
              </span>
              <span className="axv-ws-item-main">
                <span className="axv-ws-item-name">{n.name}</span>
                <span className="axv-ws-item-sub">
                  {isDir ? `${n.layoutCount} 个布局` : "单个 xml"}
                </span>
              </span>
            </button>
            {isDir && n.layoutCount > 0 ? (
              <button
                className="axv-ws-open"
                title="打开这个文件夹里的主布局"
                aria-label="打开项目"
                onClick={(e) => {
                  e.stopPropagation();
                  void openWsProject(n.item);
                }}
              >
                <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>play_arrow</span>
              </button>
            ) : null}
          </div>
        </li>,
      );
      if (isDir && open && n.children.length > 0) rows.push(...renderWsRows(n.children, depth + 1));
    }
    return rows;
  };

  /** 载入完整示例项目：布局 + 自带 drawable + values 一起换（合并语义：用户已有资源不会被覆盖） */
  const applySampleProject = useCallback(
    (key: string) => {
      const p = sampleProjectByKey(key);
      if (!p) return;
      setXmlAndTrack(p.layout);
      setGeneratedDrawables((m) => ({ ...p.drawables, ...m }));
      setSampleValues(p.values ?? "");
      setSelectedPath(null);
      setExportNote(
        `已载入示例项目「${p.name}」· ${p.library}，自带 ${Object.keys(p.drawables).length} 个 drawable`,
      );
      window.setTimeout(() => setExportNote(""), 4600);
    },
    [setXmlAndTrack],
  );

  const applyBlankTemplate = useCallback(
    (key: string) => {
      const b = SAMPLE_BLANKS.find((t) => t.key === key);
      if (!b) return;
      setXmlAndTrack(b.layout);
      setSelectedPath(null);
    },
    [setXmlAndTrack],
  );

  /** M9：多文件切换 —— 先把当前编辑内容回写到项目，再切到目标文件，撤销栈跟着文件走 */
  const selectFile = useCallback(
    (id: string) => {
      flushTextTimer();
      setProject((p) => {
        const withSaved = updateFileXml(p, p.activeId, xml);
        const next = switchFile(withSaved, id);
        const target = activeFile(next);
        if (target && target.id !== p.activeId) {
          setXml(target.xml);
          histRef.current = { stack: [target.xml], idx: 0 };
          syncHist();
          setSelectedPath(null);
        }
        return next;
      });
    },
    [flushTextTimer, xml],
  );

  const newFile = useCallback(() => {
    flushTextTimer();
    setProject((p) => {
      const withSaved = updateFileXml(p, p.activeId, xml);
      const n = withSaved.files.length;
      const { project: next, id } = addFile(
        withSaved,
        `untitled_${n + 1}.xml`,
        `<?xml version="1.0" encoding="utf-8"?>\n<LinearLayout\n    xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent"\n    android:orientation="vertical">\n\n</LinearLayout>\n`,
      );
      if (!id) {
        setExportNote(`最多 ${n} 个文件，新建失败`);
        window.setTimeout(() => setExportNote(""), 3600);
        return withSaved;
      }
      const target = activeFile(next)!;
      setXml(target.xml);
      histRef.current = { stack: [target.xml], idx: 0 };
      syncHist();
      setSelectedPath(null);
      setExportNote(`已新建「${target.name}」`);
      window.setTimeout(() => setExportNote(""), 2400);
      return next;
    });
  }, [flushTextTimer, xml]);

  const renameActiveFile = useCallback(() => {
    const cur = activeFile(project);
    if (!cur) return;
    const input = window.prompt(`重命名「${cur.name}」`, cur.name);
    if (!input || input === cur.name) return;
    setProject((p) => renameFile(p, cur.id, input));
  }, [project]);

  const deleteActiveFile = useCallback(() => {
    const cur = activeFile(project);
    if (!cur || project.files.length <= 1) {
      setExportNote("项目里只剩最后一个文件，删不了（先新建一个）");
      window.setTimeout(() => setExportNote(""), 3600);
      return;
    }
    if (!window.confirm(`删除「${cur.name}」？该文件内容会丢失。`)) return;
    flushTextTimer();
    setProject((p) => {
      const withSaved = updateFileXml(p, p.activeId, xml);
      const next = removeFile(withSaved, cur.id);
      const target = activeFile(next)!;
      setXml(target.xml);
      histRef.current = { stack: [target.xml], idx: 0 };
      syncHist();
      setSelectedPath(null);
      return next;
    });
    setExportNote(`已删除「${cur.name}」`);
    window.setTimeout(() => setExportNote(""), 2400);
  }, [flushTextTimer, project, xml]);

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

  /** M5b：资源改名 —— 同步改布局里的 @drawable/x 引用（依赖 setXmlAndTrack，故定义在此） */
  const onRenameAsset = (oldName: string, newName: string) => {
    const next = renameAsset(generatedDrawables, oldName, newName);
    if (!next) return;
    setGeneratedDrawables(next);
    if (xml.includes(`@drawable/${oldName}`) || xml.includes(`@mipmap/${oldName}`)) {
      setXmlAndTrack(renameReferences(xml, oldName, newName));
    }
  };

  /** M5b：删除生成资源（布局里的引用变成缺失资源占位） */
  const onDeleteAsset = (name: string) => {
    setGeneratedDrawables((m) => {
      if (!(name in m)) return m;
      const next = { ...m };
      delete next[name];
      return next;
    });
  };

  /** 资源面板 / 图标选完后的提示条 */
  const assetsNote = (text: string) => {
    setExportNote(text);
    window.setTimeout(() => setExportNote(" "), 3600);
  };

  const insertWidget = (w: WidgetDef) => {
    const frag = stripNs(w.xml);
    const { root } = parseLayoutXml(xml);
    const targetNode = selectedPath && selectedPath !== "#0" && root ? findNode(root, selectedPath) : null;
    // 优先：选中的是容器且还能接收子控件 → 插入为它的子节点
    if (targetNode) {
      const chk = canAcceptChild(targetNode.tag, targetNode.children.length);
      if (chk.ok) {
        const res = insertChild(xml, selectedPath!, frag, w.label);
        if (res.ok) {
          const withDef = res.insertedPath ? applyConstraintDefaults(res.xml, res.insertedPath) : res.xml;
          setXmlAndTrack(withDef);
          if (res.insertedPath) setSelectedPath(res.insertedPath);
          return;
        }
        // 插入失败（理论上 chk.ok 时不会，但保险）：提示后退回兄弟插入
        setExportNote(res.issues[0]?.message || "插入失败");
        window.setTimeout(() => setExportNote(""), 3000);
      } else {
        // 选中叶子节点 / 单 child 容器已满 → 作为兄弟插到它后面
        const res = insertSiblingAfter(xml, selectedPath!, frag, w.label);
        if (res.ok) {
          const withDef = res.insertedPath ? applyConstraintDefaults(res.xml, res.insertedPath) : res.xml;
          setXmlAndTrack(withDef);
          if (res.insertedPath) setSelectedPath(res.insertedPath);
          return;
        }
        setExportNote(res.issues[0]?.message || "插入失败");
        window.setTimeout(() => setExportNote(""), 3000);
        return;
      }
    }
    // 无选中 / 选中是根节点 / 选中叶子但兄弟插入失败 → 插入到根末尾
    const res = insertChild(xml, "#0", frag, w.label);
    if (res.ok) {
      const withDef = res.insertedPath ? applyConstraintDefaults(res.xml, res.insertedPath) : res.xml;
      setXmlAndTrack(withDef);
      if (res.insertedPath) setSelectedPath(res.insertedPath);
    } else if (res.issues[0]) {
      setExportNote(res.issues[0].message);
      window.setTimeout(() => setExportNote(""), 3000);
    }
  };

  /** 画布拖放：落到容器上→校验能否接收后追加为子节点；落到叶子→插到它后面作为兄弟 */
  const onDropWidget = (path: string, key: string, isContainer: boolean) => {
    const w = WIDGET_MAP[key];
    if (!w) return;
    const frag = stripNs(w.xml);
    if (isContainer) {
      const { root } = parseLayoutXml(xml);
      const target = root ? findNode(root, path) : null;
      // 校验：该容器还能接收子控件吗？
      if (target) {
        const chk = canAcceptChild(target.tag, target.children.length);
        if (!chk.ok) {
          setExportNote(chk.reason || "无法插入");
          window.setTimeout(() => setExportNote(""), 3000);
          return;
        }
      }
      const r = insertAt(xml, path, target ? target.children.length : 0, frag, w.label);
      if (r.ok) {
        const withDef = r.insertedPath ? applyConstraintDefaults(r.xml, r.insertedPath) : r.xml;
        setXmlAndTrack(withDef);
        if (r.insertedPath) setSelectedPath(r.insertedPath);
      } else if (r.issues[0]) {
        setExportNote(r.issues[0].message);
        window.setTimeout(() => setExportNote(""), 3000);
      }
      return;
    }
    const r = insertSiblingAfter(xml, path, frag, w.label);
    if (r.ok) {
      const withDef = r.insertedPath ? applyConstraintDefaults(r.xml, r.insertedPath) : r.xml;
      setXmlAndTrack(withDef);
      if (r.insertedPath) setSelectedPath(r.insertedPath);
    } else if (r.issues[0]) {
      setExportNote(r.issues[0].message);
      window.setTimeout(() => setExportNote(""), 3000);
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
  /**
   * 结构自检：标签没闭合 / 有多个根时，按 path 切片会切到錯的区间（历史上因此丢节点、重复节点）。
   * 这种时候宁可不改，也不要把文档弄得更乱——顺手把提示挂在底部提示条上。
   */
  const structureBroken = (): boolean => {
    const root = scanElements(xml);
    const broken = !root || !!xml.slice(root.end).trim();
    if (broken) setExportNote("当前 XML 结构不完整（有标签没闭合），层级调整已暂停；请先在代码里补齐闭合标签");
    return broken;
  };

  const onMoveSibling = (targetPath: string, toIndex: number) => {
    if (structureBroken()) return;
    const r = moveSibling(xml, targetPath, toIndex);
    if (r.ok) {
      setXmlAndTrack(r.xml);
      if (r.newPath) setSelectedPath(r.newPath);
    }
  };

  /** M3d：拖拽调整层级（三种落点：上一兄弟 / 作为子项 / 下一兄弟） */
  const onDragMoveNode = (fromPath: string, target: { path: string; zone: "before" | "inside" | "after" }) => {
    if (structureBroken()) return;
    const { root } = parseLayoutXml(xml);
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

    const r = moveNodeRaw(xml, fromPath, { parentPath, index, maxChildren });
    if (r.ok) {
      setXmlAndTrack(r.xml);
      if (r.newPath) setSelectedPath(r.newPath);
    } else if (r.issues.length) {
      setExportNote(r.issues[0].message);
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
  const commitAttrRef = useRef<(name: string, value: string) => void>(() => {});
  const commitAttr = (name: string, value: string) => {
    if (!selectedPath) return;
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
    const r = writebackAttrs(xml, selectedPath, { [name]: value }, remove);
    // M2u：属性面板连续改同一属性（拖动滑杆/输入）合并成一步撤销
    if (r.changed) setXmlAndTrack(r.xml, `attr:${selectedPath}:${name}`);
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
    const r = writebackAttrs(xml, path, set, []);
    // M2u：同一节点连续拖动/拉伸（900ms 内）合并成一步撤销；换节点则重新计数
    if (r.changed) setXmlAndTrack(r.xml, `geom:${path}`);
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

  const widthPx = Math.round(device.w * SCALE * scale);
  const heightPx = Math.round(device.h * SCALE * scale);
  /** 屏 dp → px（含用户缩放） */
  /** 手机外壳边框宽（px）；内容区保持 412x892dp 不被边框吃掉
   *  M12：必须和 xml-canvas.css 里 `.axv-phone` 的 `border: 8px` 一致。
   *  之前这里是 2，CSS 是 8 → border-box 下内容区比模型假设窄 12px，
   *  导致 CL/RL 的 match_parent 子项比内容区宽 12px，肉眼看到「右边偏窄/贴边」。 */
  const PHONE_BORDER = 8;
  const outerW = widthPx + PHONE_BORDER * 2;
  const outerH = heightPx + PHONE_BORDER * 2;
  /** 状态栏 24dp（Android 默认高度） */
  const STATUS_BAR_H = Math.round(24 * DPX);
  /** 三键导航栏 48dp */
  const NAV_BAR_H = Math.round(48 * DPX);
  /** 按根布局背景色推导状态栏/导航栏文字颜色（深底浅字 / 浅底深字） */
  const phoneTheme = readableOn(
    String(model?.root?.style?.backgroundColor ?? model?.root?.style?.background ?? ""),
  );
  const phoneBg = phoneTheme.bg;
  const phoneFg = phoneTheme.fg;

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
    // M20i：用户要求复原为之前的实现（基准装入比 × 用户缩放）
    const baseW = device.w * SCALE + PHONE_BORDER * 2;
    const fitBase = Math.min(1, avail / Math.max(1, baseW));
    return Math.min(1, fitBase * scale);
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

/** 在渲染模型里按 path 找节点（findResolvedNode 的别名，历史命名保留） */
const findResolved = findResolvedNode;
  /** M6d：载入一个 .xml 文件（工具栏按钮 / 资源面板按钮 / 拖拽入口共用）
   *  校验类型与大小，try/catch 读取，载入前预检可解析性，解析不了就提示而不留坏文件 */
  const loadXmlFile = (f: File) => {
    // 1) 类型校验：后缀必须 .xml
    if (!/\.xml$/i.test(f.name)) {
      setExportNote(`「${f.name}」不是 .xml 文件，已忽略`);
      window.setTimeout(() => setExportNote(""), 3600);
      return;
    }
    // 2) 大小上限（5MB），防止巨型文件卡死浏览器
    if (f.size > 5 * 1024 * 1024) {
      setExportNote(`「${f.name}」超过 5MB，不加载`);
      window.setTimeout(() => setExportNote(""), 4000);
      return;
    }
    // 3) 读取（try/catch，File.text() 会 reject）
    f.text()
      .then((txt) => {
        // 4) M22：坏文件也照常载入 —— 由用户在代码面板修正，而不是被拒之门外
        let parseOk = true;
        let firstErr = "";
        try {
          const { root, issues } = parseLayoutXml(txt);
          const errs = issues.filter((i) => i.level === "error");
          if (!root) {
            parseOk = false;
            firstErr = errs[0]?.message || "没有可识别的根布局节点";
          } else if (errs.length > 0) {
            firstErr = errs[0].message;
          }
        } catch (e) {
          parseOk = false;
          firstErr = e instanceof Error ? e.message : String(e);
        }

        // M9：打开的文件作为项目里的一个新文件（同名自动加序号），不再冲掉当前内容
        const res2 = addFile(project, f.name, txt);
        if (res2.id) setProject(res2.project);
        setXmlAndTrack(txt);

        if (!parseOk) {
          // 解析失败 → 切到代码面板，让用户就地改；画布会显示失败说明，不会崩
          setLeftView("code");
          setLeftOpen(true);
          setFocusLine(1);
          setFocusTick((t) => t + 1);
          setExportNote(`「${f.name}」有不完整或错误的结构（${firstErr}），已切到代码面板，改好画布会自动恢复`);
          window.setTimeout(() => setExportNote(""), 7000);
          return;
        }
        if (firstErr) {
          setExportNote(`已载入「${f.name}」，但有结构问题：${firstErr}（可在代码面板修正）`);
          window.setTimeout(() => setExportNote(""), 6000);
        } else if (!res2.id) {
          setExportNote(`项目文件已达上限（${MAX_FILES} 个），仍已载入「${f.name}」但未入项目`);
          window.setTimeout(() => setExportNote(""), 4600);
        } else {
          setExportNote(`已载入「${f.name}」`);
          window.setTimeout(() => setExportNote(""), 2400);
        }
      })
      .catch((err) => {
        console.error("[axv] 读取 xml 文件失败", err);
        setExportNote(`读取「${f.name}」失败，请重试`);
          window.setTimeout(() => setExportNote(""), 4000);
      });
  };

  /** 打开 .xml 文件（弹系统文件选择器） */
  const openProject = () => {
    // M21：浏览器支持 File System Access 时带句柄打开 → 之后「保存」能写回原路径
    void (async () => {
      const picked = await pickXmlFile();
      if (picked) {
        const fake = new File([picked.text], picked.name, { type: "text/xml" });
        loadXmlFile(fake);
        setSaveOrigin({ kind: "handle", handle: picked.handle, name: picked.name });
        return;
      }
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".xml";
      input.onchange = () => {
        const f = input.files?.[0];
        if (f) {
          setSaveOrigin(null); // 普通 <input> 拿不到写句柄
          loadXmlFile(f);
        }
      };
      input.click();
    })();
  };

  /** M3b：上传 res/ 目录，解析 drawable/vector/values/styles。
   *  带容错：文件数为空、全部不是 res 结构、buildResourceExtras 抛错都有友好提示 */
  const onPickRes = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) {
      setExportNote("未选择任何文件（目录选择器取消或目录为空）");
      window.setTimeout(() => setExportNote(""), 3000);
      return;
    }
    const items = Array.from(fileList).map((f) => {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      return { name: f.name, path: rel, file: f };
    });
    // 提示：选到的是目录吗？（webkitRelativePath 存在 = 目录模式；否则 = 散件模式）
    const isDirMode = items.some((it) => it.path !== it.name);
    if (!isDirMode) {
      setExportNote("提示：选中的是散文件，建议选整个 res 目录（含 drawable/ values/ layout/）效果最佳");
    }
    try {
      const extras = await buildResourceExtras(items);
      setResExtras(extras);
      const c = extras.counts;
      setExportNote(
        `已读取 res：图片 ${c.images} / 矢量 ${c.vectors} / values ${c.values} / 样式 ${c.styles}` +
          (isDirMode ? "" : "（散件模式，可能不完整）"),
      );
      window.setTimeout(() => setExportNote(""), 3600);
    } catch (err) {
      console.error("[axv] 读取 res 失败", err);
      setExportNote("读取 res 失败，请确认目录结构合法（参考 console）");
      window.setTimeout(() => setExportNote(""), 4000);
    }
  };

  /** 清掉已上传的资源，回到内置默认 */
  /** M3g：导出 res 包（zip）：布局 + 图标矢量 + 上传的 shape/values 一起带走，
   *  避免别处打开工程时「找不到图标文件」。*/
  const doDownloadResZip = () => {
    const layout = exportLayoutXml(xml, { mode: exportMode });
    const entries = buildResBundle({ layoutXml: layout, generatedDrawables, extras: resExtrasAll });
    const missing = missingDrawables(layout, entries);
    const bytes = makeZip(entries);
    downloadBytes(bytes, "res.zip");
    setExportNote(
      `已导出 res.zip（${entries.length} 个文件）` +
        (missing.length
          ? `；还有 ${missing.length} 个 @drawable 引用未覆盖：${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " …" : ""}（需上传 res 目录补齐）`
          : "；布局里引用的图标资源已全部包含"),
    );
    window.setTimeout(() => setExportNote(""), 4200);
  };

  const clearRes = () => {
    setResExtras(null);
    setResourceFragment("");
    try {
      window.localStorage.removeItem(LS_KEY_RES);
    } catch {
      /* ignore */
    }
    if (resDirRef.current) resDirRef.current.value = "";
    setExportNote("已清除上传的 res 资源");
    window.setTimeout(() => setExportNote(""), 2400);
  };

  /** M3：生成正式 Android 布局 XML 并下载。导出前检查：结构错误阻断；语义提示允许忽略继续
   *  M2s：改成可视化检查面板（不再用 alert/confirm） */
  const doDownload = () => {
    const body = exportLayoutXml(xml, { mode: exportMode });
    if (saveTextNative("activity_main.xml", body, "text/xml")) {
      setExportNote(`已保存 activity_main.xml（${workspaceLabel() || "工作目录"}）`);
      window.setTimeout(() => setExportNote(""), 2400);
      return;
    }
    const blob = new Blob([body], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "activity_main.xml";
    a.click();
    URL.revokeObjectURL(a.href);
    setExportNote(`已导出 activity_main.xml`);
    window.setTimeout(() => setExportNote(""), 2400);
  };

  /** M21：保存
   *  - 从工作目录/本地打开的文件：写回**原路径**（依赖资源写到同级 res 目录）
   *  - 新建文件：先确认文件名 → 再弹系统文件夹选择器（可新建文件夹）→ 按 res 结构一起写
   *  - 依赖资源（生成的 shape/vector/values）一并写到 drawable/ values/ */
  const flashNote = (msg: string, ms = 3600) => {
    setExportNote(msg);
    window.setTimeout(() => setExportNote(""), ms);
  };

  /** 组装当前要落盘的文件（layout + 依赖） */
  const buildSaveFiles = (name: string): SaveFileSpec[] => {
    const body = exportLayoutXml(xml, { mode: exportMode });
    const entries = buildResBundle({
      layoutXml: body,
      layoutName: name,
      generatedDrawables,
      extras: resExtrasAll,
    });
    return entries.map((e) => ({ path: e.path, text: e.text }));
  };

  /** 写回原路径（含依赖资源） */
  const saveBack = async (): Promise<boolean> => {
    if (!saveOrigin) return false;
    const name = saveOrigin.name || activeFile(project)?.name || "activity_main.xml";
    const body = exportLayoutXml(xml, { mode: exportMode });
    const deps = buildSaveFiles(name).filter((f) => !f.path.startsWith("layout/"));
    let ok = false;
    if (saveOrigin.kind === "native") ok = writeTextNative(saveOrigin.target, body);
    else {
      try {
        ok = await writeHandleText(saveOrigin.handle, body);
      } catch {
        ok = false;
      }
    }
    if (!ok) return false;
    let depNote = "";
    if (saveOrigin.kind === "native" && saveOrigin.target.startsWith("/") && deps.length > 0) {
      // .../res/layout/activity_main.xml → res 根是上上级；其它情况就把同目录当 res 根
      const dir = saveOrigin.target.slice(0, saveOrigin.target.lastIndexOf("/"));
      const resRoot = dir.endsWith("/layout") ? dir.slice(0, dir.lastIndexOf("/")) : dir;
      let n = 0;
      for (const d of deps) if (writeTextNative(`${resRoot}/${d.path}`, d.text)) n++;
      depNote = n > 0 ? `，依赖资源 ${n} 个` : `（${deps.length} 个依赖资源没写成，请检查目录权限）`;
    } else if (deps.length > 0) {
      depNote = `；另有 ${deps.length} 个依赖资源，可用「另存到文件夹」一起写出`;
    }
    flashNote(tr("save.doneBack", "已保存 {name}（原路径）", { name }) + depNote, 4200);
    return true;
  };

  /** 另存：走系统文件夹选择器，按 res 结构整包写 */
  const saveAsTo = async (name: string) => {
    const files = buildSaveFiles(name);
    const r = await saveBundleAnywhere(files, name);
    if (r.ok) {
      flashNote(
        tr("save.doneAs", "已保存到「{dir}」：{n} 个文件（含依赖资源）", {
          dir: r.label || "所选文件夹",
          n: r.count ?? files.length,
        }),
        5000,
      );
      return true;
    }
    if (r.canceled) {
      flashNote(tr("save.canceled", "已取消保存"));
      return false;
    }
    flashNote(tr("save.failed", "保存失败：{reason}", { reason: r.reason || "未知原因" }), 5000);
    return false;
  };

  const doSave = async () => {
    // A) 有来源 → 直接写回原路径
    if (saveOrigin) {
      if (await saveBack()) return;
      flashNote(tr("save.backFailed", "写回原文件失败，改为另存到文件夹…"), 2600);
    }
    // B) 新建文件 → 先让用户确认文件名，再选文件夹
    const def = activeFile(project)?.name || "activity_main.xml";
    setSaveAsName(def);
    setSaveAsOpen(true);
  };

  const confirmSaveAs = async () => {
    const raw = saveAsName.trim() || "activity_main.xml";
    const name = /\.xml$/i.test(raw) ? raw : `${raw}.xml`;
    setSaveAsOpen(false);
    await saveAsTo(name);
  };

  const buildReport = (mode: ExportMode = exportMode): ExportReport => {
    // M13：报告基于「真正要导出的内容」算——兼容模式下 CL 约束/库属性都已消失，
    // 拿原始 xml 算会把已不存在的项报成错误
    const body = exportLayoutXml(xml, { mode });
    const check = exportChecks(body);
    const lint = lintXml(body);
    if (mode === "compat") {
      const compat = toCompatXml(fixNamespacePrefixes(xml));
      setCompatNotes(compat.notes);
    }
    return {
      errors: lint.filter((i) => i.level === "error"),
      notes: check.notes,
    };
  };

  /** M13：切换导出模式（面板里点选）——立即重算报告，用户能看到模式带来的差异 */
  const applyExportMode = (m: ExportMode) => {
    setExportMode(m);
    try {
      window.localStorage.setItem("axv.exportMode", m);
    } catch {
      /* ignore */
    }
    setExportReport(buildReport(m));
  };

  const saveProject = () => {
    setExportAction("download");
    setExportReport(buildReport());
    setExportOpen(true);
  };

  /** M3：复制生成的 XML 到剪贴板（与下载同一份内容） */
  const doCopy = async () => {
    const body = exportLayoutXml(xml, { mode: exportMode });
    // 原生壳里先走 ClipboardManager（WebView 的 navigator.clipboard 不可靠）
    if (copyTextNative(body)) {
      setExportNote("已复制到剪贴板");
      window.setTimeout(() => setExportNote(""), 2600);
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      setExportNote("已复制到剪贴板");
    } catch {
      // 剪贴板 API 不可用（非 https / 旧浏览器）时退化成保存
      doDownload();
      setExportNote("剪贴板不可用，已改为保存文件");
    }
    window.setTimeout(() => setExportNote(""), 2600);
  };

  const copyExportedXml = () => {
    setExportAction("copy");
    setExportReport(buildReport());
    setExportOpen(true);
  };

  /** M2s：跳转到代码 tab 并让代码编辑器滚动/选中到指定行 */
  const [focusLine, setFocusLine] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const gotoLine = useCallback((line: number) => {
    setLeftView("code");
    setLeftOpen(true);
    setFocusLine(line);
    setFocusTick((t) => t + 1);
  }, []);

  return (
    <div
      className="axv-editor"
      onDragOver={(e) => {
        // M6d：拖 .xml 文件进来直接打开（控件拖拽由内层画布处理）
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }
      }}
      onDrop={(e) => {
        const f = e.dataTransfer.files?.[0];
        if (!f) return;
        e.preventDefault();
        loadXmlFile(f);
      }}
    >
      {/* 上传资源：整目录入口 */}
      <input
        ref={resDirRef}
        type="file"
        multiple
        // @ts-expect-error 非标准属性，Chrome/Edge 用 webkitdirectory；Firefox 用 directory；双写双保险
        webkitdirectory=""
        directory=""
        style={{ display: "none" }}
        onChange={(e) => {
          void onPickRes(e.target.files);
          e.target.value = "";
        }}
      />
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
        <div
          className="axv-mob-tabs"
          style={
            isMobile
              ? undefined
              : {
                  // M11：桌面端跟着两侧面板收放（与工具栏同一套偏移）
                  left: leftOpen ? 320 : 0,
                  right: rightOpen ? 320 : 0,
                  transition: "left 0.22s, right 0.22s",
                }
          }
        >
          <div className="axv-mob-tabs-inner" role="tablist" aria-label="视图">
          <button
            role="tab"
            aria-selected={mobileTab === "preview"}
            className={mobileTab === "preview" ? "on" : ""}
            onClick={() => setMobileTab("preview")}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>phone_android</span>
            预览
          </button>
          <select
            className="axv-tb-select axv-tab-sample"
            title="载入完整示例项目（布局 + 自带图标/背景资源）"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (v.startsWith("blank:")) applyBlankTemplate(v.slice(6));
              else applySampleProject(v);
            }}
            style={{ margin: "0 8px" }}
          >
            <option value="">示例项目…</option>
            <optgroup label="完整示例（带资源）">
              {SAMPLE_PROJECTS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} · {p.library.split(" + ")[0]}
                </option>
              ))}
            </optgroup>
            <optgroup label="新建（空白）">
              {SAMPLE_BLANKS.map((b) => (
                <option key={b.key} value={`blank:${b.key}`}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          </select>
          {fileSelect}
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
        </div>
      )}

      {/* 画布舞台 */}
      {mobileTab === "preview" && (
        <div
          className={"axv-stage" + (leftOpen ? " pad-l" : "") + (rightOpen ? " pad-r" : "")}
          ref={stageRef}
        >
          {zoomHud !== null ? (
            <div className="axv-zoom-hud" role="status" aria-live="polite">
              {Math.round(zoomHud * 100)}%
            </div>
          ) : null}
          {!parseErr && lintErrCount > 0 ? (
            <div className="axv-struct-warn" role="status">
              <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>warning</span>
              <span>
                {tr("err.structWarn", "有 {n} 处结构问题（不影响预览）", { n: lintErrCount })}
              </span>
              <button className="axv-struct-warn-btn" onClick={() => gotoLine(1)}>
                {tr("err.fix", "去代码面板修正")}
              </button>
            </div>
          ) : null}
          {parseErr ? (
            <div className="axv-parse-fail" role="alert">
              <span className="msr axv-parse-fail-icon" aria-hidden="true">error</span>
              <div className="axv-parse-fail-title">{tr("err.parseTitle", "这个 XML 现在画不出来")}</div>
              <div className="axv-parse-fail-msg">
                {parseReason || tr("err.parseMsg", "XML 结构不完整或有语法错误")}
              </div>
              <div className="axv-parse-fail-hint">
                {tr(
                  "err.parseHint",
                  "先到「代码」面板修正这段内容，画布会自动恢复；改动不会丢失，也不会影响你原来的文件。",
                )}
              </div>
              <button className="axv-parse-fail-btn" onClick={() => gotoLine(1)}>
                <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>code</span>
                {tr("err.fix", "去代码面板修正")}
              </button>
            </div>
          ) : model ? (
            <div
              style={{
                width: outerW * fitRatio,
                height: outerH * fitRatio,
                flex: "0 0 auto",
              }}
            >
            <div
              ref={phoneRef}
              className={"axv-phone" + (dropHint ? " axv-drop-target" : "")}
              style={{
                width: outerW,
                height: outerH,
                boxSizing: "border-box",
                background: phoneBg,
                color: phoneFg,
                transform: fitRatio < 1 ? `scale(${fitRatio})` : undefined,
                transformOrigin: "top left",
                borderRadius: device.radius ? Math.round(device.radius * DPX) : undefined,
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
              {/* 状态栏（系统窗口，不属于布局 XML）：时间 + 前置摄像头（居中）+ 信号/WiFi/电池 */}
              {showSystemBars && (
              <div className="axv-statusbar" style={{ height: STATUS_BAR_H }}>
                <span className="axv-sb-time">9:41</span>
                {exportNote ? <div className="axv-toast axv-sb-camera-note">{exportNote}</div> : <div className="axv-sb-camera" aria-hidden="true" />}
                <span className="axv-sb-icons">
                  <span className="msr" aria-hidden="true">
                    signal_cellular_alt
                  </span>
                  <span className="msr" aria-hidden="true">
                    wifi
                  </span>
                  <span className="msr" aria-hidden="true">
                    battery_full
                  </span>
                </span>
              </div>
              )}

              {/* 应用内容区：根布局填满这里 */}
              <div className="axv-phone-body">
                <CanvasBoundary
                  resetKey={parsedXml}
                  onFix={() => gotoLine(1)}
                  labels={{
                    title: tr("err.crashTitle", "画布渲染出错了"),
                    hint: tr(
                      "err.crashHint",
                      "这不是你操作的问题，多半是某段布局数据超出了支持范围。到「代码」面板改一下（哪怕加个空格再删掉）画布会自动重试。",
                    ),
                    fix: tr("err.fix", "去代码面板修正"),
                    retry: tr("err.retry", "重试渲染"),
                  }}
                >
                  <XmlCanvas
                    node={model.root}
                    selectedPath={selectedPath}
                    onSelect={setSelectedPath}
                    onDropWidget={onDropWidget}
                    onConstraintDraw={onConstraintDraw}
                    onGeometryChange={onGeometryChange}
                    isLocked={isPathLocked}
                    scale={DPX}
                  />
                </CanvasBoundary>
              </div>

              {/* 导航栏（三键导航：返回 / 主页 / 多任务） */}
              {showSystemBars && (
              <div className="axv-navbar" style={{ height: NAV_BAR_H }}>
                <span className="axv-nav-btn" title="返回">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M13.5 4.5 L14.5 4.5 L14.5 4.75 L14.75 4.75 L14.75 5 L15 5 L15 5.75 L14.75 5.75 L14.75 6.25 L14.5 6.25 L14.5 6.5 L14.25 6.5 L14.25 6.75 L14 6.75 L14 7 L13.75 7 L13.75 7.25 L13.5 7.25 L13.5 7.5 L13.25 7.5 L13.25 7.75 L13 7.75 L13 8 L12.75 8 L12.75 8.25 L12.5 8.25 L12.5 8.5 L12.25 8.5 L12.25 8.75 L12 8.75 L12 9 L11.75 9 L11.75 9.25 L11.5 9.25 L11.5 9.5 L11.25 9.5 L11.25 9.75 L11 9.75 L11 10.25 L11.25 10.25 L11.25 10.5 L11.5 10.5 L11.5 10.75 L11.75 10.75 L11.75 11 L12 11 L12 11.25 L12.25 11.25 L12.25 11.5 L12.5 11.5 L12.5 11.75 L12.75 11.75 L12.75 12 L13 12 L13 12.25 L13.25 12.25 L13.25 12.5 L13.5 12.5 L13.5 12.75 L13.75 12.75 L13.75 13 L14 13 L14 13.25 L14.25 13.25 L14.25 13.5 L14.5 13.5 L14.5 13.75 L14.75 13.75 L14.75 14.25 L15 14.25 L15 15 L14.75 15 L14.75 15.25 L14.5 15.25 L14.5 15.5 L13.5 15.5 L13.5 15.25 L13.25 15.25 L13.25 15 L13 15 L13 14.75 L12.75 14.75 L12.75 14.5 L12.5 14.5 L12.5 14.25 L12.25 14.25 L12.25 14 L12 14 L12 13.75 L11.75 13.75 L11.75 13.5 L11.5 13.5 L11.5 13.25 L11.25 13.25 L11.25 13 L11 13 L11 12.75 L10.75 12.75 L10.75 12.5 L10.5 12.5 L10.5 12.25 L10.25 12.25 L10.25 12 L10 12 L10 11.75 L9.75 11.75 L9.75 11.5 L9.5 11.5 L9.5 11.25 L9.25 11.25 L9.25 11 L9 11 L9 10.75 L8.75 10.75 L8.75 10.5 L8.5 10.5 L8.5 9.5 L8.75 9.5 L8.75 9.25 L9 9.25 L9 9 L9.25 9 L9.25 8.75 L9.5 8.75 L9.5 8.5 L9.75 8.5 L9.75 8.25 L10 8.25 L10 8 L10.25 8 L10.25 7.75 L10.5 7.75 L10.5 7.5 L10.75 7.5 L10.75 7.25 L11 7.25 L11 7 L11.25 7 L11.25 6.75 L11.5 6.75 L11.5 6.5 L11.75 6.5 L11.75 6.25 L12 6.25 L12 6 L12.25 6 L12.25 5.75 L12.5 5.75 L12.5 5.5 L12.75 5.5 L12.75 5.25 L13 5.25 L13 5 L13.25 5 L13.25 4.75 L13.5 4.75 Z" fill="currentColor" />
                  </svg>
                </span>
                <span className="axv-nav-btn" title="主页">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </span>
                <span className="axv-nav-btn" title="多任务">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </span>
              </div>
              )}
            </div>
            </div>
          ) : null}
          {showIssues && issues.length > 0 && (
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
            focusLine={focusLine}
            focusTick={focusTick}
            onCursorLine={onCodeCursorLine}
          />
          <div className="axv-mob-xml-tools">
            <button className="axv-mob-tool-btn axv-ghost" onClick={doFormat} title="重排缩进（保留注释）">
              格式化
            </button>
            <select
              className="axv-tb-select"
              title="载入完整示例项目（布局 + 自带图标/背景资源）"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v.startsWith("blank:")) applyBlankTemplate(v.slice(6));
                else applySampleProject(v);
              }}
            >
              <option value="">示例项目…</option>
              <optgroup label="完整示例（带资源）">
                {SAMPLE_PROJECTS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="新建（空白）">
                {SAMPLE_BLANKS.map((b) => (
                  <option key={b.key} value={`blank:${b.key}`}>
                    {b.name}
                  </option>
                ))}
              </optgroup>
            </select>
            {fileSelect}
            <button className="axv-mob-tool-btn" onClick={openProject} title="打开本地 XML 文件">打开</button>
            <button className="axv-mob-tool-btn" onClick={() => void doSave()} title="保存">保存</button>
            {resExtras || Object.keys(generatedDrawables).length > 0 ? (
              <button className="axv-mob-tool-btn" onClick={doDownloadResZip} title="导出 res 包（含图标）">res 包</button>
            ) : null}
            <button className="axv-mob-tool-btn axv-mob-run" onClick={() => setRunOpen(true)} title="运行调试">▶ 运行</button>
            {nativeAvailable() ? (
              <button
                className="axv-mob-tool-btn"
                title={`保存位置：${workspaceLabel() || "默认目录"}`}
                onClick={() => {
                  if (chooseWorkspace()) {
                    setExportNote(`保存位置：${workspaceLabel()}`);
                    window.setTimeout(() => setExportNote(""), 2400);
                  }
                }}
              >
                存至
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* 左侧滑面板：52px 图标条 + 内容列（M3E 同款布局；移动端宽 75vw） */}
      <aside className={"axv-slide-left" + (leftOpen ? " axv-open" : "")}>
        <div className="axv-rail">
          <button
            className={"axv-rail-btn" + (leftView === "parts" ? " on" : "")}
            title={tr("rail.parts", "组件")}
            aria-label={tr("rail.parts", "组件")}
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
            title={tr("rail.layers", "图层")}
            aria-label={tr("rail.layers", "图层")}
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
          {/* M17：AI 助手（模型调用 + 后续写代码） */}
          <button
            className={"axv-rail-btn" + (leftView === "ai" ? " on" : "")}
            title={tr("rail.ai", "AI 助手")}
            aria-label={tr("rail.ai", "AI 助手")}
            aria-pressed={leftView === "ai"}
            onClick={() => {
              setLeftView("ai");
              setLeftOpen(true);
            }}
          >
            <span className="msr" aria-hidden="true" data-fill={leftView === "ai" ? "1" : "0"} style={{ fontSize: 24 }}>
              auto_awesome
            </span>
          </button>
          <button
            className={"axv-rail-btn" + (leftView === "assets" ? " on" : "")}
            title={tr("rail.assets", "已生成资源")}
            aria-label={tr("rail.assets", "已生成资源")}
            aria-pressed={leftView === "assets"}
            onClick={() => {
              setLeftView("assets");
              setLeftOpen(true);
            }}
          >
            <span className="msr" aria-hidden="true" data-fill={leftView === "assets" ? "1" : "0"} style={{ fontSize: 24 }}>
              category
            </span>
          </button>
          <button
            className={"axv-rail-btn" + (leftView === "res" ? " on" : "")}
            title={tr("rail.res", "项目管理")}
            aria-label={tr("rail.res", "项目管理")}
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
          <div className="axv-rail-gap" />
          <button
            className={"axv-rail-btn" + (leftView === "settings" ? " on" : "")}
            title={tr("rail.settings", "设置")}
            aria-label={tr("rail.settings", "设置")}
            aria-pressed={leftView === "settings"}
            onClick={() => {
              setLeftView("settings");
              setLeftOpen(true);
            }}
          >
            <span className="msr" aria-hidden="true" data-fill={leftView === "settings" ? "1" : "0"} style={{ fontSize: 24 }}>
              settings
            </span>
          </button>
          <button
            className={"axv-rail-btn" + (leftView === "about" ? " on" : "")}
            title={tr("rail.about", "关于")}
            aria-label={tr("rail.about", "关于")}
            aria-pressed={leftView === "about"}
            onClick={() => {
              setLeftView("about");
              setLeftOpen(true);
            }}
          >
            <span className="msr" aria-hidden="true" data-fill={leftView === "about" ? "1" : "0"} style={{ fontSize: 24 }}>
              info
            </span>
          </button>
        </div>

        <div className="axv-rail-body">
          <div className="axv-rail-head">
            <span className="axv-rail-title">
              {leftView === "parts"
                ? tr("rail.parts", "组件")
                : leftView === "layers"
                  ? tr("rail.layers", "图层")
                  : leftView === "ai"
                    ? tr("rail.ai", "AI 助手")
                    : leftView === "res"
                      ? tr("rail.res", "项目管理")
                      : leftView === "assets"
                        ? tr("rail.assets", "已生成资源")
                        : leftView === "settings"
                          ? tr("rail.settings", "设置")
                          : tr("rail.about", "关于")}
            </span>
            <button
              className="axv-icon-btn"
              title={tr("rail.close", "关闭面板")}
              aria-label={tr("rail.close", "关闭面板")}
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
                onDragMove={onDragMoveNode}
                lockedPaths={lockedPaths}
                onToggleLock={toggleLockPath}
              />
            </div>
          )}
          {leftView === "ai" && (
            <AiPanel
              xml={xml}
              selection={pathChain.length ? pathChain.map((p) => `${p.tag}${p.id ? "#" + String(p.id).replace("@+id/", "") : ""}`).join(" > ") : null}
              onReplaceXml={(next) => setXmlAndTrack(next, "")}
              onNote={(text) => {
                setExportNote(text);
                window.setTimeout(() => setExportNote(" "), 3000);
              }}
            />
          )}
          {leftView === "assets" && (
            <div className="axv-rail-scroll axv-assets-inline-wrap">
              <GenAssetsPanel
                inline
                assets={generatedDrawables}
                layoutXml={xml}
                onRename={(oldName, newName) => onRenameAsset(oldName, newName)}
                onDelete={onDeleteAsset}
                onEditShape={(name, shapeXml) => setResShape({ name, xml: shapeXml })}
                onEditIcon={(name, iconXml) => setResIcon({ name, xml: iconXml })}
                onClose={() => setLeftView("parts")}
                onNote={(text) => {
                  setExportNote(text);
                  window.setTimeout(() => setExportNote(" "), 3200);
                }}
              />
            </div>
          )}
          {leftView === "res" && (
            <div className="axv-rail-scroll">
              {/* M16i：项目管理两个 tab（工作目录在前，当前项目在后；默认停在当前项目） */}
              <div className="axv-proj-tabs">
                <button
                  className={"axv-proj-tab" + (projectTab === "workspace" ? " on" : "")}
                  onClick={() => {
                    setProjectTab("workspace");
                    void refreshWorkspace();
                  }}
                >
                  工作目录
                </button>
                <button
                  className={"axv-proj-tab" + (projectTab === "current" ? " on" : "")}
                  onClick={() => setProjectTab("current")}
                >
                  当前项目
                </button>
              </div>

              {projectTab === "workspace" ? (
                <div className="axv-ws-panel">
                  <div className="axv-ws-path">
                    <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>folder_open</span>
                    <span className="axv-ws-path-text" title={wsState?.label || ""}>
                      {wsState?.mode === "native"
                        ? wsState.label || "AndroidUIIDE/Project"
                        : wsState?.mode === "unsupported"
                          ? "当前浏览器不支持读本地目录"
                          : wsState?.custom
                            ? wsState.label
                            : "未授权目录"}
                    </span>
                    <button
                      className="axv-ws-mini"
                      title="刷新列表"
                      onClick={() => void refreshWorkspace()}
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
                    </button>
                  </div>

                  <div className="axv-ws-actions">
                    <button className="axv-rail-mini-btn" onClick={() => void pickCustomDir()}>
                      选择目录
                    </button>
                    <button className="axv-rail-mini-btn" onClick={() => void useDefaultDir()} title="回到内置默认目录">
                      恢复默认
                    </button>
                  </div>

                  {wsState?.mode === "native" && wsState.allFiles === false ? (
                    <div className="axv-ws-warn">
                      默认目录在存储根下，需要「所有文件访问」权限才能读取。
                      <button className="axv-ws-link" onClick={() => wsRequestAllFiles()}>
                        去开启
                      </button>
                    </div>
                  ) : null}
                  {wsState?.mode === "unsupported" ? (
                    <div className="axv-ws-warn">
                      请用 Chrome / Edge 打开网页版，或安装 APK（APK 默认目录：/AndroidUIIDE/Project）。
                    </div>
                  ) : null}
                  {wsState?.mode === "web" && !wsState.custom ? (
                    <div className="axv-ws-hint">点「选择目录」授权一个文件夹，授权会被记住，下次打开不用再选。</div>
                  ) : null}
                  {wsState?.permission === "prompt" ? (
                    <div className="axv-ws-warn">
                      目录权限需要重新确认（浏览器安全策略）。
                      <button className="axv-ws-link" onClick={() => void refreshWorkspace()}>
                        重新授权
                      </button>
                    </div>
                  ) : null}

                  {wsBusy ? <div className="axv-ws-hint">正在读取…</div> : null}

                  {wsProjects.length > 0 ? (
                    <ul className="axv-ws-list">{renderWsRows(wsTree, 0)}</ul>
                  ) : !wsBusy && (wsState?.mode === "native" || wsState?.custom) ? (
                    <div className="axv-ws-hint">
                      目录里还没有项目。把项目文件夹（内含 layout/*.xml）放到这个目录下，点刷新即可。
                    </div>
                  ) : null}

                  {wsMsg ? <div className="axv-ws-hint">{wsMsg}</div> : null}
                </div>
              ) : (
                <>
                  {/* 资源操作按钮（横向排列，树形框上方） */}
                  <div style={{ display: "flex", gap: 8, padding: "8px 12px 6px" }}>
                <button
                  className="axv-rail-mini-btn"
                  title="选择整个 res 目录（推荐：一次导入 drawable / values / mipmap）"
                  onClick={() => resDirRef.current?.click()}
                >
                  📁 选择res目录
                </button>
                <button
                  className="axv-rail-mini-btn"
                  title="打开 XML 文件"
                  onClick={openProject}
                >
                  📄 打开xml
                </button>
                {resExtras ? (
                  <button
                    className="axv-rail-mini-btn axv-rail-mini-btn-danger"
                    style={{ flex: "0 0 auto" }}
                    title="清除已上传的 res 资源"
                    onClick={clearRes}
                  >
                    ✖
                  </button>
                ) : null}
              </div>
              {resExtras?.tree ? (
                <ResTree
                  tree={resExtras.tree}
                  layouts={resExtras.layouts}
                  extras={resExtras}
                  onOpenLayout={(fileName, content) => setXmlAndTrack(content)}
                  onOpenDrawable={(_rel, name, xml) => setResShape({ name, xml })}
                  onPreviewImage={(rel, name, url) => setResImage({ rel, name, url })}
                  generated={generatedDrawables}
                />
              ) : (
                <>
                  <div style={{ padding: "8px 12px 4px", fontSize: 12, color: "var(--axv-on-surface-variant)", lineHeight: 1.5 }}>
                    上传 res/ 目录后可在这里以树形浏览资源文件，点击 layout/*.xml 直接预览。
                  </div>
                  <div className="axv-res-box">
                    <textarea
                      value={resourceFragment}
                      onChange={(e) => setResourceFragment(e.target.value)}
                      placeholder={'<resources>\n  <string name="app_name">My App</string>\n  <dimen name="margin_small">8dp</dimen>\n  <color name="primary">#FF0000</color>\n</resources>'}
                    />
                  </div>
                </>
              )}
                </>
              )}
            </div>
          )}

          {leftView === "settings" && (
            <div className="axv-rail-scroll">
              {/* ===== 外观：预设配色方案 ===== */}
              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.theme", "配色方案")}</div>
                <div className="axv-theme-grid">
                  {THEME_PRESETS.map((p) => {
                    const t = themeTokens(p.id, theme);
                    const on = p.id === themePreset;
                    return (
                      <button
                        key={p.id}
                        className={"axv-theme-card" + (on ? " on" : "")}
                        onClick={() => setThemePreset(p.id)}
                        title={p.note}
                      >
                        <span
                          className="axv-theme-swatch"
                          style={{
                            background: `linear-gradient(135deg, ${t.primary}, ${t.toolbarBg})`,
                            borderColor: t.primary,
                          }}
                        >
                          <span style={{ background: t.panelBg }} />
                        </span>
                        <span className="axv-theme-name">{p.name}</span>
                        {on ? <span className="msr axv-theme-check" aria-hidden="true">check</span> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="axv-set-seg" style={{ marginTop: 8 }}>
                  <button
                    className={"axv-set-seg-btn" + (theme === "light" ? " on" : "")}
                    onClick={() => setTheme("light")}
                  >
                    {tr("set.themeLight", "浅色")}
                  </button>
                  <button
                    className={"axv-set-seg-btn" + (theme === "dark" ? " on" : "")}
                    onClick={() => setTheme("dark")}
                  >
                    {tr("set.themeDark", "深色")}
                  </button>
                </div>
                <div className="axv-set-hint">
                  {THEME_PRESETS.find((p) => p.id === themePreset)?.note}。配色只作用于编辑器界面，不影响导出的布局。
                </div>
              </div>

              {/* M20m：设置面板不再列「配色明细」（用户要求去掉），配色方案卡片保留 */}

              {/* ===== M23：界面语言 ===== */}
              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.lang", "界面语言")}</div>
                <select
                  className="axv-tb-select axv-lang-select"
                  value={langPref}
                  aria-label={tr("set.lang", "界面语言")}
                  onChange={(e) => setLangPref(e.target.value as LangPref)}
                >
                  {LANG_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value === "auto" ? `${o.label}（${o.native}）` : o.label}
                    </option>
                  ))}
                </select>
                <div className="axv-set-hint">{tr("set.langHint", "默认跟随系统语言；切换只影响编辑器界面文字，不影响布局内容。")}</div>
              </div>

              {/* ===== 工作目录 ===== */}
              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.workspace", "工作目录")}</div>
                <div className="axv-set-kv">
                  <span>当前</span>
                  <b title={wsState?.label || ""}>
                    {wsState?.mode === "native"
                      ? wsState.label || "AndroidUIIDE/Project"
                      : wsState?.mode === "unsupported"
                        ? "不支持（请用 Chrome/Edge 或 APK）"
                        : wsState?.custom
                          ? wsState.label
                          : "未授权目录"}
                  </b>
                </div>
                {wsState?.defaultPath ? (
                  <div className="axv-set-kv">
                    <span>默认</span>
                    <b className="axv-set-mono">{wsState.defaultPath}</b>
                  </div>
                ) : null}
                <div className="axv-set-btns">
                  <button className="axv-set-btn" onClick={() => void pickCustomDir()}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>folder_open</span>
                    选择目录
                  </button>
                  <button className="axv-set-btn" onClick={() => void useDefaultDir()}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>settings_backup_restore</span>
                    恢复默认
                  </button>
                </div>
                {wsState?.mode === "native" && wsState.allFiles === false ? (
                  <button className="axv-set-btn" onClick={() => wsRequestAllFiles()}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>shield</span>
                    开启「所有文件访问」（默认目录在存储根下，必须开）
                  </button>
                ) : null}
                <div className="axv-set-hint">
                  默认目录：APK 是 <code>/AndroidUIIDE/Project</code>；网页版由你授权一个文件夹（授权会记住）。
                  自定义目录失效时会自动回落到默认目录，两者都不会留空。
                </div>
              </div>

              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.device", "渲染设备")}</div>
                <div className="axv-set-seg">
                  {RENDER_THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={"axv-set-seg-btn" + (renderTheme === t.id ? " on" : "")}
                      onClick={() => setRenderTheme(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="axv-set-hint">
                  {RENDER_THEMES.find((t) => t.id === renderTheme)?.hint}
                </div>
              </div>

              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.preview", "预览")}</div>
                <label className="axv-set-row">
                  <span>显示系统状态栏 / 导航栏</span>
                  <input
                    type="checkbox"
                    checked={showSystemBars}
                    onChange={(e) => setShowSystemBars(e.target.checked)}
                  />
                </label>
                <label className="axv-set-row">
                  <span>控件提示（缺资源红框等）</span>
                  <input
                    type="checkbox"
                    checked={showIssues}
                    onChange={(e) => setShowIssues(e.target.checked)}
                  />
                </label>
              </div>

              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.data", "数据")}</div>
                <div className="axv-set-hint">
                  布局、资源与生成的图标都自动存在本机浏览器（localStorage），关页面不丢。
                </div>
                <button className="axv-set-btn" onClick={saveProject}>
                  <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>save</span>
                  立即导出当前 XML
                </button>
                <button
                  className="axv-set-btn axv-set-btn-danger"
                  onClick={() => {
                    if (!window.confirm("清空本机所有缓存（布局 / 资源 / 生成的图标 / 文件列表）？此操作不可撤销。")) return;
                    try {
                      Object.keys(window.localStorage)
                        .filter((k) => k.startsWith("axv."))
                        .forEach((k) => window.localStorage.removeItem(k));
                    } catch {
                      /* ignore */
                    }
                    window.location.reload();
                  }}
                >
                  <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>delete</span>
                  清空本机缓存并重启
                </button>
              </div>
            </div>
          )}

          {leftView === "about" && (
            <div className="axv-rail-scroll">
              <div className="axv-about-hero">
                {/* M16g：项目 logo（public/logo.svg，也是应用图标） */}
                <img
                  className="axv-about-logo"
                  src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo.svg`}
                  alt=""
                  width={44}
                  height={44}
                />
                <div>
                  <div className="axv-about-name">{PROJECT_NAME}</div>
                  <div className="axv-about-ver">版本 {APP_VERSION}</div>
                </div>
              </div>
              <div className="axv-about-desc">
                {PROJECT_TAGLINE}
                支持 ConstraintLayout 约束求解、shape / selector / vector 资源、图标生成与 res 打包导出。
              </div>

              {/* M16f：项目来源 + 开源致谢（列表数据在 lib/xml/credits.ts，跟 README 同一口径） */}
              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.projectRes", "项目资源")}</div>
                <div className="axv-credit-upstream">
                  本项目由 <b>{UPSTREAM.name}</b>（{UPSTREAM.license}，作者 {UPSTREAM.by}）拓展而来。
                  {UPSTREAM.role}
                  <a href={UPSTREAM.url} target="_blank" rel="noreferrer noopener">
                    查看上游仓库
                  </a>
                </div>
              </div>

              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.credits", "鸣谢 / 开源组件")}</div>
                <div className="axv-set-hint" style={{ marginBottom: 8 }}>
                  这个编辑器能跑到今天，靠的是下面这些开源项目与作者的分享。在此致谢。
                </div>
                <ul className="axv-credit-list">
                  {CREDITS.map((c) => (
                    <li key={c.name}>
                      <a href={c.url} target="_blank" rel="noreferrer noopener">
                        {c.name}
                      </a>
                      <span className="axv-credit-by">{c.by}</span>
                      <span className="axv-credit-lic">{c.license}</span>
                      <div className="axv-credit-role">{c.role}</div>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.shortcuts", "快捷键")}</div>
                <div className="axv-about-kv"><kbd>Ctrl</kbd>+<kbd>Z</kbd><span>撤销</span></div>
                <div className="axv-about-kv"><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd><span>重做</span></div>
                <div className="axv-about-kv"><kbd>Ctrl</kbd>+<kbd>F</kbd><span>代码内查找</span></div>
                <div className="axv-about-kv"><kbd>Ctrl</kbd>+<kbd>滚轮</kbd><span>缩放画布</span></div>
                <div className="axv-about-kv"><kbd>Ctrl</kbd>+<kbd>0</kbd><span>缩放复位</span></div>
                <div className="axv-about-kv"><kbd>Delete</kbd><span>删除选中控件</span></div>
              </div>
              <div className="axv-set-group">
                <div className="axv-set-label">{tr("set.notes", "说明")}</div>
                <div className="axv-set-hint">
                  渲染为近似实现，不是 aapt / Android 运行时；个别属性（自定义 View、动画、第三方库）
                  只做占位。最终效果以真机为准。
                </div>
              </div>
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
              {selectedNode.sourceFile ? (
                <div className="axv-include-readonly" title="include 展开进来的节点：主 XML 里没有它的实体，改不了（要改去那个文件）">
                  ⚠ 来自 <b>{selectedNode.sourceFile}</b>（include 展开，只读）
                </div>
              ) : null}
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
                chain={pathChain}
                onSelectPath={(p) => setSelectedPath(p)}
                onCommit={commitAttr}
                onRemove={removeAttr}
                onAddAttr={() => setAddModalOpen(true)}
                resExtras={resExtras}
                onDeleteNode={() => onRemoveNode(selectedNode.path)}
                onPickIcon={onPickIcon}
                onEditIconResource={(name, iconXml, attr) =>
                  setResIcon({ name: name || "ic_icon", xml: iconXml ?? "", attr })
                }
                iconNames={Object.keys(generatedDrawables)}
                onSaveShape={onSaveShape}
                generatedXml={generatedDrawables}
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

      {/* M2s：导出前检查面板 */}
      <ExportCheckModal
        open={exportOpen}
        report={exportReport}
        action={exportAction}
        mode={exportMode}
        onMode={applyExportMode}
        compatNotes={compatNotes}
        onClose={() => setExportOpen(false)}
        onConfirm={exportAction === "copy" ? doCopy : doDownload}
        onJumpLine={(line) => {
          setExportOpen(false);
          gotoLine(line);
        }}
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
        {leftOpen ? null : (
          <button
            className="axv-tb-btn axv-tb-side-btn"
            title="展开左侧面板"
            aria-label="展开左侧面板"
            aria-pressed={false}
            onClick={() => setLeftOpen(true)}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>left_panel_open</span>
          </button>
        )}

        {/* M6b：中间可横向滚动的工具栏区（左/右侧滑按钮各占一边，不悬浮不吸边） */}
        <div className="axv-tb-scroll">
          <div className="axv-tb-group">
            {/* M6c/M10：设备 + 缩放收进这个按钮，并与其它工具同处一个工具组 */}
            <ViewSettingsMenu deviceId={deviceId} onDevice={changeDevice} scale={scale} onScale={setScale} />
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
          <button
            className="axv-tb-btn"
            title="保存（打开的文件写回原路径；新建文件选择保存位置）"
            aria-label="保存"
            onClick={() => void doSave()}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>save</span>
          </button>
          <button className="axv-tb-btn" title="打开本地 XML 文件（也可直接把文件拖进来）" aria-label="打开 XML 文件" onClick={openProject}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>file_open</span>
          </button>
          <button className="axv-tb-btn" title="复制生成的 XML" aria-label="复制 XML" onClick={copyExportedXml}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>content_copy</span>
          </button>
          {resExtras || Object.keys(generatedDrawables).length > 0 ? (
            <button className="axv-tb-btn" title="导出 res 目录（zip：布局 + 图标矢量 + shape/values）" aria-label="导出 res 包" onClick={doDownloadResZip}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>folder_zip</span>
            </button>
          ) : null}
          <button
            className="axv-tb-btn"
            title="导出预览图（PNG / SVG）"
            aria-label="导出预览图"
            onClick={() => setImgExportOpen(true)}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>image</span>
          </button>
          {resExtras ? (
            <button className="axv-tb-btn" title="清除已上传的 res 资源" aria-label="清除 res" onClick={clearRes}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>hide_image</span>
            </button>
          ) : null}
          {nativeAvailable() ? (
            <button
              className="axv-tb-btn"
              title={`保存位置：${workspaceLabel() || "默认目录"}（点击更换）`}
              aria-label="更换保存位置"
              onClick={() => {
                if (chooseWorkspace()) {
                  setExportNote("已更换保存位置（下次保存生效）");
                  window.setTimeout(() => setExportNote(""), 2400);
                }
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>save_location</span>
            </button>
          ) : null}
          <button
            className="axv-tb-btn axv-tb-run"
            title="运行调试：全屏交互预览，可点控件跳布局（Esc 退出）"
            aria-label="运行"
            onClick={() => setRunOpen(true)}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>play_arrow</span>
          </button>
          <button
            className="axv-tb-btn"
            title="格式化代码（重排缩进，保留注释）"
            aria-label="格式化"
            onClick={doFormat}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 22 }}>format_shapes</span>
          </button>
        </div>
        </div>

        {rightOpen ? null : (
          <button
            className="axv-tb-btn axv-tb-side-btn"
            title="展开右侧属性面板"
            aria-label="右侧属性面板"
            aria-pressed={false}
            onClick={() => setRightOpen(true)}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>right_panel_open</span>
          </button>
        )}
      </div>
      </div>

      {runOpen ? (
        <RunPreview
          entryXml={xml}
          entryName={"activity_main"}
          layouts={resExtras?.layouts ?? {}}
          resources={resources}
          device={{ label: device.label, w: device.w, h: device.h, radius: device.radius }}
          onClose={() => setRunOpen(false)}
        />
      ) : null}

      {/* M6a：导出预览图（PNG / SVG） */}
      {/* M21：新建文件保存 → 先确认文件名，再选文件夹（系统选择器里可新建文件夹） */}
      {saveAsOpen ? (
        <div
          className="axv-saveas-mask"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSaveAsOpen(false);
          }}
        >
          <div className="axv-saveas-card">
            <div className="axv-saveas-title">{tr("save.title", "保存布局")}</div>
            <div className="axv-saveas-hint">
              {tr(
                "save.hint",
                "下一步会让你选择保存位置（系统选择器里可以新建文件夹）。生成的形状、图标等依赖资源会一起写进 drawable/，values 写进 values/。",
              )}
            </div>
            <label className="axv-saveas-field">
              <span>{tr("save.fileName", "文件名")}</span>
              <input
                className="axv-saveas-input"
                value={saveAsName}
                autoFocus
                spellCheck={false}
                onChange={(e) => setSaveAsName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmSaveAs();
                  if (e.key === "Escape") setSaveAsOpen(false);
                }}
              />
            </label>
            <div className="axv-saveas-btns">
              <button className="axv-set-btn" onClick={() => setSaveAsOpen(false)}>
                {tr("save.cancel", "取消")}
              </button>
              <button className="axv-set-btn axv-saveas-ok" onClick={() => void confirmSaveAs()}>
                {tr("save.confirm", "选择文件夹并保存")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {imgExportOpen ? (
        <ExportImageModal
          getTarget={(): ExportTarget | null =>
            phoneRef.current
              ? {
                  el: phoneRef.current,
                  width: outerW,
                  height: outerH,
                  background: phoneBg,
                }
              : null
          }
          deviceLabel={device.label}
          width={outerW}
          height={outerH}
          onClose={() => setImgExportOpen(false)}
          onToast={assetsNote}
        />
      ) : null}

      {/* M4u：资源树里的 drawable xml → 绘制编辑器（保存回写 generatedDrawables） */}
      {resShape ? (
        <ShapeEditor
          attrName="background"
          value={`@drawable/${resShape.name}`}
          existingXml={resShape.xml}
          existingNames={Object.keys(generatedDrawables)}
          onClose={() => setResShape(null)}
          onSave={(resourceName, shapeXml) => {
            const safe = sanitizeResName(resourceName, "bg");
            setGeneratedDrawables((m) => ({ ...m, [safe]: shapeXml }));
            setResShape(null);
            setExportNote(`已保存 res/drawable/${safe}.xml`);
            window.setTimeout(() => setExportNote(" "), 3200);
          }}
        />
      ) : null}

      {/* M11j：生成的图标 → 图标编辑器（颜色 / 尺寸 / 路径 / 旋转） */}
      {resIcon ? (
        <IconEditor
          name={resIcon.name}
          xml={resIcon.xml}
          existingNames={Object.keys(generatedDrawables)}
          onClose={() => setResIcon(null)}
          onSave={(safeName, iconXml) => {
            const oldName = resIcon.name;
            setGeneratedDrawables((m) => {
              const next = { ...m };
              if (safeName !== oldName) delete next[oldName];
              next[safeName] = iconXml;
              return next;
            });
            if (safeName !== oldName) onRenameAsset(oldName, safeName);
            // M11p：从属性面板「图标编辑」进来的话，保存后把属性指向这个资源
            if (resIcon.attr) commitAttr(resIcon.attr, "@drawable/" + safeName);
            setResIcon(null);
            setExportNote("已保存 res/drawable/" + safeName + ".xml");
            window.setTimeout(() => setExportNote(" "), 3200);
          }}
        />
      ) : null}

      {/* M4u：资源树里的图片 / vector xml → 图片预览框 */}
      {resImage ? (
        <ResImagePreview
          rel={resImage.rel}
          name={resImage.name}
          url={resImage.url}
          xml={
            generatedDrawables[resImage.name] ??
            resExtras?.drawableXml?.[resImage.name] ??
            resExtras?.drawableXml?.[resImage.name.replace(/\.xml$/i, "")]
          }
          onEdit={(iconXml) => {
            const n = resImage.name.replace(/\.xml$/i, "");
            setResImage(null);
            setResIcon({ name: n, xml: iconXml });
          }}
          onClose={() => setResImage(null)}
        />
      ) : null}
    </div>
  );
}
