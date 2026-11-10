// components/XmlEditor.tsx — M1a 主入口（v4：桌面端按 M3E 原版三栏布局拓展功能 + 移动端 75% 侧滑 + 蒙版）
// 桌面：左 320 停靠（52px 图标条：组件/图层 + 代码/资源）| 中间画布 | 右 320 属性
// 工具栏：☰ 撤销 重做 打开 保存（中段），最右 ⇔ 属性
// 移动端（≤840px 或粗指针+≤1024px）：两侧滑面板宽 75vw，背后加蒙版，点蒙版关闭；
// 画布区顶部 tab 切换 XML 代码 / 预览

"use client";

import AiPanel from "@/components/AiPanel";
import { createResResolver } from "@/lib/xml/res-index";
import { findUsages, type UsageHit } from "@/lib/xml/ai-usages";
import { renameResRef, singularResType } from "@/lib/xml/res-search";
import type { AiFileEntry } from "@/lib/xml/ai-tools";
import { formatResRefHit } from "@/lib/xml/res-refs";
import { parseRefToken, refAction } from "@/lib/xml/ref-token";
import { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue, startTransition } from "react";
import { parseLayoutXml, findNode, serialize, nodeAtLine } from "@/lib/xml/parser";
import { pathChainOf } from "@/lib/xml/path-chain";
import { buildRenderModel } from "@/lib/xml/css";
import { ComparePreview, COMPARE_DEFAULTS } from "./ComparePreview";
import type { MeasuredMap } from "@/lib/xml/constraints";
import {
  EMPTY_MARK,
  MERGE_MS,
  diffHistoryInit,
  diffHistoryCommit,
  diffHistoryUndo,
  diffHistoryRedo,
  diffHistoryCanUndo,
  diffHistoryCanRedo,
  diffTo,
  applyDiff,
  type DiffHistory,
  type MergeMark,
} from "@/lib/xml/history";
import { mergeResourceFragment, DEFAULT_RESOURCES } from "@/lib/xml/resources";
import { buildResourceExtras, backfillDrawableXml, type ResourceExtras } from "@/lib/xml/resdir";
import { loadProjectResForDoc, loadProjectResIndexCached, mergeProjectExtras, invalidateProjectRes } from "@/lib/xml/project-res";
import { loadProjectJavaFiles } from "@/lib/xml/java-files";
import type { ResolvedNode, ResourceTable, XmlNode, XmlIssue, RenderModel } from "@/lib/xml/types";
import { writebackAttrs } from "@/lib/xml/writeback";
import { insertChild, insertSiblingAfter, insertAt, moveSibling, isContainerTag, applyConstraintDefaults, canAcceptChild, childLimitOf } from "@/lib/xml/insert";
import { moveNodeRaw, scanElements, elementAt } from "@/lib/xml/reorder";
import { formatXml } from "@/lib/xml/format";
import { formatJava } from "@/lib/xml/java-format";
import { lintXml, type LintIssue } from "@/lib/xml/lint";
import { lintJava } from "@/lib/xml/java-lint";
import { collectResEnv } from "@/lib/xml/java-res-env";
import { checkXmlResRefs, applyFixToLine } from "@/lib/xml/xml-res-check";
import { checkApiTypos, formatApiIssue } from "@/lib/xml/java-api-check";
import { lintCodeDoc } from "@/lib/xml/lint-doc";
import { loadSnaps, pushSnap, SNAP_LABEL_SAVE } from "@/lib/xml/snapshots";
import { loadBaseline, planWrite, saveBaseline, snapshotBeforeWrite, firstDiffLine } from "@/lib/xml/safe-write";
import { useUnsavedLeave } from "@/components/UnsavedLeaveDialog";
import { vectorToDataUrl } from "@/lib/xml/vector-svg";
import { sanitizeResName } from "@/lib/xml/resname";
import { HistoryPanel } from "@/components/HistoryPanel";
import { repairGeneratedVectors } from "@/lib/xml/icon-vectors";
import { getIconVectorWysiwyg, looksLikeGlyfVector } from "@/lib/xml/font-glyph";
import { hasIcon } from "@/lib/xml/icon-vectors";
import { workspaceLabel, chooseWorkspace, nativeAvailable, copyTextNative, writeTextNative } from "@/lib/xml/native-save";
import { yieldToUi } from "@/lib/xml/native-async";
import { perfMark, perfTimer, heapMB, perfLogPath } from "@/lib/xml/perf-log";
import { DEFAULT_ICON_URL } from "@/lib/xml/default-icon";
// M31i：新建项目时把完整 Android 工程骨架落盘
import { createAndroidProject, packageOf, safeProjectName, validatePackageName } from "@/lib/xml/new-project";
import {
  dirNameOf,
  readAppName,
  readThemeName,
  renameProjectDirNative,
  renameThemeDef,
  renameThemeRef,
  replaceTailDir,
  setAppName,
  setRootProjectName,
  uniqueProjectName,
} from "@/lib/xml/project-rename";
import { nativeNewProjectIO, webNewProjectIO, nativeVerifyProject } from "@/lib/xml/new-project-io";
import { pickXmlFile } from "@/lib/xml/save-as";
import { buildSaveFiles, buildRealRenderFiles, downloadLayout, downloadResZip, nextSaveAction, saveAs as saveAsBundle, saveBack as saveBackPure, type SaveInput } from "@/lib/xml/save-flow";
import { hasRealRender, renderReal, prepareFiles } from "@/lib/xml/native-render";
import { readStoredSigning, writeStoredSigning, clearStoredSigning } from "@/lib/xml/sign-store";
import { pickProjectLayout } from "@/lib/xml/pick-layout";
import { buildApk, hasBuildApk, installApk, shareApkFile, type BuildApkResult } from "@/lib/xml/native-apk";
import { parseGradlePackage } from "@/lib/xml/project-info";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { projectSaveRoot, projectFileExists, readProjectFile, saveProjectFile, saveResFiles, resAbs, RES_PREFIX } from "@/lib/xml/project-save";
import { parseAppIconConfig } from "@/lib/xml/app-icon";
import { nativeBridge } from "@/lib/xml/native-save";
import { codeOnlyNotice, detectDocKind } from "@/lib/xml/doc-kind";
import { isValuesPath } from "@/lib/xml/doc-kind";
import { looksLikeValuesDoc } from "@/lib/xml/values-edit";
import { isManifestPath, looksLikeManifest } from "@/lib/xml/manifest-edit";
import { pickLang } from "@/lib/xml/editor-lang";
import { isJavaLikePath, parseOutline } from "@/lib/xml/java-outline";
import { lineOfPath, shouldResync } from "@/lib/xml/line-sync";
import {
  THEME_PRESETS,
  DEFAULT_PRESET_ID,
  LS_KEY_THEME_OVERRIDES,
  applyThemeToDom,
  normalizeOverrides,
  themeTokens,
  type ThemeMode,
  type ThemeOverrides,
} from "@/lib/xml/theme-presets";
import {
  wsInfo,
  wsListTopProjects,
  wsSubscribeTopProjects,
  wsOpenProject,
  wsPickCustom,
  wsUseDefault,
  wsRequestAllFiles,
  invalidateNativeProjectCache,
  type WsInfo,
  type WsProject,
} from "@/lib/xml/workspace";
import {
  openProjectFolder,
  openProjectFromItem,
  restoreProjectFolder,
  type OpenedProject,
} from "@/lib/xml/project";
import {
  findMainLayout,
  fileOpsCtxOf,
  nativeProjectSource,
  projectSourceFromWorkspaceItem,
  readProjectMeta,
  readProjectMetaNative,
  readProjectMetaFromSource,
  type BrowseEntry,
  type ProjectMeta,
  type ProjectSource,
} from "@/lib/xml/project-browse";
import { ioForProject } from "@/lib/xml/ai-fs";
import { exportProjectZip } from "@/lib/xml/project-export";
import { readPublishInfo } from "@/lib/xml/gradle-publish";
import { SAMPLE_PROJECTS, SAMPLE_BLANKS, sampleProjectByKey } from "@/lib/xml/sample-projects";

/** M31：当前打开的项目（name = app 名称；iconUrl = ic_launcher 图标） */
type ActiveProject = {
  name: string;
  source: ProjectSource | null;
  iconUrl?: string | null;
  /* M36：保存时定位 <项目>/app/src/main/res/ 用 */
  dirPath?: string;
  rootPath?: string;
  handle?: unknown;
};
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
import { CanvasStage } from "./CanvasStage";
import { APP_VERSION } from "@/lib/version";
import { AboutPanel } from "@/components/AboutPanel";
import { SettingsPanel } from "@/components/SettingsPanel";
import { ThemeEditor } from "@/components/ThemeEditor";
import { ProjectPanel } from "@/components/ProjectPanel";
import { loadLangPref, saveLangPref, resolveLang, makeT, type LangPref } from "@/lib/i18n";
import { setI18nLang, t as tt } from "@/lib/i18n-src";
import { XmlCodeView } from "./XmlCodeView";
import { AttrPanel } from "./AttrPanel";
import { AddAttrModal } from "./AddAttrModal";
import { defaultFor } from "./attr-catalog";
import { WidgetPalette } from "./WidgetPalette";
import { ConstraintPanel, type SibOption } from "./ConstraintPanel";
import { autoConstrain, hasConstraints, nextViewId, type CBox, type SibInfo } from "@/lib/xml/autoconstrain";
import { collectMeasurements, inspectorWarningsOf } from "@/lib/xml/inspector";
import type { MeasuredNode } from "@/lib/xml/inspector";
import { ResImagePreview } from "./ResImagePreview";
import { ShapeEditor } from "./ShapeEditor";
import { ResourcePanel } from "./ResourcePanel";
import IconCanvasEditor from "./IconCanvasEditor";
import { renameAsset, renameReferences } from "@/lib/xml/asset-refs";
import { findResolvedNode, splitPath, stripNs, collectIds } from "@/lib/xml/paths";
// M115：画布多选 · 复制 / 粘贴 / 成组 / 解组
import {
  collectSnippets,
  deletePaths as deletePathsText,
  insertSnippetsAt,
  normalizePaths,
  renameDuplicateIds,
  snippetsToText,
  splitSnippets,
  unwrapElement,
  wrapSiblings,
  canUnwrap,
} from "@/lib/xml/clip";
import { LS_KEY_XML, LS_KEY_RES, LS_KEY_ICONS, LS_KEY_PROJECT, LS_KEY_LAST_FILE, LS_KEY_SAMPLE, LS_KEY_APP_ICON, lsGet, lsSet, lsGetJson, lsSetJson } from "@/lib/xml/storage";
/** M144：项目 → 上次打开的文件（按项目记，切项目再回来还是那个文件） */
const LAST_REL_MAP_KEY = "axv.lastFile.map.v1";
function readLastRelMap(): Record<string, string> {
  const raw = lsGetJson<Record<string, string>>(LAST_REL_MAP_KEY);
  return raw && typeof raw === "object" ? raw : {};
}
function readLastRel(projectKey: string): string | null {
  if (!projectKey) return null;
  const rel = readLastRelMap()[projectKey];
  return typeof rel === "string" && rel ? rel : null;
}
function writeLastRel(projectKey: string, rel: string): void {
  if (!projectKey || !rel) return;
  try {
    const map = readLastRelMap();
    map[projectKey] = rel;
    lsSetJson(LAST_REL_MAP_KEY, map);
  } catch {
    /* 静默 */
  }
}

import { RunPreview } from "./RunPreview";
import { Toolbar } from "./Toolbar";
import { SigningDialog } from "./SigningDialog";
import { readSigningFromGradle } from "@/lib/xml/signing";
import { LeftRail, type LeftView } from "./LeftRail";
import { ProblemsDrawer } from "./ProblemsDrawer";
import { Inspector } from "./Inspector";
import { StatusBar } from "./StatusBar";
import { LayerTree } from "./LayerTree";
import { WIDGET_MAP, DRAG_WIDGET_MIME, type WidgetDef } from "./widget-catalog";
import "./xml-canvas.css";
// M100：安卓硬件返回键 → 关闭最上层浮层（而不是直接退出 App）
import { useBackGuard } from "./useBackGuard";
import { installBackBridge, resetBackStack } from "@/lib/ui/back-stack";
import { readableOn, deviceById } from "@/lib/xml/theme";
import { DEFAULT_RENDER_THEME, type RenderTheme } from "@/lib/xml/theme";
import {
  DARK_EDITOR_COLORS,
  DEFAULT_EDITOR_THEME,
  LS_KEY_EDITOR_THEME,
  applyEditorTheme,
  colorsFor,
  parseTheme,
  type EditorColorSet,
  type EditorTheme,
} from "@/lib/xml/editor-theme";

const SAMPLES: Record<string, string> = {
  /** M2s：新建空白 ConstraintLayout 骨架（一行注释 + 空 CL，拖控件进来即可开建） */
  "blank-cl": `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- ${tt("从左侧「组件」把控件拖进来，或选中后在右侧加约束")} -->

</androidx.constraintlayout.widget.ConstraintLayout>
`,
  /** M2s：新建空白 LinearLayout（竖） */
  "blank-ll": `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

  <!-- ${tt("从左侧「组件」把控件拖进来")} -->

</LinearLayout>
`,
  /** M2s：新建空白 FrameLayout */
  "blank-frame": `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- ${tt("从左侧「组件」把控件拖进来")} -->

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
      android:text="${tt("约束布局示例")}"
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
      android:text="${tt("选中控件后在右侧编辑四条边的约束")}"
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
      android:text="${tt("确定")}"
      app:layout_constraintBottom_toBottomOf="parent"
      app:layout_constraintEnd_toEndOf="parent" />

  <TextView
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="${tt("我没约束（选中我点「自动约束」）")}"
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
      android:text="${tt("chain 链式排布 + Guideline")}"
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
      android:text="${tt("一")}"
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
      android:text="${tt("二")}"
      app:layout_constraintStart_toEndOf="@+id/b1"
      app:layout_constraintEnd_toStartOf="@+id/b3"
      app:layout_constraintTop_toTopOf="@+id/b1"
      android:layout_marginStart="8dp"
      android:layout_marginEnd="8dp" />

  <Button
      android:id="@+id/b3"
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:text="${tt("三")}"
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
      android:text="${tt("三个 0dp 按钮在 spread 链里平分宽度")}"
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
      android:text="${tt("左边一段较长的说明文字，会把高度撑高")}"
      android:textSize="14sp"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toTopOf="parent" />

  <TextView
      android:id="@+id/tvR"
      android:layout_width="120dp"
      android:layout_height="wrap_content"
      android:layout_marginStart="16dp"
      android:layout_marginTop="24dp"
      android:text="${tt("右边短")}"
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
      android:text="${tt("我跟着较高的那个往下排")}"
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
      android:text="${tt("项目一")}"/>

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
        project: createProject(tt("我的项目"), { name: guessFileName(raw), xml: raw }),
        xml: raw,
      };
    }
  }
  const [xml, setXml] = useState<string>(() => bootRef.current!.xml);

  /* ===== M57：编辑器 → React 的同步改成「常驻 ref + 防抖落状态」 =====
   * 旧行为：每个按键都 setXml(整份文档) → 这个 3000+ 行的组件整棵树重渲染
   * （ProjectPanel / AttrPanel / LayerTree / Toolbar 全跟着渲染）→ 大文件必然卡。
   * 新：最新文本先进 liveXmlRef（同步、零成本），setXml 防抖 250ms；
   * 保存/格式化/切 tab/撤销前先 flushXml()，保证拿到的是最新内容。
   * 这也是 VS Code（Monaco）/ CM6 官方 React 包的做法：文档真相在编辑器里，React 只拿快照。 */
  const docRef = useRef(xml);
  const liveXmlRef = useRef<string | null>(null);
  /** M202：doFixOne 在 setXmlAndTrack 声明之前就需要引用它，用 ref 包一层 */
  const setXmlAndTrackRef = useRef<((next: string, mergeKey?: string) => void) | null>(null);
  const xmlSyncTimer = useRef<number | null>(null);
  /** 当前真实文本（优先编辑中的最新值） */
  const currentXml = useCallback(() => liveXmlRef.current ?? docRef.current, []);
  const flushXml = useCallback(() => {
    if (xmlSyncTimer.current !== null) {
      window.clearTimeout(xmlSyncTimer.current);
      xmlSyncTimer.current = null;
    }
    const v = liveXmlRef.current;
    if (v === null) return;
    setXml(v);
  }, []);
  useEffect(() => {
    docRef.current = xml;
    // 状态追平后清掉 live（留着会让 currentXml 永远走旧分支）
    if (liveXmlRef.current === xml) liveXmlRef.current = null;
  }, [xml]);
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
      className="axv-tb-select axv-tab-sample"
      title={tt("项目文件（多文件切换）")}
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
      <option value="">{`${currentFile?.name ?? tt("文件")} ▾`}</option>
      <optgroup label={tt("项目文件")}>
        {project.files.map((f) => (
          <option key={f.id} value={f.id}>
            {f.id === project.activeId ? "● " : "○ "} {f.name}
          </option>
        ))}
      </optgroup>
      <optgroup label={tt("文件操作")}>
        <option value="action:new">{tt("＋ 新建文件…")}</option>
        <option value="action:rename">{tt("✎ 重命名当前文件…")}</option>
        <option value="action:delete">{tt("🗑 删除当前文件")}</option>
      </optgroup>
    </select>
  );
  /** 解析用（低优先级）：敲代码时让输入不卡，解析滞后几帧 */
  const parsedXml = useDeferredValue(xml);
  const [resourceFragment, setResourceFragment] = useState("");
  /** M149：重启后把上次示例项目自带的 values/drawable 也恢复回来。
   *  不恢复的话 @string/@drawable 会全裸显示（标题直接写 @string/shop_title），一眼就假。 */
  const sampleBoot = useRef<{ values: string; drawables: Record<string, string> } | null>(null);
  if (sampleBoot.current === null) {
    const key = lsGet(LS_KEY_SAMPLE);
    const p = key ? sampleProjectByKey(key) : undefined;
    sampleBoot.current = p
      ? { values: p.values ?? "", drawables: p.drawables }
      : { values: "", drawables: {} };
  }
  /** 示例项目自带的 values（@color/@string）——单独存，不抢用户自己贴的片段；用户片段优先 */
  const [sampleValues, setSampleValues] = useState(sampleBoot.current.values);
  /** 上传 res/ 目录解析出的附加资源（drawable/vector/styles/values 原文） */
  const [resExtras, setResExtras] = useState<ResourceExtras | null>(null);
  /** M210c：资源索引缓存世代。存了 res 文件（新建布局/values/drawable）后 +1，
   *   让下一次「全量资源索引」先 invalidate 再扫，否则 20s 缓存里还是旧的（新建的 id 查不到 → 误报）。 */
  const [resCacheRev, setResCacheRev] = useState(0);
  const bumpResCache = useCallback(() => setResCacheRev((v) => v + 1), []);
  /** M3g/M3h：本工具生成的 drawable 资源：资源名 → xml 原文（图标 vector + 自定义 shape/ripple 共用） */
  const [generatedDrawables, setGeneratedDrawables] = useState<Record<string, string>>(sampleBoot.current.drawables);
  /** M171：应用图标生成的额外资源（mipmap-anydpi-v26/ic_launcher.xml 等，路径相对 res/） */
  const [appIconRes, setAppIconRes] = useState<Record<string, string>>({});
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
  /** M115：多选的「附加项」（不含主选 selectedPath）；空数组 = 单选 */
  const [selExtra, setSelExtra] = useState<string[]>([]);
  /** M115：内部剪贴板（XML 片段；同时尽量写系统剪贴板） */
  const clipRef = useRef<string>("");
 const [exportNote, setExportNote] = useState<string>(" ");
  /** M154：设备端真渲染（aapt2）——只有 APK 里有桥才能用，且编译要几秒，用 busy 防连点 */
  const [realRenderAvailable, setRealRenderAvailable] = useState(false);
  const [realRenderBusy, setRealRenderBusy] = useState(false);
  useEffect(() => {
    // 网页版没有 AxvNative，APK 里才有；桥在首次加载时就注册好了，查一次即可
    setRealRenderAvailable(hasRealRender());
  }, []);
  /** M101：toast 定时器（连续提示时先清上一个，避免新提示被旧定时器提前抹掉） */
  const noteTimerRef = useRef<number | null>(null);
  /** M11j：正在编辑的生成图标（vector） */
  const [resIcon, setResIcon] = useState<{ name: string; xml: string; attr?: string } | null>(
    null
  );
  /** M4u：从资源树里直接打开的「绘制编辑器」（drawable/*.xml） */
  const [resShape, setResShape] = useState<{ name: string; xml: string; forceTree?: boolean } | null>(null);
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
  const [leftView, setLeftView] = useState<LeftView>("parts");
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
  const [projectTab, setProjectTab] = useState<"projects" | "current">("current");
  const [wsState, setWsState] = useState<WsInfo | null>(null);
  const [wsProjects, setWsProjects] = useState<WsProject[]>([]);
  /** M24：当前项目（项目名 + 懒加载浏览源）。M25d 起不再一次性深扫整棵树 */
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
  /** M25d：手动刷新项目结构时 +1，让面板丢掉懒加载缓存重新读根目录 */
  const [projectRev, setProjectRev] = useState(0);
  /** M25d：项目卡片分析结果（app_name / 图标），key = 项目 rel */
  const [projMeta, setProjMeta] = useState<Record<string, ProjectMeta>>({});
  /** M24：新建项目对话框 */
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState("MyApp");
  /** M31i：新建项目可选图标（data URL 预览 + base64 落盘 + mime；null = 用默认自适应图标） */
  const [newProjIcon, setNewProjIcon] = useState<{ dataUrl: string; base64: string; mime: string } | null>(null);
  /** M176：新建项目时的包名（留空 = 按项目名自动 com.example.xxx） */
  const [newProjPkg, setNewProjPkg] = useState("");
  const [newProjBusy, setNewProjBusy] = useState(false);
  /** M21：当前编辑内容的来源 —— 决定「保存」是写回原路还是弹选择器 */
  const [saveOrigin, setSaveOrigin] = useState<
    { kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null
  >(null);
  /** M23：界面语言（默认跟随系统） */
  const [langPref, setLangPref] = useState<LangPref>(() => loadLangPref());
  const lang = useMemo(() => resolveLang(langPref), [langPref]);
  const tr = useMemo(() => makeT(lang), [lang]);
  // M95：把当前语言同步给模块级 t()，没接 lang prop 的组件也能跟着切
  useEffect(() => {
    setI18nLang(lang);
  }, [lang]);
  useEffect(() => {
    saveLangPref(langPref);
    // 让 <html lang> 跟着走（影响字距/断行规则，也便于辅助技术识别）
    if (typeof document !== "undefined") document.documentElement.lang = lang;
  }, [langPref, lang]);

  /** M21：另存对话框（新建文件时先确认文件名） */
  const [saveAsOpen, setSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("activity_main.xml");
  const [wsBusy, setWsBusy] = useState(false);

  /** M201：磁盘上的文件被外部改过 → 拦下这一次写入，让用户选
   *  （直接用旧内容盖掉别人在电脑上的改动是开发工具最不能犯的错） */
  const [conflict, setConflict] = useState<
    | {
        rel: string;
        disk: string;
        mine: string;
        /** 用户点「覆盖保存」后重跑的那次写入 */
        retry: () => void;
        /** 载入磁盘版本（放弃编辑器里的改动） */
        loadDisk?: () => void;
      }
    | null
  >(null);

  /** M140：历史版本快照面板 */
  const [histPanelOpen, setHistPanelOpen] = useState(false);
  const [snapCount, setSnapCount] = useState(0);
  /** M25b：从项目目录打开的文件名（用于结构树里标「正在编辑」；应用内文件为空） */
  const [wsActiveName, setWsActiveName] = useState("");
  const [wsMsg, setWsMsg] = useState<string>("");
  const [addModalOpen, setAddModalOpen] = useState(false);
  /** M2s：导出前检查面板 */
  const [exportOpen, setExportOpen] = useState(false);
  // M165 并排对比：开/关 + 勾选的设备（localStorage 记住）
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>(() => {
    try {
      const raw = window.localStorage.getItem("axv.compareIds");
      if (raw) {
        const arr = JSON.parse(raw) as string[];
        if (Array.isArray(arr) && arr.length > 0) return arr;
      }
    } catch {
      /* 静默 */
    }
    return COMPARE_DEFAULTS;
  });
  const toggleCompareDevice = (id: string, on: boolean) => {
    setCompareIds((cur) => {
      const next = on ? [...cur, id] : cur.filter((x) => x !== id);
      const list = next.length > 0 ? next : COMPARE_DEFAULTS;
      try {
        window.localStorage.setItem("axv.compareIds", JSON.stringify(list));
      } catch {
        /* 静默 */
      }
      return list;
    });
  };
  const [exportReport, setExportReport] = useState<ExportReport | null>(null);
  /** M13：导出模式（localStorage 记住），compat = 纯平台控件、AIDE 可编译 */
  const [exportMode, setExportMode] = useState<ExportMode>(() => {
    try {
      return window.localStorage.getItem("axv.exportMode") === "compat" ? "compat" : "modern";
    } catch {
      return "modern";
    }
  });
  /** M37：代码编辑器外观（光标/选区/高亮/字号，localStorage 记住） */  const [editorTheme, setEditorTheme] = useState<EditorTheme>(() => {
    try {
      return parseTheme(window.localStorage.getItem(LS_KEY_EDITOR_THEME));
    } catch {
      return DEFAULT_EDITOR_THEME;
    }
  });
  /** M37b：当前打开的工程内相对路径（判断是不是布局文件，以及非布局文件写回哪里） */
  const [openRel, setOpenRel] = useState<string | null>(null);
  const patchEditorTheme = useCallback((patch: Partial<EditorTheme>) => {
    setEditorTheme((t) => ({ ...t, ...patch }));
  }, []);
  const resetEditorTheme = useCallback(() => {
    setEditorTheme(DEFAULT_EDITOR_THEME);
  }, []);
  /** 兼容模式的转换摘要（选 compat 时重算） */
  const [compatNotes, setCompatNotes] = useState<string[]>([]);
  /** M6a：导出预览图（PNG / SVG）弹窗 */
  const [imgExportOpen, setImgExportOpen] = useState(false);
  /** 手机壳 DOM（导出图片要拿它做 DOM → SVG/PNG） */
  const phoneRef = useRef<HTMLDivElement | null>(null);
  const [exportAction, setExportAction] = useState<"download" | "copy">("download");
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [runOpen, setRunOpen] = useState(false);
  /** M199：运行调试时加载的 Java/Kotlin 源码（轻量逻辑仿真用） */
  const [runJavaFiles, setRunJavaFiles] = useState<{ rel: string; text: string }[]>([]);
  /** M199：当前布局名（Java 仿真按它挑 Activity）；开的是代码文件时退回 activity_main */
  const entryLayoutName = useMemo(() => {
    const seg = (openRel || "").replace(/\\/g, "/").split("/").pop() || "";
    if (!/\.xml$/i.test(seg)) return "activity_main";
    return seg.replace(/\.xml$/i, "") || "activity_main";
  }, [openRel]);

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
  /** M90：配色方案的逐项覆盖（方案 id → { light, dark }），存在 localStorage */
  const [themeOverrides, setThemeOverrides] = useState<ThemeOverrides>(() => {
    try {
      return normalizeOverrides(JSON.parse(window.localStorage.getItem(LS_KEY_THEME_OVERRIDES) || "null"));
    } catch {
      return {};
    }
  });
  /** M90：正在子页里编辑的方案 id（null = 没开） */
  const [editingTheme, setEditingTheme] = useState<string | null>(null);
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
  /** M92：预览深色模式（工程 values-night）/ M93：预览语言（values-<locale>） */
  const [previewNight, setPreviewNight] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("axv.previewNight") === "1";
    } catch {
      return false;
    }
  });
  const [previewLocale, setPreviewLocale] = useState<string>(() => {
    try {
      return window.localStorage.getItem("axv.previewLocale") || "";
    } catch {
      return "";
    }
  });
  const [showIssues, setShowIssues] = useState(true);

  /* ===== M100：安卓返回键 =====
   * 注册顺序 = 层级从下到上：先左栅面板，再子页面，最后弹窗。
   * 后注册的优先被返回键消费，所以弹出弹窗时按返回先关弹窗。 */
  useEffect(() => {
    installBackBridge();
    return () => resetBackStack();
  }, []);
  useBackGuard(leftOpen, () => setLeftOpen(false), "left-panel");
  useBackGuard(resShape !== null, () => setResShape(null), "shape-editor");
  useBackGuard(resIcon !== null, () => setResIcon(null), "icon-editor");
  useBackGuard(editingTheme !== null, () => setEditingTheme(null), "theme-dialog");
  useBackGuard(exportOpen, () => setExportOpen(false), "export-dialog");
  useBackGuard(addModalOpen, () => setAddModalOpen(false), "add-attr");
  useBackGuard(imgExportOpen, () => setImgExportOpen(false), "img-export");
  useBackGuard(newProjOpen, () => setNewProjOpen(false), "new-project");
  useBackGuard(saveAsOpen, () => setSaveAsOpen(false), "save-as");

  // M16h：应用配色方案（只影响编辑器外壳，不影响导出/预览）
  // M90：带上当前方案的覆盖值；子页打开时临时预览正在编辑的那套（关闭就回原方案）
  useEffect(() => {
    const shown = editingTheme ?? themePreset;
    applyThemeToDom(shown, theme, themeOverrides[shown]?.[theme]);
    try {
      window.localStorage.setItem("axv.theme", theme);
      window.localStorage.setItem("axv.themePreset", themePreset);
    } catch {
      /* ignore */
    }
  }, [theme, themePreset, editingTheme, themeOverrides]);

  // M90：覆盖表持久化
  useEffect(() => {
    try {
      if (Object.keys(themeOverrides).length) {
        window.localStorage.setItem(LS_KEY_THEME_OVERRIDES, JSON.stringify(themeOverrides));
      } else {
        window.localStorage.removeItem(LS_KEY_THEME_OVERRIDES);
      }
    } catch {
      /* ignore */
    }
  }, [themeOverrides]);

  /** M90：改一项颜色（写到「正在编辑的方案」× 当前亮暗）
   *  ⚠️ 必须用 editingTheme，不能用 themePreset —— 用户可以从卡片直接编辑
   *  未选中的方案，写错对象会把颜色存到当前方案上。 */
  const patchThemeToken = useCallback(
    (token: string, color: string) => {
      const pid = editingTheme ?? themePreset;
      // 改成跟默认值一模一样 → 当作「没改过」，不写冗余覆盖
      const same = themeTokens(pid, theme)[token] === color;
      setThemeOverrides((prev) => {
        const cur = prev[pid] ?? {};
        if (same) {
          const modeMap = { ...(cur[theme] ?? {}) };
          delete modeMap[token];
          const nextPreset = { ...cur };
          if (Object.keys(modeMap).length) nextPreset[theme] = modeMap;
          else delete nextPreset[theme];
          const next = { ...prev };
          if (Object.keys(nextPreset).length) next[pid] = nextPreset;
          else delete next[pid];
          return next;
        }
        const modeMap = { ...(cur[theme] ?? {}), [token]: color };
        return { ...prev, [pid]: { ...cur, [theme]: modeMap } };
      });
    },
    [editingTheme, themePreset, theme],
  );

  /** M90：恢复单项默认（删掉覆盖值） */
  const resetThemeToken = useCallback(
    (token: string) => {
      const pid = editingTheme ?? themePreset;
      setThemeOverrides((prev) => {
        const cur = prev[pid];
        if (!cur) return prev;
        const modeMap = { ...(cur[theme] ?? {}) };
        delete modeMap[token];
        const nextPreset = { ...cur };
        if (Object.keys(modeMap).length) nextPreset[theme] = modeMap;
        else delete nextPreset[theme];
        const next = { ...prev };
        if (Object.keys(nextPreset).length) next[pid] = nextPreset;
        else delete next[pid];
        return next;
      });
    },
    [editingTheme, themePreset, theme],
  );

  /** M90：整套方案恢复默认 */
  const resetThemePreset = useCallback(() => {
    const pid = editingTheme ?? themePreset;
    setThemeOverrides((prev) => {
      if (!prev[pid]) return prev;
      const next = { ...prev };
      delete next[pid];
      return next;
    });
  }, [editingTheme, themePreset]);

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

  // M92/M93：深色模式与预览语言持久化
  useEffect(() => {
    try {
      window.localStorage.setItem("axv.previewNight", previewNight ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [previewNight]);
  useEffect(() => {
    try {
      window.localStorage.setItem("axv.previewLocale", previewLocale);
    } catch {
      /* ignore */
    }
  }, [previewLocale]);

  // M37：代码编辑器外观（CSS 变量 + localStorage 持久化）
  // M90b：光标/选区/当前行 4 个颜色分浅色、深色两套，按当前主题取
  useEffect(() => {
    applyEditorTheme(editorTheme, theme);
    try {
      window.localStorage.setItem(LS_KEY_EDITOR_THEME, JSON.stringify(editorTheme));
    } catch {
      /* ignore */
    }
  }, [editorTheme, theme]);

  /** M90b：改代码编辑器的 4 个颜色之一（按当前亮/暗写对应那一套） */
  const patchEditorColor = useCallback(
    (patch: Partial<EditorColorSet>) => {
      setEditorTheme((t) =>
        theme === "dark" ? { ...t, dark: { ...(t.dark ?? {}), ...patch } } : { ...t, ...patch },
      );
    },
    [theme],
  );

  /* ===== M16i：工作目录 ===== */
  const wsSigRef = useRef<string>("");
  /** M30：工作目录状态签名（避免 4s 轮询把同一个 info 重设成新对象 → 整面板重渲染） */
  const wsInfoSigRef = useRef<string>("");
  /** M30：静默轮询用上次的 info，不再每轮都问一次 bridge */
  const wsInfoRef = useRef<WsInfo | null>(null);
  /** M30：轮询重入锁（上一次还在读文件就不再发新的） */
  const wsTickingRef = useRef(false);
  /** M48：手动刷新防重入 */
  const wsBusyRef = useRef(false);
  /** M25d：已经分析过名称/图标的项目（rel），避免 4s 轮询重复读文件 */
  const analyzedRef = useRef<Set<string>>(new Set());
  /** M48：分析链重入锁 */
  const analyzingRef = useRef(false);

  /** M25d/M31：后台分析项目名/图标（串行，读不到就跳过，不影响列表渲染）
   *  web：有 DirHandle 走 readProjectMeta；APK：没有句柄，按项目绝对路径试读 strings.xml + ic_launcher */
  const analyzeProjects = useCallback(
    async (list: WsProject[]) => {
      // M48：同一个项目列表只允许一条分析链在跑（轮询和重试可能撞车）
      if (analyzingRef.current) return;
      analyzingRef.current = true;
      // M47：每轮最多分析 4 个，剩下的 200ms 后再来一轮，
      // 避免一打开面板就一口气读十几个项目把主线程啃完（手机上最重的就是这里）
      let count = 0;
      let ok = 0;
      const patch: Record<string, ProjectMeta> = {};
      for (const it of list) {
        if (count >= 4) break;
        if (it.kind !== "dir") continue;
        if (!it.handle && !it.dirPath) continue;
        if (analyzedRef.current.has(it.rel)) continue;
        try {
          const meta = it.handle
            ? await readProjectMeta(it.handle, it.name)
            : await readProjectMetaNative(it.name, it.dirPath);
          // M31d：成功才记账，失败（权限未授权/目录刚变）下一轮轮询再试
          analyzedRef.current.add(it.rel);
          patch[it.rel] = meta;
          count++;
          ok++;
        } catch {
          /* 分析失败就当没有，卡片回退到文件夹名 */
          count++;
        }
        // M33：一个一个来，每个之间让出一帧，列表可以边读边显示（不再整页卡住）
        await yieldToUi();
      }
      // 一次性合并，避免 N 次 setState 引发 N 轮重渲染
      if (Object.keys(patch).length) setProjMeta((prev) => ({ ...prev, ...patch }));
      analyzingRef.current = false;
      // 还有没分析完的 → 200ms 后再来一轮（页面隐藏时不排）
      // M48：一轮里一个都没成功（比如没权限）就不重试，否则会 200ms 一次死循环空转
      const remaining =
        ok > 0
          ? list.filter(
              (it) => it.kind === "dir" && (it.handle || it.dirPath) && !analyzedRef.current.has(it.rel),
            )
          : [];
      if (remaining.length) {
        window.setTimeout(() => {
          if (typeof document !== "undefined" && document.hidden) return;
          void analyzeProjects(list);
        }, 200);
      }
    },
    [],
  );

  const refreshWorkspace = useCallback(async (opts?: { quiet?: boolean }) => {
    const quiet = !!opts?.quiet;
    // M63k：浏览器不支持选目录时，刷新毫无意义——直接不进循环，
    // 否则非静默刷新会把 wsBusy 抬一下，「正在读取…」就一直闪
    if (!quiet && wsInfoRef.current?.mode === "unsupported") return;
    if (quiet && wsTickingRef.current) return;
    if (quiet) wsTickingRef.current = true;
    if (!quiet) {
      // M48：手点刷新时防重入（连续点两下不再排队跑两次 JNI）
      if (wsBusyRef.current) return;
      wsBusyRef.current = true;
      setWsBusy(true);
    }
    try {
      // M47：非静默刷新一开始先让出一帧，让「点 tab」的点击动画先画完，
      // 后面的同步 JNI（wsInfo / listTopProjects）不再挡在点击帧前面
      if (!quiet) await yieldToUi();
      // M30：静默轮询复用上次 info（native 下 getWorkspaceInfo 每次都要走 JNI），
      // 只有手动刷新才重新问一次。
      const info: WsInfo = quiet && wsInfoRef.current ? wsInfoRef.current : await wsInfo();
      wsInfoRef.current = info;
      const infoSig = `${info.mode}:${info.label}:${info.custom ? 1 : 0}:${info.allFiles ? 1 : 0}`;
      if (!quiet || infoSig !== wsInfoSigRef.current) {
        wsInfoSigRef.current = infoSig;
        setWsState(info);
      }
      let next: WsProject[] = [];
      if (info.mode === "unsupported") {
        next = [];
      } else if (info.mode === "native" || info.custom) {
        // M25d：只读一层（不再深扫整个工作目录）
        // M58：顶层列表走 12s 内存缓存（mtime 没变就不重新探测，轮询/切 tab 都是免费）
        next = await wsListTopProjects();
      }
      // 自动刷新时列表没变就不 setState（否则卡片/树一直重建）
      const sig = next.map((p) => `${p.kind}:${p.rel}`).join("|");
      if (!quiet || sig !== wsSigRef.current) {
        wsSigRef.current = sig;
        setWsProjects(next);
        void analyzeProjects(next);
      }
    } catch (e) {
      if (!quiet) setWsMsg(e instanceof Error ? e.message : String(e));
    } finally {
      if (!quiet) {
        wsBusyRef.current = false;
        setWsBusy(false);
      }
      wsTickingRef.current = false;
    }
  }, [analyzeProjects]);

  useEffect(() => {
    // M63k：不支持选目录的环境（比如非 Chromium 浏览器）就别再刷了
    if (wsState?.mode === "unsupported") return;
    // M47：项目管理 tab 才刷工作目录；设置 tab 只往从未加载过工作目录信息时补一次
    //（旧逻辑两个 tab 都无条件刷 → 手机上每次点「设置」都走一遍同步 JNI）
    if (leftView === "res") void refreshWorkspace();
    else if (leftView === "settings" && !wsState) void refreshWorkspace();
  }, [leftView, refreshWorkspace, wsState]);

  /* M60：订阅「后台补齐的完整项目列表」——快速列表先出卡片，完整探测回来后
     自动替换成带 mainPath/精确计数的版本（并继续跑图标/名称分析） */
  useEffect(() => {
    const unsub = wsSubscribeTopProjects((full) => {
      setWsProjects(full);
      void analyzeProjects(full);
    });
    return unsub;
  }, [analyzeProjects]);

  /* M24/M30：项目列表自动刷新 —— 12s 一次（原来 4s，在手机上频繁走 JNI 会卡）；
     切回页面/窗口获得焦点时立即刷一次。 */
  useEffect(() => {
    if (leftView !== "res") return;
    // M63k：不支持选目录 → 不起轮询（否则「正在读取…」每 12s 闪一次）
    if (wsState?.mode === "unsupported") return;
    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) return;
      void refreshWorkspace({ quiet: true });
    };
    const timer = window.setInterval(tick, 12000);
    const onVisible = () => {
      if (!document.hidden) tick();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [leftView, refreshWorkspace, wsState?.mode]);

  /** M24：打开项目面板时恢复上次的项目结构（不弹窗，权限失效就当没有） */
  useEffect(() => {
    if (leftView !== "res") return;
    if (activeProject) return;
    let alive = true;
    void (async () => {
      // M47：先让出画面，再走 JNI（restoreProjectFolder 内部会同步调 wsInfo/wsListProjects）
      await yieldToUi();
      try {
        const p = await restoreProjectFolder();
        if (alive && p) setActiveProject(p);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, [leftView, activeProject]);

  const pickCustomDir = useCallback(async () => {
    const ok = await wsPickCustom();
    if (!ok) {
      setWsMsg(wsState?.mode === "unsupported" ? tt("当前浏览器不支持，请用 Chrome / Edge 或 APK") : tt("已取消选择"));
      return;
    }
    setWsMsg("");
    // 原生选择器是异步回调，给系统一点时间落盘
    window.setTimeout(() => void refreshWorkspace(), 600);
  }, [refreshWorkspace, wsState?.mode]);

  const useDefaultDir = useCallback(async () => {
    await wsUseDefault();
    setWsMsg(tt("已恢复默认工作目录"));
    window.setTimeout(() => void refreshWorkspace(), 400);
  }, [refreshWorkspace]);

  // M30b：默认落在「XML 代码」tab
  const [mobileTab, setMobileTab] = useState<"preview" | "xml" | "values">("xml");

  /** M56：代码 tab 时不需要渲染模型 —— 只在 preview/values 视图才把解析结果交给渲染管线，
   *   这样代码 tab 连续打字时 parse/buildRenderModel/实测回路全不跑（代码高亮不受影响，
   *   那是 CM6 自己的增量解析器，跟这条管线无关）。切回预览/停手后才重新算。 */
  const previewActive = mobileTab === "preview" || mobileTab === "values";
  const parsedForRender = previewActive ? parsedXml : "";


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
  const [histInfo, setHistInfo] = useState({ canUndo: false, canRedo: false });

  /* ===== 撤销 / 重做（M59：diff 栈）=====
     原来存全量快照 ×20 份，250KB 文档就是 5MB。现在存相邻两版的 diff
     （十几个字符），50 步撤销只占几十 KB。
     结构变更立即入栈；手动敲代码则防抖 500ms 合并成一步。 */
  const histRef = useRef<DiffHistory>(diffHistoryInit(lsGet(LS_KEY_XML) ?? SAMPLES.list));
  const textTimer = useRef<number | null>(null);

  const syncHist = () => {
    const h = histRef.current;
    setHistInfo({ canUndo: diffHistoryCanUndo(h), canRedo: diffHistoryCanRedo(h) });
  };
  /** M2u：合并窗口——同一手势 key 在 900ms 内连续提交 → 只覆盖栈顶，不新增撤销点 */
  const lastCommitRef = useRef<MergeMark>(EMPTY_MARK);
  const commitHistory = useCallback((next: string, key = "") => {
    const h = histRef.current;
    if (next === h.cur) return;
    const now = Date.now();
    const mark = lastCommitRef.current;
    const canMerge = key !== "" && key === mark.key && now - mark.at < MERGE_MS && h.undo.length > 0;
    if (canMerge) {
      // 手势进行中：把「上一步 diff」换成「手势起点 → 当前」这一段
      const prev = applyDiff(h.cur, h.undo[h.undo.length - 1], false);
      histRef.current = { ...h, undo: [...h.undo.slice(0, -1), diffTo(prev, next)], redo: [], cur: next };
    } else {
      histRef.current = diffHistoryCommit(h, next);
    }
    lastCommitRef.current = { at: now, key };
    syncHist();
  }, []);
  const flushTextTimer = useCallback(() => {
    if (textTimer.current !== null) {
      window.clearTimeout(textTimer.current);
      textTimer.current = null;
    }
  }, []);

  const canUndo = histInfo.canUndo;
  const canRedo = histInfo.canRedo;
  /** M139：把「还没入栈的编辑」先提交（编辑器里 500ms 合并窗口内按 Ctrl+Z 时，
   *  以前 flushTextTimer 只是丢弃定时器 → 刚敲的那段既没入栈也不在撤销范围，直接蒸发） */
  const commitPendingText = () => {
    const pending = liveXmlRef.current;
    if (pending !== null && pending !== histRef.current.cur) commitHistory(pending);
  };

  const undo = () => {
    flushTextTimer();
    commitPendingText();
    flushXml();
    liveXmlRef.current = null;
    const r = diffHistoryUndo(histRef.current);
    if (r.next === histRef.current) return;
    histRef.current = r.next;
    lastCommitRef.current = EMPTY_MARK; // M2u：撤销后断开合并链，新操作必须新建撤销点
    setXml(r.doc);
    syncHist();
  };
  const redo = () => {
    flushTextTimer();
    // 有未入栈的输入时先提交（会清空 redo 栈），否则重做会跳过刚敲的那段
    commitPendingText();
    flushXml();
    liveXmlRef.current = null;
    const r = diffHistoryRedo(histRef.current);
    if (r.next === histRef.current) return;
    histRef.current = r.next;
    lastCommitRef.current = EMPTY_MARK;
    setXml(r.doc);
    syncHist();
  };

  // 移动端判定（与 M3E 原版同口径：max-width:840 或 粗指针且 max-width:1024）
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 840px), (pointer: coarse) and (max-width: 1024px)");
    const apply = () => {
      const m = mq.matches;
      setIsMobile(m);
      // 进移动端：两侧面板收起，默认看代码 tab（M30b）；values 文件则直接进「视图」（M42）
      if (m) {
        setLeftOpen(false);
        setRightOpen(false);
        setMobileTab(hasViewTabRef.current ? "values" : "xml");
      } else {
        setLeftOpen(true);
        setRightOpen(true);
      }
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ===== 键盘快捷键：Ctrl/⌘ + Z 撤销 / Y 重做 / S 保存 / F 格式化 / C,V,D,G 多选操作 =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      // M115：在输入框 / 代码编辑器里不接 C V D G（那里要能正常复制粘贴文本）
      const t = e.target as HTMLElement | null;
      const inEditing =
        !!t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable ||
          !!t.closest?.(".cm-editor"));
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
      } else if (!inEditing && k === "c") {
        // M115：复制选中的控件（没选中就不拦，留给浏览器）
        if (!selectedPath) return;
        e.preventDefault();
        copySelection();
      } else if (!inEditing && k === "v") {
        if (!selectedPath) return;
        e.preventDefault();
        pasteSelection();
      } else if (!inEditing && k === "d") {
        if (!selectedPath) return;
        e.preventDefault();
        duplicateSelection();
      } else if (!inEditing && k === "g") {
        e.preventDefault();
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
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
  /* ===== M56：历史栈不再持久化到 localStorage =====
   * 旧实现在每次打字停顿 600ms 后 JSON.stringify(60条×整份文档) ≈ 序列化 12MB 写 localStorage，
   * 手机上这是真·卡顿源。历史本来就是「会话内」的（关 App 重开没有意义），
   * 砍掉持久化，保留当前文档 LS_KEY_XML 的持久化（重启恢复当前内容）。 */
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
            setExportNote(tt("已按选择器同款样式重建 {n} 个图标", { n }));
            window.setTimeout(() => setExportNote(""), 4200);
          }
        })();
        if (fixed.repaired.length > 0) {
          setExportNote(tt("已修正 {n} 个旧图标的坐标（之前预览是空白）", { n: fixed.repaired.length }));
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
      const file = safe + ".xml";
      const root = projectSaveRoot(activeProject);
      // M172：有打开的项目就直接写进 res/drawable，不只存内存
      if (root) {
        void saveResFiles(root, [{ path: `drawable/${file}`, text: vectorXml }]).then((r) => {
          setExportNote(
            r.ok
              ? tt("已写入 res/drawable/{file}，属性指向它", { file })
              : tt("已生成 drawable/{file}（内存），但写入项目失败：{reason}", { file, reason: r.failed[0] || tt("目录不可写") }),
          );
          window.setTimeout(() => setExportNote(""), 4200);
        });
        return;
      }
      setExportNote(tt("已生成 res/drawable/{file}，属性指向它（导出 res 包时会自动包含）", { file }));
      window.setTimeout(() => setExportNote(""), 3600);
    },
    [selectedPath, activeProject],
  );

  /** M3h：形状 → 存 xml + 把属性写成 @drawable/资源名（与图标同一存储） */
  const onSaveShape = useCallback(
    (attrName: string, resourceName: string, shapeXml: string) => {
      const safe = sanitizeResName(resourceName, "bg");
      setGeneratedDrawables((m) => ({ ...m, [safe]: shapeXml }));
      if (selectedPath) commitAttrRef.current(attrName, `@drawable/${safe}`);
      const file = safe + ".xml";
      const root = projectSaveRoot(activeProject);
      // M172：有打开的项目就直接写进 res/drawable，不只存内存
      if (root) {
        void saveResFiles(root, [{ path: `drawable/${file}`, text: shapeXml }]).then((r) => {
          setExportNote(
            r.ok
              ? tt("已写入 res/drawable/{file}，属性指向它（水波纹？{yn}）", {
                  file,
                  yn: shapeXml.includes("<ripple") ? tt("是") : tt("否"),
                })
              : tt("已生成 drawable/{file}（内存），但写入项目失败：{reason}", {
                  file,
                  reason: r.failed[0] || tt("目录不可写"),
                }),
          );
          window.setTimeout(() => setExportNote(""), 4200);
        });
        return;
      }
      setExportNote(tt("已生成 res/drawable/{file}（含水波纹？{yn}），属性指向它", { file, yn: shapeXml.includes("<ripple") ? tt("是") : tt("否") }));
      window.setTimeout(() => setExportNote(""), 3600);
    },
    [selectedPath, activeProject],
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
        themeAttrsNight: resExtras.themeAttrsNight,
        colorsNight: resExtras.colorsNight,
        stringsByLocale: resExtras.stringsByLocale,
        nightMode: previewNight,
        locale: previewLocale,
        styles: resExtras.styles,
      };
    }
    return base;
  }, [resourceFragment, sampleValues, resExtras, generatedDataUrls, generatedVectorNames, generatedShapeXml, previewNight, previewLocale]);

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

/** M166：drawable 编辑器搜索候选 = 项目 res/drawable 下的文件名（resExtras）
 *  + 工具已生成/上传的 generatedDrawables。只传 generated 会把磁盘上的资源全漏掉 */
const allDrawableNames = useMemo(() => {
  const set = new Set<string>([...Object.keys(resExtras?.drawableXml ?? {}), ...Object.keys(generatedDrawables)]);
  return [...set].map((n) => n.replace(/\.xml$/i, "")).filter(Boolean).sort((a, b) => a.localeCompare(b));
}, [resExtras, generatedDrawables]);

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
  /** M187：DPX 固定 = SCALE。
   *  用户缩放不再进布局 px —— 否则「外壳随缩放变大、控件 px 不变」，
   *  里面所有 dp 控件相对外框越缩越小（用户看到的「排版没跟上」）。
   *  现在缩放只由手机外壳的 transform: scale(fitRatio) 表达，整机等比放大缩小。 */
  const DPX = SCALE;

  /** M37b：当前文档是布局还是「只读代码」（manifest / values / menu …） */  const docKind = useMemo(
    () => detectDocKind(xml, openRel, saveOrigin?.name ?? null),
    [xml, openRel, saveOrigin?.name],
  );
  const codeOnly = docKind === "code";
  const codeNotice = useMemo(
    () => (codeOnly ? codeOnlyNotice(openRel || saveOrigin?.name || "") : null),
    [codeOnly, openRel, saveOrigin?.name],
  );
  /** M38：编辑器语法（.java/.kt → java，其余 xml） */
  const editorLang = useMemo(
    () => pickLang(openRel || saveOrigin?.name || null),
    [openRel, saveOrigin?.name],
  );

  /* ===== M61：Java/Kotlin 函数列表（右侧面板） =====
     只在当前文件是 .java/.kt 时算（xml 文档不跑），解析是单趟扫描，几次毫秒级 */
  const codeFileName = useMemo(
    () => (openRel || saveOrigin?.name || "").split(/[\\/]/).pop() || "",
    [openRel, saveOrigin?.name],
  );
  const isJavaFile = useMemo(() => isJavaLikePath(codeFileName), [codeFileName]);
  const javaOutline = useMemo(
    () => (isJavaFile ? parseOutline(xml, /\.kts?$/i.test(codeFileName)) : undefined),
    [isJavaFile, xml, codeFileName],
  );
  /** 代码编辑器光标行（函数列表里高亮「你在这儿」） */
  const [codeCursor, setCodeCursor] = useState(0);
  /** M39：values 资源文件 → 代码视图默认走表格（路径优先，其次看内容根节点是不是 <resources>） */
  const isValuesFile = useMemo(
    () =>
      isValuesPath(openRel || saveOrigin?.name || null) ||
      (docKind === "code" && looksLikeValuesDoc(xml)),
    [openRel, saveOrigin?.name, docKind, xml],
  );
  /** M43：AndroidManifest.xml → 「视图」页编辑基本字段/权限/组件 */
  const isManifestFile = useMemo(
    () => isManifestPath(openRel || saveOrigin?.name || null) || (docKind === "code" && looksLikeManifest(xml)),
    [openRel, saveOrigin?.name, docKind, xml],
  );
  /** 支持表格/表单视图的文件（values / manifest） */
  const hasViewTab = isValuesFile || isManifestFile;
  const viewKind: "values" | "manifest" | null = isManifestFile ? "manifest" : isValuesFile ? "values" : null;
  /** M37b/M42：按文件类型定默认页 —— values 文件进「视图」，其他只读代码文件进「代码」 */
  const docKey = openRel || saveOrigin?.name || "";

  // M64b（B2）：AI 的文件通道跟着「当前项目」走，不再拼默认目录 + 项目名
  const aiFileIo = useMemo(() => ioForProject(activeProject), [activeProject]);

  // M159：打开文件就把它引用的项目资源读进来（values + @drawable 递归 → 再后台扫全套）
  // M194：Java/Kotlin 文件（codeOnly）也要扫 —— javaResEnv 靠它查 R.layout.X / R.string.X 是否真存在
  // 否则「R.layout.activity_main 不存在」对磁盘上真实存在的布局是误报（以前只扫非 code 文档）
  useEffect(() => {
    if (!aiFileIo || !openRel) return;
    let cancelled = false;
    void (async () => {
      try {
        // M210c：项目 res 刚被写过（resCacheRev 变）→ 先失效全量索引缓存，否则 20s 内还是旧 id/布局
        if (resCacheRev > 0) invalidateProjectRes(aiFileIo);
        const quick = await loadProjectResForDoc(aiFileIo, openRel, currentXml());
        if (cancelled) return;
        if (quick) setResExtras((prev) => mergeProjectExtras(prev, quick) ?? quick);
        const full = await loadProjectResIndexCached(aiFileIo, openRel);
        if (cancelled || !full) return;
        setResExtras((prev) => mergeProjectExtras(prev, full) ?? full);
      } catch {
        /* 资源拿不到不影响编辑，预览按已有资源降级 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiFileIo, openRel, currentXml, resCacheRev]);

  // M199：进运行调试前把项目里的 Java/Kotlin 读进来（只读，失败就当没代码）
  useEffect(() => {
    if (!runOpen) return;
    let cancelled = false;
    void (async () => {
      try {
        const files = await loadProjectJavaFiles(aiFileIo);
        if (!cancelled) setRunJavaFiles(files);
      } catch {
        if (!cancelled) setRunJavaFiles([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runOpen, aiFileIo]);

  const hasViewTabRef = useRef(hasViewTab);
  hasViewTabRef.current = hasViewTab;
  useEffect(() => {
    if (hasViewTab) setMobileTab("values");
    else if (codeOnly) setMobileTab("xml");
  }, [hasViewTab, codeOnly, docKey]);

  /** M57：共享解析结果 —— 模型 / 图层树 / 结构检查共用一棵语法树，不再各 parse 一次
   *  ⚠ 必须在下面 model 的 useMemo **之前**声明：render 时 memo 主体立即执行，
   *    若引用后面才声明的 const 会报 "Cannot access 'parsedDoc' before initialization"（TDZ） */
  const parsedDoc = useMemo(() => {
    if (parsedForRender === "") return { root: null, issues: [] as XmlIssue[] };
    const t = perfTimer("xml.parse", "len=" + parsedForRender.length);
    try {
      const doc = parseLayoutXml(parsedForRender);
      t.end("issues=" + (doc.issues?.length ?? 0));
      return doc;
    } catch (e) {
      t.end("ERR");
      console.error("[axv] 解析失败", e); // i18n-ignore
      return { root: null, issues: [] as XmlIssue[] };
    }
  }, [parsedForRender]);

  const { model, issues, parseErr, parseReason } = useMemo((): {
    model: RenderModel | null;
    issues: XmlIssue[];
    parseErr: boolean;
    parseReason: string;
  } => {
    // M22：解析 / 约束求解全程兜住异常 —— 半个 XML、错标签、坏属性都不能让整个页面白屏
    try {
      // M37b：非布局文件不走布局管线（否则 manifest 会被报缺 layout_width 之类）
      if (codeOnly) return { model: null, issues: [], parseErr: false, parseReason: "" };
      // M56：代码 tab 不打字解析（parsedForRender=""），高亮由 CM6 自己跑，互不影响
      if (parsedForRender === "") {
        return { model: null, issues: [], parseErr: false, parseReason: "" };
      }
      // M57：复用共享解析结果（原来这里 parse 一次、treeRoot 再一次、lint 再一次 = parse×3）
      const parsed = parsedDoc;
      if (!parsed.root) {
        const first = parsed.issues.find((i) => i.level === "error");
        return {
          model: null,
          issues: parsed.issues,
          parseErr: true,
          parseReason: first ? first.message : tt("没有可识别的根布局节点"),
        };
      }
      // M2q：把上传 res/layout 里的布局传进去，供 <include> 就地展开
      // M2r：屏幕尺寸传入，影响 match_parent 根 / CL 内容区回落值
      // M2t：wrap 实测表传入，CL/RL 求解的 wrap 维度不再靠 estSize 估
      const tModel = perfTimer("xml.model");
      const built = buildRenderModel(
        parsed.root,
        resources,
        SCALE,
        resExtras?.layouts,
        { w: device.w, h: device.h },
        measured ?? undefined,
        renderTheme,
      );
      tModel.end("built");
      return {
        model: built,
        issues: parsed.issues,
        parseErr: false,
        parseReason: "",
      };
    } catch (e) {
      console.error("[axv] 渲染模型构建失败", e); // i18n-ignore
      return {
        model: null,
        issues: [],
        parseErr: true,
        parseReason: tt("渲染失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }),
      };
    }
  }, [previewActive ? parsedForRender : "", resources, resExtras?.layouts, device, measured, renderTheme, codeOnly]);

  /** M2t：XML / 设备变了 → 旧 path 可能指向别的节点，实测表作废重测 */
  useEffect(() => {
    measurePass.current = 0;
    setMeasured((m) => (m ? null : m));
  }, [previewActive ? parsedForRender : "", device]);

  /**
   * M2t：wrap_content 真实尺寸回填。
   * CL/RL 的子项是 absolute（wrap 轴已写成 width/height:auto），渲染后读 offsetWidth/Height
   * 就是浏览器按真实文字/图标算出的尺寸 → 回填给下一个渲染循环，兄弟锚点/居中/bias 才准。
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const host = document.querySelector(".axv-phone-body");
    if (!host) return;
    const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
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
    // M59：量「读 DOM 尺寸」花多少（回流次数 × 节点数的直接成本）
    const ms = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
    perfMark("xml.measure", `pass=${measurePass.current} nodes=${next.size} ${ms.toFixed(1)}ms`);
    setMeasured(next);
  }, [model, measured]);

  /** 图层树用的原始节点树（不经渲染模型） */
  const treeRoot = useMemo(() => parsedDoc.root, [parsedDoc]);

  /** M57：lint 改「停手后跑」——代码 tab 仍能标错，但打字期间不跑（lintXml 之前是 O(n²) 已修，
   *  这里再加一道闸：400ms 内不再输入才计算） */
  const [lintSrc, setLintSrc] = useState("");
  useEffect(() => {
    // M138：非布局文件也跑校验（lint-doc 按文件类型叠领域规则），只是规则不同
    const t = window.setTimeout(() => setLintSrc(parsedXml), 400);
    return () => window.clearTimeout(t);
  }, [parsedXml]);

  /** M177：把工程里的布局/values/图片汇总成资源清单，供 Java 代码检查 */
  const javaResEnv = useMemo(() => {
    const layouts: Record<string, string> = { ...(resExtras?.layouts ?? {}) };
    const drawables = [
      ...Object.keys(resExtras?.drawables ?? {}),
      ...Object.keys(resExtras?.drawableXml ?? {}),
      ...(resExtras?.vectorNames ?? []),
      ...Object.keys(generatedDrawables ?? {}),
    ];
    // M179：示例项目/资源片段的 values 也参与渲染，检查时同源带上，否则 string/color 引用查不到真名
    const valuesText = [resExtras?.valuesXml ?? "", sampleValues].filter((x) => x.trim()).join("\n");
    return collectResEnv({
      layouts,
      currentLayoutXml: docKind === "layout" ? xml : null,
      valuesFiles: valuesText.trim() ? { "values.xml": valuesText } : undefined,
      drawables,
    });
  }, [resExtras, generatedDrawables, docKind, xml, sampleValues]);

  /** M179：XML 资源引用检查用的清单（名字集合；某类为空时不检查该类） */
  const xmlResEnv = useMemo(
    () => ({
      layout: javaResEnv.layout,
      drawable: javaResEnv.drawable,
      mipmap: javaResEnv.mipmap,
      string: javaResEnv.string,
      color: javaResEnv.color,
      dimen: javaResEnv.dimen,
      style: javaResEnv.style,
      id: javaResEnv.ids,
    }),
    [javaResEnv],
  );
  /** 资源清单的指纹：只有名字真变了才重跑 lint（打字时不变，保住 M57 的 debounce） */
  const xmlResSig = useMemo(
    () =>
      [
        xmlResEnv.layout,
        xmlResEnv.drawable,
        xmlResEnv.mipmap,
        xmlResEnv.string,
        xmlResEnv.color,
        xmlResEnv.dimen,
        xmlResEnv.style,
        xmlResEnv.id,
      ]
        .map((xs) => (xs ?? []).join(","))
        .join("|"),
    [xmlResEnv],
  );

  /** 代码视图的结构检查（带行号，标红用） */
  const lints = useMemo(() => {
    try {
      if (lintSrc === "") return [] as LintIssue[];
      const t = perfTimer("xml.lint", "len=" + lintSrc.length);
      // M142：.java / .kt 是 Java 语法，不能拿 XML 规则跑（`if (a<1) {` 里的 `<1` 会被当成标签 → 误报「未闭合」）
      let out: LintIssue[];
      if (isJavaFile) {
        out = lintJava(lintSrc, {
          isKotlin: /\.kt(s)?$/i.test(codeFileName),
          // M177：把项目里真实存在的资源喂进去，R.id / R.layout / findViewById 类型才能真校验
          ids: javaResEnv.ids,
          res: {
            layout: javaResEnv.layout,
            string: javaResEnv.string,
            drawable: javaResEnv.drawable,
            color: javaResEnv.color,
            dimen: javaResEnv.dimen,
            mipmap: javaResEnv.mipmap,
            style: javaResEnv.style,
          },
          idTag: javaResEnv.idTag,
        }).map((j) => ({
          line: j.line,
          level: j.sev,
          message: j.msg,
          // M202：带列号/长度，编辑器能画精确范围的波浪下划线（像 AIDE 那样圈住出问题的这一段）
          ...(j.col !== undefined ? { col: j.col } : {}),
          ...(j.len !== undefined ? { len: j.len } : {}),
          // M179：能自动修复的带上 from/to，编辑器给「一键修复」
          ...(j.fix ? { fix: { from: j.fix.from, to: j.fix.to, label: `${j.fix.from} → ${j.fix.to}` } } : {}),
          // M207：带上机器可读 code，问题卡片能显示「为什么报 / 怎么改」
          code: j.code,
        }));
        // M178：控件方法名拼写错误（setTxt → setText），只报编辑距离 1 的
        for (const a of checkApiTypos(lintSrc)) {
          out.push({ line: a.line, level: "warn", message: formatApiIssue(a), code: "method" });
        }
      } else if (codeOnly) {
        // M138：非布局文件走 lint-doc（结构 + 清单/values/drawable 等类型规则）
        out = lintCodeDoc(lintSrc, openRel || saveOrigin?.name || currentFile?.name || "");
        // M179：drawable / menu / values / 清单 里也会引用资源，名字拼错一样给提示
        out.push(...checkXmlResRefs(lintSrc, xmlResEnv));
      } else {
        out = lintXml(lintSrc);
        // M179：布局里的 @drawable/ @string/ @color/ … 引用，拼错且能猜出来 → 带 fix
        out.push(...checkXmlResRefs(lintSrc, xmlResEnv));
      }
      // M179：资源引用的问题按行号排进去（排序稳定，错误条取第一条才合理）
      out.sort((a, b) => a.line - b.line);
      t.end("issues=" + out.length);
      return out;
    } catch (e) {
      console.error("[axv] 结构检查失败", e); // i18n-ignore
      return [] as LintIssue[];
    }
  }, [lintSrc, codeOnly, isJavaFile, codeFileName, openRel, saveOrigin?.name, currentFile?.name, xmlResSig]);
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
      if (line > 0) setCodeCursor(line);
      if (!treeRoot || line < 1) return;
      const n = nodeAtLine(treeRoot, line);
      if (n && n.path !== selectedPath) {
        fromCodeRef.current = true; // 这次选中是代码触发的，不要再反向拖动编辑器
        setSelectedPath(n.path);
      }
    },
    [treeRoot, selectedPath],
  );

  /** 一键格式化：重排缩进，保留注释，可撤销 */
  const doFormat = () => {
    flushXml();
    const cur = currentXml();
    let next: string;
    if (isJavaLikePath(openRel || "")) {
      next = formatJava(cur, { indent: editorTheme.indent || 4 });
    } else {
      next = formatXml(cur, 2);
    }
    if (next !== cur) setXmlAndTrack(next);
  };

  /** M179：一键修复：把 lints 里所有能修的（资源引用拼错/方法名拼错）就地替换。
   *  - 同一行可能有多处：逐条改，每改一次就把结果写回 lines
   *  - 用 applyFixToLine 做「整词」替换：@drawable/ic_hom 不能把 @drawable/ic_home 改坏
   *  - 修完重新跑检查自然收敛（lintSrc 会跟着 xml 重新 debounce） */
  const doFixAll = () => {
    flushXml();
    const cur = currentXml();
    const lines = cur.split("\n");
    const done = new Set<string>();
    let fixed = 0;
    for (const iss of lints) {
      const fx = iss.fix;
      if (!fx) continue;
      const key = `${iss.line}|${fx.from}|${fx.to}`;
      if (done.has(key)) continue;
      done.add(key);
      const idx = Math.max(0, Math.min(iss.line - 1, lines.length - 1));
      const L = lines[idx];
      if (L === undefined) continue;
      const r = applyFixToLine(L, fx.from, fx.to);
      if (!r.count) continue;
      lines[idx] = r.text;
      fixed += r.count;
    }
    if (!fixed) return;
    setXmlAndTrack(lines.join("\n"));
    setExportNote(tt("已修复 {n} 处（可撤销）", { n: fixed }));
    window.setTimeout(() => setExportNote(""), 2400);
  };

  /** M202：点某条问题卡片的「应用此修复」—— 只修这一条（其余等用户再点） */
  const doFixOne = useCallback(
    (iss: LintIssue) => {
      const fx = iss.fix;
      if (!fx) return;
      flushXml();
      const cur = currentXml();
      const lines = cur.split("\n");
      const idx = Math.max(0, Math.min((iss.line ?? 1) - 1, lines.length - 1));
      const L = lines[idx];
      if (L === undefined) return;
      const r = applyFixToLine(L, fx.from, fx.to);
      if (!r.count) return;
      lines[idx] = r.text;
      setXmlAndTrackRef.current?.(lines.join("\n"));
      setExportNote(tt("已修复 {n} 处（可撤销）", { n: r.count }));
      window.setTimeout(() => setExportNote(""), 2400);
    },
    [flushXml, currentXml],
  );

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
      setAutoNotes([tt("该控件还拿不到布局坐标，先切到预览看一眼再试")]);
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

  /** M188a：签名与发布配置弹层（读写项目里的 app/build.gradle）
   *  M188b：放宽为只要有 activeProject 就能打开；没可写根时配置先暂存 localStorage，
   *  用户保存项目后可再点一次「写入 build.gradle」真正落盘 */
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [gradleForSign, setGradleForSign] = useState<string | null>(null);
  const [signRootMissing, setSignRootMissing] = useState(false);
  /** M189：keystore 文件是否真存在（不给就是没检查） */
  const [signKeystoreExists, setSignKeystoreExists] = useState<boolean | undefined>(undefined);
  const [signAppName, setSignAppName] = useState<string | null>(null);
  const [signIconDefault, setSignIconDefault] = useState<boolean | undefined>(undefined);
  const LS_KEY_SIGN_DRAFT = "axv.signing.draft";
  /** M195：本项目记住的签名配置（按项目名存，build.gradle 读不到时回填） */
  const [signStoredRev, setSignStoredRev] = useState(0);
  const signStored = useMemo(
    () => readStoredSigning(activeProject?.name),
    [activeProject?.name, signDialogOpen, signStoredRev],
  );
  const openSignDialog = useCallback(async () => {
    const root = projectSaveRoot(activeProject);
    // M188c：统一走 readProjectFile（native 用 readTextQueued，web 用目录句柄）
    const txt = await readProjectFile(root, "app/build.gradle");    // 没有可写根时，读 localStorage 里的草稿
    const missing = !root;
    let use = txt;
    if (missing && !use) {
      try {
        const draft = window.localStorage.getItem(LS_KEY_SIGN_DRAFT);
        if (draft) use = draft;
      } catch { /* ignore */ }
    }
    // M189：查一下 keystore 文件在不在（发布前检查用）
    let exists: boolean | undefined;
    if (root && use) {
      const store = readSigningFromGradle(use)?.storeFile || ".axv/release.keystore";
      exists = await projectFileExists(root, store);
    }
    // M189+：读 strings.xml 的 app_name 和 manifest 图标，判断是否还是默认值
    let appName: string | null = null;
    let iconDefault: boolean | undefined;
    if (root) {
      const strings = await readProjectFile(root, "app/src/main/res/values/strings.xml");
      appName = strings ? readAppName(strings) : null;
      const mf = await readProjectFile(root, "app/src/main/AndroidManifest.xml");
      if (mf) {
        const m = /android:icon\s*=\s*"([^"]*)"/.exec(mf);
        const v = m ? m[1] : "";
        iconDefault = !v || /@(mipmap|drawable)\/ic_launcher(_round)?$/.test(v);
      }
    }
    setGradleForSign(use);
    setSignRootMissing(missing);
    setSignKeystoreExists(exists);
    setSignAppName(appName);
    setSignIconDefault(iconDefault);
    setSignDialogOpen(true);
  }, [activeProject]);
  /** M191：在设备上生成 keystore（Android 里跑的是真 JVM，只缺 keytool 命令；
   *  KeystoreMaker.java 用标准 java.security 自己造 PKCS#12，桌面 keytool/apksigner 已验过） */
  const makeKeystoreOnDevice = useCallback(
    async (rel: string, o: { alias: string; password: string; cn: string; years: number }) => {
      const b = nativeBridge();
      if (!b?.makeKeystore) return { ok: false, msg: tt("当前 APK 版本还不支持在设备上生成，请升级到 1.16.27 以上") };
      const root = projectSaveRoot(activeProject);
      const base = root?.kind === "native" ? root.base.replace(/[/\\]+$/, "") : b.getDefaultWorkspace?.() || "";
      if (!base) return { ok: false, msg: tt("没有可写的项目目录") };
      const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
      const abs = `${base}/${clean}`;
      try {
        const r = b.makeKeystore(abs, o.alias, o.password, o.cn, "Android", o.years);
        if (r.startsWith("ok:")) return { ok: true, msg: r };
        return { ok: false, msg: r.replace(/^err:/, "") || tt("生成失败") };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
    [activeProject],
  );

  /* M192：一键打包成可安装 APK（设备端 aapt2 + 壳 dex + apksig） */
  const [apkBusy, setApkBusy] = useState(false);
  const [apkResult, setApkResult] = useState<BuildApkResult | null>(null);
  const doBuildApk = useCallback(
    async (o: { storeFile: string; storePass: string; alias: string; keyPass?: string }) => {
      if (apkBusy) return;
      setApkResult(null);
      if (!hasBuildApk()) {
        setApkResult({ ok: false, step: "env", log: tt("当前环境不支持打包（网页版没有 aapt2/apksig），请在手机上操作") });
        return;
      }
      const b = nativeBridge();
      const root = projectSaveRoot(activeProject);
      const base = root?.kind === "native" ? root.base.replace(/[/\\]+$/, "") : b?.getDefaultWorkspace?.() || "";
      if (!base) {
        setApkResult({ ok: false, step: "keystore", log: tt("没有可写的项目目录") });
        return;
      }
      const clean = (o.storeFile || "").replace(/\\/g, "/").replace(/^\/+/, "");
      const keystore = clean ? `${base}/${clean}` : "";
      // 包名：优先读 build.gradle 的 applicationId，读不到退回项目名推导
      let pkg = activeProject?.name ? packageOf(activeProject.name) : "com.axv.app";
      if (gradleForSign) {
        const pg = parseGradlePackage(gradleForSign);
        if (pg.applicationId || pg.namespace) pkg = pg.applicationId || pg.namespace || pkg;
      }
      const input = currentSaveInput();
      setApkBusy(true);
      setExportNote(tt("正在收集资源…"));
      try {
        // M192f：当前编辑的可能是 MainActivity.java（Java 代码），不能把编辑器正文当布局写盘
        // —— 否则 layout/activity_main.xml 里装的是 Java，aapt2 报 syntax error。
        // M192g：collectProjectRes 只按引用收集，不会把 layout/ 整目录带上，所以得自己列 layout 目录挑。
        const openRelNorm = (openRel || input.name || "").replace(/\\/g, "/");
        const relLayout = openRelNorm.match(/(?:^|\/)layout(?:-[^/]+)?\/(.+)\.xml$/i);
        const isLayoutDoc = docKind === "layout" && !!relLayout;
        let layout = isLayoutDoc && relLayout ? relLayout[1] : "";
        let baseInput = input;
        if (!layout) {
          const want = (xml.match(/R\.layout\.([A-Za-z_][A-Za-z0-9_]*)/) || [])[1] || "";
          const picked = await pickProjectLayout(aiFileIo, openRel, want);
          if (!picked) {
            setApkResult({
              ok: false,
              step: "compile",
              log: tt("项目里没找到布局文件（layout/*.xml）。请先在左侧资源新建或打开一个布局，再打包。"),
            });
            setExportNote(tt("打包失败：{msg}", { msg: "compile" }));
            return;
          }
          layout = picked.name;
          // 把真实布局内容当成当前文档送去收集（否则 layout/ 里根本没有这个文件）
          baseInput = { ...input, name: picked.rel, xml: picked.text };
        }
        const collected = await collectProjectRes(aiFileIo, openRel, buildRealRenderFiles(baseInput));
        const files = collected.files;
        setExportNote(tt("正在编译资源并签名（设备端，约十几秒）…"));
        // M192e：与真机渲染用同一套洗法（补占位、去重、include 命名空间…）
        // 不洗直接打包的话，aapt2 会在 layout 上报 syntax error
        const prep = prepareFiles(layout, files);
        if (prep.blocked) {
          setApkResult({ ok: false, step: "compile", log: prep.blocked });
          setExportNote(tt("打包失败：{msg}", { msg: "compile" }));
          return;
        }
        const r = await buildApk({
          pkg,
          layout,
          appName: signAppName || layout,
          files: prep.files,
          keystore,
          storePass: o.storePass,
          alias: o.alias,
          keyPass: o.keyPass,
          outName: `${pkg}-${layout}.apk`,
        });
        setApkResult(r);
        setExportNote(r.ok ? tt("打包完成：{name}", { name: r.name || "" }) : tt("打包失败：{msg}", { msg: r.step || "" }));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setApkResult({ ok: false, step: "js", log: msg });
        setExportNote(tt("打包失败：{msg}", { msg }));
      } finally {
        setApkBusy(false);
      }
    },
    [apkBusy, activeProject, gradleForSign, signAppName, aiFileIo, openRel, docKind, xml],
  );

  const writeGradleForSign = useCallback(
    async (next: string) => {
      const root = projectSaveRoot(activeProject);
      if (!root) {
        // 没可写根：配置存草稿，提示用户保存项目后再写
        try { window.localStorage.setItem(LS_KEY_SIGN_DRAFT, next); } catch { /* ignore */ }
        return true;
      }
      const ok = await saveProjectFile(root, "app/build.gradle", next);
      if (ok) {
        try { window.localStorage.removeItem(LS_KEY_SIGN_DRAFT); } catch { /* ignore */ }
      }
      return ok;
    },
    [activeProject],
  );

  /** M186：右侧面板当前页签（属性 / 检查器） */
  const [rightTab, setRightTab] = useState<"attrs" | "inspector">("attrs");
  /** M186：右侧「检查器」tab 数据（DOM 实测 → dp，纯函数在 lib/xml/inspector.ts） */
  const [inspMeasured, setInspMeasured] = useState<MeasuredNode[]>([]);
  useEffect(() => {
    const st = stageRef.current;
    if (!st || !treeRoot || !previewActive) {
      setInspMeasured([]);
      return;
    }
    const take = () => {
      const els = st.querySelectorAll<HTMLElement>("[data-path]");
      // M187：dp = 视觉 px ÷ (SCALE × vs)，两层就够
      //   ① SCALE：1dp = 2px（用户缩放 scale 已经算进布局 px 里了，别再除一次）
      //   ② vs = 视觉宽 ÷ 布局宽 = 手机外壳 transform: scale(fitRatio) 的压缩比，实测比自己推 fitRatio 稳
      // 原点用 .axv-phone-body：量的是「相对画布内容区左上角」，不是含留白的整个 stage
      const body = st.querySelector<HTMLElement>(".axv-phone-body");
      const ref = body && body.offsetWidth > 0 ? body : st;
      const vs = ref.offsetWidth > 0 ? ref.getBoundingClientRect().width / ref.offsetWidth : 1;
      const pxPerDp = SCALE * (vs > 0 ? vs : 1);
      setInspMeasured(collectMeasurements(ref, els, pxPerDp, () => ""));
    };
    take();
    const obs = new ResizeObserver(take);
    obs.observe(st);
    // M187：缩放改变的是手机外壳大小（stage 容器本身不变），单独盯外壳才跟得上
    const ph = phoneRef.current;
    if (ph) obs.observe(ph);
    const t = window.setTimeout(take, 300);
    return () => {
      obs.disconnect();
      window.clearTimeout(t);
    };
    // scale 进依赖：缩放一变就重新量（ResizeObserver 是兜底）
  }, [treeRoot, previewActive, scale]);
  const inspWarnings = useMemo(
    () => (treeRoot ? inspectorWarningsOf(treeRoot, inspMeasured) : []),
    [treeRoot, inspMeasured],
  );

    // ===== 组件插入（点击 / 拖放）=====
  // 有选中节点：插到它的同级（兄弟）；否则插到根节点末尾
  const setXmlAndTrack = useCallback(
    (next: string, /** M2u：同一手势 key 在 900ms 内合并成一步撤销 */ mergeKey?: string) => {
      flushTextTimer();
      // M57：外部改文档（画布/属性面板/格式化）——清掉打字中的 live 值，否则会被它盖住
      liveXmlRef.current = null;
      setXml(next);
      commitHistory(next, mergeKey ?? "");
    },
    [flushTextTimer, commitHistory],
  );
  setXmlAndTrackRef.current = setXmlAndTrack;

  /** M25d：把一个条目载入画布（记住来源，保存时写回原文件） */
  const loadEntry = useCallback(
    async (source: ProjectSource, entry: BrowseEntry) => {
      try {
        const text = await source.readText(entry.rel);
        if (text === null) {
          setWsMsg(tt("打不开《{name}》：文件已不存在或目录权限被收回", { name: entry.name }));
          return;
        }
        setXmlAndTrack(text);
        // M201：把「打开时的磁盘内容」记成基线 —— 之后别人在电脑上改了、我们再保存时能拦下来
        saveBaseline(entry.rel || entry.target || entry.name, text);
        // M25b：结构树里标「正在编辑」用
        setWsActiveName(entry.name);
        // M37b：记住工程内相对路径（非布局文件保存/判定都靠它）
        setOpenRel(entry.rel || null);
        // M21：记住来源，保存时优先写回原路径
        if (entry.target) setSaveOrigin({ kind: "native", target: entry.target, name: entry.name });
        else if (entry.handle) setSaveOrigin({ kind: "handle", handle: entry.handle, name: entry.name });
        else setSaveOrigin(null);
        setWsMsg(tt("已打开 {name}", { name: entry.name }));
      } catch (e) {
        setWsMsg(tt("打开失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      }
      // M144：记住「当前项目里打开的文件」，重开 App 直接回到这一页（用户要求：不要每次都重新选）
      try {
        const cur = activeProjectRef.current;
        if (cur?.source && entry.rel) {
          lsSetJson(LS_KEY_LAST_FILE, {
            dirPath: cur.dirPath ?? null,
            rootPath: cur.rootPath ?? null,
            project: cur.name,
            rel: entry.rel,
            name: entry.name,
          });
          writeLastRel(cur.dirPath || cur.name, entry.rel);
        }
      } catch {
        /* 静默 */
      }
    },
    [setXmlAndTrack],
  );

  /** 当前项目的浏览源（用 ref 拿，避免面板回调闭包里拿到旧值） */
  const activeProjectRef = useRef<ActiveProject | null>(null);
  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

  /** 结构树里点一个 xml */
  const openProjectEntry = useCallback(
    (entry: BrowseEntry) => {
      const src = activeProjectRef.current?.source;
      if (src) void loadEntry(src, entry);
    },
    [loadEntry],
  );

  /** 激活一个已打开的项目：切到「当前项目」tab，并自动载入主布局（找不到就只显示结构树） */
  const activateProject = useCallback(
    async (opened: OpenedProject, preferRel?: string | null) => {
      // M31：标题显示 app 名称（读 res/values/strings.xml 的 app_name），并取 ic_launcher 做图标
      let name = opened.name;
      let iconUrl: string | null = null;
      try {
        const meta = await readProjectMetaFromSource(opened.source, opened.name);
        name = meta.name;
        iconUrl = meta.iconUrl ?? null;
        // M31：APK 里扁平列表只含 xml，图标读不到 → 按项目绝对路径直试 ic_launcher*
        if (!iconUrl && opened.dirPath) {
          const nm = await readProjectMetaNative(opened.name, opened.dirPath);
          if (nm.name && nm.name !== opened.name) name = nm.name;
          iconUrl = nm.iconUrl ?? null;
        }
      } catch {
        /* 读不到就用目录名 */
      }
      setActiveProject({ ...opened, name, iconUrl });
      setProjectRev((n) => n + 1);
      setProjectTab("current");
      setWsActiveName("");
      // M144：优先恢复「上次打开的文件」，读不到才退回主布局
      const prefer = preferRel ?? readLastRel(opened.dirPath || opened.name);
      let restored = false;
      if (prefer) {
        const text = await opened.source.readText(prefer).catch(() => null);
        if (text !== null) {
          const bn = prefer.split("/").pop() || prefer;
          await loadEntry(opened.source, { kind: "file", name: bn, rel: prefer });
          restored = true;
        }
      }
      const main = restored ? null : await findMainLayout(opened.source);
      if (main) await loadEntry(opened.source, main);
      else if (!restored) setWsMsg(tt("已打开《{name}》，但里面没找到 layout xml", { name }));
    },
    [loadEntry],
  );

  /* M144：启动时恢复上次打开的项目+文件（仅 native：有绝对路径才能不经用户手势直读）。
   * 网页端目录句柄拿不到，只能让用户重新选项目，这里静默跳过。 */
  const lastFileRestored = useRef(false);
  useEffect(() => {
    if (lastFileRestored.current) return;
    lastFileRestored.current = true;
    const rec = lsGetJson<{ dirPath?: string | null; rootPath?: string | null; project?: string; rel?: string }>(
      LS_KEY_LAST_FILE,
    );
    if (!rec?.rel || !rec.dirPath) return;
    const src = nativeProjectSource(rec.project || "", [], rec.dirPath);
    void activateProject(
      { name: rec.project || "", source: src, dirPath: rec.dirPath ?? undefined, rootPath: rec.rootPath ?? undefined },
      rec.rel,
    );
  }, [activateProject]);

  /** M25d：项目列表里点一项 —— 打开这个项目（网页端也能直接读工作目录里的文件夹） */
  const openWsProject = useCallback(
    async (item: WsProject) => {
      setWsBusy(true);
      try {
        if (item.kind === "file") {
          const r = await wsOpenProject(item);
          if (!r) {
            setWsMsg(tt("打不开《{name}》：文件已不存在或目录权限被收回", { name: item.name }));
            return;
          }
          setXmlAndTrack(r.text);
          setWsActiveName(item.name);
          if (item.target) setSaveOrigin({ kind: "native", target: item.target, name: item.name });
          else if (item.handle) setSaveOrigin({ kind: "handle", handle: item.handle, name: item.name });
          else setSaveOrigin(null);
          setWsMsg(tt("已打开 {name}", { name: item.name }));
          return;
        }
        const opened = await openProjectFromItem(item);
        if (!opened) {
          setWsMsg(tt("打不开《{name}》：目录权限可能已失效，请重新选目录", { name: item.name }));
          return;
        }
        const shownName = projMeta[item.rel]?.name || item.name;
        await activateProject({ ...opened, name: shownName });
      } catch (e) {
        setWsMsg(tt("打开失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      } finally {
        setWsBusy(false);
      }
    },
    [activateProject, projMeta, setXmlAndTrack],
  );

  /** M24：打开一个项目目录（弹系统选择器），成功后切到「当前项目」 */
  const openProjectDir = useCallback(async () => {
    setWsBusy(true);
    setWsMsg(tt("正在等你选项目文件夹…"));
    try {
      const proj = await openProjectFolder();
      if (!proj) {
        setWsMsg(wsState?.mode === "unsupported" ? tt("当前环境不支持选目录，请用 Chrome / Edge 或 APK") : tt("已取消打开"));
        return;
      }
      await activateProject(proj);
      window.setTimeout(() => void refreshWorkspace({ quiet: true }), 600);
    } catch (e) {
      setWsMsg(tt("打开项目失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setWsBusy(false);
    }
  }, [activateProject, refreshWorkspace, wsState?.mode]);

  /** M24/M31i：新建项目 —— 应用内建一个带 activity_main.xml 的项目，
   *  并在工作目录里直接落盘完整 Android 工程结构：项目名/app/src/main/...
   *  M176：pkg 可选（用户手填的包名），缺省 com.example.<项目名> */
  const createNewProject = useCallback(
    async (rawName: string, pkg?: string) => {
      const name = safeProjectName(rawName);
      const pkgErr = validatePackageName(pkg ?? "");
      if (pkgErr) {
        setExportNote(tt(pkgErr));
        window.setTimeout(() => setExportNote(" "), 4000);
        return;
      }
      const finalPkg = pkg!.trim();
      const tpl = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"',
        '    android:layout_width="match_parent"',
        '    android:layout_height="match_parent"',
        '    android:gravity="center"',
        '    android:orientation="vertical">',
        '',
        '    <TextView',
        '        android:id="@+id/tv_hello"',
        '        android:layout_width="wrap_content"',
        '        android:layout_height="wrap_content"',
        `        android:text="Hello ${name}!"`,
        '        android:textSize="20sp" />',
        '',
        '</LinearLayout>',
        '',
      ].join("\n");

      // 先把应用内状态切过去（落盘失败也不影响继续编辑）
      setProject((p) => ({ ...createProject(name, { name: "activity_main.xml", xml: tpl }), name }));
      setXmlAndTrack(tpl);
      setSelectedPath(null);
      setSaveOrigin(null);
      setActiveProject({ name, source: null });
      setProjectTab("current");
      setNewProjOpen(false);

      // M31i：落盘。native 用默认工作目录（绝对路径）；用户曾自选目录时 Bridge 只能写默认目录，
      // web 用已授权的工作目录句柄；SAF 自选目录写不了，只能保留应用内项目
      setNewProjBusy(true);
      const icon = newProjIcon;
      setNewProjIcon(null);
      let io: ReturnType<typeof nativeNewProjectIO> | (Awaited<ReturnType<typeof webNewProjectIO>>) | null;
      let usedNativeDefault = false;
      let customNote = "";
      let nativeRoot = "";
      try {
        // M35：不依赖可能滞后的 wsState，直接用刚查的 wsInfo；native 时即便 custom 也写默认目录
        const info = await wsInfo();
        if (info.mode === "native" && info.defaultPath) {
          io = nativeNewProjectIO(info.defaultPath, name);
          usedNativeDefault = true;
          nativeRoot = info.defaultPath;
          if (info.custom) customNote = tt("（你自选过工作目录，但原生桥只能写默认目录，项目建在 AndroidUIIDE/Project 下）");
          if (!info.allFiles) customNote += tt(" 未拿到「所有文件访问」权限，可能写不进去");
        } else if (info.mode === "web") {
          io = await webNewProjectIO(name);
        } else {
          io = null;
        }

        if (!io) {
          setExportNote(tt("已新建项目《{name}》（仅应用内）{note}· 当前目录不支持直接写入，点「保存」可导出文件", { name, note: customNote }));
          window.setTimeout(() => setExportNote(" "), 5200);
          setNewProjBusy(false);
          return;
        }

        // M176：已有同名项目目录 → 不覆盖，要求换名（之前会落进同一个 app/ 目录，造成重名无效）
        if (usedNativeDefault) {
          const exist = nativeVerifyProject(nativeRoot, name);
          if (exist > 0) {
            setExportNote(tt("工作目录里已有名为《{name}》的项目，请换个项目名（否则会写进同一目录）", { name }));
            window.setTimeout(() => setExportNote(" "), 7000);
            setNewProjBusy(false);
            return;
          }
        }

        const res = await createAndroidProject(io, name, {
          iconBase64: icon?.base64,
          iconMime: icon?.mime,
          pkg: finalPkg,
        });
        // M35：native 落盘后再 listDir 验一层，确认真的写进去了（没权限/失败时 0）
        if (usedNativeDefault) {
          const dirCount = nativeVerifyProject(nativeRoot, name);
          if (dirCount === 0) {
            setExportNote(tt("《{name}》工程已生成但目录里没写进任何文件{note}。请确认已授予「所有文件访问」权限", { name, note: customNote }));
            window.setTimeout(() => setExportNote(" "), 7000);
            setNewProjBusy(false);
            return;
          }
        }
        if (res.ok) {
          setExportNote(tt("已创建《{name}》· {n} 个文件已写入 {dir}/{note}", { name, n: res.written, dir: name + "/app/src/main/", note: customNote }));
          // M46c：新建项目也要带上目录根，否则结构树写操作（重命名/移动/删除）全被置灰
          if (usedNativeDefault) {
            const projDir = `${nativeRoot.replace(/\/+$/, "")}/${name}`;
            setActiveProject((prev) =>
              prev
                ? {
                    ...prev,
                    dirPath: projDir,
                    rootPath: projDir,
                    source: nativeProjectSource(name, [], projDir),
                  }
                : prev,
            );
          }
          window.setTimeout(() => void refreshWorkspace({ quiet: true }), 400);
        } else {
          setExportNote(tt("《{name}》已创建，但有 {n} 个文件没写进去（{first} 等）{note}", { name, n: res.failed.length, first: res.failed[0], note: customNote }));
        }
      } catch (e) {
        setExportNote(tt("《{name}》已创建，落盘失败：{msg}", { name, msg: e instanceof Error ? e.message : String(e) }));
      } finally {
        setNewProjBusy(false);
        window.setTimeout(() => setExportNote(" "), 5200);
      }
    },
    [setXmlAndTrack, newProjIcon, refreshWorkspace],
  );

  /** M176：改项目名称（目录名）与 app 名称（strings.xml 的 app_name）。
   *  路径约定 工作目录/<项目名>/app/src/... —— 改项目名要真改目录（native only），
   *  并同步 settings.gradle 的 rootProject.name、themes.xml 的 Theme.XXX、manifest 的 @style 引用。 */
  const renameWsProject = useCallback(
    async (item: WsProject, rawDirName: string, rawAppName: string): Promise<{ ok: boolean; msg: string }> => {
      if (item.kind !== "dir") return { ok: false, msg: tt("只有目录项目能改名") };
      const oldDir = item.name;
      const newDir = safeProjectName(rawDirName || oldDir);
      const newApp = (rawAppName || "").trim();
      const dirChanged = newDir !== oldDir;
      if (!dirChanged && !newApp) return { ok: false, msg: tt("名称不能为空") };

      const src = await projectSourceFromWorkspaceItem(item);
      if (!src) return { ok: false, msg: tt("读不到项目内容") };

      // 1. 先把要改的文件读出来（改名前后路径不同，统一事前读）
      const readOne = async (rel: string): Promise<string | null> => {
        try {
          return await src.readText(rel);
        } catch {
          return null;
        }
      };
      const stringsRel = "app/src/main/res/values/strings.xml";
      const themesRel = "app/src/main/res/values/themes.xml";
      const manifestRel = "app/src/main/AndroidManifest.xml";
      const settingsRel = "settings.gradle";

      const stringsSrc = await readOne(stringsRel);
      const themesSrc = await readOne(themesRel);
      const manifestSrc = await readOne(manifestRel);
      const settingsSrc = await readOne(settingsRel);

      const oldTheme = themesSrc ? readThemeName(themesSrc) : null;
      const newTheme = dirChanged ? `Theme.${newDir}` : oldTheme;

      const writes: { rel: string; text: string }[] = [];
      if (stringsSrc && newApp && readAppName(stringsSrc) !== newApp) {
        writes.push({ rel: stringsRel, text: setAppName(stringsSrc, newApp) });
      }
      if (dirChanged) {
        if (settingsSrc) {
          const t = setRootProjectName(settingsSrc, newDir);
          if (t !== settingsSrc) writes.push({ rel: settingsRel, text: t });
        }
        if (themesSrc && oldTheme && newTheme) {
          const t = renameThemeDef(themesSrc, oldTheme, newTheme);
          if (t !== themesSrc) writes.push({ rel: themesRel, text: t });
        }
        if (manifestSrc && oldTheme && newTheme) {
          const t = renameThemeRef(manifestSrc, oldTheme, newTheme);
          if (t !== manifestSrc) writes.push({ rel: manifestRel, text: t });
        }
      }

      // 2. 目录改名（web 没有 rename API → 只能改 app 名）
      let base = item.dirPath || "";
      let renamed = false;
      if (dirChanged) {
        if (!base.startsWith("/")) {
          return { ok: false, msg: tt("网页版不支持改项目目录名，请在 APK 里操作（app 名称可以改）") };
        }
        const wsRoot = replaceTailDir(base, "");
        const r = renameProjectDirNative(wsRoot.replace(/\/+$/, ""), oldDir, newDir);
        if (!r.ok) return { ok: false, msg: tt("目录改名失败：{msg}", { msg: r.reason || tt("未知错误") }) };
        base = r.newRoot || replaceTailDir(base, newDir);
        renamed = true;
        invalidateNativeProjectCache();
      }

      // 3. 写回同步过的文件
      const root: ReturnType<typeof projectSaveRoot> = base.startsWith("/")
        ? { kind: "native", base }
        : item.handle
          ? { kind: "handle", handle: item.handle }
          : null;
      if (!root) return { ok: renamed, msg: renamed ? tt("目录已改名，但读不到写入根，gradle/主题没同步") : tt("读不到项目目录") };

      const failed: string[] = [];
      for (const w of writes) {
        const ok = await saveProjectFile(root, w.rel, w.text);
        if (!ok) failed.push(w.rel);
      }

      // 4. 当前正打开这个项目 → 同步 activeProject（否则结构树还指旧路径）
      const cur = activeProjectRef.current;
      const curDir = cur?.rootPath ? dirNameOf(cur.rootPath) : cur?.name;
      if (renamed && curDir === oldDir) {
        setActiveProject((prev) =>
          prev
            ? {
                ...prev,
                name: newDir,
                dirPath: base,
                rootPath: base,
                source: nativeProjectSource(newDir, [], base),
              }
            : prev,
        );
        setProjectRev((n) => n + 1);
      }
      if (newApp) setProject((prev) => ({ ...prev, name: newApp }));

      const parts: string[] = [];
      if (renamed) parts.push(tt("目录 → {name}", { name: newDir }));
      if (newApp) parts.push(tt("应用名 → {name}", { name: newApp }));
      const msg = failed.length
        ? tt("已改 {list}，但 {n} 个文件没写进去（{first}）", {
            list: parts.join(tt("、")),
            n: failed.length,
            first: failed[0],
          })
        : tt("已改 {list}", { list: parts.join(tt("、")) });
      return { ok: failed.length === 0, msg };
    },
    [setProject],
  );

  /** M24：重读当前项目结构（手动刷新）——M25d：只重置懒加载缓存，不深扫 */
  const refreshActiveProject = useCallback(async () => {
    if (activeProjectRef.current?.source) {
      setProjectRev((n) => n + 1);
      setWsMsg(tt("已刷新项目结构"));
      return;
    }
    try {
      const p = await restoreProjectFolder();
      if (p) {
        // M31：刷新时重读 app_name / 图标
        let name = p.name;
        let iconUrl: string | null = null;
        try {
          const meta = await readProjectMetaFromSource(p.source, p.name);
          name = meta.name;
          iconUrl = meta.iconUrl ?? null;
          if (!iconUrl && p.dirPath) {
            const nm = await readProjectMetaNative(p.name, p.dirPath);
            if (nm.name && nm.name !== p.name) name = nm.name;
            iconUrl = nm.iconUrl ?? null;
          }
        } catch {
          /* 用目录名 */
        }
        setActiveProject({ ...p, name, iconUrl });
        setProjectRev((n) => n + 1);
        setWsMsg(tt("已刷新《{name}》", { name }));
      } else {
        setWsMsg(tt("刷新失败：项目目录权限可能已失效，请重新「打开」"));
      }
    } catch (e) {
      setWsMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);



  /** 载入完整示例项目：布局 + 自带 drawable + values 一起换（合并语义：用户已有资源不会被覆盖） */
  const applySampleProject = useCallback(
    (key: string) => {
      const p = sampleProjectByKey(key);
      if (!p) return;
      setXmlAndTrack(p.layout);
      setGeneratedDrawables((m) => ({ ...p.drawables, ...m }));
      setSampleValues(p.values ?? "");
      // M149：记住示例项目，重启后恢复它的 values/drawable（不记 key 就全裸显示 @string/@drawable）
      lsSet(LS_KEY_SAMPLE, key);
      setSelectedPath(null);
      setExportNote(
        tt("已载入示例项目「{name}」· {lib}，自带 {n} 个 drawable", { name: p.name, lib: p.library, n: Object.keys(p.drawables).length }),
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
          histRef.current = diffHistoryInit(target.xml);
          syncHist();
          setSelectedPath(null);
          // M37b：吓得切到内置文件后，不再算「从工程里打开的文件」
          setOpenRel(null);
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
        setExportNote(tt("最多 {n} 个文件，新建失败", { n }));
        window.setTimeout(() => setExportNote(""), 3600);
        return withSaved;
      }
      const target = activeFile(next)!;
      setXml(target.xml);
      histRef.current = diffHistoryInit(target.xml);
      syncHist();
      setSelectedPath(null);
      setExportNote(tt("已新建「{name}」", { name: target.name }));
      window.setTimeout(() => setExportNote(""), 2400);
      return next;
    });
  }, [flushTextTimer, xml]);

  const renameActiveFile = useCallback(() => {
    const cur = activeFile(project);
    if (!cur) return;
    const input = window.prompt(tt("重命名「{name}」", { name: cur.name }), cur.name);
    if (!input || input === cur.name) return;
    setProject((p) => renameFile(p, cur.id, input));
  }, [project]);

  const deleteActiveFile = useCallback(() => {
    const cur = activeFile(project);
    if (!cur || project.files.length <= 1) {
      setExportNote(tt("项目里只剩最后一个文件，删不了（先新建一个）"));
      window.setTimeout(() => setExportNote(""), 3600);
      return;
    }
    if (!window.confirm(tt("删除「{name}」？该文件内容会丢失。", { name: cur.name }))) return;
    flushTextTimer();
    setProject((p) => {
      const withSaved = updateFileXml(p, p.activeId, xml);
      const next = removeFile(withSaved, cur.id);
      const target = activeFile(next)!;
      setXml(target.xml);
      histRef.current = diffHistoryInit(target.xml);
      syncHist();
      setSelectedPath(null);
      return next;
    });
    setExportNote(tt("已删除「{name}」", { name: cur.name }));
    window.setTimeout(() => setExportNote(""), 2400);
  }, [flushTextTimer, project, xml]);

  /** 手敲代码：最新文本先进 ref（不阻塞输入），状态防抖 250ms 落一次，历史 500ms 合并 */
  const onChangeXmlText = useCallback(
    (next: string) => {
      liveXmlRef.current = next;
      if (xmlSyncTimer.current !== null) window.clearTimeout(xmlSyncTimer.current);
      xmlSyncTimer.current = window.setTimeout(() => {
        xmlSyncTimer.current = null;
        const v = liveXmlRef.current;
        if (v !== null) setXml(v);
      }, 250);
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
        setExportNote(res.issues[0]?.message || tt("插入失败"));
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
        setExportNote(res.issues[0]?.message || tt("插入失败"));
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
          setExportNote(chk.reason || tt("无法插入"));
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
    if (broken) setExportNote(tt("当前 XML 结构不完整（有标签没闭合），层级调整已暂停；请先在代码里补齐闭合标签"));
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

  // M187：外壳布局 px 固定（不乘 scale），缩放靠 transform
  const widthPx = Math.round(device.w * SCALE);
  const heightPx = Math.round(device.h * SCALE);
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
    // M187：不再钳 1 —— 钳了以后放大档等于没放大（外壳变大 + transform 缩回，内容却没变）
    return fitBase * scale;
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
      setExportNote(tt("「{name}」不是 .xml 文件，已忽略", { name: f.name }));
      window.setTimeout(() => setExportNote(""), 3600);
      return;
    }
    // 2) 大小上限（5MB），防止巨型文件卡死浏览器
    if (f.size > 5 * 1024 * 1024) {
      setExportNote(tt("「{name}」超过 5MB，不加载", { name: f.name }));
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
            firstErr = errs[0]?.message || tt("没有可识别的根布局节点");
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
          // 解析失败 → 切到代码视图，让用户就地改；画布会显示失败说明，不会崩
          // M187：代码视图在主区 tab（原来是 setLeftView("code") + 打开左面板，而左面板根本没有 code 页）
          setMobileTab("xml");
          setLeftOpen(false);
          setRightOpen(false);
          setFocusLine(1);
          setFocusTick((t) => t + 1);
          setExportNote(tt("「{name}」有不完整或错误的结构（{err}），已切到代码面板，改好画布会自动恢复", { name: f.name, err: firstErr }));
          window.setTimeout(() => setExportNote(""), 7000);
          return;
        }
        if (firstErr) {
          setExportNote(tt("已载入「{name}」，但有结构问题：{err}（可在代码面板修正）", { name: f.name, err: firstErr }));
          window.setTimeout(() => setExportNote(""), 6000);
        } else if (!res2.id) {
          setExportNote(tt("项目文件已达上限（{max} 个），仍已载入「{name}」但未入项目", { max: MAX_FILES, name: f.name }));
          window.setTimeout(() => setExportNote(""), 4600);
        } else {
          setExportNote(tt("已载入「{name}」", { name: f.name }));
          window.setTimeout(() => setExportNote(""), 2400);
        }
      })
      .catch((err) => {
        console.error("[axv] 读取 xml 文件失败", err); // i18n-ignore
        setExportNote(tt("读取「{name}」失败，请重试", { name: f.name }));
          window.setTimeout(() => setExportNote(""), 4000);
      });
  };

  /** 打开 .xml 文件（弹系统文件选择器）；M141：有未保存改动先问一句 */
  const openProject = () => leaveGuard.gate(dirty, () => openProjectFile());
  const openProjectFile = () => {
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
      setExportNote(tt("未选择任何文件（目录选择器取消或目录为空）"));
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
      setExportNote(tt("提示：选中的是散文件，建议选整个 res 目录（含 drawable/ values/ layout/）效果最佳"));
    }
    try {
      const extras = await buildResourceExtras(items);
      setResExtras(extras);
      const c = extras.counts;
      setExportNote(
        tt("已读取 res：图片 {img} / 矢量 {vec} / values {val} / 样式 {sty}", { img: c.images, vec: c.vectors, val: c.values, sty: c.styles }) +
          (isDirMode ? "" : tt("（散件模式，可能不完整）")),
      );
      window.setTimeout(() => setExportNote(""), 3600);
    } catch (err) {
      console.error("[axv] 读取 res 失败", err); // i18n-ignore
      setExportNote(tt("读取 res 失败，请确认目录结构合法（参考 console）"));
      window.setTimeout(() => setExportNote(""), 4000);
    }
  };

  /** 清掉已上传的资源，回到内置默认 */
  /** M3g：导出 res 包（zip）：布局 + 图标矢量 + 上传的 shape/values 一起带走，
   *  避免别处打开工程时「找不到图标文件」。*/
  /** M190：导出整个可编译项目（zip）——手机上没有 Gradle/JDK，出 release 包得拿到电脑上，
   *  所以这里把整个项目（含二进制资源）打包，附一份打包说明。 */
  const doExportProject = async () => {
    const io = aiFileIo;
    if (!io) {
      flashNote(tt("先打开一个项目目录，再导出"), 3200);
      return;
    }
    const name = activeProject?.name || "project";
    const gradleTxt = await readProjectFile(projectSaveRoot(activeProject), "app/build.gradle");
    const info = gradleTxt ? readPublishInfo(gradleTxt) : null;
    const sign = gradleTxt ? readSigningFromGradle(gradleTxt) : null;
    setExportNote(tt("正在打包项目…"));
    try {
      const r = await exportProjectZip({
        io,
        projectName: name,
        pkg: info?.applicationId || info?.namespace || null,
        versionName: info?.versionName || null,
        storeFile: sign?.storeFile || null,
        alias: sign?.alias || null,
      });
      if (!r.ok) {
        setExportNote(tt("导出失败：{reason}", { reason: r.error || "未知错误" }));
        return;
      }
      setExportNote(
        tt("已导出 {name}（{n} 个文件，{mb} MB）", {
          name: r.filename || "",
          n: r.files,
          mb: (r.bytes / 1024 / 1024).toFixed(2),
        }) + (r.skipped.length ? tt("；跳过 {n} 项（见包内「跳过文件清单.txt」）", { n: r.skipped.length }) : ""),
      );
      window.setTimeout(() => setExportNote(""), 6000);
    } catch (e) {
      setExportNote(tt("导出失败：{reason}", { reason: e instanceof Error ? e.message : String(e) }));
    }
  };

  const doDownloadResZip = () => {
    // M37b：非布局文件没有「res 包」概念，直接阻止
    if (codeOnly) {
      flashNote(tt("当前文件不是布局，无法导出 res 包；直接「保存」写回原文件即可"), 4600);
      return;
    }
    // M36：有打开的项目 → 直接写进它的 res 目录，不再丢一个 res.zip 在工作目录根
    if (projRoot) {
      void saveResFiles(projRoot, buildSaveFiles(currentSaveInput())).then((r) => {
        if (r.ok && r.written > 0) bumpResCache();
        setExportNote(
          r.ok
            ? tt("已写入《{name}》的 app/src/main/res/：{n}/{total} 个文件", { name: activeProject?.name || tt("项目"), n: r.written, total: r.total }) +
                (r.failed.length ? tt("（失败 {n}）", { n: r.failed.length }) : "")
            : tt("写入项目失败：{reason}", { reason: r.failed[0] || tt("目录不可写") }),
        );
        window.setTimeout(() => setExportNote(""), 4800);
      });
      return;
    }
    const { count, missing } = downloadResZip(currentSaveInput());
    setExportNote(
      tt("已导出 res.zip（{n} 个文件）", { n: count }) +
        (missing.length
          ? tt("；还有 {n} 个 @drawable 引用未覆盖：{list}{more}（需上传 res 目录补齐）", { n: missing.length, list: missing.slice(0, 5).join(", "), more: missing.length > 5 ? " …" : "" })
          : tt("；布局里引用的图标资源已全部包含")),
    );
    window.setTimeout(() => setExportNote(""), 4200);
  };

  /** M154：真机渲染——把当前 xml + 依赖资源交给设备端 aapt2 现场编译，
   *  再用系统 LayoutInflater 渲染（不是 CSS 模拟，能对照出 canvas 的偏差）。
   *  M158：编译前先从项目 res 里按引用递归补齐（资源列表里有的文件，之前没进文件清单）。 */
  /** M188b：构建日志（真机渲染 pipeline，新在前），给底部抽屉「构建日志」tab */
  const [buildLogs, setBuildLogs] = useState<
    {
      id: string;
      ok: boolean;
      stage?: string;
      ms?: number;
      log?: string;
      logFile?: string;
      files?: number;
      bytes?: number;
    }[]
  >([]);

  const doRealRender = () => {
    if (realRenderBusy) return;
    const input = currentSaveInput();
    const name = (input.name || "activity_main.xml").replace(/\.xml$/i, "");
    const base = buildRealRenderFiles(input);
    setRealRenderBusy(true);
    setExportNote(tt("正在收集布局引用的资源…"));
    void collectProjectRes(aiFileIo, openRel, base)
      .then((collected) => {
        const stubNote = collected.stubbed?.length
          ? tt("；{n} 个资源项目里没有，已用透明占位顶住", { n: collected.stubbed.length })
          : "";
        setExportNote(
          (collected.added
            ? tt("已补齐 {n} 个项目资源，正在用设备上的 aapt2 编译…", { n: collected.added })
            : tt("正在用设备上的 aapt2 编译资源包…")) + stubNote,
        );
        return renderReal(name, collected.files);
      })
      .then((r) => {
        setRealRenderBusy(false);
        setBuildLogs((prev) =>
          [
            {
              id: String(Date.now()),
              ok: !!r.ok,
              stage: r.ok
                ? tt("真机渲染")
                : tt("真机渲染（{stage}）", { stage: r.stage || tt("未知") }),
              ms: r.ms,
              log: r.log,
              logFile: r.logFile,
              files: r.files,
              bytes: r.bytes,
            },
            ...prev,
          ].slice(0, 20),
        );
        if (r.ok) {
          setExportNote(
            tt("真机渲染：{n} 个文件 → 资源包 {kb} KB（编译 {ms} ms），已打开真控件预览\n日志：{log}", {
              n: r.files ?? 0,
              kb: Math.round((r.bytes ?? 0) / 1024),
              ms: r.ms ?? 0,
              log: r.logFile || tt("（无）"),
            }),
          );
        } else {
          setExportNote(
            tt("真机渲染失败（{stage}）：{log}\n完整日志：{file}", {
              stage: r.stage || tt("未知"),
              // M170：错误正文都在日志尾部（前面是 framework/compile 的例行行），
              // 显示尾部 700 字比显示前 300 字有用得多
              log: "…" + (r.log || "").slice(-700),
              file: r.logFile || tt("（写日志失败）"),
            }),
          );
        }
        window.setTimeout(() => setExportNote(""), r.ok ? 5200 : 12000);
      })
      .catch((e) => {
        setRealRenderBusy(false);
        setExportNote(tt("真机渲染失败：{reason}", { reason: String(e) }));
        window.setTimeout(() => setExportNote(""), 8000);
      });
  };

  const clearRes = () => {
    setResExtras(null);
    setResourceFragment("");
    // M149：连示例项目自带的 values/drawable 一起清掉，否则清完还是一堆“幽灵资源”
    setSampleValues("");
    lsSet(LS_KEY_SAMPLE, "");
    try {
      window.localStorage.removeItem(LS_KEY_RES);
    } catch {
      /* ignore */
    }
    if (resDirRef.current) resDirRef.current.value = "";
    setExportNote(tt("已清除上传的 res 资源"));
    window.setTimeout(() => setExportNote(""), 2400);
  };

  /** M3：生成正式 Android 布局 XML 并下载。导出前检查：结构错误阻断；语义提示允许忽略继续
   *  M2s：改成可视化检查面板（不再用 alert/confirm） */
  const doDownload = () => {
    if (codeOnly) {
      flashNote(tt("当前文件不是布局，不能导出为布局 XML；直接「保存」就行"), 4600);
      return;
    }
    const r = downloadLayout(currentSaveInput("activity_main.xml"));
    setExportNote(
      r.native ? tt("已保存 {name}（{dir}）", { name: r.name, dir: workspaceLabel() || tt("工作目录") }) : tt("已导出 {name}", { name: r.name }),
    );
    window.setTimeout(() => setExportNote(""), 2400);
  };

  /** M21：保存
   *  - 从工作目录/本地打开的文件：写回**原路径**（依赖资源写到同级 res 目录）
   *  - 新建文件：先确认文件名 → 再弹系统文件夹选择器（可新建文件夹）→ 按 res 结构一起写
   *  - 依赖资源（生成的 shape/vector/values）一并写到 drawable/ values/ */
  const flashNote = (msg: string, ms = 3600) => {
    // M101：连续弹提示时旧定时器会把新提示提前抹掉 —— 先清掉上一个
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current);
    setExportNote(msg);
    noteTimerRef.current = window.setTimeout(() => setExportNote(""), ms);
  };

  /* ===== M115：画布多选 / 复制 / 粘贴 / 成组 / 解组 ===== */
  /** 当前实际多选集合（主选在前，附加在后；按 path 字典序排序方便成组判定） */
  const selPaths = useMemo(() => {
    if (!selectedPath) return selExtra.length ? selExtra : [];
    return normalizePaths([selectedPath, ...selExtra]);
  }, [selectedPath, selExtra]);

  /** M115：取消主选时一并取消多选 */
  useEffect(() => {
    if (selectedPath === null && selExtra.length) setSelExtra([]);
  }, [selectedPath, selExtra.length]);

  /** M115：单选 / 追加多选。additive = Ctrl/⌘/Shift 按住 */
  const selectPath = useCallback(
    (p: string | null, additive = false) => {
      if (!p) {
        setSelectedPath(null);
        setSelExtra([]);
        return;
      }
      if (p === "#0") {
        setSelectedPath(p);
        setSelExtra([]);
        return;
      }
      if (!additive) {
        setSelectedPath(p);
        setSelExtra([]);
        return;
      }
      // 追加模式：已包含且不止一个 → 取消该节点；否则加入
      setSelExtra((prev) => {
        const all = selectedPath ? [selectedPath, ...prev] : [...prev];
        if (all.length > 1 && all.includes(p)) {
          setSelectedPath(all.filter((x) => x !== p)[0] ?? null);
          return all.filter((x) => x !== p);
        }
        return [...prev, p];
      });
      if (selectedPath) setSelectedPath(selectedPath);
      else setSelectedPath(p);
    },
    [selectedPath],
  );

  /** 取一份「路径仍然有效」的多选集合（文档变过之后可能失效） */
  const validSelPaths = useCallback((): string[] => {
    if (!selPaths.length) return [];
    const root = scanElements(xml);
    if (!root) return [];
    return selPaths.filter((p) => elementAt(root, p) !== null);
  }, [selPaths, xml]);

  /** M115：复制当前多选到内部剪贴板 + 系统剪贴板 */
  const copySelection = useCallback((): number => {
    const paths = validSelPaths();
    if (!paths.length) return 0;
    const text = snippetsToText(collectSnippets(xml, paths));
    clipRef.current = text;
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    flashNote(tt("已复制 {n} 个控件", { n: paths.length }), 2200);
    return paths.length;
  }, [validSelPaths, xml, flashNote]);

  /** M115：把内部剪贴板（或系统剪贴板里的 XML）粘贴到主选节点之后 */
  const pasteSelection = useCallback((): number => {
    const paths = validSelPaths();
    const anchor = selectedPath ?? paths[0];
    if (!anchor) {
      flashNote(tt("先选中一个控件再粘贴"), 3000);
      return 0;
    }
    const { parentPath, index } = splitPath(anchor);
    // 粘贴目标：最后一个选中项之后（单选时就是主选之后）
    const lastIdx = paths.length ? splitPath(paths[paths.length - 1]).index : index;
    const targetIndex = lastIdx + 1;

    const place = (text: string, from: string): number => {
      const parts = splitSnippets(text);
      if (!parts.length) {
        flashNote(from === "sys" ? tt("剪贴板里没有可粘贴的控件 XML") : tt("内部剪贴板已失效，请重新复制"), 3200);
        return 0;
      }
      const base = currentXml();
      const renamed = parts.map((p) => renameDuplicateIds(base, p));
      const r = insertSnippetsAt(base, parentPath, targetIndex, renamed);
      if (!r.ok) {
        flashNote(r.reason ?? tt("粘贴失败"), 3600);
        return 0;
      }
      setXmlAndTrack(r.xml);
      setSelectedPath(r.firstPath);
      setSelExtra([]);
      flashNote(
        from === "sys" ? tt("已粘贴（来自系统剪贴板）") : tt("已粘贴 {n} 个控件", { n: r.count }),
        2400,
      );
      return r.count;
    };

    const snippet = clipRef.current;
    if (snippet.trim()) return place(snippet, "inner");
    // 没有内部剪贴板：试读系统剪贴板（异步，只看不像 XML 就提示）
    void navigator.clipboard
      ?.readText?.()
      .then((text) => {
        if (text && /<\w[^>]*>/.test(text)) place(text, "sys");
        else flashNote(tt("剪贴板里没有可粘贴的控件 XML"), 3200);
      })
      .catch(() => flashNote(tt("读不到系统剪贴板，请先在本应用里复制一次"), 3600));
    return 0;
  }, [validSelPaths, selectedPath, setXmlAndTrack, currentXml, flashNote]);

  /** M115：Ctrl+D 式「就地复制」= 复制 + 紧跟原位置粘贴 */
  const duplicateSelection = useCallback((): number => {
    const paths = validSelPaths();
    if (paths.length === 1) {
      const text = snippetsToText(collectSnippets(xml, paths));
      clipRef.current = text;
      const { parentPath, index } = splitPath(paths[0]);
      const r = insertSnippetsAt(xml, parentPath, index + 1, [renameDuplicateIds(xml, text)]);
      if (!r.ok) {
        flashNote(r.reason ?? tt("无法复制"), 3600);
        return 0;
      }
      setXmlAndTrack(r.xml);
      setSelectedPath(r.firstPath);
      setSelExtra([]);
      flashNote(tt("已复制 1 个控件"), 2200);
      return 1;
    }
    if (!paths.length) return 0;
    const text = snippetsToText(collectSnippets(xml, paths));
    clipRef.current = text;
    const { parentPath } = splitPath(paths[paths.length - 1]);
    const idxs = paths.map((p) => splitPath(p).index).sort((a, b) => a - b);
    const r = insertSnippetsAt(xml, parentPath, idxs[idxs.length - 1] + 1, [renameDuplicateIds(xml, text)]);
    if (!r.ok) {
      flashNote(r.reason ?? tt("无法复制"), 3600);
      return 0;
    }
    setXmlAndTrack(r.xml);
    setSelectedPath(r.firstPath);
    setSelExtra([]);
    flashNote(tt("已复制 {n} 个控件", { n: paths.length }), 2200);
    return paths.length;
  }, [validSelPaths, xml, setXmlAndTrack, flashNote]);

  /** M115：Ctrl+G 成组（多选相邻兄弟） */
  const groupSelection = useCallback((): string | null => {
    const paths = validSelPaths();
    if (paths.length < 2) {
      flashNote(tt("至少选中两个控件才能成组"), 3200);
      return null;
    }
    const r = wrapSiblings(xml, paths);
    if (!r.ok) {
      flashNote(r.reason ?? tt("成组失败"), 3600);
      return null;
    }
    setXmlAndTrack(r.xml);
    setSelectedPath(r.newPath);
    setSelExtra([]);
    flashNote(tt("已把 {n} 个控件包进 FrameLayout", { n: paths.length }), 2600);
    return r.newPath;
  }, [validSelPaths, xml, setXmlAndTrack, flashNote]);

  /** M115：Ctrl+Shift+G 解组（仅对主选容器） */
  const ungroupSelection = useCallback((): string[] => {
    if (!selectedPath) return [];
    if (!canUnwrap(xml, selectedPath)) {
      flashNote(tt("选中的不是带子控件的容器，解不了组"), 3200);
      return [];
    }
    const r = unwrapElement(xml, selectedPath);
    if (!r.ok) {
      flashNote(r.reason ?? tt("解组失败"), 3600);
      return [];
    }
    setXmlAndTrack(r.xml);
    setSelectedPath(r.childPaths[0] ?? null);
    setSelExtra(r.childPaths.slice(1));
    flashNote(tt("已解组：子控件已提出来"), 2400);
    return r.childPaths;
  }, [selectedPath, xml, setXmlAndTrack, flashNote]);

  /** M115：删除当前多选（有 ≥2 时用文本切片批量删；否则走原单删） */
  const deleteSelection = useCallback((): number => {
    const paths = validSelPaths();
    if (paths.length < 2) {
      // 走原有 onRemoveNode 路径（保留其状态/历史行为）
      if (selectedPath) onRemoveNode(selectedPath);
      setSelExtra([]);
      return 1;
    }
    const out = deletePathsText(xml, paths);
    setXmlAndTrack(out);
    setSelExtra([]);
    setSelectedPath(null);
    flashNote(tt("已删除 {n} 个控件", { n: paths.length }), 2400);
    return paths.length;
  }, [validSelPaths, xml, selectedPath, onRemoveNode, setXmlAndTrack, setSelExtra, flashNote]);

  /** 当前 xml → 落盘输入（四条保存路径共用） */
  const currentSaveInput = (name?: string): SaveInput => ({    xml: currentXml(),
    mode: exportMode,
    name: name || saveOrigin?.name || activeFile(project)?.name || "activity_main.xml",
    generatedDrawables,
    extras: resExtrasAll,
    extraRes: appIconRes,
  });

  /** M36：当前打开项目的可写根（有则保存一律落进 <项目>/app/src/main/res/） */
  const projRoot = useMemo(() => projectSaveRoot(activeProject), [activeProject]);

  /** M174：「设为应用图标」面板初始值：
   *  1) localStorage 里上次的参数（生成过就写进去）
   *  2) 没有则从项目 res 读回（native 壳里读 mipmap-anydpi-v26 + drawable 背景色） */
  const appIconInit = useMemo(() => {
    try {
      const saved = lsGetJson<{ bgColor?: string; contentDp?: number }>(LS_KEY_APP_ICON);
      if (saved?.bgColor) {
        return { bgColor: saved.bgColor, contentDp: saved.contentDp ?? 72 };
      }
      if (projRoot?.kind === "native") {
        const b = nativeBridge();
        if (b?.readText) {
          const collect: Record<string, string> = {};
          for (const rel of [
            "mipmap-anydpi-v26/ic_launcher.xml",
            "mipmap-anydpi-v26/ic_launcher_round.xml",
            "drawable/ic_launcher_background.xml",
            "drawable/ic_launcher_foreground.xml",
          ]) {
            try {
              const t = b.readText(resAbs(projRoot.base, rel));
              if (t) collect[rel] = t;
            } catch { /* 读不到就跳过 */ }
          }
          const cfg = parseAppIconConfig(collect);
          if (cfg) return cfg;
        }
      }
    } catch { /* 回落到默认值 */ }
    return null;
  }, [projRoot]);

  /** 把当前内容整包写进当前项目的 res 目录（layout + 依赖 drawable/values） */
  const saveIntoProject = async (name?: string, forceExternal = false): Promise<boolean> => {
    if (!projRoot) return false;
    const input = currentSaveInput(name);
    const files = buildSaveFiles(input);
    /* M201：写之前先读磁盘主文件，看是不是别人在电脑上改过了。
     * 只在「我们记得上次写了什么」且「磁盘对不上」时拦，首次写不拦。 */
    const primary = files[0];
    const diskRel = primary ? `${RES_PREFIX}/${primary.path}` : "";
    if (primary && diskRel) {
      const disk = await readProjectFile(projRoot, diskRel);
      const plan = planWrite(loadBaseline(diskRel), disk, forceExternal);
      if (plan.conflict) {
        setConflict({
          rel: diskRel,
          disk: disk ?? "",
          mine: primary.text ?? "",
          retry: () => void saveIntoProject(name, true),
          loadDisk: () => loadDiskIntoEditor(disk ?? ""),
        });
        return false;
      }
      snapshotBeforeWrite(diskRel, disk, primary.text ?? "");
    }
    const r = await saveResFiles(projRoot, files);
    if (!r.ok) {
      flashNote(
        tt("写入项目失败（{reason}）。请确认「所有文件访问」已开启、项目目录可写", { reason: r.failed[0] || tt("未知原因") }),
        5000,
      );
      return false;
    }
    flashNote(
      tt("已保存《{name}》：{n} 个文件 → app/src/main/res/", { name: activeProject?.name || tt("项目"), n: r.written }) +
        (r.failed.length ? tt("（{n} 个失败）", { n: r.failed.length }) : ""),
      4200,
    );
    markSaved(xml);
    // M201：写成功了才更新基线（失败时不更新，下次还能发现外部改动）
    for (const f of files) saveBaseline(`${RES_PREFIX}/${f.path}`, f.text ?? "");
    return true;
  };

  /** M201：用户在「文件已被外部修改」弹窗里选「载入磁盘版本」 */
  const loadDiskIntoEditor = (text: string) => {
    liveXmlRef.current = null;
    docRef.current = text;
    setXml(text);
    markSaved(text);
    flashNote(tt("已载入磁盘上的版本（编辑器里的未保存改动已丢弃）"), 4600);
  };
  const saveBack = async (): Promise<boolean> => {
    // M36：有打开的项目 → 优先进项目 res（不依赖 saveOrigin）
    if (projRoot && (await saveIntoProject())) return true;
    if (!saveOrigin) return false;
    const input = currentSaveInput();
    const r = await saveBackPure(input, saveOrigin);
    if (!r.ok) return false;
    let depNote = "";
    if (r.depsWritten) depNote = tt("，依赖资源 {n} 个", { n: r.depsWritten });
    else if (r.depsTotal) {
      depNote =
        saveOrigin.kind === "native"
          ? tt("（{n} 个依赖资源没写成，请检查目录权限）", { n: r.depsTotal })
          : tt("；另有 {n} 个依赖资源，可用「另存到文件夹」一起写出", { n: r.depsTotal });
    }
    flashNote(tr("save.doneBack", "已保存 {name}（原路径）", { name: input.name }) + depNote, 4200);
    markSaved(xml);
    return true;
  };

  /** 另存：走系统文件夹选择器，按 res 结构整包写 */
  const saveAsTo = async (name: string) => {
    const r = await saveAsBundle(currentSaveInput(name));
    if (r.ok) {
      flashNote(
        tr("save.doneAs", "已保存到「{dir}」：{n} 个文件（含依赖资源）", {
          dir: r.label || tt("所选文件夹"),
          n: r.count ?? 0,
        }),
        5000,
      );
      markSaved(xml);
      return true;
    }
    if (r.canceled) {
      flashNote(tr("save.canceled", "已取消保存"));
      return false;
    }
    flashNote(tr("save.failed", "保存失败：{reason}", { reason: r.reason || "未知原因" }), 5000);
    return false;
  };

  /** M37b：非布局文件（manifest / values / menu …）—— 整文件原位写回，不生成任何布局/依赖资源 */
  const saveRawFile = async (forceExternal = false): Promise<boolean> => {
    const name = saveOrigin?.name || (openRel ? openRel.split("/").pop() || "" : "") || tt("文件");
    // 1) 原生绝对路径 / content URI
    if (saveOrigin?.kind === "native") {
      /* M201：绝对路径也查一次外部改动（读不到就当首次，不拦） */
      const target = saveOrigin.target;
      let disk: string | null = null;
      try {
        disk = nativeBridge()?.readText?.(target) ?? null;
      } catch {
        disk = null;
      }
      const plan = planWrite(loadBaseline(target), disk, forceExternal);
      if (plan.conflict) {
        setConflict({
          rel: target,
          disk: disk ?? "",
          mine: xml,
          retry: () => void saveRawFile(true),
          loadDisk: () => loadDiskIntoEditor(disk ?? ""),
        });
        return false;
      }
      snapshotBeforeWrite(target, disk, xml);
      if (writeTextNative(target, xml)) {
        saveBaseline(target, xml);
        flashNote(tt("已保存 {name}（原路径）", { name }), 3200);
        markSaved(xml);
        return true;
      }
      flashNote(tt("写入失败：{name} —— 请确认「所有文件访问」已开启", { name }), 5000);
      return false;
    }
    // 2) 项目可写根 + 工程内相对路径（native 拼绝对路径 / web 走目录句柄）
    if (projRoot && openRel) {
      const disk = await readProjectFile(projRoot, openRel);
      const plan = planWrite(loadBaseline(openRel), disk, forceExternal);
      if (plan.conflict) {
        setConflict({
          rel: openRel,
          disk: disk ?? "",
          mine: xml,
          retry: () => void saveRawFile(true),
          loadDisk: () => loadDiskIntoEditor(disk ?? ""),
        });
        return false;
      }
      snapshotBeforeWrite(openRel, disk, xml);
      const ok = await saveProjectFile(projRoot, openRel, xml);
      if (ok) {
        saveBaseline(openRel, xml);
        bumpResCache();
        flashNote(tt("已保存 {name} → {rel}", { name, rel: openRel }), 3600);
        markSaved(xml);
        return true;
      }
      flashNote(tt("写入失败：{rel}（目录不可写？）", { rel: openRel }), 5000);
      return false;
    }
    // 3) 浏览器里打开的文件句柄
    const h = saveOrigin?.kind === "handle" ? saveOrigin.handle : null;
    if (h && typeof (h as { createWritable?: unknown }).createWritable === "function") {
      try {
        const w = await (
          h as { createWritable(): Promise<{ write(d: string): Promise<void>; close(): Promise<void> }> }
        ).createWritable();
        await w.write(xml);
        await w.close();
        flashNote(tt("已保存 {name}（原文件）", { name }), 3200);
        markSaved(xml);
        return true;
      } catch {
        /* 往下退 */
      }
    }
    flashNote(tt("没有可写回的位置：{name} —— 请用项目目录打开，或先「另存到文件夹」", { name }), 5200);
    return false;
  };

  const doSave = async () => {
    // M37b：非布局文件不拼 res 包，直接原文件写回
    if (codeOnly) {
      await saveRawFile();
      return;
    }
    // M36：优先存进当前打开的项目（<项目>/app/src/main/res/）
    if (projRoot && (await saveIntoProject())) return;
    // A) 有来源 → 直接写回原路径
    if (saveOrigin && nextSaveAction(saveOrigin) === "back") {
      if (await saveBack()) return;
      flashNote(tr("save.backFailed", "写回原文件失败，改为另存到文件夹…"), 2600);
    }
    // B) 新建文件 → 先让用户确认文件名，再选文件夹
    setSaveAsName(activeFile(project)?.name || "activity_main.xml");
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
    flushXml(); // M57：先把打字中的最新文本落状态，保存读到的才是当前内容
    if (codeOnly) {
      flashNote(tt("当前文件不是布局，不能走「导出检查」；直接「保存」写回原文件即可"), 4600);
      return;
    }
    setExportAction("download");
    setExportReport(buildReport());
    setExportOpen(true);
  };

  /** M3：复制生成的 XML 到剪贴板（与下载同一份内容） */
  const doCopy = async () => {
    const body = exportLayoutXml(xml, { mode: exportMode });
    // 原生壳里先走 ClipboardManager（WebView 的 navigator.clipboard 不可靠）
    if (copyTextNative(body)) {
      setExportNote(tt("已复制到剪贴板"));
      window.setTimeout(() => setExportNote(""), 2600);
      return;
    }
    try {
      await navigator.clipboard.writeText(body);
      setExportNote(tt("已复制到剪贴板"));
    } catch {
      // 剪贴板 API 不可用（非 https / 旧浏览器）时退化成保存
      doDownload();
      setExportNote(tt("剪贴板不可用，已改为保存文件"));
    }
    window.setTimeout(() => setExportNote(""), 2600);
  };

  const copyExportedXml = () => {
    setExportAction("copy");
    setExportReport(buildReport());
    setExportOpen(true);
  };

  /** M27：保存基线（用于状态条「未保存」提示） */
  const xmlRef = useRef(xml);
  xmlRef.current = xml;
  const [savedMark, setSavedMark] = useState<string>(() => xml);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const markSaved = useCallback((text: string) => {
    setSavedMark(text);
    setSavedAt(Date.now());
    // M140：保存成功 = 一个自然的历史版本，顺手存一条快照（去重）
    const key = snapFileKey();
    if (key) {
      pushSnap(key, text, SNAP_LABEL_SAVE);
      setSnapCount(loadSnaps(key).length);
    }
  }, []);
  const snapFileKey = useCallback(() => {
    // 快照按文件存：优先工程内相对路径，其次当前打开的文件名，都没有（纯新建）就存 "untitled"
    if (openRel) return openRel;
    const n = saveOrigin?.name || wsActiveName || currentFile?.name;
    if (n) return n;
    return "untitled";
  }, [openRel, saveOrigin, wsActiveName, currentFile]);

  // 切文件 / 关面板后徽标数字要跟着变（保存时 markSaved 也会刷）
  useEffect(() => {
    setSnapCount(loadSnaps(snapFileKey()).length);
  }, [snapFileKey, histPanelOpen, savedMark]);

  const dirty = xml !== savedMark;

  /** M141：全局离开拦截 —— 切文件 / 打开新文件 / 关浏览器（未保存时） */
  const leaveGuard = useUnsavedLeave({
    title: tt("有未保存的内容"),
    onSave: () => void doSave(),
    onDiscard: () => setSavedMark(currentXml()),
  });

  // 关窗口 / 切后台时提示（浏览器原生 beforeunload 只能弹默认框，但必须拦，不然丢文档）
  useEffect(() => {
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBefore);
    return () => window.removeEventListener("beforeunload", onBefore);
  }, [dirty]);
  // 切换/打开文件 → 当前内容就是磁盘上的基线（避免一进来就顶着「未保存」）
  useEffect(() => {
    setSavedMark(xmlRef.current);
    setSavedAt(null);
  }, [saveOrigin]);

  /** M26：画布选中 → 代码视图滚到并高亮对应行（反方向由 onCodeCursorLine 负责） */
  const selectedLine = useMemo(() => lineOfPath(treeRoot, selectedPath), [treeRoot, selectedPath]);
  const lastLineSyncRef = useRef("");
  const fromCodeRef = useRef(false);
  useEffect(() => {
    // 切到代码视图时重置，保证每次都重新定位到当前选中块
    if (mobileTab === "xml") lastLineSyncRef.current = "";
  }, [mobileTab]);
  useEffect(() => {
    if (mobileTab !== "xml") return;
    if (fromCodeRef.current) {
      fromCodeRef.current = false;
      return;
    }
    if (selectedLine == null) return;
    if (!shouldResync(lastLineSyncRef.current, selectedPath ?? '', selectedLine)) return;
    lastLineSyncRef.current = `${selectedPath}@${selectedLine}`;
    setFocusLine(selectedLine);
    setFocusTick((t) => t + 1);
  }, [selectedPath, selectedLine, mobileTab]);

  /** M2s：跳转到代码视图并让代码编辑器滚动/选中到指定行
   *  M187 修复：代码视图早就搬到主区 tab（mobileTab === "xml"）了，这里还在 setLeftView("code")
   *  → 点抽屉里的问题只弹出左侧滑面板、代码根本没动。改成切主区 tab + 关面板 + 下一帧跳行。 */
  const [focusLine, setFocusLine] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const gotoLine = useCallback((line: number) => {
    setMobileTab("xml");
    setLeftOpen(false);
    setRightOpen(false);
    requestAnimationFrame(() => {
      setFocusLine(line);
      setFocusTick((t) => t + 1);
    });
  }, []);

  /** M61：函数列表 → 跳行（手机上先切到「代码」页，等一帧编辑器挂载后再跳） */
  const jumpToCodeLine = useCallback(
    (line: number) => {
      if (isMobile && mobileTab !== "xml") setMobileTab("xml");
      // M63j：手机端跳完就收起右侧面板，把屏幕让给代码（桌面端保持面板不关）
      if (isMobile) setRightOpen(false);
      requestAnimationFrame(() => {
        setFocusLine(line);
        setFocusTick((t) => t + 1);
      });
    },
    [isMobile, mobileTab],
  );

  /** M68（C3）：「引用」浮层（查这个资源在项目里被哪些地方用到） */
  const [usesPanel, setUsesPanel] = useState<{
    title: string;
    hits: UsageHit[];
    files: number;
    truncated: boolean;
    loading: boolean;
  } | null>(null);
  /* M146：右滑面板 + 运行预览 + 历史面板 + 引用列表 —— 返回键先关浮层再谈退出 */
  useBackGuard(isMobile && rightOpen, () => setRightOpen(false), "right-panel");
  useBackGuard(runOpen, () => setRunOpen(false), "run-preview");
  useBackGuard(histPanelOpen, () => setHistPanelOpen(false), "history-panel");
  useBackGuard(usesPanel !== null, () => setUsesPanel(null), "usages-panel");


  const openUsages = useCallback(
    async (value: string) => {
      if (!aiFileIo) {
        setWsMsg(tt("先打开一个项目目录，才能查引用（当前是单个文件）"));
        return;
      }
      const dir = openRel ? openRel.split("/").slice(0, -1).join("/") : undefined;
      setUsesPanel({ title: value, hits: [], files: 0, truncated: false, loading: true });
      try {
        const res = await findUsages(aiFileIo, value, undefined, { firstDir: dir });
        setUsesPanel({
          title: value,
          hits: res.hits,
          files: res.files,
          truncated: res.truncated,
          loading: false,
        });
      } catch (e) {
        setUsesPanel(null);
        setWsMsg(tt("查引用失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      }
    },
    [aiFileIo, openRel],
  );

  /**
   * M65：属性值是 `@string/app_name` 这类资源引用时 → 找定义文件并跳到那一行。
   * 已经打开的就是这个文件时只跳行，不重新读盘。
   */
  const openResRef = useCallback(
    async (value: string) => {
      const resolver = createResResolver(aiFileIo, openRel ?? null);
      if (!resolver) {
        // M101：改成底部 toast —— wsMsg 只在项目面板里看得到，代码面板上点了“没反应”很难受
        flashNote(tt("先打开一个项目目录，才能跳到资源定义（当前是单个文件）"));
        return;
      }
      const hit = await resolver.resolve(value);
      if (!hit) {
        flashNote(tt("项目里没找到 {value}（可能只在别的模块/依赖库里）", { value }));
        return;
      }
      const going = formatResRefHit(hit.ref, hit.rel, hit.line);
      if (openRel && openRel === hit.rel) {
        jumpToCodeLine(hit.line);
        flashNote(going);
        return;
      }
      const src = activeProjectRef.current?.source;
      if (!src) {
        flashNote(tt("找到了：{target}，但当前没有可切换的项目源", { target: going }));
        return;
      }
      const name = hit.rel.split("/").pop() || hit.rel;
      await loadEntry(src, { kind: "file", name, rel: hit.rel });
      jumpToCodeLine(hit.line);
      flashNote(going);
    },
    [aiFileIo, flashNote, jumpToCodeLine, loadEntry, openRel],
  );

  /**
   * M101：删除资源前的影响面 —— 复用已有的 findUsages（带预算扫描，手机上也安全）。
   * 入参是 `drawable/bg_card` 这种符号，内部拼成 `@drawable/bg_card` 去扫。
   */
  const checkDeleteImpact = useCallback(
    async (symbol: string) => {
      if (!aiFileIo) return null;
      const res = await findUsages(aiFileIo, `@${symbol}`, undefined, { maxHits: 40 });
      return {
        count: res.hits.length,
        samples: res.hits.slice(0, 3).map((h) => ({ rel: h.rel, line: h.line })),
      };
    },
    [aiFileIo],
  );

  /**
   * M101：代码面板里 Ctrl/Cmd + 点击资源引用 → 按写法分流。
   *  - @+id/x / @id/x / R.id.x → 打开「查引用」浮层（id 没有独立定义文件）
   *  - 其余（@string/x、R.string.x、@drawable/x…）→ 跳定义
   *  - @android:x → 提示「框架内置，跳不了」
   */
  const onGotoRef = useCallback(
    (raw: string) => {
      const t = parseRefToken(raw);
      if (!t) {
        // M209：不是资源引用 → 当「本文件内符号」处理：Ctrl+点击跳到声明行
        if (isJavaLikePath(openRel || "")) {
          const name = raw.replace(/^\.+|\.+$/g, "").split(".").pop() || "";
          const isKt = /\.kts?$/i.test(openRel || "");
          const outline = parseOutline(xml, isKt);
          const hit = outline.find((s) => s.name === name);
          if (hit) {
            jumpToCodeLine(hit.line);
            return;
          }
        }
        flashNote(tt("这里没有可跳转的定义"));
        return;
      }
      const a = refAction(t);
      if (a.kind === "none") {
        flashNote(
          a.reason === "framework" ? tt("@android: 内置资源，没有可跳的定义") : tt("这里没有可跳转的引用"),
        );
        return;
      }
      // 没打开项目目录时，静默失败让人其妙（wsMsg 在不看项目面板时看不到）→ 用底部 toast 提示
      if (!aiFileIo) {
        flashNote(tt("先打开一个项目目录，才能跳转 / 查引用（当前是单个文件）"));
        return;
      }
      if (a.kind === "usages") {
        void openUsages(a.refValue);
        return;
      }
      void openResRef(a.refValue);
    },
    [aiFileIo, flashNote, openResRef, openUsages, openRel, xml, jumpToCodeLine],
  );

  /**
   * M209：代码编辑器悬停提示——光标落在资源引用 / 已知方法·变量上时，给一行说明。
   * 数据源：resExtras（项目 res）+ generatedDrawables（本工具生成）+ 当前文件的 Java/Kotlin 大纲。
   */
  const hoverTip = useCallback(
    (raw: string): string | null => {
      // R.id.X / R.drawable.X / @drawable/X / @string/X
      const rType = raw.match(/^R\.(\w+)\.(\w+)$/);
      const atType = raw.match(/^@(\w+)\s*\/\s*(\w+)$/);
      if (rType || atType) {
        const kind = rType ? rType[1] : atType ? atType[1] : null;
        const name = (rType ? rType[2] : atType ? atType[2] : null) || "";
        if (kind === "id") {
          const found = xml.search(new RegExp(`<[^>]*android:id="@\\+?id/"?${name}"?`, "g"));
          if (found >= 0) {
            const ln = xml.slice(0, found).split("\n").length;
            return `R.id.${name} · layout L${ln}`;
          }
        }
        // drawable / string 等资源
        if (resExtras || generatedDrawables[name]) {
          const where = kind === "drawable" || kind === "mipmap" ? "res/drawable" : `res/values/${kind}s`;
          return tt("资源 {name}（{where}）", { name, where });
        }
        return `R.${kind}.${name}`;
      }
      // 裸标识符：查当前文件的 Java/Kotlin 大纲（类 / 方法）
      if (isJavaLikePath(openRel || "")) {
        const isKt = /\.kts?$/i.test(openRel || "");
        const outline = parseOutline(xml, isKt);
        const hit = outline.find((s) => s.name === raw);
        if (hit) {
          return tt("{kind} {name} · L{line}", {
            kind: hit.kind === "class" ? tt("类") : tt("方法"),
            name: hit.name,
            line: hit.line,
          });
        }
      }
      return null;
    },
    [xml, resExtras, generatedDrawables, openRel],
  );

  /**
   * M180：重命名资源文件 → 同步改全项目对它的 @type/name 引用（布局/values/drawable 互引/Java）。
   * 改名本身由调用方（项目树）完成，这里只负责文本替换 + 写回。
   */
  const onRenameResource = useCallback(
    async (oldRel: string, newName: string) => {
      if (!aiFileIo || !aiFileIo.canWrite) {
        return { ok: false, msg: tt("当前环境不能写文件，只改了文件名，引用没同步") };
      }
      const m = /^(.*)\/res\/(\S+)\/.+/i.exec(oldRel);
      if (!m) {
        return { ok: false, msg: tt("这个名字不在 res/ 下，没敢自动改引用") };
      }
      const subDir = m[2].toLowerCase();
      const kind: "ref" | "values" = subDir.startsWith("values") ? "values" : "ref";
      const resType =
        kind === "values"
          ? singularResType(
              (oldRel.split("/").pop() || "strings.xml").replace(/\.xml$/, "").replace(/-.*$/, ""),
            )
          : subDir.split("-")[0];
      const oldName = oldRel.split("/").pop()!.replace(/\.[^.]+$/, "");
      let files = 0;
      let refs = 0;
      let budget = 260;
      // 扫项目里的 xml + java/kt（预算 260 个文件，超出停止）
      const scanDir = async (dir: string, depth: number): Promise<void> => {
        if (depth > 8 || budget <= 0) return;
        let items: AiFileEntry[] = [];
        try {
          const r = await aiFileIo.list(dir);
          items = r.ok && r.items ? r.items : [];
        } catch {
          return;
        }
        for (const it of items) {
          if (budget <= 0) return;
          const p = `${dir}/${it.name}`;
          if (it.kind === "dir") {
            await scanDir(p, depth + 1);
            continue;
          }
          if (!/\.(xml|java|kt)$/i.test(it.name)) continue;
          const rd = await aiFileIo.read(p);
          if (!rd.ok || typeof rd.text !== "string" || !rd.text) continue;
          const inValues = /\/res\/values/.test(p);
          const r2 = renameResRef(rd.text, inValues ? "values" : "ref", resType, oldName, newName);
          if (r2.n > 0) {
            const w = await aiFileIo.write(p, r2.text);
            if (w.ok) {
              files++;
              refs += r2.n;
            }
          }
          budget--;
        }
      };
      await scanDir("", 0);
      // 当前编辑器里打开的布局如果也引用了 → 一并改（未保存内容）
      if (kind === "ref" && xml.includes(`@${resType}/${oldName}`)) {
        const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const fixed = xml.replace(new RegExp(`@${resType}/${esc}(?![A-Za-z0-9_])`, "g"), `@${resType}/${newName}`);
        if (fixed !== xml) setXmlAndTrack(fixed);
      }
      return {
        ok: true,
        msg:
          refs > 0
            ? tt("已同步 {n} 处引用（{f} 个文件）", { n: refs, f: files })
            : tt("项目里没找到对「{name}」的引用", { name: oldName }),
      };
    },
    [aiFileIo, xml],
  );

  /** M180：项目树里选中的图标 → 直接写进当前选中控件的属性（attr 由调用方给，通常 src） */
  const onFillIconAttr = useCallback(
    (attr: string, resourceName: string, vectorXml: string) => {
      if (!selectedPath) {
        flashNote(tt("先在画布上选一个控件（比如 ImageView），再点「填入选中控件」"));
        return;
      }
      const safe = sanitizeResName(resourceName, "ic");
      if (vectorXml) setGeneratedDrawables((m) => ({ ...m, [safe]: vectorXml }));
      commitAttrRef.current(attr, `@drawable/${safe}`);
      flashNote(tt("已填入 {attr} = @drawable/{name}", { attr, name: safe }));
    },
    [selectedPath, flashNote],
  );

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
          <div className="axv-mob-tabs-inner" role="tablist" aria-label={tt("视图")}>
          {/* M31e：「XML 代码」改叫「代码」并挪到「预览」前面 —— 以后要在这里接 Java 代码显示 */}
          <button
            role="tab"
            aria-selected={mobileTab === "xml"}
            className={mobileTab === "xml" ? "on" : ""}
            onClick={() => {
              flushXml(); // M57：切 tab 前把最新文本落状态，预览/视图才能看到刚输的内容
              setMobileTab("xml");
            }}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>code_xml</span>
            {tt("代码")}
          </button>
          {/* M42：values 资源才有「视图」—— 键值对表格页（.axv-val），紧跟「代码」后面 */}
          {hasViewTab && (
            <button
              role="tab"
              aria-selected={mobileTab === "values"}
              className={mobileTab === "values" ? "on" : ""}
              onClick={() => {
                flushXml();
                setMobileTab("values");
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>table_chart</span>
              {tt("视图")}
            </button>
          )}
          {/* M42：「预览」只在能画布局的文档上出现（manifest / values / menu 等不显示） */}
          {!codeOnly && (
            <button
              role="tab"
              aria-selected={mobileTab === "preview"}
              className={mobileTab === "preview" ? "on" : ""}
              onClick={() => {
                flushXml();
                setMobileTab("preview");
              }}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>phone_android</span>
              {tt("预览")}
            </button>
          )}
          {/* M30b：两个下拉框挪到两个 tab 按钮后面 */}
          <select
            className="axv-tb-select axv-tab-sample"
            title={tt("载入完整示例项目（布局 + 自带图标/背景资源）")}
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              if (v.startsWith("blank:")) applyBlankTemplate(v.slice(6));
              else applySampleProject(v);
            }}
            style={{ margin: "0 8px" }}
          >
            <option value="">{tt("示例项目…")}</option>
            <optgroup label={tt("完整示例（带资源）")}>
              {SAMPLE_PROJECTS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name} · {p.library.split(" + ")[0]}
                </option>
              ))}
            </optgroup>
            <optgroup label={tt("新建（空白）")}>
              {SAMPLE_BLANKS.map((b) => (
                <option key={b.key} value={`blank:${b.key}`}>
                  {b.name}
                </option>
              ))}
            </optgroup>
          </select>
          {fileSelect}
          </div>
        </div>
      )}

      {/* 画布舞台（M25e：整块搬到 components/CanvasStage.tsx） */}
      <CanvasStage
        active={mobileTab === "preview"}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        stageRef={stageRef}
        phoneRef={phoneRef}
        tr={tr}
        gotoLine={gotoLine}
        zoomHud={zoomHud}
        outerW={outerW}
        outerH={outerH}
        fitRatio={fitRatio}
        DPX={DPX}
        radius={device.radius ?? 0}
        phoneBg={phoneBg}
        phoneFg={phoneFg}
        showSystemBars={showSystemBars}
        STATUS_BAR_H={STATUS_BAR_H}
        NAV_BAR_H={NAV_BAR_H}
        dropHint={dropHint}
        onDropHint={setDropHint}
        onDrop={onDrop}
        model={model}
        parsedXml={previewActive ? parsedForRender : ""}
        issues={issues}
        showIssues={showIssues}
        parseErr={parseErr}
        parseReason={parseReason}
        notice={codeNotice}
        lintErrCount={lintErrCount}
        exportNote={exportNote}
        selectedPath={selectedPath}
        selectedPaths={selExtra}
        onSelectPath={selectPath}
        onDropWidget={onDropWidget}
        onConstraintDraw={onConstraintDraw}
        onGeometryChange={onGeometryChange}
        isPathLocked={isPathLocked}
      />

      {/* M115：多选工具条（触屏没 Ctrl，按钮是唯一入口） */}
      {selPaths.length >= 2 && mobileTab !== "values" ? (
        <div className="axv-multibar" role="toolbar" aria-label={tt("多选操作")}>
          <span className="axv-multibar-n">{tt("已选 {n} 个", { n: selPaths.length })}</span>
          <button className="axv-mb-btn" onClick={() => copySelection()} title={tt("复制（Ctrl+C）")}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>content_copy</span>
            {tt("复制")}
          </button>
          <button className="axv-mb-btn" onClick={() => groupSelection()} title={tt("成组（Ctrl+G）")}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>folder_zip</span>
            {tt("成组")}
          </button>
          <button className="axv-mb-btn" onClick={() => deleteSelection()} title={tt("删除（Del）")}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>delete</span>
            {tt("删除")}
          </button>
          <button
            className="axv-mb-btn axv-mb-x"
            aria-label={tt("取消多选")}
            onClick={() => {
              setSelExtra([]);
            }}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>close</span>
          </button>
        </div>
      ) : null}

      {/* M185：通用底部抽屉（ROADMAP L0.5-22）：Problems 先接现有 lints，M188b 构建日志 */}
      <ProblemsDrawer
        problems={(lints ?? []).map((l) => ({ line: l.line ?? 1, msg: l.message }))}
        onGotoLine={(ln) => gotoLine(ln)}
        buildLogs={buildLogs}
        insetLeft={isMobile ? undefined : leftOpen ? 320 : 0}
        insetRight={isMobile ? undefined : rightOpen ? 320 : 0}
        statusSlot={
          /* M193：状态条合并进抽屉把手条（不再自己占一行 28px） */
          <StatusBar
            isMobile={isMobile}
            fileName={saveOrigin?.name || activeFile(project)?.name || currentFile?.name || "activity_main.xml"}
            source={
              saveOrigin?.kind === "native"
                ? saveOrigin.target
                : saveOrigin?.kind === "handle"
                  ? saveOrigin.name
                  : workspaceLabel() || null
            }
            deviceLabel={device.label}
            deviceSize={`${device.w}×${device.h}`}
            scale={scale}
            dirty={dirty}
            issueCount={lintErrCount}
            onIssues={() => setShowIssues((v) => !v)}
            onResetZoom={() => applyZoom(1)}
            savedHint={
              savedAt
                ? tt("已保存 {time}", {
                    time: new Date(savedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
                  })
                : null
            }
          />
        }
        tr={tr}
      />
      {/* M101：代码面板也要看得到 toast（exportNote 的汉堡包在 CanvasStage，代码 tab 看不到） */}
      <XmlCodeView
        open={mobileTab === "xml" || mobileTab === "values"}
        isMobile={isMobile}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        value={xml}
        onChange={onChangeXmlText}
        errors={lints}
        focusLine={focusLine}
        focusTick={focusTick}
        onCursorLine={onCodeCursorLine}
        onFormat={doFormat}
        onFixAll={doFixAll}
        onFixOne={doFixOne}
        onRefClick={onGotoRef}
        hoverTip={hoverTip}
        lang={editorLang}
        indent={editorTheme.indent}
        resNames={useMemo(() => {
          const out: string[] = [];
          // ① 已上传 res 目录的资源（drawable 名 + vector 名）
          if (resExtras) {
            Object.keys(resExtras.drawables).forEach((n) => out.push(n));
            Object.keys(resExtras.drawableXml).forEach((n) => out.push(n));
            (resExtras.vectorNames ?? []).forEach((n) => out.push(n));
          }
          // ② 本工具生成的 drawable
          Object.keys(generatedDrawables).forEach((n) => out.push(n));
          // 去重，纯资源名（不带扩展/密度后缀）
          return [...new Set(out)];
        }, [resExtras, generatedDrawables])}
        view={mobileTab === "values" ? viewKind ?? "code" : "code"}
        fileKey={openRel || saveOrigin?.name || ""}
        onNote={flashNote}
      />

      {/* M101：代码 tab 也能看到操作反馈（exportNote 原本只在画布里的状态条） */}
      {(mobileTab === "xml" || mobileTab === "values") && exportNote.trim() ? (
        <div className="axv-toast axv-code-toast">{exportNote}</div>
      ) : null}

      {/* 左侧滑面板（M25g：图标条 + 标题栏搬到 components/LeftRail.tsx） */}
      <LeftRail
        tr={tr}
        view={leftView}
        open={leftOpen}
        onPick={(v) => {
          setLeftOpen(true);
          // M47：切 tab 本身是高频操作，把视图切换丢进 transition，让点击帧先画完（手机上不再卡一下）
          startTransition(() => setLeftView(v));
        }}
        onClose={() => setLeftOpen(false)}
      >
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
                selectedPaths={selExtra}
                onSelect={selectPath}
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
              docRel={openRel || saveOrigin?.name || null}
              fileIo={aiFileIo}
              projectName={activeProject?.name || ""}
              selection={pathChain.length ? pathChain.map((p) => `${p.tag}${p.id ? "#" + String(p.id).replace("@+id/", "") : ""}`).join(" > ") : null}
              onReplaceXml={(next) => setXmlAndTrack(next, "")}
              onApplied={({ rel, text }) => {
                // M64e（B3）：落盘成功后刷新缓存；若改的正好是当前文档，直接进画布 + 撤销栈
                invalidateNativeProjectCache();
                const key = openRel || saveOrigin?.name || "";
                if (key && rel === key) setXmlAndTrack(text, `ai:${rel}`);
                setExportNote(tt("AI 已更新 {rel}", { rel }));
                window.setTimeout(() => setExportNote(" "), 3000);
              }}
              onNote={(text) => {
                setExportNote(text);
                window.setTimeout(() => setExportNote(" "), 3000);
              }}
            />
          )}
          {leftView === "assets" && (
            <div className="axv-rail-scroll axv-assets-inline-wrap">
              <ResourcePanel
                source={activeProject?.source ?? null}
                aiFileIo={aiFileIo}
                assets={generatedDrawables}
                onNewIcon={() => setResIcon({ name: "", xml: "" })}
                onNewDrawable={() => setResShape({ name: "", xml: "", forceTree: true })}
                onEditIcon={(name, iconXml) => setResIcon({ name, xml: iconXml })}
                onEditShape={(name, shapeXml) => setResShape({ name, xml: shapeXml })}
                onOpenFile={(rel, line) => {
                  const src = activeProjectRef.current?.source;
                  if (!src) {
                    setExportNote(tt("先打开一个项目目录，才能打开资源文件"));
                    window.setTimeout(() => setExportNote(" "), 3000);
                    return;
                  }
                  if (openRel === rel) {
                    if (typeof line === "number") jumpToCodeLine(line);
                    return;
                  }
                  const rootPath = src.rootPath;
                  // M183c：native 路径分隔符用 /（Linux/Android），旧版拼成 \\ 会写错盘
                  const target = rootPath
                    ? rootPath.replace(/[\\/]+$/, "") + "/" + rel
                    : undefined;
                  void loadEntry(src, { kind: "file", name: rel.split("/").pop() || rel, rel, target }).then(() => {
                    if (typeof line === "number") jumpToCodeLine(line);
                  });
                }}
                onPreview={(rel, url, name) => setResImage({ rel, name, url })}
                onNote={(text) => {
                  setExportNote(text);
                  window.setTimeout(() => setExportNote(" "), 3200);
                }}
              />
            </div>
          )}
          {leftView === "res" && (
            <ProjectPanel
              tr={tr}
              tab={projectTab}
              onTab={setProjectTab}
              wsState={wsState}
              wsBusy={wsBusy}
              wsMsg={wsMsg}
              projects={wsProjects}
              metaOf={(p) => projMeta[p.rel]}
              onOpenProject={(item) => void openWsProject(item)}
              onRefresh={() => void refreshWorkspace()}
              onOpenDir={() => void openProjectDir()}
              onRequestAllFiles={() => wsRequestAllFiles()}
              onRenameProject={renameWsProject}
              projectName={activeProject?.name || project.name || ""}
            projectIconUrl={activeProject?.iconUrl ?? null}
              projectSource={activeProject?.source ?? null}
              projectRev={projectRev}
              currentFileName={wsActiveName || (currentFile?.name ?? "")}
              currentRel={openRel}
              onOpenEntry={openProjectEntry}
              onRefreshProject={() => void refreshActiveProject()}
              fileOps={activeProject ? fileOpsCtxOf(activeProject) : null}
              onFilesChanged={() => setProjectRev((n) => n + 1)}
              checkDeleteImpact={checkDeleteImpact}
              onRenameResource={onRenameResource}
              onFillIconAttr={onFillIconAttr}
              onNewProject={(suggest) => {
                setNewProjName(uniqueProjectName([...(suggest ? [suggest] : []), ...wsProjects.map((w) => w.name)]));
                setNewProjPkg("");
                setNewProjOpen(true);
              }}
              appProject={project}
              onSelectFile={(id) => {
                setWsActiveName("");
                selectFile(id);
              }}
              resExtras={resExtras}
              onOpenDrawable={(_rel, name, xml) => setResShape({ name, xml })}
              onPreviewImage={(rel, name, url) => setResImage({ rel, name, url })}
            />
          )}

          {leftView === "settings" && (
            <SettingsPanel
              tr={tr}
              themePreset={themePreset}
              onThemePreset={setThemePreset}
              theme={theme}
              onTheme={setTheme}
              themeOverrides={themeOverrides}
              onEditTheme={(id) => setEditingTheme(id)}
              langPref={langPref}
              onLangPref={setLangPref}
              wsState={wsState}
              onPickDir={() => void pickCustomDir()}
              onUseDefault={() => void useDefaultDir()}
              onRequestAllFiles={() => wsRequestAllFiles()}
              renderTheme={renderTheme}
              onRenderTheme={setRenderTheme}
              previewNight={previewNight}
              onPreviewNight={setPreviewNight}
              hasNightTheme={!!resExtras?.themeAttrsNight && Object.keys(resExtras.themeAttrsNight).length > 0}
              previewLocale={previewLocale}
              onPreviewLocale={setPreviewLocale}
              locales={Object.keys(resExtras?.stringsByLocale ?? {}).sort()}
              showSystemBars={showSystemBars}
              onShowSystemBars={setShowSystemBars}
              showIssues={showIssues}
              onShowIssues={setShowIssues}
              editorTheme={editorTheme}
              onEditorTheme={patchEditorTheme}
              onEditorColor={patchEditorColor}
              onResetEditorTheme={resetEditorTheme}
              onSaveXml={saveProject}
            />
          )}

          {leftView === "about" && <AboutPanel version={APP_VERSION} tr={tr} />}
      </LeftRail>

      {/* 右侧属性面板（M25h：搬到 components/Inspector.tsx） */}
      <Inspector
        open={rightOpen}
        onClose={() => setRightOpen(false)}
        node={selectedNode}
        chain={pathChain}
        isChildOfCL={isChildOfCL}
        clSiblings={clSiblings}
        onCommitMany={commitMany}
        onAutoConstrain={runAutoConstrain}
        onClearConstraints={clearConstraints}
        autoNotes={autoNotes}
        onSelectPath={setSelectedPath}
        onCommitAttr={commitAttr}
        onRemoveAttr={removeAttr}
        onAddAttr={() => setAddModalOpen(true)}
        onOpenRef={(v) => void openResRef(v)}
        onFindUsages={(v) => void openUsages(v)}
        onDeleteNode={onRemoveNode}
        resExtras={resExtras}
        onPickIcon={onPickIcon}
        onEditIconResource={(name, iconXml, attr) =>
          setResIcon({ name: name || "ic_icon", xml: iconXml ?? "", attr })
        }
        iconNames={Object.keys(generatedDrawables)}
        onSaveShape={onSaveShape}
        generatedXml={generatedDrawables}
        inspector={{
          tree: treeRoot,
          measured: inspMeasured,
          selectedPath: selectedPath,
          warnings: inspWarnings,
          gotoLine: () => {}, // M186：层级树选中走画布；后续版本再补代码行跳转
        }}
        onInspectSelect={(p) => setSelectedPath(p)}
        tab={rightTab}
        onTab={setRightTab}
        outline={javaOutline}
        outlineName={codeFileName}
        outlineLine={codeCursor}
        onJumpLine={jumpToCodeLine}
      />

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

        {/* M165 并排对比覆盖层 */}
        <ComparePreview
          open={compareOpen}
          onClose={() => setCompareOpen(false)}
          root={parsedDoc.root ?? null}
          resources={resources}
          layouts={resExtras?.layouts}
          theme={renderTheme}
          deviceIds={compareIds}
          onToggleDevice={(id, on) => toggleCompareDevice(id, on)}
        />

      {/* 顶部工具栏（桌面端只占两侧面板之间的画布区，不重叠侧栏） */}
      <Toolbar
        isMobile={isMobile}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onOpenLeft={() => setLeftOpen(true)}
        onOpenRight={() => setRightOpen(true)}
        deviceId={deviceId}
        onChangeDevice={changeDevice}
        scale={scale}
        onScale={setScale}
        onCompare={() => setCompareOpen(true)}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void doSave()}
        onOpenFile={openProject}
        onCopyXml={copyExportedXml}
        showResZip={Boolean(resExtras) || Object.keys(generatedDrawables).length > 0}
        onExportRes={doDownloadResZip}
        canExportProject={!!aiFileIo}
        onExportProject={() => void doExportProject()}
        onExportImage={() => setImgExportOpen(true)}
        hasRes={Boolean(resExtras)}
        onClearRes={clearRes}
        nativeAvailable={nativeAvailable()}
        workspaceLabel={workspaceLabel()}
        onChangeWorkspace={() => {
          if (chooseWorkspace()) {
            setExportNote(tt("已更换保存位置（下次保存生效）"));
            window.setTimeout(() => setExportNote(""), 2400);
          }
        }}
        onRun={() => setRunOpen(true)}
        realRenderAvailable={realRenderAvailable}
        realRenderBusy={realRenderBusy}
        onRealRender={doRealRender}
        onFormat={doFormat}
        onHistory={() => setHistPanelOpen(true)}
        snapCount={snapCount}
        onSign={openSignDialog}
        canSign
      />
      </div>

      {/* M140：历史版本快照面板 */}
      <HistoryPanel
        open={histPanelOpen}
        fileKey={snapFileKey()}
        fileLabel={saveOrigin?.name || wsActiveName || currentFile?.name || ""}
        currentXml={xml}
        onRestore={(next, label) => {
          // 恢复 = 一次普通编辑：进撤销栈，可再 Ctrl+Z 回 当前版
          setHistPanelOpen(false);
          setXmlAndTrack(next);
          flashNote(tt("已恢复到 {t} 的版本", { t: label }), 2600);
        }}
        onClose={() => setHistPanelOpen(false)}
      />

      {/* M141：离开前的未保存提示 */}
      {leaveGuard.dialog}

      {runOpen ? (
        <RunPreview
          entryXml={xml}
          entryName={entryLayoutName}
          layouts={resExtras?.layouts ?? {}}
          resources={resources}
          device={{ label: device.label, w: device.w, h: device.h, radius: device.radius }}
          javaFiles={runJavaFiles}
          onClose={() => setRunOpen(false)}
        />
      ) : null}

      {/* M68（C3）：资源引用列表 */}
      {usesPanel ? (
        <div
          className="axv-uses-mask"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setUsesPanel(null);
          }}
        >
          <div className="axv-uses-card">
            <div className="axv-uses-head">
              <span className="axv-uses-title">{tt("{title} 的引用", { title: usesPanel.title })}</span>
              <span className="axv-uses-count">
                {usesPanel.loading
                  ? tt("扫描中…")
                  : tt("{n} 处 · 扫了 {files} 个文件{mode}", { n: usesPanel.hits.length, files: usesPanel.files, mode: usesPanel.truncated ? tt("（已截断）") : "" })}
              </span>
              <span style={{ flex: 1 }} />
              <button className="axv-uses-x" aria-label={tt("关闭")} onClick={() => setUsesPanel(null)}>
                ✕
              </button>
            </div>
            <div className="axv-uses-list">
              {!usesPanel.loading && usesPanel.hits.length === 0 ? (
                <div className="axv-uses-empty">{tt("没找到引用（可能只在别的模块或依赖库里）")}</div>
              ) : null}
              {usesPanel.hits.map((h) => (
                <button
                  key={`${h.rel}:${h.line}`}
                  className="axv-uses-row"
                  title={`${h.rel}:${h.line}`}
                  onClick={() => {
                    setUsesPanel(null);
                    const src = activeProjectRef.current?.source;
                    if (!src) {
                      setWsMsg(`${h.rel}:${h.line}`);
                      return;
                    }
                    if (openRel === h.rel) {
                      jumpToCodeLine(h.line);
                      return;
                    }
                    void loadEntry(src, {
                      kind: "file",
                      name: h.rel.split("/").pop() || h.rel,
                      rel: h.rel,
                    }).then(() => jumpToCodeLine(h.line));
                  }}
                >
                  <span className="axv-uses-file">{h.rel}</span>
                  <span className="axv-uses-line">L{h.line}</span>
                  <span className="axv-uses-snip">{h.text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
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
                tt("下一步会让你选择保存位置（系统选择器里可以新建文件夹）。生成的形状、图标等依赖资源会一起写进 drawable/，values 写进 values/。"),
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

      {/* M201：文件被外部改过 → 写入前拦一道 */}
      {conflict ? (
        <div
          className="axv-saveas-mask"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConflict(null);
          }}
        >
          <div className="axv-saveas-card" role="dialog" aria-modal="true" aria-label={tt("文件已被外部修改")}>
            <div className="axv-saveas-title">{tt("文件已被外部修改")}</div>
            <div className="axv-saveas-hint">
              {tt("磁盘上的内容和上次保存的不一样（可能是 Android Studio、git 或别的工具改过）。直接保存会把那些改动整段覆盖掉。")}
            </div>
            <code className="axv-conflict-path">{conflict.rel}</code>
            <div className="axv-saveas-subhint">
              {tt("从第 {n} 行开始不一致 · 磁盘 {a} 行 / 编辑器 {b} 行", {
                n: firstDiffLine(conflict.disk, conflict.mine),
                a: conflict.disk ? conflict.disk.split("\n").length : 0,
                b: conflict.mine ? conflict.mine.split("\n").length : 0,
              })}
            </div>
            <div className="axv-saveas-btns">
              <button className="axv-set-btn" onClick={() => setConflict(null)}>
                {tt("取消")}
              </button>
              <button
                className="axv-set-btn"
                onClick={() => {
                  const c = conflict;
                  setConflict(null);
                  c.loadDisk?.();
                }}
              >
                {tt("载入磁盘版本")}
              </button>
              <button
                className="axv-set-btn axv-saveas-ok"
                onClick={() => {
                  const c = conflict;
                  setConflict(null);
                  c.retry();
                }}
              >
                {tt("覆盖保存")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* M24：新建项目对话框 */}
      {newProjOpen ? (
        <div
          className="axv-saveas-mask"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setNewProjOpen(false);
          }}
        >
          <div className="axv-saveas-card">
            <div className="axv-saveas-title">{tr("proj.newTitle", "新建项目")}</div>
            <div className="axv-saveas-hint">
              {tr(
                "proj.newHint",
                tt("会在工作目录里直接建出完整工程：项目名/app/src/main/{java,res,AndroidManifest.xml} + gradle 文件。不选图标就用默认自适应图标。"),
              )}
            </div>
            <label className="axv-saveas-field">
              <span>{tr("proj.newName", "项目名")}</span>
              <input
                className="axv-saveas-input axv-newproj-input"
                value={newProjName}
                autoFocus
                spellCheck={false}
                placeholder="MyApp"
                onChange={(e) => setNewProjName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createNewProject(newProjName, newProjPkg);
                  if (e.key === "Escape") setNewProjOpen(false);
                }}
              />
            </label>
            {/* M176：包名（选填，留空按项目名自动 com.example.xxx） */}
            <label className="axv-saveas-field">
              <span>{tr("proj.newPkg", "包名")}</span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  className="axv-saveas-input"
                  style={{ flex: 1 }}
                  value={newProjPkg}
                  spellCheck={false}
                  placeholder={`com.example.${safeProjectName(newProjName).toLowerCase().replace(/_+/g, "")}`}
                  onChange={(e) => setNewProjPkg(e.target.value)}
                />
                {newProjPkg ? (
                  <button
                    type="button"
                    className="axv-ws-link"
                    title={tr("proj.newPkgReset", "清空，按项目名自动生成")}
                    onClick={() => setNewProjPkg("")}
                  >
                    {tr("proj.newPkgReset", "清空")}
                  </button>
                ) : null}
              </div>
              <span className="axv-saveas-subhint">
                {tr(
                  "proj.newPkgHint",
                  tt("选填。留空则按项目名自动生成 com.example.{name}，写进 build.gradle 的 namespace / applicationId。"),
                )}
              </span>
            </label>
            {/* M31i：项目图标（不选就是默认自适应图标） */}
            <div className="axv-saveas-field axv-newproj-iconrow">
              <span>{tr("proj.newIcon", "项目图标")}</span>
              <div className="axv-newproj-iconbox">
                <span className="axv-newproj-iconprev" aria-hidden="true">
                  {newProjIcon ? (
                    <img src={newProjIcon.dataUrl} alt="" />
                  ) : (
                    <img src={DEFAULT_ICON_URL} alt="" />
                  )}
                </span>
                <label className="axv-set-btn axv-newproj-iconpick">
                  {tr("proj.newPickIcon", "选图片…")}
                  <input
                    type="file"
                    accept="image/png,image/webp,image/jpeg"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (!f) return;
                      if (f.size > 2 * 1024 * 1024) {
                        setExportNote(tt("图标建议小于 2MB"));
                        window.setTimeout(() => setExportNote(" "), 3000);
                        return;
                      }
                      const reader = new FileReader();
                      reader.onload = () => {
                        const dataUrl = String(reader.result || "");
                        const comma = dataUrl.indexOf(",");
                        if (comma < 0) return;
                        setNewProjIcon({
                          dataUrl,
                          base64: dataUrl.slice(comma + 1),
                          mime: f.type || "image/png",
                        });
                      };
                      reader.readAsDataURL(f);
                    }}
                  />
                </label>
                {newProjIcon ? (
                  <button className="axv-ws-link" onClick={() => setNewProjIcon(null)}>
                    {tr("proj.newIconReset", "用默认")}
                  </button>
                ) : (
                  <span className="axv-newproj-icontip">{tr("proj.newIconTip", "默认图标")}</span>
                )}
              </div>
            </div>
            <div className="axv-saveas-btns">
              <button className="axv-set-btn" onClick={() => setNewProjOpen(false)} disabled={newProjBusy}>
                {tr("save.cancel", "取消")}
              </button>
              <button
                className="axv-set-btn axv-saveas-ok axv-newproj-ok"
                onClick={() => void createNewProject(newProjName, newProjPkg)}
                disabled={newProjBusy || (newProjPkg.trim() !== "" && validatePackageName(newProjPkg) !== null)}
              >
                {newProjBusy ? tr("proj.newBusy", "创建中…") : tr("proj.newOk", "创建项目")}
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

      {/* M90：配色方案编辑子页（改界面 token + 代码编辑器 4 个颜色） */}
      {signDialogOpen && (
        <SigningDialog
          gradleText={gradleForSign}
          rootMissing={signRootMissing}
          keystoreExists={signKeystoreExists}
          appName={signAppName}
          iconDefault={signIconDefault}
          pkg={activeProject?.name ? packageOf(activeProject.name) : undefined}
          onMakeKeystore={makeKeystoreOnDevice}
          onBuildApk={doBuildApk}
          apkBusy={apkBusy}
          apkResult={apkResult}
          onInstallApk={(p) => {
            const r = installApk(p);
            setExportNote(r.ok ? tt("已调起系统安装器") : tt("安装失败：{msg}", { msg: r.msg || "" }));
          }}
          onWriteGradle={writeGradleForSign}
          stored={signStored}
          onRemember={(s) => writeStoredSigning(activeProject?.name, s)}
          onShareApk={(p) => {
            const r = shareApkFile(p);
            setExportNote(r.ok ? tt("已调起分享") : tt("分享失败：{msg}", { msg: r.msg || "" }));
          }}
          onForget={() => {
            clearStoredSigning(activeProject?.name);
            setSignStoredRev((v) => v + 1);
            setExportNote(tt("已清除本机记住的签名配置"));
          }}
          onClose={() => setSignDialogOpen(false)}
          onNote={(m, ms = 2400) => {
            setExportNote(m);
            window.setTimeout(() => setExportNote(""), ms);
          }}
        />
      )}
      {editingTheme ? (
        <ThemeEditor
          presetId={editingTheme}
          mode={theme}
          onMode={setTheme}
          overrides={themeOverrides[editingTheme]?.[theme] ?? {}}
          onChangeToken={patchThemeToken}
          onResetToken={resetThemeToken}
          onResetPreset={resetThemePreset}
          editorTheme={editorTheme}
          onEditorTheme={patchEditorTheme}
          onEditorColor={patchEditorColor}
          onClose={() => setEditingTheme(null)}
        />
      ) : null}

      {/* M4u：资源树里的 drawable xml → 绘制编辑器（保存回写 generatedDrawables） */}
      {resShape ? (
        <ShapeEditor
          attrName="background"
          value={`@drawable/${resShape.name}`}
          existingXml={resShape.xml}
          existingNames={allDrawableNames}
          forceTree={resShape.forceTree}
          res={resExtrasAll}
          io={aiFileIo}
          docRel={openRel}
          onClose={() => setResShape(null)}
          onSave={(resourceName, shapeXml) => {
            const safe = sanitizeResName(resourceName, "bg");
            setGeneratedDrawables((m) => ({ ...m, [safe]: shapeXml }));
            setResShape(null);
            const file = safe + ".xml";
            // M172：有打开的项目就直接写进它的 res/drawable，不只存内存
            if (projRoot) {
              void saveResFiles(projRoot, [{ path: `drawable/${file}`, text: shapeXml }]).then((r) => {
                flashNote(
                  r.ok
                    ? tt("已保存 res/drawable/{file}，已写入项目 res 目录", { file })
                    : tt("已保存到内存，但写入项目失败：{reason}", {
                        reason: r.failed[0] || tt("目录不可写"),
                      }),
                  4200,
                );
              });
            } else {
              setExportNote(tt("已保存 res/drawable/{file}", { file }));
              window.setTimeout(() => setExportNote(" "), 3200);
            }
          }}
        />
      ) : null}

      {/* M11j：生成的图标 → 图标编辑器（颜色 / 尺寸 / 路径 / 旋转） */}
      {resIcon ? (
        <IconCanvasEditor
          name={resIcon.name}
          xml={resIcon.xml}
          existingNames={allDrawableNames}
          onClose={() => setResIcon(null)}
          initialAppIcon={appIconInit ?? undefined}
          onAppIcon={({ files, bgColor, contentDp }) => {
            // M171：把 4 个图标文件存起来（给 res.zip / 真机渲染用），有项目就直接写进它的 res/
            const map: Record<string, string> = {};
            for (const f of files) map[f.path] = f.text;
            setAppIconRes(map);
            // M174：记住上次的参数，刷新/重开后面板直接显示
            lsSet(LS_KEY_APP_ICON, JSON.stringify({ bgColor, contentDp }));
            const total = files.length;
            if (projRoot) {
              void saveResFiles(
                projRoot,
                files.map((f) => ({ path: f.path, text: f.text })),
              ).then((r) => {
                setExportNote(
                  r.ok
                    ? tt("已设为应用图标：{n}/{total} 个文件写入 res/（背景 {color}）", {
                        n: r.written,
                        total: r.total,
                        color: bgColor,
                      })
                    : tt("生成成功但写入失败：{reason}", {
                        reason: r.failed[0] || tt("目录不可写"),
                      }),
                );
                window.setTimeout(() => setExportNote(""), 6000);
              });
            } else {
              setExportNote(
                tt("已生成 {n} 个图标文件（背景 {color}），导 res.zip 或真机渲染时一起带走", {
                  n: total,
                  color: bgColor,
                }),
              );
              window.setTimeout(() => setExportNote(""), 6000);
            }
          }}
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
            const file = safeName + ".xml";
            // M172：有打开的项目就直接写进它的 res/drawable，不只存内存
            if (projRoot) {
              void saveResFiles(projRoot, [{ path: `drawable/${file}`, text: iconXml }]).then((r) => {
                setExportNote(
                  r.ok
                    ? tt("已保存 res/drawable/{file}，已写入项目 res 目录", { file })
                    : tt("已保存到内存，但写入项目失败：{reason}", {
                        reason: r.failed[0] || tt("目录不可写"),
                      }),
                );
                window.setTimeout(() => setExportNote(""), 4200);
              });
            } else {
              setExportNote(tt("已保存 res/drawable/{file}", { file }));
              window.setTimeout(() => setExportNote(" "), 3200);
            }
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

      {/* M193：底部状态条不再单独渲染，已合并进 ProblemsDrawer 的把手条（20px） */}
    </div>
  );
}
