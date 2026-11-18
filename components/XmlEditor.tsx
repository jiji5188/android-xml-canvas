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
import { buildResourceExtras, backfillDrawableXml, type ResourceExtras, type ResTreeDir, type ResTreeFile } from "@/lib/xml/resdir";
import { loadProjectResForDoc, loadProjectResIndexCached, mergeProjectExtras, invalidateProjectRes } from "@/lib/xml/project-res";
import { collectProjectDex, numberDexFiles } from "@/lib/xml/project-dex";import { loadProjectJavaFiles } from "@/lib/xml/java-files";
import { buildLexicon, type Lexicon } from "@/lib/xml/lexicon";
import { loadSdkLexicon, mergeSdkLexicon } from "@/lib/xml/sdk-lexicon";
import { collectProjectLibs, collectSharedLibs } from "@/lib/xml/project-libs";
import { indexLibsCached, mergeThirdLexicon } from "@/lib/xml/lib-index";
import { collectDeclaredMethods } from "@/lib/xml/java-methods";
import { findLauncherActivity } from "@/lib/xml/find-launcher";
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
import { loadBaseline, planWrite, saveBaseline, snapshotBeforeWrite } from "@/lib/xml/safe-write";
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
import { withCurrentSource, withCurrentXml } from "@/lib/xml/editor-buffer";
import { useEditorState } from "./editor-state";
import { useBuildApk } from "./use-build-apk";
import { installApk, shareApkFile, hasBuildApk, type BuildApkResult } from "@/lib/xml/native-apk";
import { parseGradlePackage } from "@/lib/xml/project-info";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { ThemePickerPanel } from "./ThemePickerPanel";
import { openThemePreviewNative } from "@/lib/xml/theme-preview-bridge";
import { writeThemeIntoValues, type AndroidThemePreset } from "@/lib/xml/android-theme-presets";
import { projectSaveRoot, projectFileExists, readProjectFile, readAppGradle, saveProjectFile, saveResFiles, resAbs, RES_PREFIX } from "@/lib/xml/project-save";
import { parseAppIconConfig } from "@/lib/xml/app-icon";
import { nativeBridge } from "@/lib/xml/native-save";
import { codeOnlyNotice, detectDocKind, looksLikeJavaSource, looksLikeKotlin } from "@/lib/xml/doc-kind";
import { isValuesPath } from "@/lib/xml/doc-kind";
import { looksLikeValuesDoc, topLevelNamesFromFiles } from "@/lib/xml/values-edit";
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
  wsOpenProject,
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
export type ActiveProject = {
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
  type ProjectFile,
} from "@/lib/xml/multi-file";
import { NEW_FILE_CATEGORIES, findCategory, findTemplate, renderTemplate, companionLayoutName, LAYOUT_BLANK_LL_EXPORT, type NewFileCategory } from "@/lib/xml/new-file";
import { useNewFileDialog } from "./use-new-file-dialog";
import { useSigning } from "./use-signing";
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
import { loadPluginEnabled, togglePluginEnabled, type PluginEnabledMap } from "@/lib/plugin/store";
import { installPlugin, loadInstalledPlugins, type InstalledPlugin } from "@/lib/plugin/installer";
import { BUILTIN_COMPILER } from "@/lib/plugin/compiler";
import { useEditorTheme } from "./use-editor-theme";
import { useCanvasZoom } from "./use-canvas-zoom";
import { useCanvasAssets } from "./use-canvas-assets";
import { useDiffHistory } from "./use-diff-history";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";
import { SaveAsDialog, ConflictDialog } from "./SmallDialogs";
import { useFileImport } from "./use-file-import";
import { useProjectCreate } from "./use-project-create";
import { useProjectRename } from "./use-project-rename";
import { useSaveDomain } from "./use-save-domain";
import { useExportRender } from "./use-export-render";
import { NewProjectDialog } from "./NewProjectDialog";
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
import { PluginEditorHost } from "./PluginEditorHost";
import { ResourcePanel } from "./ResourcePanel";
import { renameAsset, renameReferences } from "@/lib/xml/asset-refs";
import { findResolvedNode, splitPath, stripNs, collectIds } from "@/lib/xml/paths";
import { pxNum, boxOf } from "@/lib/xml/geom";
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
import { readLastRel, writeLastRel } from "@/lib/xml/last-rel";
import { SAMPLES } from "@/lib/xml/samples";

import { RunPreview } from "./RunPreview";
import { Toolbar } from "./Toolbar";
import { SigningDialog } from "./SigningDialog";
import { ApkRepackDialog } from "./ApkRepackDialog";
import { readSigningFromGradle } from "@/lib/xml/signing";
import { LeftRail, type LeftView } from "./LeftRail";
import { LibsPanel } from "./LibsPanel";
import { ProblemsDrawer } from "./ProblemsDrawer";
import { useBuildLogs } from "./use-build-logs";
import { usePanels } from "./use-panels";
import { useXmlProjectState } from "./use-xml-project";
import { useXmlProjectFns } from "./use-xml-project-fns";
import { useIconShapeActions } from "./use-icon-shape-actions";
import { useSelectionOps } from "./use-selection-ops";
import { useLints } from "./use-lints";
import { useCanvasOps } from "./use-canvas-ops";
import { useCanvasRender } from "./use-canvas-render";
import { useSaveExport } from "./use-save-export";
import {
  subscribeRuntimeLog,
  installRuntimeLogBridge,
  clearRuntimeLog,
  type RuntimeLogEntry,
} from "@/lib/xml/runtime-log";
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
  /** M366（路线 2）：共享核心 state 下沉到 useEditorState，壳/各组都读 E */
  const E = useEditorState(bootRef.current!);
  const { xml, setXml, project, setProject, resExtras, setResExtras, resCacheRev, bumpResCache, docRef, liveXmlRef, xmlSyncTimer, setXmlAndTrackRef, currentXml, flushXml } = E;

  /* ===== M57：编辑器 → React 的同步改成「常驻 ref + 防抖落状态」 =====
   * 旧行为：每个按键都 setXml(整份文档) → 这个 3000+ 行的组件整棵树重渲染
   * （ProjectPanel / AttrPanel / LayerTree / Toolbar 全跟着渲染）→ 大文件必然卡。
   * 新：最新文本先进 liveXmlRef（同步、零成本），setXml 防抖 250ms；
   * 保存/格式化/切 tab/撤销前先 flushXml()，保证拿到的是最新内容。
   * 这也是 VS Code（Monaco）/ CM6 官方 React 包的做法：文档真相在编辑器里，React 只拿快照。
   * （M366：state/refs 已下沉到 useEditorState，见上方 E） */

  const currentFile = activeFile(project);
  /** M290：多文件 tab 面板 —— 每个项目文件一个 tab，名字就是文件名；点 tab 切换当前文件。
   *  取代原来的「文件切换 / 示例项目」两个 select（窄屏放不下且操作藏得深）。
   *  M291：长按 / 右键 tab 弹上下文菜单（保存 / 重命名 / 关闭 / 删除）。 */
  const fileTabs = (
    <div className="axv-filetabs" role="tablist" aria-label={tt("项目文件")}>
      {project.files.map((f) => (
        <button
          key={f.id}
          type="button"
          role="tab"
          aria-selected={f.id === project.activeId}
          className={"axv-filetab" + (f.id === project.activeId ? " on" : "")}
          title={f.name}
          onClick={() => {
            selectFile(f.id);
            setMobileTab("xml");
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            openFileTabMenu(f.id, f.name, e.clientX, e.clientY);
          }}
          onPointerDown={(e) => {
            // 长按 500ms 触发（移动端主要交互；桌面端右键也能触发）
            if (e.pointerType === "mouse") return;
            const start = { x: e.clientX, y: e.clientY };
            const timer = window.setTimeout(() => {
              openFileTabMenu(f.id, f.name, start.x, start.y);
            }, 500);
            const cancel = () => {
              window.clearTimeout(timer);
              window.removeEventListener("pointerup", cancel);
              window.removeEventListener("pointercancel", cancel);
              window.removeEventListener("pointermove", move);
            };
            const move = (ev: PointerEvent) => {
              if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > 12) cancel();
            };
            window.addEventListener("pointerup", cancel);
            window.addEventListener("pointercancel", cancel);
            window.addEventListener("pointermove", move);
          }}
        >
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>description</span>
          <span className="axv-filetab-name">{f.name}</span>
        </button>
      ))}
      <button
        type="button"
        className="axv-filetab-act"
        title={tt("新建文件")}
        aria-label={tt("新建文件")}
        onClick={() => newFile()}
      >
        <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>add</span>
      </button>
    </div>
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
  /** 上传 res/ 目录解析出的附加资源（drawable/vector/styles/values 原文）—— M366：已下沉到 useEditorState，见上方 E */
  /** M210c：资源索引缓存世代—— M366：已下沉到 useEditorState */
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
  /** M101：提示条统一入口 —— 连续弹提示时先清掉上一个定时器，避免旧定时器把新提示提前抹掉
   *  M366：上移到 439 行（hook 调用点之前），消除 useSelectionOps/useExportRender 等 getter 延迟 Proxy 的 TDZ 风险 */
  const flashNote = (msg: string, ms = 3600) => {
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current);
    setExportNote(msg);
    noteTimerRef.current = window.setTimeout(() => setExportNote(""), ms);
  };
  // M304：画布资产/设备/面板状态域（resIcon/resShape/resImage + device + 锁定 + 面板开合）→ components/use-canvas-assets.ts
  const { resIcon, setResIcon, resShape, setResShape, resImage, setResImage, deviceId, device, changeDevice, leftOpen, setLeftOpen, rightOpen, setRightOpen, leftView, setLeftView, lockedPaths, toggleLockPath, isPathLocked } = useCanvasAssets();
  /* ===== M16i：工作目录 ===== */
  /** M366：弹窗/面板 UI state → components/use-panels.ts（前移：setWsMsg 要给 useXmlProjectState 用） */
  const {
    histPanelOpen, setHistPanelOpen, snapCount, setSnapCount,
    wsActiveName, setWsActiveName, wsMsg, setWsMsg,
    addModalOpen, setAddModalOpen, exportOpen, setExportOpen,
    compareOpen, setCompareOpen, compareIds, toggleCompareDevice,
    exportReport, setExportReport, exportMode, setExportMode,
    imgExportOpen, setImgExportOpen, exportAction, setExportAction,
    dropHint, setDropHint, runOpen, setRunOpen,
  } = usePanels();
  /** M366：项目管理/工作区 state → components/use-xml-project.ts */
  const {
    projectTab, setProjectTab, wsState, setWsState, wsProjects, setWsProjects,
    activeProject, setActiveProject, projectRev, setProjectRev, projMeta, setProjMeta,
    newProjOpen, setNewProjOpen, newProjName, setNewProjName, newProjIcon, setNewProjIcon,
    newProjPkg, setNewProjPkg, newProjBusy, setNewProjBusy, saveOrigin, setSaveOrigin,
    analyzeProjects, wsBusy, setWsBusy, refreshWorkspace, pickCustomDir, useDefaultDir,
  } = useXmlProjectState({ leftView, setWsMsg });
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

  /** M366：弹窗/面板 UI state → usePanels 已在上方（M16i 区域）调用，此处不再重复 */
  /** M37：代码编辑器外观（光标/选区/高亮/字号，localStorage 记住）→ use-editor-theme */
  const {
    editorTheme, patchEditorTheme, resetEditorTheme, patchEditorColor,
    theme, setTheme, themePreset, setThemePreset, themeOverrides, setThemeOverrides,
    editingTheme, setEditingTheme, renderTheme, setRenderTheme, showSystemBars, setShowSystemBars,
    previewNight, setPreviewNight, previewLocale, setPreviewLocale,
    patchThemeToken, resetThemeToken, resetThemePreset,
  } = useEditorTheme();
  /** M37b：当前打开的工程内相对路径（判断是不是布局文件，以及非布局文件写回哪里） */
  const [openRel, setOpenRel] = useState<string | null>(null);
  // M219c：当前打开文件的路径（ref 版，供同步回调闭包读最新值）
  const openRelRef = useRef<string | null>(null);
  useEffect(() => {
    openRelRef.current = openRel;
  }, [openRel]);
  /** 兼容模式的转换摘要（选 compat 时重算） */
  const [compatNotes, setCompatNotes] = useState<string[]>([]);
  /** M6a：导出预览图（PNG / SVG）弹窗 */
  /** M366：imgExportOpen/exportAction/dropHint/runOpen 已下沉到 usePanels，见下方解构 */
  /** 手机壳 DOM（导出图片要拿它做 DOM → SVG/PNG） */
  const phoneRef = useRef<HTMLDivElement | null>(null);
  /** M199：运行调试时加载的 Java/Kotlin 源码（轻量逻辑仿真用） */
  const [runJavaFiles, setRunJavaFiles] = useState<{ rel: string; text: string }[]>([]);
  /** M351：项目里所有文件声明过的方法名（含其它文件）—— 自己类里实现的 getTitle() 不应被当成 setTitle() 的拼写错 */
  const [projMethods, setProjMethods] = useState<string[]>([]);
  /** M352：项目词库（单一数据源）—— 建好塞进 CodeEditor 的 lexRef；空库 = 旧行为 */
  const lexRef = useRef<Lexicon | null>(null);
  /** M2：词库就绪/更新计数（ref 变化不触发渲染，用它在 lint useMemo 依赖里重算） */
  const [lexRev, setLexRev] = useState(0);
  /** M199：当前布局名（Java 仿真按它挑 Activity）；开的是代码文件时退回 activity_main */
  const entryLayoutName = useMemo(() => {
    const seg = (openRel || "").replace(/\\/g, "/").split("/").pop() || "";
    if (!/\.xml$/i.test(seg)) return "activity_main";
    return seg.replace(/\.xml$/i, "") || "activity_main";
  }, [openRel]);

  const [showIssues, setShowIssues] = useState(true);

  // M233：内置编辑器插件的启用状态（drawable / icon）。关掉后资源树点对应类型回退代码编辑。
  const [pluginEnabled, setPluginEnabled] = useState<PluginEnabledMap>(loadPluginEnabled);
  const onTogglePlugin = (id: string, on: boolean) =>
    setPluginEnabled((cur) => togglePluginEnabled(id, on, cur));

  // M234：第三方插件安装
  const [installedPlugins, setInstalledPlugins] = useState<InstalledPlugin[]>([]);
  const [installBusy, setInstallBusy] = useState(false);
  const [installNote, setInstallNote] = useState("");
  // 启动时把 IndexedDB 里已装的插件重新加载 + 注册
  useEffect(() => {
    let alive = true;
    loadInstalledPlugins().then((list) => {
      if (alive) setInstalledPlugins(list);
    });
    

  return () => {
      alive = false;
    };
  }, []);

  // M235：编译器插件（内置）
  const [compilerInfo, setCompilerInfo] = useState({ id: BUILTIN_COMPILER.id, name: BUILTIN_COMPILER.name, language: BUILTIN_COMPILER.language, version: BUILTIN_COMPILER.version, source: BUILTIN_COMPILER.source });
  const [compilerBusy, setCompilerBusy] = useState(false);
  const [compilerNote, setCompilerNote] = useState("");
  const onCheckCompilerUpdate = () => {
    setCompilerBusy(true);
    setCompilerNote("");
    import("@/lib/plugin/compiler").then(({ fetchCompilerInfo }) => {
      fetchCompilerInfo()
        .then((info) => {
          if (info) {
            setCompilerInfo({ ...info, source: info.version !== "3.33.0" ? "remote" : "builtin" });
            setCompilerNote(
              info.version === "3.33.0"
                ? tt("已是最新版本 v{v}", { v: info.version })
                : tt("发现新版本 v{v}（APK 端下载后重启生效）", { v: info.version })
            );
          } else {
            setCompilerNote(tt("拉取 manifest 失败，检查网络"));
          }
        })
        .catch(() => setCompilerNote(tt("拉取 manifest 失败")))
        .finally(() => setCompilerBusy(false));
    }).catch(() => setCompilerBusy(false));
  };
  const onInstallPlugin = (manifestUrl: string): Promise<void> => {
    setInstallBusy(true);
    setInstallNote("");
    return installPlugin(manifestUrl)
      .then((p) => {
        setInstalledPlugins((cur) => (cur.some((x) => x.id === p.id) ? cur.map((x) => (x.id === p.id ? p : x)) : [...cur, p]));
        setInstallNote(tt("已安装：{name}", { name: p.name }));
        setPluginEnabled((cur) => ({ ...cur, [p.id]: true }));
      })
      .catch((e: unknown) => {
        const msg = String((e as Error)?.message || e);
        setInstallNote(msg);
        throw new Error(msg); // 让弹窗也能 catch
      })
      .finally(() => setInstallBusy(false));
  };

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

  // M25d/M31 项目分析（analyzeProjects + analyzed/analyzing refs）已下沉 → components/use-xml-project.ts
  // M309：工作目录刷新/12s 轮询/恢复上次项目 + 手选/默认目录 也已下沉 → components/use-xml-project.ts

  // M30b：默认落在「XML 代码」tab
  const [mobileTab, setMobileTab] = useState<"preview" | "xml" | "values">("xml");

  // M303：画布缩放域（scale/zoomHud/手势/快捷键）→ components/use-canvas-zoom.ts
  const { scale, setScale, scaleRef, stageRef, zoomAnchor, zoomHud, setZoomHud, applyZoom } =
    useCanvasZoom({ phoneRef, mobileTab });

  /** M56：代码 tab 时不需要渲染模型 —— 只在 preview/values 视图才把解析结果交给渲染管线，
   *   这样代码 tab 连续打字时 parse/buildRenderModel/实测回路全不跑（代码高亮不受影响，
   *   那是 CM6 自己的增量解析器，跟这条管线无关）。切回预览/停手后才重新算。 */
  const previewActive = mobileTab === "preview" || mobileTab === "values";
  const parsedForRender = previewActive ? parsedXml : "";


  // M305：diff 撤销/重做域 → components/use-diff-history.ts
  const { histInfo, histRef, textTimer, syncHist, lastCommitRef, commitHistory, flushTextTimer, canUndo, canRedo, commitPendingText, undo, redo } = useDiffHistory({ setXml, liveXmlRef, flushXml });

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

  // M306：键盘快捷键 → components/useKeyboardShortcuts.ts
  useKeyboardShortcuts(() => ({
    undo,
    redo,
    save: saveProject,
    format: doFormat,
    copy: copySelection,
    paste: pasteSelection,
    duplicate: duplicateSelection,
    group: groupSelection,
    ungroup: ungroupSelection,
    selectedPath,
  }));

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

  /** M3g/M3h/M366：图标/形状资源动作（onPickIcon/onSaveShape/onFillIconAttr）→ components/use-icon-shape-actions.ts（延迟 Proxy 避开 commitAttrRef/flashNote TDZ） */
  const { onPickIcon, onSaveShape, onFillIconAttr } = useIconShapeActions(() => ({
    setGeneratedDrawables,
    selectedPath,
    commitAttrRef,
    activeProject,
    setExportNote,
    flashNote,
  }));

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
  // M255：文件名不可靠/缺失时，按内容嗅探 Java/Kotlin（否则 .kt 代码会被 XML 规则跑 → 「非法标签名」误报）
  const isJavaByContent = useMemo(() => looksLikeJavaSource(xml), [xml]);
  const isJavaFile = useMemo(
    () => isJavaLikePath(codeFileName) || (isJavaByContent && !/\.(xml|layout|drawable|menu|values)\b/i.test(codeFileName)),
    [codeFileName, isJavaByContent],
  );
  const isKotlinLike = useMemo(
    () => (/\.kts?$/i.test(codeFileName) ? true : looksLikeKotlin(xml) && isJavaByContent),
    [codeFileName, xml, isJavaByContent],
  );
  const javaOutline = useMemo(
    () => (isJavaFile ? parseOutline(xml, isKotlinLike) : undefined),
    [isJavaFile, xml, isKotlinLike],
  );
  /** 代码编辑器光标行（函数列表里高亮「你在这儿」） */
  const [codeCursor, setCodeCursor] = useState(0);
  /** M2y：光标行 → 画布反跳时置 true，避免画布选中再反拖编辑器（M366：上移到 useLints 调用点之前，避 Proxy 渲染期 evaluate 撞 TDZ） */
  const fromCodeRef = useRef(false);
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
  /** M351：编辑代码文件时把项目里其它文件的方法声明收集起来（拼写检查豁免用）。
   *  只在看代码时扫、项目/保存变化才重扫，不会随着打字反复读盘。 */
  const projRootKey = activeProject?.rootPath || activeProject?.dirPath || "";
  useEffect(() => {
    if (!isJavaFile) return;
    let cancelled = false;
    void (async () => {
      try {
        const files = await loadProjectJavaFiles(aiFileIo, 12, { nativeRoot: projRootKey || null });
        if (cancelled) return;
        const names = new Set<string>();
        for (const f of files) collectDeclaredMethods(f.text, names);
        setProjMethods([...names]);
        // M352：同一份文件建项目词库（单一数据源）
        const src = files
          .filter((f) => /\.(java|kt)$/i.test(f.rel))
          .map((f) => ({
            rel: f.rel,
            text: f.text,
            lang: (/\.kt$/i.test(f.rel) ? "kotlin" : "java") as "java" | "kotlin",
          }));
        const nextLex = buildLexicon(src);
        // M2：合并 SDK 预消化词库（项目同名类优先，不污染）——SDK 方法/类名也能进候选
        const sdkLex = await loadSdkLexicon();
        if (cancelled) return;
        const merged = sdkLex ? mergeSdkLexicon(nextLex, sdkLex) : nextLex;
        lexRef.current = merged.allMethodNames.size > 0 ? merged : null;
        setLexRev((v) => v + 1);
        // M2b：第三方库索引（较慢，后台补上；同项目库不变就命中缓存）
        if (!cancelled) {
          try {
            const libsRes = await collectProjectLibs(aiFileIo, projRootKey || null);
            if (cancelled) return;
            // M362：共享库 /AndroidUIIDE/libs 也进候选词库（跨项目复用的库符号）
            const sharedLibs = await collectSharedLibs();
            const allLibs = [...libsRes.libs, ...sharedLibs];
            if (allLibs.length) {
              const third = await indexLibsCached(projRootKey || "-", allLibs);
              if (cancelled) return;
              const base = lexRef.current ?? merged;
              const withThird = mergeThirdLexicon(base, third.lex);
              lexRef.current = withThird.allMethodNames.size > 0 ? withThird : lexRef.current;
              setLexRev((v) => v + 1);
            }
          } catch {
            /* 库索引失败不致命，词库保持 SDK+项目 */
          }
        }
      } catch {
        if (!cancelled) {
          setProjMethods([]);
          lexRef.current = null;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isJavaFile, aiFileIo, projRootKey, projectRev]);

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
        const files = await loadProjectJavaFiles(aiFileIo, 8, {
          nativeRoot: activeProject?.rootPath || activeProject?.dirPath || null,
        });
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

  /** M293：切到某个文件 tab 后，同步外部来源状态（openRel / saveOrigin） */
  const applyExternalState = useCallback((f: ProjectFile | undefined) => {
    if (!f) return;
    if (f.ext?.rel) {
      setOpenRel(f.ext.rel);
      if (f.ext.target) setSaveOrigin({ kind: "native", target: f.ext.target, name: f.name });
      else if (f.ext.handle) setSaveOrigin({ kind: "handle", handle: f.ext.handle, name: f.name });
      else setSaveOrigin(null);
    } else {
      setOpenRel(null);
      setSaveOrigin(null);
    }
  }, []);

  /** M293：活动文件变化时，把外部来源（openRel / saveOrigin）同步到当前文件 */
  useEffect(() => {
    applyExternalState(activeFile(project));
  }, [project.activeId, applyExternalState]);

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
    /** M138/M177/M202/M366：代码视图结构检查域（lintSrc + resEnv + lints + lintErrCount +
   *  onCodeCursorLine + doFixOne）→ components/use-lints.ts（延迟 Proxy 避开 fromCodeRef TDZ） */
  const {
    lintSrc, setLintSrc, lints, lintErrCount, onCodeCursorLine, doFixOne,
  } = useLints(() => ({
    xml, resExtras, parsedXml, flushXml, currentXml, setXmlAndTrackRef,
    generatedDrawables, sampleValues,
    docKind, codeOnly, isJavaFile, isKotlinLike, codeFileName,
    openRel, saveOrigin, currentFile, projMethods, lexRef, lexRev,
    setCodeCursor, treeRoot, selectedPath, setSelectedPath, fromCodeRef,
    setExportNote,
  }));

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

  /** M366 step14：画布渲染几何计算域（selectedNode/widthPx/…/fitRatio/shortTag/findResolved）
   *  → components/use-canvas-render.ts（纯计算 + resize；无跨集群纠缠，直接搬）
   *  调用点上移到此（shortTag 在 1257 行 isChildOfCL 被用，早于原 1567 位置） */
  const {
    selectedNode, widthPx, heightPx, PHONE_BORDER, outerW, outerH,
    STATUS_BAR_H, NAV_BAR_H, phoneTheme, phoneBg, phoneFg, vw, fitRatio,
    shortTag, findResolved,
  } = useCanvasRender({
    selectedPath, model, device, isMobile, leftOpen, rightOpen, scale, SCALE, DPX,
  });

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
  /** M336c：签名对话框 state+逻辑 → 抽到 components/use-signing.tsx */
  const signing = useSigning({ activeProject, tt, setExportNote, noteTimerRef });
  const {
    signDialogOpen, setSignDialogOpen,
    gradleForSign, signRootMissing, signKeystoreExists, signAppName, signIconDefault, signStored, setSignStoredRev,
    openSignDialog, makeKeystoreOnDevice, noteTimed, writeGradleForSign, onRemember, onForget,
  } = signing;
  /** M212：导入 APK 换资源重签面板 */
  const [repackOpen, setRepackOpen] = useState(false);


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

    /** M293/M366：项目操作 B 集群函数（loadEntry/openProjectEntry/handlePkgSynced/activateProject/
   *  openWsProject/openProjectDir/refreshActiveProject/applySample/Blank/selectFile/rename/delete/close）
   *  → components/use-xml-project-fns.ts（deps-getter 模式，函数体运行时解引用壳内晚声明 ref） */
  const {
    loadEntry,
    openProjectEntry,
    handlePkgSynced,
    activateProject,
    openWsProject,
    openProjectDir,
    refreshActiveProject,
    applySampleProject,
    applyBlankTemplate,
    selectFile,
    renameActiveFile,
    deleteActiveFile,
    closeActiveFile,
  } = useXmlProjectFns(() => ({
    xml, setXml, project, setProject,
    histRef, syncHist, flushTextTimer,
    setSelectedPath, setExportNote, setOpenRel, setXmlAndTrack, applyExternalState,
    openRelRef, xmlRef, projectRef,
    setGeneratedDrawables, setSampleValues,
    setWsActiveName, setWsMsg,
    activeProjectRef, setSaveOrigin, setActiveProject, setProjectRev, setProjectTab, projMeta,
    refreshWorkspace, setWsBusy, wsState,
  }));

  /** 当前项目的浏览源（用 ref 拿，避免面板回调闭包里拿到旧值） */
  const activeProjectRef = useRef<ActiveProject | null>(null);
  useEffect(() => {
    activeProjectRef.current = activeProject;
  }, [activeProject]);

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

  /** M24/M31i：新建项目 —— 应用内建一个带 activity_main.xml 的项目，
   *  并在工作目录里直接落盘完整 Android 工程结构：项目名/app/src/main/...
   *  M176：pkg 可选（用户手填的包名），缺省 com.example.<项目名> */
  /** M310：新建项目（校验包名 + native/web 双路落盘）→ components/use-project-create.ts */
  const { createNewProject } = useProjectCreate(() => ({
    setExportNote,
    setProject,
    setXmlAndTrack,
    setSelectedPath,
    setSaveOrigin,
    setActiveProject,
    setProjectTab,
    setNewProjOpen,
    setNewProjBusy,
    newProjIcon,
    setNewProjIcon,
    refreshWorkspace,
  }));

  /** M311：改项目名/应用名（真改目录 + 同步 gradle/主题/manifest）→ components/use-project-rename.ts */
  const { renameWsProject } = useProjectRename({
    activeProjectRef,
    setActiveProject,
    setProjectRev,
    setProject,
  });

  /** M294/M336b：新建文件对话框 → 抽出到 components/use-new-file-dialog.tsx */
  const newFileDlg = useNewFileDialog({
    tt, project, setProject, xml, flushTextTimer,
    applyExternalState, setXml, histRef, syncHist, setSelectedPath, setExportNote,
  });
  const { openNewFileMenu, newFile, dialogJsx: newFileDialog } = newFileDlg;

  /** M366 step12：画布编辑操作域（onChangeXmlText + 控件增删改 + 层级 + 属性回写 + 几何）
   *  → components/use-canvas-ops.ts（延迟 Proxy 避开 liveXmlRef/xmlSyncTimer/textTimer 等晚声明 TDZ） */
  const {
    onChangeXmlText, onRenameAsset, onDeleteAsset, assetsNote,
    insertWidget, onDropWidget, onDrop,
    structureBroken, onMoveSibling, onDragMoveNode,
    onRemoveNode, commitAttr, commitAttrRef, onGeometryChange, removeAttr, addAttr,
  } = useCanvasOps(() => ({
    xml, setXml, setXmlAndTrack, flushTextTimer, commitHistory,
    liveXmlRef, xmlSyncTimer, textTimer,
    selectedPath, setSelectedPath,
    generatedDrawables, setGeneratedDrawables,
    setExportNote, setDropHint,
  }));

  /** M308：载入 .xml / 上传 res 目录 → components/use-file-import.ts */
  const { loadXmlFile, onPickRes } = useFileImport(() => ({
    setExportNote,
    project,
    setProject,
    setXmlAndTrack,
    setMobileTab,
    setLeftOpen,
    setRightOpen,
    setFocusLine,
    setFocusTick,
    setResExtras,
  }));

  /** 打开 .xml 文件（弹系统文件选择器）；M141：有未保存改动先问一句 */
    /** M366 step13：打开文件/保存/导出域（openProject/openProjectFile/clearRes/doDownload/currentSaveInput）
   *  → components/use-save-export.ts（延迟 Proxy；currentSaveInput 供 useExportRender/useBuildApk 复用） */
  const {
    openProject, openProjectFile, clearRes, doDownload, currentSaveInput,
  } = useSaveExport(() => ({
    leaveGuard, dirty, pickXmlFile, loadXmlFile, setSaveOrigin,
    setResExtras, setResourceFragment, setSampleValues, resDirRef,
    setExportNote, flashNote,
    codeOnly, downloadLayout, workspaceLabel,
    currentXml, exportMode, saveOrigin, project, generatedDrawables,
    resExtrasAll, appIconRes, LS_KEY_SAMPLE, LS_KEY_RES,
  }));

  /** 清掉已上传的资源，回到内置默认 */
  /** M3g：导出 res 包（zip）：布局 + 图标矢量 + 上传的 shape/values 一起带走，
   *  避免别处打开工程时「找不到图标文件」。*/
  /** M190：导出整个可编译项目（zip）——手机上没有 Gradle/JDK，出 release 包得拿到电脑上，
   *  所以这里把整个项目（含二进制资源）打包，附一份打包说明。 */
  /** M313：导出/真机渲染域（doExportProject / doDownloadResZip / doRealRender）→ components/use-export-render.ts */
  const { doExportProject, doDownloadResZip, doRealRender } = useExportRender(() => ({
    aiFileIo,
    flashNote,
    activeProject,
    setExportNote,
    codeOnly,
    projRoot,
    currentSaveInput,
    bumpResCache,
    openRel,
    realRenderBusy,
    setRealRenderBusy,
    setBuildLogs,
  }));

  /** M366：构建/运行日志 + 抽屉状态 → components/use-build-logs.ts */
  const {
    buildLogs, setBuildLogs, apkForceView, setApkForceView,
    runtimeLogs, setRuntimeLogs, drawerOpen, setDrawerOpen,
    clearRuntimeLogsCb, pushApkBuildLog,
  } = useBuildLogs();

    /** M3：生成正式 Android 布局 XML 并下载。导出前检查：结构错误阻断；语义提示允许忽略继续
   *  M2s：改成可视化检查面板（不再用 alert/confirm） */
  /* ===== M115：画布多选 / 复制 / 粘贴 / 成组 / 解组 ===== */
  /** 当前实际多选集合（主选在前，附加在后；按 path 字典序排序方便成组判定） */
  /** M115/M366：画布多选/剪贴板操作域（selPaths + select/copy/paste/dup/group/ungroup/delete）
   *  → components/use-selection-ops.ts（延迟 Proxy 避开 onRemoveNode/flashNote TDZ） */
  const {
    selPaths, selectPath, validSelPaths, copySelection, pasteSelection,
    duplicateSelection, groupSelection, ungroupSelection, deleteSelection,
  } = useSelectionOps(() => ({
    selectedPath, setSelectedPath, selExtra, setSelExtra,
    xml, clipRef, flashNote, setXmlAndTrack, currentXml, onRemoveNode,
  }));

  /** M115：取消主选时一并取消多选 */
  useEffect(() => {
    if (selectedPath === null && selExtra.length) setSelExtra([]);
  }, [selectedPath, selExtra.length]);

  // M238：打包 hook（放在 currentSaveInput 之后，闭包能拿到 buildSaveInput）
  const { apkBusy, apkResult, doBuildApk } = useBuildApk({
    activeProject,
    gradleForSign,
    signAppName,
    aiFileIo,
    openRel,
    docKind,
    xml,
    buildSaveInput: currentSaveInput,
    noteTimed,
    setExportNote,
    onBuildLog: pushApkBuildLog,
  });

  /** M290：工具栏「打包并运行」—— 默认签名一键打包；doBuildApk 成功后会自动调安装/分享 */
  const doBuildAndRun = useCallback(async () => {
    await doBuildApk({ storeFile: "", storePass: "", alias: "", keyPass: "" });
  }, [doBuildApk]);


  /** M36：当前打开项目的可写根（有则保存一律落进 <项目>/app/src/main/res/） */
  const projRoot = useMemo(() => projectSaveRoot(activeProject), [activeProject]);

  /** M316：主题选择页——把选中预设写进 themes.xml（没有则新建），写完刷新资源索引 */
  const [themeApplying, setThemeApplying] = useState(false);
  const applyAndroidTheme = useCallback(
    async (preset: AndroidThemePreset) => {
      if (!projRoot) {
        setExportNote(tr("没有打开的项目，先新建/打开一个项目", "Open a project first"));
        window.setTimeout(() => setExportNote(" "), 3200);
        return;
      }
      setThemeApplying(true);
      const rel = "values/themes.xml";
      try {
        const cur = await readProjectFile(projRoot, rel);
        const base = cur ?? "";
        const next = writeThemeIntoValues(base, preset);
        const r = await saveResFiles(projRoot, [{ path: rel, text: next }]);
        setProjectRev((n) => n + 1);
        // M316：写进 themes.xml 后失效 res 全量索引缓存 → 重新收集 themeAttrs → 预览框调色板即时更新
        bumpResCache();
        setExportNote(
          r.ok
            ? tr("已应用主题 {name} → themes.xml", "Applied theme {name} to themes.xml", { name: preset.name })
            : tr("主题写入失败（{n} 条）", "Theme write failed ({n})", { n: String(r.failed.length) }),
        );
        window.setTimeout(() => setExportNote(" "), 3200);
      } catch {
        setExportNote(tr("主题写入出错", "Failed to write theme"));
        window.setTimeout(() => setExportNote(" "), 3200);
      } finally {
        setThemeApplying(false);
      }
    },
    [projRoot, setProjectRev, setExportNote, tr, bumpResCache],
  );

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
  /** M312：保存域（saveIntoProject / saveBack / saveAsTo / saveRawFile / doSave / M201 外部改动拦截）→ components/use-save-domain.ts */
  const { saveIntoProject, loadDiskIntoEditor, saveBack, saveAsTo, saveRawFile, doSave } = useSaveDomain(() => ({
    projRoot,
    xml,
    saveOrigin,
    openRel,
    codeOnly,
    currentSaveInput,
    flashNote,
    tr,
    markSaved,
    activeProject,
    project,
    bumpResCache,
    setConflict,
    liveXmlRef,
    docRef,
    setXml,
    setSaveAsName,
    setSaveAsOpen,
  }));
  // M291：文件 tab 的长按 / 右键上下文菜单
  const [fileTabMenu, setFileTabMenu] = useState<{ id: string; name: string; x: number; y: number } | null>(null);
  const openFileTabMenu = useCallback((id: string, name: string, x: number, y: number) => {
    setFileTabMenu({ id, name, x, y });
  }, []);
  const closeFileTabMenu = useCallback(() => {
    setFileTabMenu(null);
  }, []);
  const fileTabMenuAction = useCallback(
    (kind: "save" | "rename" | "close" | "delete") => {
      const cur = activeFile(project);
      if (cur?.id !== fileTabMenu?.id) closeFileTabMenu();
      if (kind === "save") void doSave();
      else if (kind === "rename") renameActiveFile();
      else if (kind === "close") closeActiveFile();
      else if (kind === "delete") deleteActiveFile();
      closeFileTabMenu();
    },
    [fileTabMenu, project, doSave, renameActiveFile, closeActiveFile, deleteActiveFile, closeFileTabMenu],
  );
  useEffect(() => {
    if (!fileTabMenu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (!t) return;
      if ((t as HTMLElement).closest?.(".axv-filetab-menu")) return;
      closeFileTabMenu();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFileTabMenu();
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [fileTabMenu, closeFileTabMenu]);

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
  const projectRef = useRef(project);
  projectRef.current = project;
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
          {/* M291：文件 tab 面板（原来两个 select 的位置）；打开/新建文件自动出现同名 tab */}
          {fileTabs}
          {/* M42/M291：values / manifest 资源才有「视图」—— 键值对 / 清单表格页，紧跟文件 tab 后面 */}
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
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>{viewKind === "manifest" ? "data_object" : "table_chart"}</span>
              {tt(viewKind === "manifest" ? "清单" : "资源")}
            </button>
          )}
          {/* M42/M291：「预览」只在当前文件是 XML 布局时出现 */}
          {docKind === "layout" && (
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
          </div>
          {fileTabMenu && (
            <div
              className="axv-filetab-menu"
              style={{ position: "fixed", left: fileTabMenu.x, top: fileTabMenu.y, width: 150, zIndex: 200 }}
              role="menu"
            >
              <button role="menuitem" aria-label={tt("保存")} onClick={() => fileTabMenuAction("save")}>
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>save</span>{tt("保存")}
              </button>
              <button role="menuitem" aria-label={tt("重命名")} onClick={() => fileTabMenuAction("rename")}>
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>drive_file_rename_outline</span>{tt("重命名")}
              </button>
              <button role="menuitem" aria-label={tt("关闭")} onClick={() => fileTabMenuAction("close")}>
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>close</span>{tt("关闭")}
              </button>
              <button role="menuitem" aria-label={tt("删除")} onClick={() => fileTabMenuAction("delete")}>
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>delete</span>{tt("删除")}
              </button>
            </div>
          )}
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
        runtimeLogs={runtimeLogs}
        onClearRuntimeLog={clearRuntimeLogsCb}
        forceView={apkForceView}
        onOpenChange={setDrawerOpen}
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
        drawerOpen={drawerOpen}
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
        lexRef={lexRef}
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
        reservedNames={useMemo(() => {
          // M341：整个 res/values 下其它文件的顶层资源名（跨文件全局查重）
          const tree = resExtras?.tree;
          if (!tree) return [];
          const files: { rel: string; text: string }[] = [];
          const walk = (dir: ResTreeDir) => {
            for (const child of Object.values(dir.children)) {
              if ("children" in child) walk(child as ResTreeDir);
              else {
                const f = child as ResTreeFile;
                if (f.rel && f.text && /^values\//i.test(f.rel) && /\.xml$/i.test(f.rel)) {
                  files.push({ rel: f.rel, text: f.text });
                }
              }
            }
          };
          walk(tree);
          if (files.length === 0) return [];
          const cur = (openRel || "").replace(/^[^/]*\//, "");
          return topLevelNamesFromFiles(files, cur);
        }, [resExtras, openRel])}
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
              onPkgSynced={handlePkgSynced}
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

          {leftView === "libs" && (
            <LibsPanel
              tr={tr}
              aiFileIo={aiFileIo}
              nativeProjectRoot={activeProject?.source?.rootPath ?? null}
              refreshKey={projectRev}
              onNote={(text) => {
                setExportNote(text);
                window.setTimeout(() => setExportNote(" "), 3200);
              }}
            />
          )}

          {/* M316：主题选择页 */}
          {leftView === "theme" && (
            <ThemePickerPanel
              tr={tr}
              onPick={(preset) => void applyAndroidTheme(preset)}
              onPreview={(preset) => {
                // M320：APK 壳跳原生主题预览 Activity；浏览器/桌面没有桥 → 静默降级（不跳）
                openThemePreviewNative(preset);
              }}
              busy={themeApplying}
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
              pluginsEnabled={pluginEnabled}
              onTogglePlugin={onTogglePlugin}
              installedPlugins={installedPlugins}
              onInstallPlugin={onInstallPlugin}
              installBusy={installBusy}
              installNote={installNote}
              compilerInfo={compilerInfo}
              compilerBusy={compilerBusy}
              compilerNote={compilerNote}
              onCheckCompilerUpdate={onCheckCompilerUpdate}
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

      {newFileDialog}

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
        canBuildApk={hasBuildApk()}
        onBuildRun={() => void doBuildAndRun()}
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
      {/* M21/M307：新建文件保存对话框 → components/SmallDialogs.tsx */}
      <SaveAsDialog
        open={saveAsOpen}
        name={saveAsName}
        tr={tr}
        setName={setSaveAsName}
        onConfirm={() => void confirmSaveAs()}
        onClose={() => setSaveAsOpen(false)}
      />

      {/* M201/M307：文件被外部改过 → components/SmallDialogs.tsx */}
      <ConflictDialog conflict={conflict} onDismiss={() => setConflict(null)} />

      {/* M24/M302：新建项目对话框 → components/NewProjectDialog.tsx */}
      <NewProjectDialog
        open={newProjOpen}
        name={newProjName}
        pkg={newProjPkg}
        icon={newProjIcon}
        busy={newProjBusy}
        defaultIconUrl={DEFAULT_ICON_URL}
        tr={tr}
        onClose={() => setNewProjOpen(false)}
        setName={setNewProjName}
        setPkg={setNewProjPkg}
        setIcon={setNewProjIcon}
        create={(n, p) => void createNewProject(n, p)}
        safeName={safeProjectName}
        validatePkg={validatePackageName}
        onToast={(m) => {
          setExportNote(m);
          window.setTimeout(() => setExportNote(" "), 3000);
        }}
      />

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
          onOpenRepack={() => {
            setSignDialogOpen(false);
            setRepackOpen(true);
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
      {repackOpen && (
        <ApkRepackDialog
          signing={
            signStored
              ? {
                  storeFile: signStored.storeFile,
                  storePass: signStored.storePass || signStored.keyPass || "",
                  alias: signStored.alias,
                  keyPass: signStored.keyPass || signStored.storePass || "",
                }
              : null
          }
          onClose={() => setRepackOpen(false)}
          onDone={(p) => {
            setExportNote(tt("重签名完成：{name}", { name: p.split(/[\\/]/).pop() || "" }));
          }}
          onNote={(m) => setExportNote(m)}
          onBuildLog={pushApkBuildLog}
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
        <PluginEditorHost
          kind="drawable"
          enabled={pluginEnabled}
          props={{
            name: resShape.name,
            existingXml: resShape.xml,
            existingNames: allDrawableNames,
            res: resExtrasAll,
            io: aiFileIo,
            docRel: openRel,
            extra: {
              attrName: "background",
              value: `@drawable/${resShape.name}`,
              forceTree: resShape.forceTree,
            },
            onClose: () => setResShape(null),
            onSave: (resourceName, shapeXml) => {
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
          }}}
        />
      ) : null}

      {/* M11j：生成的图标 → 图标编辑器（颜色 / 尺寸 / 路径 / 旋转） */}
      {resIcon ? (
        <PluginEditorHost
          kind="icon"
          enabled={pluginEnabled}
          props={{
            name: resIcon.name,
            existingXml: resIcon.xml,
            existingNames: allDrawableNames,
            onClose: () => setResIcon(null),
            extra: {
              initialAppIcon: appIconInit ?? undefined,
              onAppIcon: ({
                files,
                bgColor,
                contentDp,
              }: {
                files: { path: string; text: string }[];
                bgColor: string;
                contentDp: number;
              }) => {
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
            }
            },
          onSave: (safeName, iconXml) => {
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
          }}}
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
