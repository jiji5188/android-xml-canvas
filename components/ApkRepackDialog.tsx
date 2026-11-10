"use client";

// components/ApkRepackDialog.tsx — M212：导入 APK → 换原始资源 → 重签名
//
// 用途：手上有一个别人给的 / 从 Studio 导出的 APK，只想改几张图、几个 assets 文件，
// 不想重新编译整个项目。这里选 APK → 列出条目 → 挑要换的 → 选本地新文件 → 重签。
//
// 明确的限制（界面上会写出来）：layout/values 是编译过的二进制，改不了；只换「原样存着的文件」。
// M212c：样式改用专属 .axv-repack-* 类（之前误用了不存在的 axv-saveas，弹窗完全没有底色/内边距）。
// M212e：① 文件选择改用「常驻在 DOM 里的 input」（临时 createElement 在 WebView 里可能不弹选择器）
//        ② 主按钮不再静默禁用——点不动时明确说缺什么，能点就立刻显示「处理中…」

import { useCallback, useMemo, useRef, useState } from "react";
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
  /** 当前正在替换哪个条目（配合常驻 input） */
  const targetRef = useRef<string>("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickApkFile = useCallback(async () => {
    setErr("");
    setOkPath("");
    setBusy(tt("选择 APK…"));
    try {
      const r = await pickApk();
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
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  }, []);

  const pickReplace = useCallback((entryName: string) => {
    targetRef.current = entryName;
    const el = fileRef.current;
    if (!el) {
      setErr(tt("当前环境打不开文件选择器"));
      return;
    }
    el.value = "";
    el.click();
  }, []);

  const onFileChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    const name = targetRef.current;
    targetRef.current = "";
    if (!file || !name) return;
    try {
      const b64 = await readFileBase64(file);
      setPicked((p) => ({ ...p, [name]: { name: file.name, dataUrl: b64, bytes: file.size } }));
      setErr("");
    } catch (ex) {
      setErr(String(ex));
    }
  }, []);

  const pickedCount = Object.keys(picked).length;
  /** 原包里有没有 classes*.dex：没有的话重签也能装，但它本来就没代码，点开会闪退——先说清楚 */
  const hasDex = useMemo(() => (entries ? entries.some((e) => /^classes\d*\.dex$/i.test(e.name)) : true), [entries]);

  /** 缺什么就说什么（主按钮点不动时给出明确原因） */
  const blocker = !supported
    ? tt("此环境不支持（需要手机 App 端）")
    : !apkPath
      ? tt("先点「选择 APK 文件」")
      : pickedCount === 0
        ? tt("先至少点一次「替换」，选好要换的文件")
        : "";

  const doRepack = useCallback(async () => {
    if (blocker) {
      setErr(blocker);
      return;
    }
    if (!signing || !signing.storeFile || !signing.storePass || !signing.alias) {
      onNote?.(tt("先在签名面板填好 keystore / 口令 / alias，再来重签"));
      setErr(tt("签名配置不完整：需要 keystore 路径、口令、alias"));
      return;
    }
    setErr("");
    setOkPath("");
    setBusy(tt("重新打包并签名…"));
    try {
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
      if (r.ok && r.path) {
        setOkPath(r.path);
        onDone?.(r.path);
      } else {
        setErr(`${r.step ? `[${r.step}] ` : ""}${r.log || tt("重打包失败")}`);
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy("");
    }
  }, [blocker, signing, picked, apkPath, apkName, onDone, onNote]);

  const shown = useMemo(() => {
    if (!entries) return [];
    const f = filter.trim().toLowerCase();
    const list = f ? entries.filter((e) => e.name.toLowerCase().includes(f)) : entries;
    return list.slice(0, 400);
  }, [entries, filter]);

  return (
    <div className="axv-saveas-mask" role="dialog" aria-modal="true" aria-label={tt("导入 APK 换图重签")}>
      <div className="axv-repack-card">
        <div className="axv-repack-head">
          <div className="axv-repack-title">{tt("导入 APK 换图重签")}</div>
          <button type="button" className="axv-repack-x" onClick={onClose} disabled={!!busy} aria-label={tt("关闭")}>
            ✕
          </button>
        </div>

        <div className="axv-repack-sub">
          {tt("能换：图片（png/webp/jpg）、assets、res/raw、lib、任意原始文件。改不了：layout/values 这类编译过的 XML 和 resources.arsc——那需要整套反编译。")}
        </div>

        {!supported ? (
          <div className="axv-sign-issue axv-sign-issue-warn axv-repack-warn">
            {tt("此环境不支持（需要手机 App 端）：网页版无法读写 APK")}
          </div>
        ) : null}

        <div className="axv-repack-bar">
          <button type="button" className="axv-repack-ghost" onClick={() => void pickApkFile()} disabled={!!busy || !supported}>
            {entries ? tt("换一个 APK") : tt("选择 APK 文件")}
          </button>
          {apkName ? (
            <span className="axv-repack-file">
              {apkName}
              {entries ? ` · ${entries.length} ${tt("个条目")}` : ""}
            </span>
          ) : null}
        </div>

        {entries && !hasDex ? (
          <div className="axv-sign-issue axv-sign-issue-warn axv-repack-warn">
            {tt("这个 APK 里没有 classes*.dex：重签后能装，但它自身没代码，点开会闪退（重签不会凭空加代码）")}
          </div>
        ) : null}

        {entries ? (
          <>
            <input
              className="axv-repack-search"
              placeholder={tt("筛选条目，例如 drawable / assets / icon")}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="axv-repack-list">
              {shown.map((e) => {
                const can = isReplaceableEntry(e.name);
                const p = picked[e.name];
                return (
                  <div key={e.name} className={`axv-repack-row${can ? "" : " is-fixed"}`}>
                    <span className="axv-repack-name" title={e.name}>
                      {e.name}
                    </span>
                    <span className="axv-repack-size">{kb(e.size)}</span>
                    {p ? (
                      <span className="axv-repack-picked" title={p.name}>
                        ✓ {p.name}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="axv-repack-btn"
                      disabled={!can || !!busy}
                      onClick={() => pickReplace(e.name)}
                      title={can ? tt("选一个本地文件替换它") : tt("这个条目是编译产物，不能直接换")}
                    >
                      {p ? tt("重选") : tt("替换")}
                    </button>
                  </div>
                );
              })}
              {shown.length === 0 ? <div className="axv-repack-empty">{tt("没有匹配的条目")}</div> : null}
            </div>
            {entries.length > shown.length ? (
              <div className="axv-repack-more">
                {tt("只显示前 {n} 条，用筛选框缩小范围", { n: String(shown.length) })}
              </div>
            ) : null}
          </>
        ) : null}

        {busy ? <div className="axv-sign-hint axv-repack-busy">{busy}</div> : null}
        {err ? <div className="axv-sign-issue axv-sign-issue-error axv-repack-err">{err}</div> : null}
        {okPath ? (
          <div className="axv-sign-ok axv-repack-ok">
            {tt("已生成：")}
            <span className="axv-repack-okpath">{okPath}</span>
          </div>
        ) : null}

        <div className="axv-repack-foot">
          <span className={`axv-repack-state${blocker ? " is-blocked" : ""}`}>
            {blocker ? blocker : tt("已选 {n} 个替换", { n: String(pickedCount) })}
          </span>
          <button type="button" className="axv-repack-ghost" onClick={onClose} disabled={!!busy}>
            {tt("关闭")}
          </button>
          <button
            type="button"
            className="axv-sign-primary axv-repack-go"
            // 不设 disabled：点不动时也要给原因，别让用户以为「按钮坏了」
            aria-disabled={!!blocker || !!busy}
            onClick={() => void doRepack()}
            title={blocker || tt("重新打包并签名")}
          >
            {busy ? tt("处理中…") : tt("重新打包并签名")}
            {pickedCount > 0 ? ` (${pickedCount})` : ""}
          </button>
        </div>

        {/* 常驻文件选择器：Android WebView 对「临时 createElement().click()」经常不弹窗 */}
        <input
          ref={fileRef}
          type="file"
          accept="*/*"
          className="axv-repack-fileinput"
          onChange={(e) => void onFileChosen(e)}
        />
      </div>
    </div>
  );
}
