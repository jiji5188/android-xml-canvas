// components/use-xml-project.ts — M366（路线 2 拆解）：项目管理/工作区 state 层
//
// 从 XmlEditor.tsx 抽出（原 444-466 区域）：projectTab/w sState/wsProjects/activeProject/
// projectRev/projMeta/newProj*/saveOrigin。纯 state 归拢，函数仍留壳（后续步再搬）。
// ActiveProject 是 XmlEditor.tsx 的本地导出类型，用 type-only 导入（无运行时循环，use-signing.tsx 已有先例）。
"use client";

import { useState } from "react";
import type { WsInfo, WsProject } from "@/lib/xml/workspace";
import type { ProjectMeta } from "@/lib/xml/project-browse";
import type { ActiveProject } from "./XmlEditor";

export interface XmlProjectState {
  /** M16i：工作目录面板 tab（projects = 项目列表 / current = 当前项目） */
  projectTab: "projects" | "current";
  setProjectTab: React.Dispatch<React.SetStateAction<"projects" | "current">>;
  wsState: WsInfo | null;
  setWsState: React.Dispatch<React.SetStateAction<WsInfo | null>>;
  wsProjects: WsProject[];
  setWsProjects: React.Dispatch<React.SetStateAction<WsProject[]>>;
  /** M24：当前项目（项目名 + 懒加载浏览源） */
  activeProject: ActiveProject | null;
  setActiveProject: React.Dispatch<React.SetStateAction<ActiveProject | null>>;
  /** M25d：手动刷新项目结构时 +1，让面板丢掉懒加载缓存重新读根目录 */
  projectRev: number;
  setProjectRev: React.Dispatch<React.SetStateAction<number>>;
  /** M25d：项目卡片分析结果（app_name / 图标），key = 项目 rel */
  projMeta: Record<string, ProjectMeta>;
  setProjMeta: React.Dispatch<React.SetStateAction<Record<string, ProjectMeta>>>;
  /** M24：新建项目对话框 */
  newProjOpen: boolean;
  setNewProjOpen: React.Dispatch<React.SetStateAction<boolean>>;
  newProjName: string;
  setNewProjName: React.Dispatch<React.SetStateAction<string>>;
  /** M31i：新建项目可选图标（data URL 预览 + base64 落盘 + mime；null = 默认自适应图标） */
  newProjIcon: { dataUrl: string; base64: string; mime: string } | null;
  setNewProjIcon: React.Dispatch<React.SetStateAction<{ dataUrl: string; base64: string; mime: string } | null>>;
  /** M176：新建项目时的包名（留空 = 按项目名自动 com.example.xxx） */
  newProjPkg: string;
  setNewProjPkg: React.Dispatch<React.SetStateAction<string>>;
  newProjBusy: boolean;
  setNewProjBusy: React.Dispatch<React.SetStateAction<boolean>>;
  /** M21：当前编辑内容的来源 —— 决定「保存」是写回原路还是弹选择器 */
  saveOrigin: { kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null;
  setSaveOrigin: React.Dispatch<
    React.SetStateAction<{ kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null>
  >;
}

export function useXmlProjectState(): XmlProjectState {
  const [projectTab, setProjectTab] = useState<"projects" | "current">("current");
  const [wsState, setWsState] = useState<WsInfo | null>(null);
  const [wsProjects, setWsProjects] = useState<WsProject[]>([]);
  const [activeProject, setActiveProject] = useState<ActiveProject | null>(null);
  const [projectRev, setProjectRev] = useState(0);
  const [projMeta, setProjMeta] = useState<Record<string, ProjectMeta>>({});
  const [newProjOpen, setNewProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState("MyApp");
  const [newProjIcon, setNewProjIcon] = useState<{ dataUrl: string; base64: string; mime: string } | null>(null);
  const [newProjPkg, setNewProjPkg] = useState("");
  const [newProjBusy, setNewProjBusy] = useState(false);
  const [saveOrigin, setSaveOrigin] = useState<
    { kind: "native"; target: string; name: string } | { kind: "handle"; handle: unknown; name: string } | null
  >(null);

  return {
    projectTab, setProjectTab, wsState, setWsState, wsProjects, setWsProjects,
    activeProject, setActiveProject, projectRev, setProjectRev, projMeta, setProjMeta,
    newProjOpen, setNewProjOpen, newProjName, setNewProjName, newProjIcon, setNewProjIcon,
    newProjPkg, setNewProjPkg, newProjBusy, setNewProjBusy, saveOrigin, setSaveOrigin,
  };
}
