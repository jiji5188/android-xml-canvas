// components/LibsPanel.tsx — M295：库管理面板（本地库 / 项目库 + 下载）
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nativeBridge } from "@/lib/xml/native-save";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import {
  groupCatalog,
  libDownloadUrls,
  libKey,
  LIBRARY_CATALOG,
  LAN_LIBS_BASE,
  type LibEntry,
} from "@/lib/xml/library-catalog";
import {
  parseGradleDepsDetailed,
  parseFileTrees,
  gradleDepDownloadUrls,
  gradleDepFname,
  insertImplementation,
  insertRepoUrl,
  mavenCoord,
  type GradleDep,
  type GradleUnresolved,
  type GradleFileTree,
} from "@/lib/xml/gradle-deps";
import { systemDownload } from "@/lib/xml/system-download";
import { formatBytes, matchLibQuery, matchGradleDep, sortLibFiles, matchFileTreeInclude, normFtDir } from "@/lib/xml/libs-utils";

interface LibsPanelProps {
  /** 当前激活项目的 SAF 源（可 list/read）；没有则项目库列不出来 */
  aiFileIo?: AiFileIo | null;
  /** 项目根绝对路径（native），用于项目库目录 */
  nativeProjectRoot?: string | null;
  /** 刷新信号：变化时重新列目录 */
  refreshKey?: number;
  onNote?: (text: string) => void;
  /** 翻译函数（由父组件传入，避免 hook 依赖） */
  tr: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
}

interface LibFile {
  name: string;
  rel: string;
  size?: number;
}

type LibTab = "local" | "project" | "catalog";

function isJarAar(name: string) {
  return /\.(jar|aar)$/i.test(name);
}

/** fileTree include 过滤 / 目录规范化统一在 libs-utils（M380：打包侧 collectProjectLibs 共用同一套规则） */

/** 项目库候选目录：标准 app/src/main/libs + 每个 fileTree 的 dir（带各自的 include 过滤） */
interface ProjectLibCandidate {
  rel: string;
  abs: string | null;
  includes: string[];
}

async function fetchBase64(url: string): Promise<{ b64: string; ok: boolean; error?: string; size?: number }> {
  try {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) return { b64: "", ok: false, error: `HTTP ${r.status}` };
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(bin);
    return { b64, ok: true, size: bytes.length };
  } catch (e: any) {
    return { b64: "", ok: false, error: e?.message || String(e) };
  }
}

function listDirViaNative(abs: string): LibFile[] {
  const b = nativeBridge();
  if (!b?.listDir) return [];
  try {
    const json = b.listDir(abs);
    if (!json) return [];
    const p = JSON.parse(json);
    if (!p?.ok || !Array.isArray(p.items)) return [];
    return p.items
      .filter((it: { kind: string; name: string }) => it.kind === "file" && isJarAar(it.name))
      .map((it: { name: string; path?: string; size?: number }) => ({
        name: it.name,
        rel: it.path || `${abs}/${it.name}`,
        size: typeof it.size === "number" ? it.size : undefined,
      }));
  } catch {
    return [];
  }
}

async function listDirViaIo(io: AiFileIo, rel: string): Promise<LibFile[]> {
  const out: LibFile[] = [];
  const r = await io.list(rel);
  if (!r.ok || !r.items) return out;
  for (const it of r.items) {
    if (it.kind === "file" && isJarAar(it.name)) {
      out.push({ name: it.name, rel: rel ? `${rel}/${it.name}` : it.name });
    }
  }
  return out;
}

export function LibsPanel({ aiFileIo, nativeProjectRoot, refreshKey, onNote, tr }: LibsPanelProps) {
  const [tab, setTab] = useState<LibTab>("local");
  const [localLibs, setLocalLibs] = useState<LibFile[]>([]);
  const [projectLibs, setProjectLibs] = useState<LibFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [catBusy, setCatBusy] = useState<Record<string, string>>({}); // libKey -> 'downloading' | 'done' | 'err:msg'
  const [dlOpen, setDlOpen] = useState(false);
  const [dlUrl, setDlUrl] = useState("");
  const [dlName, setDlName] = useState("");
  const [dlBusy, setDlBusy] = useState(false);
  // M345：从 build.gradle 解析依赖并自动下载
  const [gradleBusy, setGradleBusy] = useState(false);
  const [gradleDeps, setGradleDeps] = useState<GradleDep[]>([]);
  const [gradleUnresolved, setGradleUnresolved] = useState<GradleUnresolved[]>([]);
  const [gradleScanned, setGradleScanned] = useState(false);
  const [gradleFileTrees, setGradleFileTrees] = useState<GradleFileTree[]>([]);
  const [gradleBusyKey, setGradleBusyKey] = useState<Record<string, string>>({});
  const [gradleMsg, setGradleMsg] = useState<string | null>(null);

  const native = nativeBridge();

  // 本地库目录：默认工作目录（/sdcard/AndroidUIIDE/Project）的**上级** /libs
  //  即 /sdcard/AndroidUIIDE/libs —— 所有下载的库都先存这里，再在本地库列表选择是否应用到项目
  const localDir = useMemo(() => {
    if (!native) return null;
    const def = native.getDefaultWorkspace?.();
    if (def) {
      const clean = def.replace(/[\\/]+$/, "");
      // /sdcard/AndroidUIIDE/Project → /sdcard/AndroidUIIDE/libs
      const parent = clean.replace(/[\\/]Project$/i, "");
      return parent !== clean ? `${parent}/libs` : `${clean}/libs`;
    }
    return "/storage/emulated/0/AndroidUIIDE/libs";
  }, [native]);

  /** M346/M358：项目库标准目录 = 项目根/app/src/main/libs（标准安卓工程布局）。
   *  M370：+ build.gradle 里 fileTree(dir: 'libs') 指定的目录（真实老项目常见 app/libs），
   *  否则这些 jar 在项目库列表里永远看不到，且「应用到项目」会写错地方。 */
  const projectLibsBases = useMemo(() => {
    if (!nativeProjectRoot) return [] as string[];
    const root = nativeProjectRoot.replace(/[\\/]+$/, "");
    const bases = [`${root}/app/src/main/libs`];
    for (const ft of gradleFileTrees) {
      const d = (ft.dir || "")
        .trim()
        .replace(/^\.\//, "")
        .replace(/^\/+/, "")
        .replace(/[\\/]+$/, "");
      if (!d) continue;
      // dir 相对模块目录（app/）；写全路径（app/...）时按项目根解
      for (const cand of [`${root}/app/${d}`, `${root}/${d}`]) {
        if (!bases.includes(cand)) bases.push(cand);
      }
    }
    return bases;
  }, [nativeProjectRoot, gradleFileTrees]);
  /** 首选写入目录（应用到项目 / gradle 依赖下载都写这里）。
   *  M370：build.gradle 配了 fileTree → 写 fileTree 目录（写 app/src/main/libs 编译不生效）；
   *  否则仍用标准位置 app/src/main/libs。 */
  const primaryLibBase = useMemo(() => {
    if (!nativeProjectRoot) return null;
    const root = nativeProjectRoot.replace(/[\\/]+$/, "");
    for (const ft of gradleFileTrees) {
      const d = (ft.dir || "")
        .trim()
        .replace(/^\.\//, "")
        .replace(/^\/+/, "")
        .replace(/[\\/]+$/, "");
      if (!d) continue;
      return /^app([\\/]|$)/.test(d) ? `${root}/${d}` : `${root}/app/${d}`;
    }
    return projectLibsBases[0] ?? null;
  }, [nativeProjectRoot, gradleFileTrees, projectLibsBases]);

  /** M372：项目库候选目录（rel + abs + 各自 include 过滤）。
   *  native 和 SAF（aiFileIo）两路都用 fileTree 指向的目录，不再只扫标准 libs。 */
  const projectLibCandidates = useMemo(() => {
    const out: ProjectLibCandidate[] = [
      { rel: "app/src/main/libs", abs: null, includes: [] },
    ];
    const root = (nativeProjectRoot || "").replace(/[\\/]+$/, "");
    for (const ft of gradleFileTrees) {
      const d = normFtDir(ft.dir);
      if (!d) continue;
      const rels = /^app(\/|$)/.test(d) ? [d] : [`app/${d}`, d];
      for (const rel of rels) {
        if (out.some((c) => c.rel === rel)) continue;
        out.push({ rel, abs: root ? `${root}/${rel}` : null, includes: ft.includes });
      }
    }
    if (root) out[0].abs = `${root}/app/src/main/libs`;
    return out;
  }, [nativeProjectRoot, gradleFileTrees]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      if (tab === "local") {
        if (!localDir) {
          setLocalLibs([]);
        } else {
          // 先确保目录存在
          native?.createEntry?.(localDir, true);
          setLocalLibs(listDirViaNative(localDir));
        }
      } else {
        // 项目库：标准 libs + build.gradle fileTree 指向的目录（按 include 过滤）
        if (nativeProjectRoot && native) {
          let all: LibFile[] = [];
          for (const c of projectLibCandidates) {
            if (!c.abs) continue;
            native.createEntry?.(c.abs, true);
            const items = listDirViaNative(c.abs).filter((f) => matchFileTreeInclude(f.name, c.includes));
            all = all.concat(items);
          }
          setProjectLibs(all);
        } else if (aiFileIo) {
          let all: LibFile[] = [];
          for (const c of projectLibCandidates) {
            const items = await listDirViaIo(aiFileIo, c.rel);
            all = all.concat(items.filter((f) => matchFileTreeInclude(f.name, c.includes)));
          }
          setProjectLibs(all);
        } else {
          setProjectLibs([]);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [tab, localDir, nativeProjectRoot, aiFileIo, native, refreshKey, projectLibCandidates]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** M365：系统下载器优先（后台 + 系统通知 + 进度弹窗）；全失败则回退 HttpURLConnection
   *  downloadLib（保证文件仍下到共享库，只是没系统通知）。返回 { ok, error?, via }。 */
  const dlWithFallback = useCallback(
    async (urls: string[], fname: string, destDir: string): Promise<{ ok: boolean; error?: string; via?: "system" | "direct" }> => {
      const res = await systemDownload(urls, fname, destDir, { showNativeProgress: true });
      if (res.missingPermission) return { ok: false, error: tr("libs.cat_no_perm", "缺 All-files-access 权限，下载不到") };
      if (res.ok) return { ok: true, via: "system" };
      // 系统下载器全失败 → 回退原生 HttpURLConnection（同步、能下到共享库）
      if (native?.downloadLib) {
        native.createEntry?.(destDir, true);
        const target = `${destDir}/${fname}`;
        let r = "";
        try { r = String(native.downloadLib(JSON.stringify(urls), target) ?? ""); } catch (e2) { r = "throw:" + String(e2); }
        if (r.startsWith("ok")) return { ok: true, via: "direct" };
        return { ok: false, error: r.slice(4) || tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") };
      }
      return { ok: false, error: res.error || tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") };
    },
    [native, tr],
  );

  const doDownload = useCallback(async () => {
    const url = dlUrl.trim();
    if (!url) return;
    const name = dlName.trim() || url.split("/").pop() || "library.jar";
    setDlBusy(true);
    onNote?.(tr("libs.downloading", "正在下载…"));
    // M357/M358：下载目标 = 共享库 /AndroidUIIDE/libs（跨项目复用，不再按 tab/项目写到 src/main/libs）
    const targetBase = localDir || null;
    const target = targetBase ? `${targetBase}/${name}` : null;

    if (targetBase) {
      // M357/M365：系统 DownloadManager（后台 + 通知 + 弹窗）；失败回退 HttpURLConnection
      const res = await dlWithFallback([url], name, targetBase);
      if (res.ok) {
        setDlOpen(false); setDlUrl(""); setDlName("");
        onNote?.(tr("libs.download_saved", "已保存到 {path}" + (res.via === "direct" ? "（直连下载，无系统通知）" : ""), { path: `${targetBase}/${name}` }));
        void refresh();
      } else {
        onNote?.(tr("libs.download_failed", "下载失败：{err}", { err: res.error || "unknown" }));
      }
      setDlBusy(false);
      return;
    }

    // 无共享库目录（浏览器 / 权限没给）→ 浏览器原生下载
    const r = await fetchBase64(url);
    if (!r.ok) {
      onNote?.(tr("libs.download_failed", "下载失败：{err}", { err: r.error || "unknown" }));
      setDlBusy(false);
      return;
    }
    onNote?.(tr("libs.download_no_target", "当前没有可写的共享库目录（浏览器已下到 Downloads）"));
    setDlBusy(false);
  }, [dlUrl, dlName, localDir, onNote, tr, refresh, setDlOpen, setDlUrl, setDlName, setDlBusy, dlWithFallback]);

  const currentList = tab === "local" ? localLibs : projectLibs;

  // M368：搜索过滤（四个列表共用一个框）+ 名称排序
  const [libQuery, setLibQuery] = useState("");
  const visibleList = useMemo(
    () => sortLibFiles(currentList.filter((f) => matchLibQuery(f.name, f.rel, libQuery))),
    [currentList, libQuery],
  );
  // 删除共享库文件（deleteEntry + 确认；项目库不提供删，避免误删工程内文件）
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const deleteLocalLib = useCallback(
    (f: LibFile) => {
      if (!native?.deleteEntry) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm(tr("libs.delete_confirm", "删除 {name}？（共享库里的文件，删了别的项目也用不了）", { name: f.name }))) return;
      setDeleteBusy(f.rel);
      try {
        const r = native.deleteEntry(f.rel, false);
        let ok = false;
        try {
          ok = !!JSON.parse(r || "").ok;
        } catch {
          ok = false;
        }
        if (ok) {
          onNote?.(tr("libs.deleted", "已删除 {name}", { name: f.name }));
          setLocalLibs((m) => m.filter((x) => x.rel !== f.rel));
        } else {
          onNote?.(tr("libs.delete_failed", "删除失败：{r}", { r: r || "unknown" }));
        }
      } catch (e: unknown) {
        onNote?.(tr("libs.delete_failed", "删除失败：{r}", { r: String(e) }));
      }
      setDeleteBusy(null);
      void refresh();
    },
    [native, onNote, tr, refresh],
  );

  /** M330：从内置目录一键下载某个库到项目 libs/（优先原生多镜像，浏览器回退 fetch） */
  const downloadCat = useCallback(
    async (e: LibEntry) => {
      const key = libKey(e);
      setCatBusy((m) => ({ ...m, [key]: "downloading" }));
      onNote?.(tr("libs.cat_downloading", "正在下载 {lib}…（多镜像）", { lib: e.artifact }));
      const fname = e.artifact + "-" + e.version + (e.isAar ? ".aar" : ".jar");
      // M335：一律先存到本地库 /AndroidUIIDE/libs，用户在本地库列表里选择是否应用到项目
      let targetBase: string | null = null;
      if (localDir) targetBase = localDir;
      const target = targetBase ? `${targetBase}/${fname}` : null;
      if (targetBase) {
        // M357/M365：系统 DownloadManager（后台 + 通知 + 弹窗）；失败回退 HttpURLConnection
        const res = await dlWithFallback(libDownloadUrls(e), fname, targetBase);
        if (res.ok) {
          setCatBusy((m) => ({ ...m, [key]: "done" }));
          onNote?.(tr("libs.cat_download_saved", "{lib} 已下载到共享库（去「共享库」点「应用到项目」加入项目）", { lib: e.artifact }));
          void refresh();
        } else {
          setCatBusy((m) => ({ ...m, [key]: "err:" + (res.error || "download failed") }));
          onNote?.(tr("libs.cat_download_failed", "{lib} 下载失败：{err}", { lib: e.artifact, err: res.error || "?" }));
        }
        return;
      }
      if (target && typeof native?.downloadLib === "function") {
        // 原生多镜像下载（APK）
        const urlsJson = JSON.stringify(libDownloadUrls(e));
        let r = "";
        try { r = String(native.downloadLib(urlsJson, target) ?? ""); } catch (e2) { r = "throw:" + String(e2); }
        if (r.startsWith("ok")) {
          const parts = r.slice(3).split("@");
          const savedPath = parts[2] || "";
          const isFallback = parts[3] === "fallback";
          // fallback：存到应用目录了，尝试拷回项目 libs（用 writeText）
          if (isFallback && savedPath && native.writeText && target) {
            try {
              const b64 = native.readBase64?.(savedPath);
              if (b64) {
                const w = native.writeText(target, b64);
                if (typeof w === "string" && w.startsWith("ok")) {
                  setCatBusy((m) => ({ ...m, [key]: "done" }));
                  onNote?.(tr("libs.cat_download_saved", "{lib} 已下载（已拷入项目 libs/）", { lib: e.artifact }));
                  void refresh();
                  return;
                }
              }
            } catch {}
            setCatBusy((m) => ({ ...m, [key]: "err:fallback" }));
            onNote?.(tr("libs.cat_fallback", "{lib} 已下载到临时目录 {p}（项目 libs 写不了，请手动拷进去）", { lib: e.artifact, p: savedPath }));
            return;
          }
          setCatBusy((m) => ({ ...m, [key]: "done" }));
          onNote?.(tr("libs.cat_download_saved", "{lib} 已下载到共享库（去「共享库」点「应用到项目」加入项目）", { lib: e.artifact }));
          void refresh();
        } else {
          setCatBusy((m) => ({ ...m, [key]: "err:" + (r.slice(4) || "download failed") }));
          onNote?.(tr("libs.cat_download_failed", "{lib} 下载失败：{err}", { lib: e.artifact, err: r.slice(4) || "?" }));
        }
        return;
      }
      // 浏览器回退：逐镜像 fetch
      for (const url of libDownloadUrls(e)) {
        const r = await fetchBase64(url);
        if (!r.ok) continue;
        if (targetBase && native) {
          native.createEntry?.(targetBase, true);
          const w = native.writeText?.(target!, r.b64);
          const ok = typeof w === "string" && w.startsWith("ok");
          if (ok) {
            setCatBusy((m) => ({ ...m, [key]: "done" }));
            onNote?.(tr("libs.cat_download_saved", "{lib} 已下载", { lib: e.artifact }));
            void refresh();
          } else {
            setCatBusy((m) => ({ ...m, [key]: "err:" + (w || "save failed") }));
            onNote?.(tr("libs.cat_download_failed", "{lib} 保存失败：{err}", { lib: e.artifact, err: w || "?" }));
          }
          return;
        }
        setCatBusy((m) => ({ ...m, [key]: "err:" + tr("libs.cat_no_target", "没有可写的 libs 目录") }));
        onNote?.(tr("libs.cat_no_target", "没有可写的 libs 目录（需先打开项目）"));
        return;
      }
      setCatBusy((m) => ({ ...m, [key]: "err:" + tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") }));
      onNote?.(tr("libs.cat_all_failed", "{lib} 下载失败：全部镜像都试过了（网络不通或源 404）", { lib: e.artifact }));
    },
    [native, nativeProjectRoot, localDir, onNote, tr, refresh, dlWithFallback],
  );

  /** 已下载判定：本地/项目库列表里已有同名文件 */
  const presentNames = useMemo(() => {
    const s = new Set<string>();
    for (const f of [...localLibs, ...projectLibs]) s.add(f.name);
    return s;
  }, [localLibs, projectLibs]);

  /** M335：项目库已有的文件名（判断本地库是否已应用到项目） */
  const projectNames = useMemo(() => new Set(projectLibs.map((f) => f.name)), [projectLibs]);
  const [applyBusy, setApplyBusy] = useState<Record<string, string>>({}); // 本地库 name -> 'applying' | 'done' | 'err'
  const canApply = !!(nativeProjectRoot && native?.copyEntry);

  /** 应用到打开的项目：/AndroidUIIDE/libs/x → 项目/app/src/main/libs/x（标准位置） */
  const applyToLocalProject = useCallback(
    (f: LibFile) => {
      if (!canApply || !nativeProjectRoot || !native) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
        return;
      }
      const dstBase = primaryLibBase || `${nativeProjectRoot.replace(/[\\/]+$/, "")}/app/src/main/libs`;
      native.createEntry?.(dstBase, true);
      const dst = `${dstBase}/${f.name}`;
      setApplyBusy((m) => ({ ...m, [f.name]: "applying" }));
      try {
        const r = String(native.copyEntry?.(f.rel, dst, false) ?? "");
        if (r.startsWith("err:")) {
          setApplyBusy((m) => ({ ...m, [f.name]: "err:" + r.slice(4) }));
          onNote?.(tr("libs.apply_fail", "{lib} 应用失败：{err}", { lib: f.name, err: r.slice(4) }));
          return;
        }
        let p: { ok?: boolean } = {};
        try { p = JSON.parse(r || "{}"); } catch { p = {}; }
        if (p?.ok) {
          setApplyBusy((m) => ({ ...m, [f.name]: "done" }));
          onNote?.(
            tr("libs.apply_done", "{lib} 已应用到 {path}（打包时会带上）", {
              lib: f.name,
              path: dstBase.replace(nativeProjectRoot.replace(/[\\/]+$/, "") + "/", "") || dstBase,
            }),
          );
          void refresh();
        } else {
          setApplyBusy((m) => ({ ...m, [f.name]: "err:fail" }));
          onNote?.(tr("libs.apply_fail", "{lib} 应用失败：{err}", { lib: f.name, err: "?" }));
        }
      } catch {
        setApplyBusy((m) => ({ ...m, [f.name]: "err:copy failed" }));
        onNote?.(tr("libs.apply_fail", "{lib} 应用失败：{err}", { lib: f.name, err: "copy" }));
      }
    },
    [canApply, nativeProjectRoot, primaryLibBase, native, onNote, tr, refresh],
  );

  /** M375：把已下载到共享库的文件拷到项目 fileTree 目录（「存 libs」按钮）。
   *  不看 tab 当前缓存，直接用 localDir + 文件名构造源路径。 */
  const saveSharedToLibs = useCallback(
    (fname: string) => {
      if (!localDir) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
        return;
      }
      applyToLocalProject({ name: fname, rel: `${localDir}/${fname}` });
    },
    [localDir, applyToLocalProject, onNote, tr],
  );

  /** M359：应用到项目 = 写 maven 坐标（不拷文件，防源码膨胀）。
   *  把 group:artifact:version 写进 app/build.gradle（implementation）+ 仓库 url 写进 settings.gradle / 根 build.gradle（repositories）。
   *  设备端打包时按 maven 坐标去共享库 /AndroidUIIDE/libs 找实体文件（M361 接）。 */
  const applyMaven = useCallback(
    async (coord: string, repoUrl: string, libName: string) => {
      if (!nativeProjectRoot) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
        return;
      }
      const root = nativeProjectRoot.replace(/[\\/]+$/, "");
      const writeOne = async (rel: string, abs: string, text: string): Promise<boolean> => {
        if (native?.writeText) {
          try {
            const b64 = btoa(unescape(encodeURIComponent(text)));
            const r = String(native.writeText?.(abs, b64) ?? "");
            if (r && !r.startsWith("err:")) return true;
          } catch {}
        }
        if (aiFileIo?.write) {
          try {
            const r = await aiFileIo.write(rel, text);
            return r.ok;
          } catch {}
        }
        return false;
      };
      const readOne = async (rel: string, abs: string): Promise<string> => {
        if (native?.readText) {
          try { const t = String(native.readText?.(abs) ?? ""); if (t && !t.startsWith("err:")) return t; } catch {}
        }
        if (aiFileIo?.read) {
          try { const r = await aiFileIo.read(rel); if (r.ok && r.text) return r.text; } catch {}
        }
        return "";
      };

      setApplyBusy((m) => ({ ...m, [libName]: "maven" }));
      try {
        // 1) app/build.gradle（groovy 优先，kts 兑底）
        let appRel = "app/build.gradle";
        let appText = await readOne(appRel, root + "/" + appRel);
        let kts = false;
        if (!appText) {
          appRel = "app/build.gradle.kts"; appText = await readOne(appRel, root + "/" + appRel);
          kts = true;
        }
        if (appText) {
          const [newApp, existed] = insertImplementation(appText, coord, kts);
          const ok = await writeOne(appRel, root + "/" + appRel, newApp);
          if (ok && !existed)
            onNote?.(tr("libs.maven_written", "{lib} 已写入 maven 坐标 {coord}（不拷文件，防源码膨胀）", { lib: libName, coord }));
        } else {
          // 项目没 build.gradle → 建一个最小 app/build.gradle 带 implementation
          appRel = "app/build.gradle"; kts = false;
          const newApp = "plugins { id 'com.android.application' }\n\ndependencies {\n    implementation '${coord}'\n}\n";
          await writeOne(appRel, root + "/" + appRel, newApp);
        }
        // 2) 仓库 url 写进 settings.gradle（现代）或根 build.gradle
        if (repoUrl) {
          let repoText = await readOne("settings.gradle", root + "/settings.gradle");
          let repoRel = "settings.gradle"; let rkts = false;
          if (!repoText) { repoText = await readOne("settings.gradle.kts", root + "/settings.gradle.kts"); repoRel = "settings.gradle.kts"; rkts = true; }
          if (!repoText) { repoText = await readOne("build.gradle", root + "/build.gradle"); repoRel = "build.gradle"; }
          if (repoText) {
            const [newRepo] = insertRepoUrl(repoText, repoUrl, rkts);
            await writeOne(repoRel, root + "/" + repoRel, newRepo);
          }
        }
        setApplyBusy((m) => ({ ...m, [libName]: "done" }));
        onNote?.(tr("libs.maven_done", "{lib} 已应用到项目（写 maven 配置，不拷文件）", { lib: libName }));
        void refresh();
      } catch {
        setApplyBusy((m) => ({ ...m, [libName]: "err:写 maven 配置失败" }));
        onNote?.(tr("libs.apply_fail", "{lib} 应用失败：{err}", { lib: libName, err: "写 maven 配置" }));
      }
    },
    [nativeProjectRoot, native, aiFileIo, onNote, tr, refresh],
  );

  /** 从项目移除：依次试 标准 + 旧 libs 目录，删到哪个算哪个（项目库可能来自三处任一个） */
  const removeFromProject = useCallback(
    (name: string) => {
      if (!nativeProjectRoot || !native) return;
      const bases = projectLibsBases.length
        ? projectLibsBases
        : [`${nativeProjectRoot.replace(/[\\/]+$/, "")}/libs`];
      let ok = false;
      let lastErr = "?";
      for (const base of bases) {
        const dst = `${base}/${name}`;
        try {
          const r = String(native.deleteEntry?.(dst, false) ?? "");
          if (r.startsWith("err:")) {
            lastErr = r.slice(4);
            continue;
          }
          let p: { ok?: boolean } = {};
          try { p = JSON.parse(r || "{}"); } catch { p = {}; }
          if (p?.ok) { ok = true; break; }
        } catch {}
      }
      if (ok) {
        onNote?.(tr("libs.remove_done", "{lib} 已从项目移除", { lib: name }));
        void refresh();
      } else {
        onNote?.(tr("libs.remove_fail", "{lib} 移除失败：{err}", { lib: name, err: lastErr }));
      }
    },
    [nativeProjectRoot, native, projectLibsBases, onNote, tr, refresh],
  );

  const catGroups = useMemo(() => groupCatalog(), []);

  /** M359：按库文件名找 maven 坐标（catalog + 项目 gradle deps）。找到返回 {coord,repoUrl}，找不到 null（用拷贝兑底）。 */
  const findCoordForLib = useCallback(
    (name: string): { coord: string; repoUrl: string } | null => {
      // 文件名可能像 material-1.12.0.aar / jxl-2.9.3.jar。去掉版本号 + 扩展去匹配 artifact。
      const base = name.replace(/\.(jar|aar)$/i, "");
      const noVer = base.replace(/-\d.*$/, "");
      const catHit = LIBRARY_CATALOG.find(
        (e) => e.artifact.toLowerCase() === noVer.toLowerCase() ||
          e.artifact.toLowerCase() === base.toLowerCase(),
      );
      if (catHit)
        return { coord: mavenCoord(catHit.group, catHit.artifact, catHit.version), repoUrl: catHit.kind === "material" || catHit.kind === "androidx" ? "https://dl.google.com/dl/android/maven2" : "https://repo.maven.apache.org/maven2" };
      // catalog 没中，看项目 gradle deps（同名 artifact）
      const gHit = gradleDeps.find((d) => d.name.toLowerCase() === noVer.toLowerCase() || d.name.toLowerCase() === base.toLowerCase());
      if (gHit) return { coord: mavenCoord(gHit.group, gHit.name, gHit.version), repoUrl: gHit.isAar ? "https://dl.google.com/dl/android/maven2" : "https://repo.maven.apache.org/maven2" };
      return null;
    },
    [gradleDeps],
  );

  /** M345：读项目根 build.gradle / build.gradle.kts + app 子目录，解析依赖
   *  M370：同时解析 fileTree(dir/include) —— 本地库声明，指向真实目录
   *  M371：模块/编译标记/app 配置/构建插件等元信息改到「项目属性」弹窗展示（ProjectPropsDialog），
   *  这里只解析「当前项目被引用的库」。 */
  const scanGradleDeps = useCallback(async () => {
    setGradleBusy(true);
    setGradleMsg(null);
    setGradleScanned(false);
    setGradleDeps([]);
    setGradleUnresolved([]);
    setGradleFileTrees([]);

    // 读单个文件：native.readText 优先（SAF/外部路径），失败再 aiFileIo（相对项目根）
    const readOne = async (abs: string, rel: string): Promise<string> => {
      if (native) {
        try {
          const t = String(native.readText?.(abs) ?? "");
          if (t && !t.startsWith("err:")) return t;
        } catch {}
      }
      if (aiFileIo) {
        try {
          const r = await aiFileIo.read(rel);
          if (r.ok && r.text) return r.text;
        } catch {}
      }
      return "";
    };
    const root = (nativeProjectRoot || "").replace(/[\\/]+$/, "");
    const abs = (p: string) => (root ? root + "/" + p : p);

    // 各文件：根 build.gradle + app/build.gradle（依赖与 fileTree 都在这里）
    const rootBuild = await readOne(abs("build.gradle"), "build.gradle");
    if (!rootBuild) await readOne(abs("build.gradle.kts"), "build.gradle.kts");
    const appBuild = await readOne(abs("app/build.gradle"), "app/build.gradle");
    if (!appBuild) await readOne(abs("app/build.gradle.kts"), "app/build.gradle.kts");

    // 依赖（根 + app build.gradle 的 implementation 等）
    // M370：fileTree(dir/include) 一并解析 —— 本地库声明，无坐标但指向真实目录
    const depTexts = [rootBuild, appBuild].filter(Boolean) as string[];
    if (depTexts.length === 0) {
      setGradleMsg(
        tr("libs.gradle_notfound", "没找到 build.gradle / build.gradle.kts（需在项目根或 app/ 下）"),
      );
      setGradleFileTrees([]);
      setGradleBusy(false);
      return;
    }
    const all = depTexts.flatMap((t) => parseGradleDepsDetailed(t));
    // 去重（同一坐标在多个 gradle 文件出现）
    const seen = new Set<string>();
    const deps = all
      .flatMap((r) => r.deps)
      .filter((d) => {
        const k = d.group + ":" + d.name + ":" + d.version;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    // 未解析变量：同一坐标去重
    const unSeen = new Set<string>();
    const unresolved = all
      .flatMap((r) => r.unresolved)
      .filter((u) => {
        if (unSeen.has(u.coord)) return false;
        unSeen.add(u.coord);
        return true;
      });
    setGradleDeps(deps);
    setGradleUnresolved(unresolved);
    // M370：fileTree 去重（dir+include 相同算同一条）
    const ftSeen = new Set<string>();
    const fts = depTexts
      .flatMap((t) => parseFileTrees(t))
      .filter((ft) => {
        const k = ft.dir + "|" + ft.includes.join(",");
        if (ftSeen.has(k)) return false;
        ftSeen.add(k);
        return true;
      });
    setGradleFileTrees(fts);
    setGradleScanned(true);
    setGradleBusy(false);
    onNote?.(tr("libs.gradle_scanned", "解析到 {n} 条依赖", { n: deps.length }));
  }, [nativeProjectRoot, native, aiFileIo, onNote, tr]);

  /** M345：下载一条 gradle 依赖（优先原生多镜像，浏览器回退 fetch）。
   *  M358/M359：一律下到共享库 /AndroidUIIDE/libs（跨项目复用），不再按「是否打开项目」写到
   *  app/src/main/libs。应用到项目=写 maven 坐标（M359），编译时从共享库取实体（M361），
   *  不预拷进项目目录。 */
  const downloadGradleDep = useCallback(
    async (d: GradleDep) => {
      const key = d.group + ":" + d.name + ":" + d.version;
      if (gradleBusyKey[key] === "downloading") return;
      setGradleBusyKey((m) => ({ ...m, [key]: "downloading" }));
      const fname = gradleDepFname(d);
      // M358/M359：固定下到共享库 localDir（/AndroidUIIDE/libs），不看是否打开项目
      const targetBase: string | null = localDir || null;
      const target = targetBase ? `${targetBase}/${fname}` : null;
      const urls = gradleDepDownloadUrls(d);
      if (targetBase) {
        // M357/M365：系统 DownloadManager（后台 + 通知 + 弹窗）；失败回退 HttpURLConnection
        const res = await dlWithFallback(urls, fname, targetBase);
        if (res.ok) {
          setGradleBusyKey((m) => ({ ...m, [key]: "done" }));
          onNote?.(tr("libs.gradle_dl_done_shared", "{lib} 已下载到共享库（跨项目复用）", { lib: key }));
          void refresh();
        } else {
          setGradleBusyKey((m) => ({ ...m, [key]: "err:" + (res.error || "download failed") }));
          onNote?.(tr("libs.gradle_dl_fail", "{lib} 下载失败：{err}", { lib: key, err: res.error || "?" }));
        }
        return;
      }
      if (target && typeof native?.downloadLib === "function") {
        native.createEntry?.(targetBase!, true);
        let r = "";
        try { r = String(native.downloadLib(JSON.stringify(urls), target) ?? ""); } catch (e2) { r = "throw:" + String(e2); }
        if (r.startsWith("ok")) {
          setGradleBusyKey((m) => ({ ...m, [key]: "done" }));
          onNote?.(tr("libs.gradle_dl_done_shared", "{lib} 已下载到共享库（跨项目复用）", { lib: key }));
          void refresh();
          return;
        }
        setGradleBusyKey((m) => ({ ...m, [key]: "err:" + (r.slice(4) || "download failed") }));
        onNote?.(tr("libs.gradle_dl_fail", "{lib} 下载失败：{err}", { lib: key, err: r.slice(4) || "?" }));
        return;
      }
      // 浏览器回退（web 没有共享库概念，下到浏览器 Downloads；APK 不会走这里）
      for (const url of urls) {
        const r = await fetchBase64(url);
        if (!r.ok) continue;
        if (targetBase && native) {
          native.createEntry?.(targetBase, true);
          const w = native.writeText?.(target!, r.b64);
          if (typeof w === "string" && w.startsWith("ok")) {
            setGradleBusyKey((m) => ({ ...m, [key]: "done" }));
            onNote?.(tr("libs.gradle_dl_done_shared", "{lib} 已下载到共享库（跨项目复用）", { lib: key }));
            void refresh();
            return;
          }
        }
      }
      setGradleBusyKey((m) => ({ ...m, [key]: "err:" + tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") }));
      onNote?.(tr("libs.gradle_dl_fail", "{lib} 下载失败：全部镜像都试过了（网络不通或源 404）", { lib: key }));
    },
    [localDir, native, onNote, tr, refresh, dlWithFallback],
  );

  /** M345：一键下载（只下尚未下载、且不在本地库的） */
  const downloadAllGradleDeps = useCallback(async () => {
    const missing = gradleDeps.filter((d) => {
      const k = d.group + ":" + d.name + ":" + d.version;
      if (gradleBusyKey[k] === "done") return false;
      if (presentNames.has(gradleDepFname(d))) return false;
      return true;
    });
    for (const d of missing) {
      await downloadGradleDep(d);
    }
  }, [gradleDeps, gradleBusyKey, presentNames, downloadGradleDep]);

  /** M360：打开项目时自动检查依赖 + 一键补齐。
   *  M372：native 项目或有 SAF 源（aiFileIo）都自动扫一次，不再需要手动按钮。
   *  不静默自动下载（省流量/可控），只扫出缺失，banner 上「自动补齐」一键下。 */
  const lastAutoScanRoot = useRef<string | null>(null);
  const scanKey = nativeProjectRoot || (aiFileIo ? "io" : null);
  useEffect(() => {
    if (!scanKey) { lastAutoScanRoot.current = null; return; }
    if (lastAutoScanRoot.current === scanKey) return; // 同项目不重扫
    lastAutoScanRoot.current = scanKey;
    void scanGradleDeps();
  }, [scanKey, scanGradleDeps]);

  return (
    <div className="axv-libs-panel">
      <div className="axv-libs-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "local"}
          className={tab === "local" ? "on" : ""}
          onClick={() => setTab("local")}
        >
          {tr("libs.local", "共享库")}{localLibs.length > 0 ? ` (${localLibs.length})` : ""}
        </button>
        <button
          role="tab"
          aria-selected={tab === "project"}
          className={tab === "project" ? "on" : ""}
          onClick={() => setTab("project")}
        >
          {tr("libs.project", "项目库")}{projectLibs.length > 0 ? ` (${projectLibs.length})` : ""}
        </button>
        <button
          role="tab"
          aria-selected={tab === "catalog"}
          className={tab === "catalog" ? "on" : ""}
          onClick={() => setTab("catalog")}
        >
          {tr("libs.catalog", "常用库")}
        </button>
      </div>

      <div className="axv-libs-actions">
        <input
          type="search"
          className="axv-libs-search"
          value={libQuery}
          onChange={(e) => setLibQuery(e.target.value)}
          placeholder={tr("libs.search_hint", "搜库名 / 包名…")}
          aria-label={tr("libs.search", "搜索库")}
        />
        <button type="button" className="axv-libs-btn" onClick={() => setDlOpen(true)}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>download</span>
          {tr("libs.download", "下载库文件")}
        </button>
        <button type="button" className="axv-libs-btn" onClick={() => void refresh()}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
          {tr("refresh", "刷新")}
        </button>
      </div>

      {/* M373：列表上方一键下载（缺的依赖在列表里直接看得到，不再弹警告条） */}
      {tab === "project" && gradleDeps.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "0 8px 6px" }}>
          <button
            type="button"
            className="axv-libs-btn primary"
            style={{ fontSize: 11, padding: "2px 10px", whiteSpace: "nowrap" }}
            disabled={gradleBusy}
            onClick={() => void downloadAllGradleDeps()}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 15, verticalAlign: "middle", marginRight: 3 }}>cloud_download</span>
            {gradleBusy ? tr("libs.downloading", "下载中…") : tr("libs.download_all", "一键下载")}
          </button>
        </div>
      )}

      <div className="axv-libs-list axv-rail-scroll">
        {tab === "local" && (
          <div style={{ fontSize: 10, opacity: 0.6, margin: "2px 6px 6px", lineHeight: 1.5, wordBreak: "break-all" }}>
            {tr("libs.local_hint", "共享库目录：{path}", { path: localDir || "/AndroidUIIDE/libs" })}
          </div>
        )}
        {tab === "project" && gradleScanned && (gradleDeps.length > 0 || gradleFileTrees.length > 0) && (
          <div style={{ fontSize: 10, opacity: 0.6, margin: "2px 6px 6px", lineHeight: 1.5, wordBreak: "break-all" }}>
            {tr("libs.project_hint", "build.gradle：maven {n} 条（下方可下）；本地目录 {dirs}", {
              n: gradleDeps.length,
              dirs: gradleFileTrees.length
                ? gradleFileTrees.map((f) => f.dir).join(", ")
                : tr("libs.none", "无"),
            })}
          </div>
        )}
        {/* M372：build.gradle 解析出的引用库直接进列表（打开项目自动解析，无需按钮） */}
        {tab === "project" && (
          <>
            {gradleMsg && (
              <div className="axv-libs-empty" style={{ padding: "4px 8px", fontSize: 11 }}>{gradleMsg}</div>
            )}
            {gradleScanned && gradleDeps.length === 0 && !gradleMsg && gradleUnresolved.length === 0 && gradleFileTrees.length === 0 && (
              <div className="axv-libs-empty" style={{ padding: "4px 8px", fontSize: 11 }}>
                {tr("libs.gradle_none", "没解析到 maven 依赖（fileTree / project 除外）")}
              </div>
            )}
            {gradleUnresolved.length > 0 && (
              <div
                className="axv-libs-empty"
                style={{ padding: "4px 8px", fontSize: 11 }}
                title={gradleUnresolved.map((u) => u.raw).join("\n")}
              >
                {tr("libs.gradle_unresolved", "{n} 条依赖的版本是变量且本文件未定义，已跳过（在 build.gradle 里给变量赋值后可重新解析）", {
                  n: gradleUnresolved.length,
                })}
              </div>
            )}
            {gradleUnresolved.map((u) => (
              <div key={u.coord} className="axv-libs-item" style={{ alignItems: "center", opacity: 0.6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="axv-libs-item-name" style={{ fontSize: 12 }}>
                    {u.coord.split(":")[1] || u.coord}
                    <span style={{ marginLeft: 6, fontSize: 10 }}>{u.config}</span>
                  </div>
                  <div className="axv-libs-item-rel" style={{ fontSize: 10 }} title={u.raw}>
                    {tr("libs.gradle_unresolved_vars", "未定义变量：{vars}", { vars: u.vars.join(", ") || "?" })}
                  </div>
                </div>
              </div>
            ))}
            {/* M372：fileTree 不再显示声明行 —— dir 并入候选目录、按 include 过滤后直接列库文件 */}
            {gradleDeps.filter((d) => matchGradleDep(d, libQuery)).map((d) => {
              const key = d.group + ":" + d.name + ":" + d.version;
              const st = gradleBusyKey[key] || "";
              const present = presentNames.has(gradleDepFname(d));
              return (
                <div key={key} className="axv-libs-item" style={{ alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="axv-libs-item-name" style={{ fontSize: 12 }}>
                      {(present || st === "done") && <span style={{ color: "#1a7f37", marginRight: 4 }}>✓</span>}
                      {d.name}
                      <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 11 }}>{d.version}</span>
                      <span style={{ opacity: 0.4, marginLeft: 6, fontSize: 10 }}>{d.config}</span>
                    </div>
                    <div className="axv-libs-item-rel" style={{ fontSize: 10, opacity: 0.6 }} title={key}>
                      {d.group}
                    </div>
                  </div>
                  {present || st === "done" ? (
                    <button
                      type="button"
                      className="axv-libs-btn"
                      style={{ whiteSpace: "nowrap", fontSize: 11, padding: "2px 8px", marginRight: 6 }}
                      onClick={() => saveSharedToLibs(gradleDepFname(d))}
                    >
                      {tr("libs.save_libs", "存 libs")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="axv-libs-btn"
                      style={{ whiteSpace: "nowrap", fontSize: 11, padding: "2px 8px", marginRight: 6 }}
                      disabled={st === "downloading"}
                      onClick={() => void downloadGradleDep(d)}
                    >
                      {st === "downloading" ? tr("libs.downloading", "下载中…") : tr("libs.cat_download", "下载")}
                    </button>
                  )}
                  {st && st.startsWith("err:") && (
                    <span style={{ fontSize: 10, color: "#c62828", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={st.slice(4)}>
                      ✗ {st.slice(4)}
                    </span>
                  )}
                </div>
              );
            })}
          </>
        )}
        {tab === "catalog" ? (
          <div>
            <div style={{ fontSize: 11, opacity: 0.6, margin: "4px 6px 8px", lineHeight: 1.5 }}>
              {tr("libs.catalog_hint", "常用库目录：点「下载」自动存入共享库 /AndroidUIIDE/libs，再去「共享库」选择是否应用到项目；打包时项目 libs/ 的库自动进编译。")}
            </div>
            {catGroups.filter((g) => !libQuery.trim() || g.libs.some((e) => matchGradleDep({ name: e.artifact, group: e.group }, libQuery))).map((g) => (
              <div key={g.kind} style={{ margin: "6px 4px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, margin: "2px 6px 6px" }}>
                  {g.label}（{g.libs.length}）
                </div>
                {g.libs.filter((e) => matchGradleDep({ name: e.artifact, group: e.group }, libQuery)).map((e) => {
                  const key = libKey(e);
                  const st = catBusy[key];
                  const present = presentNames.has(e.artifact + "-" + e.version + (e.isAar ? ".aar" : ".jar")) || st === "done";
                  return (
                    <div key={key} className="axv-libs-item" style={{ alignItems: "center" }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="axv-libs-item-name" style={{ fontSize: 12 }}>
                          {present && <span style={{ color: "#1a7f37", marginRight: 4 }}>✓</span>}
                          {e.artifact}
                          <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 11 }}>{e.version}</span>
                        </div>
                        <div className="axv-libs-item-rel" style={{ fontSize: 10, opacity: 0.6 }} title={e.group + ":" + e.artifact + ":" + e.version}>
                          {e.note}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="axv-libs-btn"
                        style={{ whiteSpace: "nowrap", fontSize: 11, padding: "2px 8px", marginRight: 6 }}
                        disabled={st === "downloading" || present}
                        onClick={() => void downloadCat(e)}
                      >
                        {st === "downloading" ? tr("libs.downloading", "下载中…") : present ? tr("libs.cat_present", "已下载") : tr("libs.cat_download", "下载")}
                      </button>
                      {present && (
                        <>
                          <button
                            type="button"
                            className="axv-libs-btn"
                            style={{ whiteSpace: "nowrap", fontSize: 10, padding: "2px 8px", marginRight: 6 }}
                            onClick={() => saveSharedToLibs(e.artifact + "-" + e.version + (e.isAar ? ".aar" : ".jar"))}
                          >
                            {tr("libs.save_libs", "存 libs")}
                          </button>
                          <button
                            type="button"
                            className="axv-libs-btn"
                            style={{ whiteSpace: "nowrap", fontSize: 10, padding: "2px 8px" }}
                            onClick={() => void applyMaven(mavenCoord(e.group, e.artifact, e.version), e.kind === "material" || e.kind === "androidx" ? "https://dl.google.com/dl/android/maven2" : "https://repo.maven.apache.org/maven2", e.artifact)}
                          >
                            {tr("libs.apply_maven", "应用到项目（maven）")}
                          </button>
                        </>
                      )}
                      {st && st.startsWith("err:") && (
                        <span style={{ fontSize: 10, color: "#c62828", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={st.slice(4)}>
                          ✗ {st.slice(4)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : visibleList.length === 0 && !(tab === "project" && (gradleDeps.length > 0 || gradleFileTrees.length > 0 || gradleUnresolved.length > 0)) ? (
          <div className="axv-libs-empty">
            {libQuery.trim()
              ? tr("libs.search_empty", "没匹配「{q}」的库", { q: libQuery.trim() })
              : tr("libs.empty", "暂无库文件")}
            {tab === "project" && !aiFileIo && !nativeProjectRoot
              ? ` (${tr("libs.empty_hint", "需先打开项目目录")})`
              : ""}
          </div>
        ) : (
          visibleList.map((f) => {
            const applied = projectNames.has(f.name);
            const ab = applyBusy[f.name];
            return (
              <div key={f.rel} className="axv-libs-item">
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>archive</span>
                <div className="axv-libs-item-text">
                  <div className="axv-libs-item-name">
                    {f.name}
                    <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>{formatBytes(f.size) || ""}</span>
                  </div>
                  <div className="axv-libs-item-rel">{f.rel}</div>
                </div>
                {tab === "local" ? (
                  applied ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 10, color: "#1a7f37" }}>{tr("libs.applied", "已应用")}</span>
                      <button
                        type="button"
                        className="axv-libs-btn"
                        style={{ fontSize: 10, padding: "1px 6px" }}
                        onClick={() => removeFromProject(f.name)}
                      >
                        {tr("libs.remove", "移除")}
                      </button>
                      {native?.deleteEntry && (
                        <button
                          type="button"
                          className="axv-libs-btn"
                          style={{ fontSize: 10, padding: "1px 6px", color: "#c62828" }}
                          disabled={deleteBusy === f.rel}
                          title={tr("libs.delete_title", "从共享库删除文件")}
                          onClick={() => deleteLocalLib(f)}
                        >
                          {deleteBusy === f.rel ? tr("libs.deleting", "…") : tr("libs.delete", "删除")}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <button
                        type="button"
                        className="axv-libs-btn"
                        style={{ fontSize: 10, padding: "2px 8px", whiteSpace: "nowrap" }}
                        disabled={ab === "applying"}
                        onClick={() => applyToLocalProject(f)}
                      >
                        {ab === "applying" ? tr("libs.applying", "应用中…") : tr("libs.save_libs", "存 libs")}
                      </button>
                      {native?.deleteEntry && (
                        <button
                          type="button"
                          className="axv-libs-btn"
                          style={{ fontSize: 10, padding: "1px 6px", color: "#c62828" }}
                          disabled={deleteBusy === f.rel}
                          title={tr("libs.delete_title", "从共享库删除文件")}
                          onClick={() => deleteLocalLib(f)}
                        >
                          {deleteBusy === f.rel ? tr("libs.deleting", "…") : tr("libs.delete", "删除")}
                        </button>
                      )}
                    </div>
                  )
                ) : (
                  <button
                    type="button"
                    className="axv-libs-btn"
                    style={{ fontSize: 10, padding: "1px 6px" }}
                    onClick={() => removeFromProject(f.name)}
                  >
                    {tr("libs.remove", "移除")}
                  </button>
                )}
              </div>
            );
          })
        )}
        {busy && <div className="axv-libs-loading">{tr("loading", "加载中…")}</div>}
      </div>

      {dlOpen && (
        <div className="axv-libs-dl-overlay" onClick={() => setDlOpen(false)}>
          <div className="axv-libs-dl-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="axv-libs-dl-title">{tr("libs.download", "下载库文件")}</div>
            <label className="axv-libs-field">
              <span>{tr("libs.url", "下载地址")}</span>
              <input
                value={dlUrl}
                onChange={(e) => setDlUrl(e.target.value)}
                placeholder="https://example.com/lib.jar"
              />
            </label>
            <label className="axv-libs-field">
              <span>{tr("libs.file_name", "文件名（可选）")}</span>
              <input
                value={dlName}
                onChange={(e) => setDlName(e.target.value)}
                placeholder="my-lib.jar"
              />
            </label>
            <div className="axv-libs-hint">
              {tr("libs.save_to", "保存到 {tab}", { tab: tab === "local" ? tr("libs.local", "共享库") : tr("libs.project", "项目库") })}
            </div>
            <div className="axv-libs-dl-actions">
              <button type="button" className="axv-libs-btn" onClick={() => setDlOpen(false)}>
                {tr("cancel", "取消")}
              </button>
              <button
                type="button"
                className="axv-libs-btn primary"
                disabled={dlBusy || !dlUrl.trim()}
                onClick={() => void doDownload()}
              >
                {dlBusy ? tr("libs.downloading", "正在下载…") : tr("libs.start_download", "开始下载")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
