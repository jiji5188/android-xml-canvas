"use client";

// components/ApkRepackDialog.tsx — M212：导入 APK → 换原始资源 → 重签名
//
// 用途：手上有一个别人给的 / 从 Studio 导出的 APK，只想改几张图、几个 assets 文件，
// 不想重新编译整个项目。这里选 APK → 列出条目 → 挑要换的 → 选本地新文件 → 重签。
//
// 明确的限制（界面上会写出来）：layout/values 是编译过的二进制，改不了；只换「原样存着的文件」。

import { useCallback, useMemo, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import {
  hasApkRepack,
  isReplaceableEntry,
  listApkEntries,
  pickApk,
  repackApk,
  type ApkEntry,
} from "@/lib/xml/apk-repack";

export interface ApkRepackSigning {
  storeFile: string;
  storePass: string;
  alias: string;
  keyPass?: string;
}

export interface ApkRepackDialogProps {
  signing: ApkRepackSigning | null;
  onClose: () => void;
  /** 成功后回调（已解出绝对路径） */
  onDone?: (path: string) => void;
  /** 顶部提示（例如签名配置没填全） */
  onNote?: (msg: string) => void;
}

interface PickState {
  name: string;
  dataUrl: string;
  bytes: number;
}

function readFileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error(String(fr.error || "读取失败")));
    fr.onload = () => {
      const s = String(fr.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    fr.readAsDataURL(file);
  });
}

function kb(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(2)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

export function ApkRepackDialog({ signing, onClose, onDone, onNote }: ApkRepackDialogProps) {
  const supported = useMemo(() => hasApkRepack(), []);
  const [apkPath, setApkPath] = useState("");
  const [apkName, setApkName] = useState("");
  const [entries, setEntries] = useState<ApkEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState<Record<string, PickState>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [okPath, setOkPath] = useState("");

  const pickApkFile = useCallback(async () => {
    setErr("");
    setBusy(tt("选择 APK…"));
    const r = await pickApk();
    setBusy("");
    if (r.err) {
      if (r.err !== "已取消" && r.err !== "canceled") setErr(r.err);
      return;
    }
    if (!r.path) {
      setErr(tt("没拿到文件路径"));
      return;
    }
    const l = listApkEntries(r.path);
    if (l.error) {
      setErr(l.error);
      return;
    }
    setApkPath(r.path);
    setApkName(r.name || r.path.split(/[\\/]/).pop() || "app.apk");
    setEntries(l.entries);
    setPicked({});
  }, []);

  const pickReplace = useCallback(async (entryName: string) => {
    // 桌面/网页版也能用：走 <input type=file>
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "*/*";
    const file = await new Promise<File | null>((resolve) => {
      input.onchange = () => resolve(input.files && input.files[0] ? input.files[0] : null);
      // 新版浏览器支持 cancel 事件；用户在对话框直接关掉时不再挂着
      input.oncancel = () => resolve(null);
      input.click();
    });
    if (!file) return;
    try {
      const b64 = await readFileBase64(file);
      setPicked((p) => ({ ...p, [entryName]: { name: file.name, dataUrl: b64, bytes: file.size } }));
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  const doRepack = useCallback(async () => {
    if (!apkPath) return;
    if (!signing || !signing.storeFile || !signing.storePass || !signing.alias) {
      onNote?.(tt("先在签名面板填好 keystore / 口令 / alias，再来重签"));
      setErr(tt("签名配置不完整：需要 keystore 路径、口令、alias"));
      return;
    }
    setErr("");
    setOkPath("");
    setBusy(tt("重新打包并签名…"));
    const replacements = Object.entries(picked).map(([name, p]) => ({ name, base64: p.dataUrl }));
    const baseName = (apkName || "app.apk").replace(/\.apk$/i, "");
    const r = await repackApk({
      apk: apkPath,
      replacements,
      keystore: signing.storeFile,
      storePass: signing.storePass,
      alias: signing.alias,
      keyPass: signing.keyPass,
      outName: `${baseName}-resigned.apk`,
    });
    setBusy("");
    if (r.ok && r.path) {
      setOkPath(r.path);
      onDone?.(r.path);
    } else {
      setErr(`${r.step ? `[${r.step}] ` : ""}${r.log || tt("重打包失败")}`);
    }
  }, [apkPath, apkName, picked, signing, onDone, onNote]);

  const shown = useMemo(() => {
    if (!entries) return [];
    const f = filter.trim().toLowerCase();
    const list = f ? entries.filter((e) => e.name.toLowerCase().includes(f)) : entries;
    return list.slice(0, 400);
  }, [entries, filter]);

  const pickedCount = Object.keys(picked).length;

  return (
    <div className="axv-saveas-mask" role="dialog" aria-modal="true">
      <div
        className="axv-saveas"
        style={{ width: "min(720px, 94vw)", maxHeight: "86vh", display: "flex", flexDirection: "column" }}
      >
        <div className="axv-saveas-title">{tt("导入 APK 换图重签")}</div>

        {!supported ? (
          <div className="axv-sign-hint" style={{ marginBottom: 8 }}>
            {tt("此环境不支持（需要手机 App 端）：网页版无法读写 APK")}
          </div>
        ) : null}

        <div className="axv-sign-hint" style={{ marginBottom: 8 }}>
          {tt("能换：图片（png/webp/jpg）、assets、res/raw、lib、任意原始文件。改不了：layout/values 这类编译过的 XML 和 resources.arsc——那需要整套反编译。")}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" onClick={() => void pickApkFile()} disabled={!!busy || !supported}>
            {entries ? tt("换一个 APK") : tt("选择 APK 文件")}
          </button>
          {apkName ? (
            <span style={{ fontSize: 12, opacity: 0.75, wordBreak: "break-all" }}>
              {apkName}
              {entries ? ` · ${entries.length} ${tt("个条目")}` : ""}
            </span>
          ) : null}
        </div>

        {entries ? (
          <>
            <input
              className="axv-sign-input"
              style={{ marginTop: 10 }}
              placeholder={tt("筛选条目，例如 drawable / assets / icon")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div
              style={{
                marginTop: 8,
                flex: 1,
                minHeight: 160,
                overflow: "auto",
                border: "1px solid rgba(0,0,0,.1)",
                borderRadius: 8,
              }}
            >
              {shown.map((e) => {
                const can = isReplaceableEntry(e.name);
                const p = picked[e.name];
                return (
                  <div
                    key={e.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "4px 8px",
                      borderBottom: "1px solid rgba(0,0,0,.05)",
                      fontSize: 12,
                    }}
                  >
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        opacity: can ? 1 : 0.45,
                      }}
                      title={e.name}
                    >
                      {e.name}
                    </span>
                    <span style={{ opacity: 0.55, fontVariantNumeric: "tabular-nums" }}>{kb(e.size)}</span>
                    {p ? (
                      <span
                        style={{ color: "#0a7", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                        title={p.name}
                      >
                        ✓ {p.name}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      disabled={!can || !!busy}
                      onClick={() => void pickReplace(e.name)}
                      style={{ fontSize: 11, padding: "2px 8px" }}
                      title={can ? tt("选一个本地文件替换它") : tt("这个条目是编译产物，不能直接换")}
                    >
                      {p ? tt("重选") : tt("替换")}
                    </button>
                  </div>
                );
              })}
              {shown.length === 0 ? (
                <div style={{ padding: 12, fontSize: 12, opacity: 0.6 }}>{tt("没有匹配的条目")}</div>
              ) : null}
            </div>
            {entries.length > shown.length ? (
              <div style={{ fontSize: 11, opacity: 0.6, marginTop: 4 }}>
                {tt("只显示前 {n} 条，用筛选框缩小范围", { n: String(shown.length) })}
              </div>
            ) : null}
          </>
        ) : null}

        {busy ? <div className="axv-sign-hint" style={{ marginTop: 8 }}>{busy}</div> : null}
        {err ? (
          <div className="axv-sign-issue axv-sign-issue-error" style={{ marginTop: 8, display: "block" }}>
            {err}
          </div>
        ) : null}
        {okPath ? (
          <div className="axv-sign-ok" style={{ marginTop: 8 }}>
            {tt("已生成：")}
            <span style={{ wordBreak: "break-all", fontSize: 11 }}>{okPath}</span>
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={!!busy}>
            {tt("关闭")}
          </button>
          <button
            type="button"
            className="axv-sign-primary"
            disabled={!apkPath || !!busy || pickedCount === 0 || !supported}
            onClick={() => void doRepack()}
            title={pickedCount === 0 ? tt("先至少替换一个文件") : tt("重新打包并签名")}
          >
            {busy ? tt("处理中…") : tt("重新打包并签名")}
            {pickedCount > 0 ? ` (${pickedCount})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
