// components/editor-state.ts — 路线 2（M366）：XmlEditor 共享状态层（EditorState）
//
// 把跨组共享的核心 state + refs + 编辑同步逻辑收拢到一个 useEditorState()，
// 壳和各组 hook（useXmlEditing/useXmlProject/…）都读这个 E 对象，不再各自持有 xml/project。
// 行为与原先完全一致（纯搬移，不改语义），tsc + 全量测试兜底。
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project, ProjectFile } from "@/lib/xml/multi-file";
import type { ResourceExtras } from "@/lib/xml/resdir";

export interface EditorBoot {
  project: Project;
  xml: string;
}

export interface EditorState {
  /** 当前 XML 文档（防抖落状态后的快照；最新文本在 liveXmlRef） */
  xml: string;
  setXml: React.Dispatch<React.SetStateAction<string>>;
  /** 多文件项目 */
  project: Project;
  setProject: React.Dispatch<React.SetStateAction<Project>>;
  /** 上传/生成 res 资源 */
  resExtras: ResourceExtras | null;
  setResExtras: React.Dispatch<React.SetStateAction<ResourceExtras | null>>;
  /** 资源索引缓存世代（存 res 文件后 +1） */
  resCacheRev: number;
  bumpResCache: () => void;
  /** refs：最新文本 / 文档 / 同步定时器 / setXmlAndTrack 自引用 */
  docRef: React.MutableRefObject<string>;
  liveXmlRef: React.MutableRefObject<string | null>;
  xmlSyncTimer: React.MutableRefObject<number | null>;
  setXmlAndTrackRef: React.MutableRefObject<((next: string, mergeKey?: string) => void) | null>;
  /** 当前真实文本（优先编辑中最新值） */
  currentXml: () => string;
  /** 把编辑器最新文本 flush 到 React state */
  flushXml: () => void;
}

/**
 * 拥有共享核心 state。boot 由壳算好（启动引导：项目存档优先，否则上次 xml 建单文件项目）。
 * 返回 E 对象；壳 `const E = useEditorState(boot)`，各组 hook 接收 E。
 */
export function useEditorState(boot: EditorBoot): EditorState {
  const [xml, setXml] = useState<string>(() => boot.xml);
  const [project, setProject] = useState<Project>(() => boot.project);

  /* ===== 编辑器 → React 同步：常驻 ref + 防抖落状态（M57 起） =====
   * 最新文本先进 liveXmlRef（同步、零成本），setXml 防抖 250ms；
   * 保存/格式化/切 tab/撤销前先 flushXml()，保证拿到最新内容。 */
  const docRef = useRef(xml);
  const liveXmlRef = useRef<string | null>(null);
  /** M202：doFixOne 在 setXmlAndTrack 声明前就要引用它，用 ref 包一层 */
  const setXmlAndTrackRef = useRef<((next: string, mergeKey?: string) => void) | null>(null);
  const xmlSyncTimer = useRef<number | null>(null);
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
    if (liveXmlRef.current === xml) liveXmlRef.current = null;
  }, [xml]);

  /** 上传 res/ 目录解析出的附加资源（drawable/vector/styles/values 原文） */
  const [resExtras, setResExtras] = useState<ResourceExtras | null>(null);
  /** M210c：资源索引缓存世代 */
  const [resCacheRev, setResCacheRev] = useState(0);
  const bumpResCache = useCallback(() => setResCacheRev((v) => v + 1), []);

  return {
    xml,
    setXml,
    project,
    setProject,
    resExtras,
    setResExtras,
    resCacheRev,
    bumpResCache,
    docRef,
    liveXmlRef,
    xmlSyncTimer,
    setXmlAndTrackRef,
    currentXml,
    flushXml,
  };
}
