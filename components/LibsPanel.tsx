// components/LibsPanel.tsx — M295：库管理面板（本地库 / 项目库 + 下载）
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { nativeBridge } from "@/lib/xml/native-save";
import type { AiFileIo } from "@/lib/xml/ai-tools";

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

type LibTab = "local" | "project";

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
  const [dlOpen, setDlOpen] = useState(false);
  const [dlUrl, setDlUrl] = useState("");
  const [dlName, setDlName] = useState("");
  const [dlBusy, setDlBusy] = useState(false);

  const native = nativeBridge();

  // 本地库目录：优先 native 默认工作目录下的 libs，没有就 /storage/emulated/0/AndroidUIIDE/libs
  const localDir = useMemo(() => {
    if (!native) return null;
    const def = native.getDefaultWorkspace?.();
    if (def) return `${def.replace(/[\\/]+$/, "")}/libs`;
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
        {currentList.length === 0 ? (
          <div className="axv-libs-empty">
            {tr("libs.empty", "暂无库文件")}
            {tab === "project" && !aiFileIo && !nativeProjectRoot
              ? ` (${tr("libs.empty_hint", "需先打开项目目录")})`
              : ""}
          </div>
        ) : (
          currentList.map((f) => (
            <div key={f.rel} className="axv-libs-item">
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>archive</span>
              <div className="axv-libs-item-text">
                <div className="axv-libs-item-name">{f.name}</div>
                <div className="axv-libs-item-rel">{f.rel}</div>
              </div>
            </div>
          ))
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
