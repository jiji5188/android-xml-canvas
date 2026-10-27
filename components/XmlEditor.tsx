// components/XmlEditor.tsx — M1a 主入口（v4：桌面端按 M3E 原版三栏布局拓展功能 + 移动端 75% 侧滑 + 蒙版）
// 桌面：左 320 停靠（52px 图标条：组件/图层 + 代码/资源）| 中间画布 | 右 320 属性
// 工具栏：☰ 撤销 重做 打开 保存（中段），最右 ⇔ 属性
// 移动端（≤840px 或粗指针+≤1024px）：两侧滑面板宽 75vw，背后加蒙版，点蒙版关闭；
// 画布区顶部 tab 切换 XML 代码 / 预览

"use client";

import { useEffect, useMemo, useRef, useState, useCallback, useDeferredValue } from "react";
import { parseLayoutXml, findNode, serialize } from "@/lib/xml/parser";
import { buildRenderModel } from "@/lib/xml/css";
import type { MeasuredMap } from "@/lib/xml/constraints";
import { mergeResourceFragment, DEFAULT_RESOURCES } from "@/lib/xml/resources";
import { buildResourceExtras, type ResourceExtras } from "@/lib/xml/resdir";
import type { ResolvedNode, ResourceTable, XmlNode } from "@/lib/xml/types";
import { writebackAttrs } from "@/lib/xml/writeback";
import { insertChild, insertSiblingAfter, insertAt, moveSibling, isContainerTag, applyConstraintDefaults, canAcceptChild } from "@/lib/xml/insert";
import { formatXml } from "@/lib/xml/format";
import { lintXml } from "@/lib/xml/lint";
import { exportLayoutXml, exportChecks } from "@/lib/xml/export";
import { ExportCheckModal, type ExportReport } from "./ExportCheckModal";
import { XmlCanvas } from "./XmlCanvas";
import { XmlCodeEditor } from "./XmlCodeEditor";
import { AttrPanel } from "./AttrPanel";
import { AddAttrModal } from "./AddAttrModal";
import { defaultFor } from "./attr-catalog";
import { WidgetPalette } from "./WidgetPalette";
import { ConstraintPanel, type SibOption } from "./ConstraintPanel";
import { autoConstrain, hasConstraints, nextViewId, type CBox, type SibInfo } from "@/lib/xml/autoconstrain";
import { ResTree } from "./ResTree";
import { LayerTree } from "./LayerTree";
import { WIDGET_MAP, DRAG_WIDGET_MIME, type WidgetDef } from "./widget-catalog";
import "./xml-canvas.css";
import { readableOn, deviceById, DEVICE_PRESETS } from "@/lib/xml/theme";

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

/** localStorage 自动保存：刷新/关页面不丢工作 */
const LS_KEY_XML = "axv.autosave.xml";
const LS_KEY_HIST = "axv.autosave.history";
const LS_KEY_RES = "axv.autosave.resources";

/** 安全读 localStorage（无 SSR、禁用存储模式都要不炸） */
function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function lsSet(key: string, val: string) {
  try {
    window.localStorage.setItem(key, val);
  } catch {
    // 超配额/隐私模式：静默放弃，不影响主流程
  }
}

export function XmlEditor() {
  const [xml, setXml] = useState<string>(() => lsGet(LS_KEY_XML) ?? SAMPLES.list);
  /** 解析用（低优先级）：敲代码时让输入不卡，解析滞后几帧 */
  const parsedXml = useDeferredValue(xml);
  const [resourceFragment, setResourceFragment] = useState("");
  /** 上传 res/ 目录解析出的附加资源（drawable/vector/styles/values 原文） */
  const [resExtras, setResExtras] = useState<ResourceExtras | null>(null);
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
  const [scale, setScale] = useState(1);
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
  const [leftView, setLeftView] = useState<"parts" | "layers" | "code" | "res">("parts");
  const [addModalOpen, setAddModalOpen] = useState(false);
  /** M2s：导出前检查面板 */
  const [exportOpen, setExportOpen] = useState(false);
  const [exportReport, setExportReport] = useState<ExportReport | null>(null);
  const [exportAction, setExportAction] = useState<"download" | "copy">("download");
  const [dropHint, setDropHint] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<"preview" | "xml">("preview");
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

  // ===== 自动保存：xml / 历史 / 资源 变更即写 localStorage（防抖 400ms） =====
  useEffect(() => {
    const t = window.setTimeout(() => {
      lsSet(LS_KEY_XML, xml);
    }, 400);
    return () => window.clearTimeout(t);
  }, [xml]);
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
      if (extras && typeof extras === "object" && extras.drawables) setResExtras(extras);
      if (typeof fragment === "string" && fragment) setResourceFragment(fragment);
    } catch {
      /* 损坏忽略 */
    }
  }, []);

  const resources: ResourceTable = useMemo(() => {
    // 顺序：内置默认 → 上传 res/ 里的 values（真实 color/dimen/string）→ 用户手贴片段（最高优先）
    let base: ResourceTable = DEFAULT_RESOURCES;
    const fragment = [resExtras?.valuesXml ?? "", resourceFragment].filter((x) => x.trim()).join("\n");
    if (fragment.trim()) base = mergeResourceFragment(fragment);
    if (resExtras) {
      base = {
        ...base,
        drawables: resExtras.drawables,
        vectorNames: resExtras.vectorNames,
        styles: resExtras.styles,
      };
    }
    return base;
  }, [resourceFragment, resExtras]);

  const [measured, setMeasured] = useState<MeasuredMap | null>(null);
  /** M2t：实测收敛计数器（避免 auto ↔ px 互推无限循环） */
  const measurePass = useRef(0);

  const { model, issues, parseErr } = useMemo(() => {
    const { root, issues } = parseLayoutXml(parsedXml);
    if (!root) return { model: null, issues, parseErr: true };
    // M2q：把上传 res/layout 里的布局传进去，供 <include> 就地展开
    // M2r：屏幕尺寸传入，影响 match_parent 根 / CL 内容区回落值
    // M2t：wrap 实测表传入，CL/RL 求解的 wrap 维度不再靠 estSize 估
    return {
      model: buildRenderModel(root, resources, SCALE, resExtras?.layouts, { w: device.w, h: device.h }, measured ?? undefined),
      issues,
      parseErr: false,
    };
  }, [parsedXml, resources, resExtras?.layouts, device, measured]);

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
    if (r.changed) setXmlAndTrack(r.xml);
  };

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

  const widthPx = Math.round(device.w * SCALE * scale);
  const heightPx = Math.round(device.h * SCALE * scale);  /** 屏 dp → px（含用户缩放） */
  const DPX = SCALE * scale;
  /** 手机外壳边框宽（px）；内容区保持 412x892dp 不被边框吃算 */
  const PHONE_BORDER = 2;
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
    return Math.min(1, avail / (widthPx + PHONE_BORDER * 2));
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
  /** 打开 .xml 文件：校验类型/大小，try/catch 读取，载入后检查可解析性，解析不了就提示而不留坏文件 */
  const openProject = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xml";
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return;
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
          // 4) 载入前预检：能解析出根元素吗？解析不了 → 报错不写入，画布保持原内容
          const { root, issues } = parseLayoutXml(txt);
          if (!root) {
            const errIssues = issues.filter((i) => i.level === "error");
            const detail = errIssues.length > 0 ? `：${errIssues[0].message}` : "";
            setExportNote(`「${f.name}」无法解析为布局 XML${detail}，未载入（画布保持不变）`);
            window.setTimeout(() => setExportNote(""), 5000);
            return;
          }
          setXmlAndTrack(txt);
          // 5) 载入后语义检查：有 error 级问题给出提示（不阻断，用户可继续编辑）
          const errs = issues.filter((i) => i.level === "error");
          if (errs.length > 0) {
            setExportNote(`已载入「${f.name}」，但检测到 ${errs.length} 条结构错误，切「XML 代码」tab 查看行号提示`);
            window.setTimeout(() => setExportNote(""), 6000);
          }
        })
        .catch((err) => {
          console.error("[axv] 读取 xml 文件失败", err);
          setExportNote(`读取「${f.name}」失败，请重试`);
          window.setTimeout(() => setExportNote(""), 4000);
        });
    };
    input.click();
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
    const body = exportLayoutXml(xml);
    const blob = new Blob([body], { type: "application/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "activity_main.xml";
    a.click();
    URL.revokeObjectURL(a.href);
    setExportNote(`已导出 activity_main.xml`);
    window.setTimeout(() => setExportNote(""), 2400);
  };

  const buildReport = (): ExportReport => {
    const check = exportChecks(xml);
    const lint = lintXml(xml);
    return {
      errors: lint.filter((i) => i.level === "error"),
      notes: check.notes,
    };
  };

  const saveProject = () => {
    setExportAction("download");
    setExportReport(buildReport());
    setExportOpen(true);
  };

  /** M3：复制生成的 XML 到剪贴板（与下载同一份内容） */
  const doCopy = async () => {
    const body = exportLayoutXml(xml);
    try {
      await navigator.clipboard.writeText(body);
      setExportNote("已复制到剪贴板");
    } catch {
      // 剪贴板 API 不可用（非 https / 旧浏览器）时退化成下载
      doDownload();
      setExportNote("剪贴板不可用，已改为下载");
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
    <div className="axv-editor">
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
          <select
            className="axv-tb-select axv-tab-sample"
            title="载入示例"
            value=""
            onChange={(e) => {
              const v = e.target.value;
              if (v && SAMPLES[v]) setXmlAndTrack(SAMPLES[v]);
            }}
            style={{ margin: "0 8px" }}
          >
            <option value="">示例…</option>
            <optgroup label="新建（空白）">
              <option value="blank-cl">ConstraintLayout</option>
              <option value="blank-ll">LinearLayout（竖）</option>
              <option value="blank-frame">FrameLayout</option>
            </optgroup>
            <optgroup label="示例">
              <option value="cl">约束布局</option>
              <option value="chain">链式排布 + Guideline</option>
              <option value="barrier">Barrier 屏障</option>
              <option value="list">竖列表</option>
            </optgroup>
          </select>
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
                width: outerW * fitRatio,
                height: outerH * fitRatio,
                flex: "0 0 auto",
              }}
            >
            <div
              className={"axv-phone" + (dropHint ? " axv-drop-target" : "")}
              style={{
                width: outerW,
                height: outerH,
                boxSizing: "border-box",
                background: phoneBg,
                color: phoneFg,
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
              {/* 状态栏（系统窗口，不属于布局 XML）：时间 + 信号/WiFi/电池 */}
              <div className="axv-statusbar" style={{ height: STATUS_BAR_H }}>
                <span className="axv-sb-time">9:41</span>
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

              {/* 应用内容区：根布局填满这里 */}
              <div className="axv-phone-body">
                <XmlCanvas
                  node={model.root}
                  selectedPath={selectedPath}
                  onSelect={setSelectedPath}
                  onDropWidget={onDropWidget}
                  onConstraintDraw={onConstraintDraw}
                  onGeometryChange={onGeometryChange}
                  scale={SCALE}
                />
              </div>

              {/* 导航栏（三键导航：返回 / 主页 / 多任务） */}
              <div className="axv-navbar" style={{ height: NAV_BAR_H }}>
                <span className="axv-nav-btn" title="返回">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M15 4 7 12l8 8z" fill="currentColor" />
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
            </div>
            </div>
          ) : null}
          {exportNote ? (
              <div className="axv-export-note">{exportNote}</div>
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
            focusLine={focusLine}
            focusTick={focusTick}
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
              <optgroup label="新建（空白）">
                <option value="blank-cl">ConstraintLayout</option>
                <option value="blank-ll">LinearLayout（竖）</option>
                <option value="blank-frame">FrameLayout</option>
              </optgroup>
              <optgroup label="示例">
                <option value="cl">约束布局</option>
                <option value="chain">链式排布 + Guideline</option>
                <option value="barrier">Barrier 屏障</option>
                <option value="list">竖列表</option>
              </optgroup>
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
            <div className="axv-rail-scroll">
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
                  onOpenLayout={(fileName, content) => setXmlAndTrack(content)}
                />
              ) : (
                <>
                  <div style={{ padding: "8px 12px 4px", fontSize: 12, color: "#6B7280", lineHeight: 1.5 }}>
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
                onCommit={commitAttr}
                onRemove={removeAttr}
                onAddAttr={() => setAddModalOpen(true)}
                resExtras={resExtras}
                onDeleteNode={() => onRemoveNode(selectedNode.path)}
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
          <button className="axv-tb-btn" title="保存为 XML 文件" aria-label="保存" onClick={saveProject}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>save</span>
          </button>
          <button className="axv-tb-btn" title="复制生成的 XML" aria-label="复制 XML" onClick={copyExportedXml}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>content_copy</span>
          </button>
          {resExtras ? (
            <button className="axv-tb-btn" title="清除已上传的 res 资源" aria-label="清除 res" onClick={clearRes}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 23 }}>hide_image</span>
            </button>
          ) : null}
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
          <div className="axv-device">
            <label htmlFor="axv-device-select">设备</label>
            <select
              id="axv-device-select"
              value={deviceId}
              onChange={(e) => changeDevice(e.target.value)}
              title={`预览设备：${device.label}（对应 ${device.hint}）`}
            >
              {DEVICE_PRESETS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
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
