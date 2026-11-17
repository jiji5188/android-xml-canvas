// components/LibsPanel.tsx — M295：库管理面板（本地库 / 项目库 + 下载）
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  parseGradleProperties,
  parseSettingsModules,
  parseSettingsRepos,
  parseAppConfig,
  parseBuildscriptClasspath,
  gradleDepDownloadUrls,
  gradleDepFname,
  type GradleDep,
  type GradleUnresolved,
  type GradleProps,
  type GradleRepo,
  type AppConfig,
  type ClasspathDep,
} from "@/lib/xml/gradle-deps";

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
      .map((it: { name: string; path?: string }) => ({
        name: it.name,
        rel: it.path || `${abs}/${it.name}`,
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
  const [gradleProps, setGradleProps] = useState<GradleProps | null>(null);
  const [gradleModules, setGradleModules] = useState<string[]>([]);
  const [gradleRootName, setGradleRootName] = useState<string | undefined>(undefined);
  const [gradleRepos, setGradleRepos] = useState<GradleRepo[]>([]);
  const [gradleAppConfig, setGradleAppConfig] = useState<AppConfig | null>(null);
  const [gradleClasspath, setGradleClasspath] = useState<ClasspathDep[]>([]);
  const [gradleScanned, setGradleScanned] = useState(false);
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
   *  M358：彻底移除 /app/libs 适配，只认标准位置 app/src/main/libs。
   *  共享库 /AndroidUIIDE/libs 是另一回事（跨项目复用，在「共享库」tab 里）。 */
  const projectLibsBases = useMemo(() => {
    if (!nativeProjectRoot) return [] as string[];
    const root = nativeProjectRoot.replace(/[\\/]+$/, "");
    return [`${root}/app/src/main/libs`];
  }, [nativeProjectRoot]);
  /** 首选写入目录（应用到项目 / gradle 依赖下载都写这里） */
  const primaryLibBase = projectLibsBases[0] ?? null;

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
        // 项目库：native 项目根下标准 + 旧 libs 目录（见 projectLibsBases）
        if (nativeProjectRoot && native) {
          let all: LibFile[] = [];
          for (const base of projectLibsBases) {
            native.createEntry?.(base, true);
            const items = listDirViaNative(base);
            all = all.concat(items);
          }
          setProjectLibs(all);
        } else if (aiFileIo) {
          const candidates = ["app/src/main/libs"];
          let all: LibFile[] = [];
          for (const c of candidates) {
            const items = await listDirViaIo(aiFileIo, c);
            all = all.concat(items.map((f) => ({ ...f, rel: f.rel })));
          }
          setProjectLibs(all);
        } else {
          setProjectLibs([]);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [tab, localDir, nativeProjectRoot, aiFileIo, native, refreshKey, projectLibsBases]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doDownload = useCallback(async () => {
    const url = dlUrl.trim();
    if (!url) return;
    const name = dlName.trim() || url.split("/").pop() || "library.jar";
    setDlBusy(true);
    onNote?.(tr("libs.downloading", "正在下载…"));
    // 保存目标：当前 tab 对应的 libs 目录
    let targetBase = tab === "local" ? localDir : null;
    if (!targetBase && nativeProjectRoot && native) {
      targetBase = `${nativeProjectRoot.replace(/[\\/]+$/, "")}/libs`;
    }
    const target = targetBase ? `${targetBase}/${name}` : null;

    // M344：优先原生 HttpURLConnection（多镜像 + 绕 CORS/WebView 限制），浏览器再回退 fetch
    if (target && typeof native?.downloadLib === "function") {
      native.createEntry?.(targetBase!, true);
      // 用户输入的是完整 URL，直接传给原生下载器（只试这一个源）
      const urlsJson = JSON.stringify([url]);
      let r = "";
      try { r = String(native.downloadLib(urlsJson, target) ?? ""); } catch (e2) { r = "throw:" + String(e2); }
      if (r.startsWith("ok")) {
        const parts = r.slice(3).split("@");
        const savedPath = parts[2] || "";
        const isFallback = parts[3] === "fallback";
        if (isFallback && savedPath) {
          // 项目 libs 写不了 → 存到应用私有目录，尝试拷回
          try {
            const b64 = native.readBase64?.(savedPath);
            if (b64) {
              const w = native.writeText?.(target, b64);
              if (typeof w === "string" && w.startsWith("ok")) {
                onNote?.(tr("libs.download_saved", "已保存到 {path}", { path: target }));
                setDlOpen(false); setDlUrl(""); setDlName("");
                void refresh(); setDlBusy(false); return;
              }
            }
          } catch {}
          setDlBusy(false);
          onNote?.(tr("libs.cat_fallback", "{lib} 已下载到临时目录 {p}（项目 libs 写不了，请手动拷进去）", { lib: name, p: savedPath }));
          return;
        }
        onNote?.(tr("libs.download_saved", "已保存到 {path}", { path: target }));
        setDlOpen(false); setDlUrl(""); setDlName("");
        void refresh();
        setDlBusy(false);
        return;
      }
      // 原生下载失败 → 走浏览器 fetch 回退
      onNote?.(tr("libs.native_dl_failed", "原生下载失败（{err}），改用浏览器下载", { err: r.slice(4) || "?" }));
    }

    // 浏览器回退：fetch + base64
    const r = await fetchBase64(url);
    if (!r.ok) {
      onNote?.(tr("libs.download_failed", "下载失败：{err}", { err: r.error || "unknown" }));
      setDlBusy(false);
      return;
    }
    if (targetBase && native) {
      native.createEntry?.(targetBase, true);
      const tgt = `${targetBase}/${name}`;
      const w = native.writeText?.(tgt, r.b64);
      const ok = typeof w === "string" && w.startsWith("ok");
      onNote?.(
        ok
          ? tr("libs.download_saved", "已保存到 {path}", { path: tgt })
          : tr("libs.download_save_failed", "保存失败：{msg}", { msg: w || "unknown" }),
      );
      if (ok) {
        setDlOpen(false);
        setDlUrl("");
        setDlName("");
        void refresh();
      }
    } else {
      onNote?.(tr("libs.download_no_target", "无法保存：当前没有可写的库目录"));
    }
    setDlBusy(false);
  }, [dlUrl, dlName, tab, localDir, nativeProjectRoot, native, onNote, tr, refresh]);

  const currentList = tab === "local" ? localLibs : projectLibs;

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
    [native, nativeProjectRoot, localDir, onNote, tr, refresh],
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
          onNote?.(tr("libs.apply_done", "{lib} 已应用到项目 app/src/main/libs/（打包时会带上）", { lib: f.name }));
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

  /** M345：读项目根 build.gradle / build.gradle.kts + app 子目录，解析依赖
   *  M347：同时读 gradle.properties（编译标记）+ settings.gradle（模块）+ 根 build.gradle（buildscript classpath）
   *  时序：settings.gradle → 根 build.gradle → app/build.gradle；gradle.properties 全局开关 */
  const scanGradleDeps = useCallback(async () => {
    setGradleBusy(true);
    setGradleMsg(null);
    setGradleScanned(false);
    setGradleDeps([]);
    setGradleUnresolved([]);
    setGradleProps(null);
    setGradleModules([]);
    setGradleRootName(undefined);
    setGradleRepos([]);
    setGradleAppConfig(null);
    setGradleClasspath([]);

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

    // 各文件（按用户给的时序）
    const settings = await readOne(abs("settings.gradle"), "settings.gradle");
    if (!settings) await readOne(abs("settings.gradle.kts"), "settings.gradle.kts");
    const rootBuild = await readOne(abs("build.gradle"), "build.gradle");
    if (!rootBuild) await readOne(abs("build.gradle.kts"), "build.gradle.kts");
    const appBuild = await readOne(abs("app/build.gradle"), "app/build.gradle");
    if (!appBuild) await readOne(abs("app/build.gradle.kts"), "app/build.gradle.kts");
    const propsText = await readOne(abs("gradle.properties"), "gradle.properties");

    // 模块 + 根名 + 仓库（settings.gradle）
    if (settings) {
      const sm = parseSettingsModules(settings);
      setGradleModules(sm.modules);
      setGradleRootName(sm.rootProjectName);
      setGradleRepos(parseSettingsRepos(settings));
    }
    // 编译标记（gradle.properties）
    if (propsText) {
      setGradleProps(parseGradleProperties(propsText));
    }
    // app 模块配置（包名 / sdk / 版本 / 签名）
    if (appBuild) {
      setGradleAppConfig(parseAppConfig(appBuild));
    }
    // buildscript classpath（根 build.gradle，构建期插件，只标记展示）
    if (rootBuild) {
      const cp = parseBuildscriptClasspath(rootBuild);
      if (cp.length) setGradleClasspath(cp);
    }

    // 依赖（根 + app build.gradle 的 implementation 等）
    const depTexts = [rootBuild, appBuild].filter(Boolean) as string[];
    if (depTexts.length === 0) {
      setGradleMsg(
        tr("libs.gradle_notfound", "没找到 build.gradle / build.gradle.kts（需在项目根或 app/ 下）"),
      );
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
    setGradleScanned(true);
    setGradleBusy(false);
    onNote?.(tr("libs.gradle_scanned", "解析到 {n} 条依赖", { n: deps.length }));
  }, [nativeProjectRoot, native, aiFileIo, onNote, tr]);

  /** M345：下载一条 gradle 依赖（优先原生多镜像，浏览器回退 fetch） */
  const downloadGradleDep = useCallback(
    async (d: GradleDep) => {
      const key = d.group + ":" + d.name + ":" + d.version;
      if (gradleBusyKey[key] === "downloading") return;
      setGradleBusyKey((m) => ({ ...m, [key]: "downloading" }));
      const fname = gradleDepFname(d);
      // M346：打开了项目就下到项目标准 libs 目录（app/src/main/libs），否则落本地库暂存目录
      const targetBase: string | null = primaryLibBase || localDir || null;
      const target = targetBase ? `${targetBase}/${fname}` : null;
      const inProject = !!primaryLibBase;
      const urls = gradleDepDownloadUrls(d);
      if (target && typeof native?.downloadLib === "function") {
        native.createEntry?.(targetBase!, true);
        let r = "";
        try { r = String(native.downloadLib(JSON.stringify(urls), target) ?? ""); } catch (e2) { r = "throw:" + String(e2); }
        if (r.startsWith("ok")) {
          setGradleBusyKey((m) => ({ ...m, [key]: "done" }));
          onNote?.(inProject
            ? tr("libs.gradle_dl_done_proj", "{lib} 已下载到项目 app/src/main/libs/（打包时自动进编译）", { lib: key })
            : tr("libs.gradle_dl_done", "{lib} 已下载到本地库", { lib: key }));
          void refresh();
          return;
        }
        setGradleBusyKey((m) => ({ ...m, [key]: "err:" + (r.slice(4) || "download failed") }));
        onNote?.(tr("libs.gradle_dl_fail", "{lib} 下载失败：{err}", { lib: key, err: r.slice(4) || "?" }));
        return;
      }
      // 浏览器回退
      for (const url of urls) {
        const r = await fetchBase64(url);
        if (!r.ok) continue;
        if (targetBase && native) {
          native.createEntry?.(targetBase, true);
          const w = native.writeText?.(target!, r.b64);
          if (typeof w === "string" && w.startsWith("ok")) {
            setGradleBusyKey((m) => ({ ...m, [key]: "done" }));
            onNote?.(inProject
              ? tr("libs.gradle_dl_done_proj", "{lib} 已下载到项目 app/src/main/libs/（打包时自动进编译）", { lib: key })
              : tr("libs.gradle_dl_done", "{lib} 已下载到本地库", { lib: key }));
            void refresh();
            return;
          }
        }
      }
      setGradleBusyKey((m) => ({ ...m, [key]: "err:" + tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") }));
      onNote?.(tr("libs.gradle_dl_fail", "{lib} 下载失败：全部镜像都试过了（网络不通或源 404）", { lib: key }));
    },
    [localDir, primaryLibBase, native, onNote, tr, refresh],
  );

  /** M345：全部下载（只下尚未下载的） */
  const downloadAllGradleDeps = useCallback(async () => {
    const missing = gradleDeps.filter((d) => {
      const k = d.group + ":" + d.name + ":" + d.version;
      return gradleBusyKey[k] !== "done";
    });
    for (const d of missing) {
      await downloadGradleDep(d);
    }
  }, [gradleDeps, gradleBusyKey, downloadGradleDep]);

  return (
    <div className="axv-libs-panel">
      <div className="axv-libs-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "local"}
          className={tab === "local" ? "on" : ""}
          onClick={() => setTab("local")}
        >
          {tr("libs.local", "共享库")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "project"}
          className={tab === "project" ? "on" : ""}
          onClick={() => setTab("project")}
        >
          {tr("libs.project", "项目库")}
        </button>
        <button
          role="tab"
          aria-selected={tab === "catalog"}
          className={tab === "catalog" ? "on" : ""}
          onClick={() => setTab("catalog")}
        >
          {tr("libs.catalog", "lib 库下载")}
        </button>
      </div>

      <div className="axv-libs-actions">
        <button type="button" className="axv-libs-btn" onClick={() => setDlOpen(true)}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>download</span>
          {tr("libs.download", "下载库文件")}
        </button>
        <button type="button" className="axv-libs-btn" onClick={() => void refresh()}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
          {tr("refresh", "刷新")}
        </button>
      </div>

      <div className="axv-libs-list axv-rail-scroll">
        {tab === "local" && (
          <div style={{ fontSize: 10, opacity: 0.6, margin: "2px 6px 6px", lineHeight: 1.5, wordBreak: "break-all" }}>
            {tr("libs.local_hint", "共享库目录：{path}", { path: localDir || "/AndroidUIIDE/libs" })}
          </div>
        )}
        {tab === "catalog" ? (
          <div>
            <div style={{ fontSize: 11, opacity: 0.6, margin: "4px 6px 8px", lineHeight: 1.5 }}>
              {tr("libs.catalog_hint", "常用库目录：点「下载」自动存入共享库 /AndroidUIIDE/libs，再去「共享库」选择是否应用到项目；打包时项目 libs/ 的库自动进编译。")}
            </div>
            {catGroups.map((g) => (
              <div key={g.kind} style={{ margin: "6px 4px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, margin: "2px 6px 6px" }}>
                  {g.label}（{g.libs.length}）
                </div>
                {g.libs.map((e) => {
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
        ) : currentList.length === 0 ? (
          <div className="axv-libs-empty">
            {tr("libs.empty", "暂无库文件")}
            {tab === "project" && !aiFileIo && !nativeProjectRoot
              ? ` (${tr("libs.empty_hint", "需先打开项目目录")})`
              : ""}
          </div>
        ) : (
          currentList.map((f) => {
            const applied = projectNames.has(f.name);
            const ab = applyBusy[f.name];
            return (
              <div key={f.rel} className="axv-libs-item">
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>archive</span>
                <div className="axv-libs-item-text">
                  <div className="axv-libs-item-name">{f.name}</div>
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
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="axv-libs-btn"
                      style={{ fontSize: 10, padding: "2px 8px", whiteSpace: "nowrap" }}
                      disabled={!canApply || ab === "applying"}
                      onClick={() => applyToLocalProject(f)}
                    >
                      {ab === "applying" ? tr("libs.applying", "应用中…") : tr("libs.apply", "应用到项目")}
                    </button>
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

      {/* M345：从 build.gradle 自动解析并下载依赖 */}
      <div className="axv-libs-gradle">
        <div className="axv-libs-gradle-head">
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>code</span>
          <span style={{ flex: 1, fontSize: 12 }}>{tr("libs.gradle_title", "build.gradle 依赖")}</span>
          <button
            type="button"
            className="axv-libs-btn"
            style={{ fontSize: 11, padding: "2px 8px", whiteSpace: "nowrap" }}
            disabled={gradleBusy}
            onClick={() => void scanGradleDeps()}
          >
            {gradleBusy ? tr("libs.gradle_scanning", "解析中…") : tr("libs.gradle_scan", "解析 build.gradle")}
          </button>
          {gradleDeps.length > 0 && (
            <button
              type="button"
              className="axv-libs-btn primary"
              style={{ fontSize: 11, padding: "2px 8px", marginLeft: 6, whiteSpace: "nowrap" }}
              onClick={() => void downloadAllGradleDeps()}
            >
              {tr("libs.gradle_download_all", "全部下载")}
            </button>
          )}
        </div>
        {gradleMsg && (
          <div className="axv-libs-gradle-msg">{gradleMsg}</div>
        )}
        {gradleScanned && (
          <div className="axv-libs-gradle-meta">
            {(gradleModules.length > 0 || gradleRootName) && (
              <div className="axv-libs-gradle-meta-row" title={tr("libs.gradle_meta_settings", "来自 settings.gradle")}>
                <span className="axv-libs-gradle-meta-k">{tr("libs.gradle_modules", "模块")}</span>
                <span className="axv-libs-gradle-meta-v">
                  {gradleRootName ? tr("libs.gradle_rootname", "根工程 {name}", { name: gradleRootName }) : " "}{" "}
                  {gradleModules.join(", ") || "—"}
                </span>
              </div>
            )}
            {gradleProps && (
              <div className="axv-libs-gradle-meta-row" title={tr("libs.gradle_meta_props", "来自 gradle.properties（全局编译开关）")}>
                <span className="axv-libs-gradle-meta-k">{tr("libs.gradle_flags", "编译标记")}</span>
                <span className="axv-libs-gradle-meta-v">
                  {gradleProps.flags.length === 0 &&
                    [gradleProps.minSdk, gradleProps.targetSdk, gradleProps.compileSdk].filter(Boolean)
                      .map((s) => s as string)
                      .join(" · ")}
                  {gradleProps.flags.map((f) => (
                    <span key={f.key} className="axv-libs-flag" title={f.key}>
                      {f.value === "true" ? f.key.replace(/^android\./, "") : `${f.key.replace(/^android\./, "")}=${f.value}`}
                    </span>
                  ))}
                  {[gradleProps.minSdk, gradleProps.targetSdk, gradleProps.compileSdk]
                    .filter(Boolean)
                    .map((s, i) => (
                      <span key={i} className="axv-libs-flag axv-libs-flag-sdk">
                        {(["minSdk", "targetSdk", "compileSdk"] as const)[i]} = {s}
                      </span>
                    ))}
                </span>
              </div>
            )}
            {gradleRepos.length > 0 && (
              <div className="axv-libs-gradle-meta-row" title={tr("libs.gradle_meta_repos", "来自 settings.gradle（依赖仓库）")}>
                <span className="axv-libs-gradle-meta-k">{tr("libs.gradle_repos", "仓库")}</span>
                <span className="axv-libs-gradle-meta-v" style={{ opacity: 0.85 }}>
                  {gradleRepos.map((r) => (
                    <span key={r.url || r.name} className="axv-libs-flag axv-libs-flag-repo" title={r.url || r.name}>
                      {r.url ? r.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : r.name}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {gradleAppConfig &&
              (gradleAppConfig.namespace ||
                gradleAppConfig.applicationId ||
                gradleAppConfig.minSdk ||
                gradleAppConfig.targetSdk ||
                gradleAppConfig.compileSdk ||
                gradleAppConfig.versionName) && (
                <div className="axv-libs-gradle-meta-row" title={tr("libs.gradle_meta_app", "来自 app/build.gradle")}>
                  <span className="axv-libs-gradle-meta-k">{tr("libs.gradle_app", "app")}</span>
                  <span className="axv-libs-gradle-meta-v">
                    {(gradleAppConfig.applicationId || gradleAppConfig.namespace) && (
                      <span className="axv-libs-flag" title={tr("libs.gradle_pkg", "包名")}>
                        {(gradleAppConfig.applicationId || gradleAppConfig.namespace) as string}
                      </span>
                    )}
                    {([
                      ["compileSdk", gradleAppConfig.compileSdk],
                      ["minSdk", gradleAppConfig.minSdk],
                      ["targetSdk", gradleAppConfig.targetSdk],
                    ] as const)
                      .filter(([, v]) => v)
                      .map(([k, v]) => (
                        <span key={k} className="axv-libs-flag axv-libs-flag-sdk">
                          {k} = {v}
                        </span>
                      ))}
                    {gradleAppConfig.versionName && (
                      <span className="axv-libs-flag">v{gradleAppConfig.versionName}</span>
                    )}
                    {gradleAppConfig.hasSigning && (
                      <span className="axv-libs-flag axv-libs-flag-sign" title={tr("libs.gradle_signing", "app/build.gradle 配了 signingConfigs")}>
                        {tr("libs.gradle_signed", "已配签名")}
                      </span>
                    )}
                  </span>
                </div>
              )}
            {gradleClasspath.length > 0 && (
              <div className="axv-libs-gradle-meta-row" title={tr("libs.gradle_meta_classpath", "根 build.gradle buildscript（构建期插件，不进运行时）")}>
                <span className="axv-libs-gradle-meta-k">{tr("libs.gradle_classpath", "构建插件")}</span>
                <span className="axv-libs-gradle-meta-v" style={{ opacity: 0.7 }}>
                  {gradleClasspath.map((c) => `${c.name}-${c.version}`).join(", ")}
                </span>
              </div>
            )}
          </div>
        )}
        {gradleScanned && gradleDeps.length === 0 && !gradleMsg && gradleUnresolved.length === 0 && (
          <div className="axv-libs-gradle-msg">{tr("libs.gradle_none", "没解析到 maven 依赖（fileTree / project 除外）")}</div>
        )}
        {gradleUnresolved.length > 0 && (
          <div className="axv-libs-gradle-msg" title={gradleUnresolved.map((u) => u.raw).join("\n")}>
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
        {gradleDeps.map((d) => {
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
              <button
                type="button"
                className="axv-libs-btn"
                style={{ whiteSpace: "nowrap", fontSize: 11, padding: "2px 8px", marginRight: 6 }}
                disabled={st === "downloading" || present || st === "done"}
                onClick={() => void downloadGradleDep(d)}
              >
                {st === "downloading" ? tr("libs.downloading", "下载中…") : present || st === "done" ? tr("libs.cat_present", "已下载") : tr("libs.cat_download", "下载")}
              </button>
              {st && st.startsWith("err:") && (
                <span style={{ fontSize: 10, color: "#c62828", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={st.slice(4)}>
                  ✗ {st.slice(4)}
                </span>
              )}
            </div>
          );
        })}
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
