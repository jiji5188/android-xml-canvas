// components/LibsPanel.tsx — M295：库管理面板（本地库 / 项目库 + 下载）
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nativeBridge } from "@/lib/xml/native-save";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import {
  LIBRARY_CATALOG,
  groupCatalog,
  libKey,
  libDownloadUrls,
  type LibEntry,
} from "@/lib/xml/library-catalog";

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
        // 项目库：优先 native 项目根下的 libs / app/libs
        if (nativeProjectRoot && native) {
          const bases = [`${nativeProjectRoot.replace(/[\\/]+$/, "")}/libs`, `${nativeProjectRoot.replace(/[\\/]+$/, "")}/app/libs`];
          let all: LibFile[] = [];
          for (const base of bases) {
            native.createEntry?.(base, true);
            const items = listDirViaNative(base);
            all = all.concat(items);
          }
          setProjectLibs(all);
        } else if (aiFileIo) {
          const candidates = ["libs", "app/libs"];
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
  }, [tab, localDir, nativeProjectRoot, aiFileIo, native, refreshKey]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const doDownload = useCallback(async () => {
    const url = dlUrl.trim();
    if (!url) return;
    const name = dlName.trim() || url.split("/").pop() || "library.jar";
    setDlBusy(true);
    onNote?.(tr("libs.downloading", "正在下载…"));
    const r = await fetchBase64(url);
    if (!r.ok) {
      onNote?.(tr("libs.download_failed", "下载失败：{err}", { err: r.error || "unknown" }));
      setDlBusy(false);
      return;
    }
    // 保存目标：当前 tab 对应的 libs 目录
    let targetBase = tab === "local" ? localDir : null;
    if (!targetBase && nativeProjectRoot && native) {
      targetBase = `${nativeProjectRoot.replace(/[\\/]+$/, "")}/libs`;
    }
    if (targetBase && native) {
      native.createEntry?.(targetBase, true);
      const target = `${targetBase}/${name}`;
      const w = native.writeText?.(target, r.b64);
      const ok = typeof w === "string" && w.startsWith("ok");
      onNote?.(
        ok
          ? tr("libs.download_saved", "已保存到 {path}", { path: target })
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
          onNote?.(tr("libs.cat_download_saved", "{lib} 已下载到本地库（去「本地库」点「应用到项目」加入项目）", { lib: e.artifact }));
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

  /** 应用到打开的项目：/AndroidUIIDE/libs/x → 项目/libs/x */
  const applyToLocalProject = useCallback(
    (f: LibFile) => {
      if (!canApply || !nativeProjectRoot || !native) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
        return;
      }
      const dstBase = `${nativeProjectRoot.replace(/[\\/]+$/, "")}/libs`;
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
          onNote?.(tr("libs.apply_done", "{lib} 已应用到项目 libs/（打包时会带上）", { lib: f.name }));
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
    [canApply, nativeProjectRoot, native, onNote, tr, refresh],
  );

  /** 从项目移除：删 项目/libs/x */
  const removeFromProject = useCallback(
    (name: string) => {
      if (!nativeProjectRoot || !native) return;
      const dst = `${nativeProjectRoot.replace(/[\\/]+$/, "")}/libs/${name}`;
      try {
        const r = String(native.deleteEntry?.(dst, false) ?? "");
        if (r.startsWith("err:")) {
          onNote?.(tr("libs.remove_fail", "{lib} 移除失败：{err}", { lib: name, err: r.slice(4) }));
          return;
        }
        let p: { ok?: boolean } = {};
        try { p = JSON.parse(r || "{}"); } catch { p = {}; }
        if (p?.ok) {
          onNote?.(tr("libs.remove_done", "{lib} 已从项目移除", { lib: name }));
          void refresh();
        } else {
          onNote?.(tr("libs.remove_fail", "{lib} 移除失败：{err}", { lib: name, err: "?" }));
        }
      } catch {
        onNote?.(tr("libs.remove_fail", "{lib} 移除失败", { lib: name, err: "?" }));
      }
    },
    [nativeProjectRoot, native, onNote, tr, refresh],
  );

  const catGroups = useMemo(() => groupCatalog(), []);

  return (
    <div className="axv-libs-panel">
      <div className="axv-libs-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "local"}
          className={tab === "local" ? "on" : ""}
          onClick={() => setTab("local")}
        >
          {tr("libs.local", "本地库")}
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
            {tr("libs.local_hint", "本地库目录：{path}", { path: localDir || "/AndroidUIIDE/libs" })}
          </div>
        )}
        {tab === "catalog" ? (
          <div>
            <div style={{ fontSize: 11, opacity: 0.6, margin: "4px 6px 8px", lineHeight: 1.5 }}>
              {tr("libs.catalog_hint", "常用库目录：点「下载」自动存入本地库 /AndroidUIIDE/libs，再去「本地库」选择是否应用到项目；打包时项目 libs/ 的库自动进编译。")}
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
              {tr("libs.save_to", "保存到 {tab}", { tab: tab === "local" ? tr("libs.local", "本地库") : tr("libs.project", "项目库") })}
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
