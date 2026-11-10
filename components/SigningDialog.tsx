// components/SigningDialog.tsx — M188a：签名与发布配置弹层
// 读项目里 app/build.gradle → 填表单 → 写回（走 projectSaveRoot 的写通道）
// 纯展示 + 回调，状态全在本地 useState；keystore 文件生成走「占位」——
// 真正 keytool 生成要 native 侧做，这里先把配置落 build.gradle（后续版本补 keytool 调用）。

import { useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { validateSigning, readSigningFromGradle, applySigningToGradle, defaultAppGradle, type SigningParams } from "@/lib/xml/signing";
import { checkPublish, readPublishInfo, setPublishVersion } from "@/lib/xml/gradle-publish";
import { setGradlePackage } from "@/lib/xml/project-info";
import type { StoredSigning } from "@/lib/xml/sign-store";

export interface SigningDialogProps {
  /** M192：一键打包成可安装 APK（设备端 aapt2 + 壳 dex + apksig 签名） */
  onBuildApk?: (o: { storeFile: string; storePass: string; alias: string; keyPass?: string }) => Promise<void>;
  apkBusy?: boolean;
  apkResult?: { ok: boolean; path?: string; name?: string; bytes?: number; ms?: number; step?: string; log?: string } | null;
  /** M192：调系统安装器装刚打出来的包 */
  onInstallApk?: (path: string) => void;
  /** M197：把打好的 APK 分享出去 */
  onShareApk?: (path: string) => void;
  /** M212：打开「导入 APK 换资源重签名」面板 */
  onOpenRepack?: () => void;
  /** 读项目里 app/build.gradle（没有就 null） */
  gradleText: string | null;
  /** M188b：当前项目没有可写根（网页版没选目录 / 示例项目）→ 写入先进 localStorage 草稿 */
  rootMissing?: boolean;
  /** M188c：项目包名（没有 build.gradle 时生成基础模板用；不传就 com.example.app） */
  pkg?: string;
  /** M189：keystore 文件是否真实存在（undefined = 没检查） */
  keystoreExists?: boolean;
  /** M189+：strings.xml 里的 app_name（判断是否还是默认值） */
  appName?: string | null;
  /** M189+：图标是否还是系统默认 */
  iconDefault?: boolean;
  /** M191：在设备上生成 keystore 文件（native bridge）；不传则按钮置灰 */
  onMakeKeystore?: (rel: string, o: { alias: string; password: string; cn: string; years: number }) => Promise<{ ok: boolean; msg: string }>;
  /** 写回（成功后弹层关闭 + 提示）；返回 true 成功 */
  onWriteGradle: (next: string) => Promise<boolean>;
  /** M195：本项目上次保存的签名配置（build.gradle 读不到时用它回填） */
  stored?: StoredSigning | null;
  /** M195：把当前表单记到本机（按项目），返回是否保存成功 */
  onRemember?: (s: Omit<StoredSigning, "savedAt">) => boolean;
  /** M197：清除本机记住的签名配置 */
  onForget?: () => void;
  onClose: () => void;
  onNote: (msg: string, ms?: number) => void;
}

const EMPTY: SigningParams = {
  alias: "release",
  keyPassword: "",
  storeFile: ".axv/release.keystore",
  algorithm: "RSA",
  keySize: 2048,
  validityDays: 10000,
  v1: true,
  v2: true,
  v3: true,
};

export function SigningDialog({ gradleText, rootMissing, pkg, keystoreExists, appName, iconDefault, onMakeKeystore, onBuildApk, apkBusy, apkResult, onInstallApk, onShareApk, onOpenRepack, onWriteGradle, onClose, onNote, stored, onRemember, onForget }: SigningDialogProps) {
  const prefill = gradleText ? readSigningFromGradle(gradleText) : null;
  // M195：build.gradle 里没写的项（典型：口令）用本机记住的配置补
  const seed = prefill ?? (stored as SigningParams | null);
  const [alias, setAlias] = useState(seed?.alias || EMPTY.alias);
  const [keyPassword, setKeyPassword] = useState(
    prefill?.keyPassword || stored?.keyPass || stored?.storePass || "",
  );
  const [storeFile, setStoreFile] = useState(seed?.storeFile || EMPTY.storeFile);
  const [algorithm, setAlgorithm] = useState<"RSA" | "EC">(seed?.algorithm || "RSA");
  const [keySize, setKeySize] = useState(seed?.keySize ?? 2048);
  const [validityDays, setValidityDays] = useState(seed?.validityDays ?? 10000);
  const [v1, setV1] = useState(seed?.v1 ?? true);
  const [v2, setV2] = useState(seed?.v2 ?? true);
  const [v3, setV3] = useState(seed?.v3 ?? true);
  /** M195：记住状态（打包/写入后把表单存到本机） */
  const remember = () => {
    if (!onRemember) return;
    onRemember({
      storeFile: storeFile || ".axv/release.keystore",
      storePass: keyPassword || "",
      alias: alias || "release",
      keyPass: keyPassword || "",
      algorithm,
      keySize,
      validityDays,
      v1,
      v2,
      v3,
    });
  };
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* M191：设备端生成 keystore */
  const [ksBusy, setKsBusy] = useState(false);
  const [ksDone, setKsDone] = useState(false);

  /* M189：发布信息（版本号 / SDK）+ 发布前检查 */
  /** 本地副本：发布前检查里的「修」按钮直接改它（最后写入时用这份） */
  const [baseText, setBaseText] = useState<string | null>(gradleText);
  /** 改包名的内联输入（null = 没展开） */
  const [pkgEdit, setPkgEdit] = useState<string | null>(null);
  const pub = baseText ? readPublishInfo(baseText) : null;
  const [versionCode, setVersionCode] = useState<number>(pub?.versionCode ?? 1);
  const [versionName, setVersionName] = useState<string>(pub?.versionName ?? "1.0");
  const defaultAppName = !!appName && /^(my ?application|my ?app|app|untitled|应用|我的应用)?$/i.test(appName.trim());
  const ksEffective = ksDone ? true : keystoreExists;
  const issues = baseText
    ? checkPublish({
        info: pub!,
        keystoreExists: ksEffective,
        storeFile,
        anyScheme: v1 || v2 || v3,
        defaultAppName,
        defaultIcon: iconDefault,
      })
    : [];

  /** 「修」：直接把改动应用到本地文本（写盘前可预览） */
  const applyFix = (fix: "bump-version" | "set-package" | "enable-v2") => {
    if (fix === "bump-version") {
      setVersionCode((n) => Math.max(1, n) + 1);
      return;
    }
    if (fix === "enable-v2") {
      setV2(true);
      setV3(true);
      return;
    }
    const cur = pub?.applicationId || pub?.namespace || pkg || "com.example.app";
    setPkgEdit(cur);
  };

  const commitPkg = () => {
    if (!baseText || !pkgEdit) return;
    const r = setGradlePackage(baseText, pkgEdit.trim());
    if (r.ok) {
      setBaseText(r.text);
      setPkgEdit(null);
    } else {
      setErr(r.msg || tt("包名不合法"));
    }
  };

  /** M191：在设备上生成 keystore 文件（alias/口令/CN 都用当前表单里的） */
  const doMakeKeystore = async () => {
    if (!onMakeKeystore) return;
    setKsBusy(true);
    const rel = storeFile ?? ".axv/release.keystore";
    const r = await onMakeKeystore(rel, { alias: alias ?? "release", password: keyPassword ?? "", cn: "", years: 25 });
    setKsBusy(false);
    if (r.ok) {
      setKsDone(true);
      remember();
      // M195：keystore 生成后表单信息就全了 → 顺手把签名配置写进 build.gradle（存进项目配置）
      if (baseText) {
        const p: SigningParams = { alias, keyPassword, storeFile: rel, algorithm, keySize, validityDays, v1, v2, v3 };
        const c = composeNext(baseText, p);
        if (c.ok) {
          const wrote = await onWriteGradle(c.next);
          if (wrote) setBaseText(c.next);
          onNote(
            wrote
              ? tt("已生成 keystore，并把签名配置写入 build.gradle")
              : tt("已在设备上生成 keystore：{path}", { path: rel }),
            3200,
          );
          return;
        }
      }
      onNote(tt("已在设备上生成 keystore：{path}", { path: rel }), 3200);
    } else {
      setErr(r.msg);
    }
  };

  /** 把「签名 + 版本」一次写进 build.gradle */
  const composeNext = (base: string, p: SigningParams): { ok: boolean; next: string; error: string | null } => {
    const signed = applySigningToGradle(base, p);
    if (!signed.ok) return { ok: false, next: base, error: signed.error };
    const ver = setPublishVersion(signed.next, { versionCode, versionName });
    // 版本字段没找到不算错（有些工程用 buildConfigField 之类），只不写版本
    return { ok: true, next: ver.ok ? ver.text : signed.next, error: null };
  };

  const submit = async () => {
    setErr(null);
    const p: SigningParams = { alias, keyPassword, storeFile, algorithm, keySize, validityDays, v1, v2, v3 };
    const check = validateSigning(p);
    if (!check.ok) { setErr(check.error); return; }

    // M188c：项目里没有 app/build.gradle 时不再堵死，直接生成一份带签名的基础模板
    if (!gradleText) {
      if (rootMissing) {
        setErr(tt("没有可写的项目目录：先打开项目或选一个保存目录"));
        return;
      }
      setBusy(true);
      const made = defaultAppGradle(p, pkg);
      if (!made.ok) { setErr(made.error); setBusy(false); return; }
      const ver = setPublishVersion(made.next, { versionCode, versionName });
      const okNew = await onWriteGradle(ver.ok ? ver.text : made.next);
      setBusy(false);
      if (okNew) {
        onNote(tt("已生成 app/build.gradle 并写入签名配置"), 3200);
        onClose();
      } else {
        setErr(tt("写入 build.gradle 失败"));
      }
      return;
    }

    setBusy(true);
    const r = composeNext(baseText || "", p);
    if (!r.ok) { setErr(r.error); setBusy(false); return; }
    const ok = await onWriteGradle(r.next);
    setBusy(false);
    if (ok) {
      remember();
      onNote(tt("签名配置已写入 build.gradle（并已记住到本机）"), 2500);
      onClose();
    } else {
      setErr(tt("写入 build.gradle 失败"));
    }
  };

  return (
    <div className="axv-saveas-mask" role="dialog" aria-label={tt("签名与发布")}>
      <div className="axv-sign-card" style={{ maxWidth: 420 }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>{tt("签名与发布")}</h3>
        <div className="axv-sign-row">
          <label>{tt("别名（alias）")}</label>
          <input value={alias} onChange={(e) => setAlias(e.target.value)} placeholder="release" />
        </div>
        <div className="axv-sign-row">
          <label>{tt("口令")}</label>
          <input
            type="password"
            value={keyPassword}
            onChange={(e) => setKeyPassword(e.target.value)}
            placeholder={tt("至少 6 位")}
          />
        </div>
        <div className="axv-sign-row">
          <label>{tt("keystore 路径")}</label>
          <div style={{ display: "flex", gap: 6, flex: 1 }}>
            <input value={storeFile} onChange={(e) => setStoreFile(e.target.value)} style={{ flex: 1 }} />
            {!ksDone && onMakeKeystore && keyPassword.length >= 6 && (
              <button
                type="button"
                onClick={() => void doMakeKeystore()}
                disabled={ksBusy}
                title={tt("在设备上生成 RSA 2048 自签名证书 + PKCS#12 文件")}
              >
                {ksBusy ? tt("生成中…") : tt("生成")}
              </button>
            )}
          </div>
          {ksDone && (
            <div className="axv-sign-ok" style={{ marginTop: 4 }}>{tt("keystore 已在本机生成")}</div>
          )}
        </div>
        <div className="axv-sign-row">
          <label>{tt("算法")}</label>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className={algorithm === "RSA" ? "axv-sign-on" : ""}
              onClick={() => setAlgorithm("RSA")}
            >
              RSA
            </button>
            <button
              type="button"
              className={algorithm === "EC" ? "axv-sign-on" : ""}
              onClick={() => setAlgorithm("EC")}
            >
              EC
            </button>
          </div>
        </div>
        {algorithm === "RSA" && (
          <div className="axv-sign-row">
            <label>{tt("位数")}</label>
            <select value={keySize} onChange={(e) => setKeySize(Number(e.target.value))}>
              {[2048, 3072, 4096].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}
        <div className="axv-sign-row">
          <label>{tt("有效期（天）")}</label>
          <input
            type="number"
            min={1}
            value={validityDays}
            onChange={(e) => setValidityDays(Number(e.target.value) || 1)}
          />
        </div>
        <div className="axv-sign-row">
          <label>{tt("签名 scheme")}</label>
          <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
            <label><input type="checkbox" checked={v1} onChange={(e) => setV1(e.target.checked)} /> v1 (JAR)</label>
            <label><input type="checkbox" checked={v2} onChange={(e) => setV2(e.target.checked)} /> v2</label>
            <label><input type="checkbox" checked={v3} onChange={(e) => setV3(e.target.checked)} /> v3</label>
          </div>
        </div>
        {err && <div className="axv-sign-err" role="alert">{err}</div>}

        {/* M189：版本信息 */}
        {baseText ? (
          <>
            <div className="axv-sign-sep">{tt("版本信息")}</div>
            <div className="axv-sign-row">
              <label>{tt("versionCode")}</label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="number"
                  min={1}
                  value={versionCode}
                  onChange={(e) => setVersionCode(Number(e.target.value) || 1)}
                  style={{ flex: 1 }}
                />
                <button type="button" onClick={() => setVersionCode((n) => n + 1)}>
                  +1
                </button>
              </div>
            </div>
            <div className="axv-sign-row">
              <label>{tt("versionName")}</label>
              <input value={versionName} onChange={(e) => setVersionName(e.target.value)} />
            </div>
            <div className="axv-sign-meta">
              {tt("包名")}：{pub?.applicationId || pub?.namespace || tt("（未设置）")}
              {pub?.minSdk != null ? ` · minSdk ${pub.minSdk}` : ""}
              {pub?.targetSdk != null ? ` · targetSdk ${pub.targetSdk}` : ""}
            </div>
            {issues.length > 0 ? (
              <ul className="axv-sign-issues">
                {issues.map((it, i) => (
                  <li key={i} className={"axv-sign-issue axv-sign-issue-" + it.level}>
                    <span className="msr" aria-hidden="true">
                      {it.level === "error" ? "error" : it.level === "warn" ? "warning" : "info"}
                    </span>
                    <span style={{ flex: 1 }}>{it.msg}</span>
                    {it.fix && (
                      <button
                        type="button"
                        className="axv-sign-fix"
                        onClick={() => applyFix(it.fix!)}
                      >
                        {it.fix === "bump-version" ? tt("自动 +1") : it.fix === "set-package" ? tt("改包名") : tt("开 v2")}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="axv-sign-ok">{tt("发布前检查：没发现问题")}</div>
            )}
            {pkgEdit !== null && (
              <div className="axv-sign-pkgfix">
                <input
                  value={pkgEdit}
                  onChange={(e) => setPkgEdit(e.target.value)}
                  placeholder="com.yourcompany.app"
                  aria-label={tt("包名")}
                />
                <button type="button" className="axv-sign-primary" onClick={commitPkg}>
                  {tt("应用")}
                </button>
                <button type="button" onClick={() => setPkgEdit(null)}>
                  {tt("取消")}
                </button>
              </div>
            )}
          </>
        ) : null}
        {stored && !prefill ? (
          <div className="axv-sign-hint">
            {tt("已从本机记忆回填签名配置（按项目保存，点打包/写入会更新）")}
            {onForget ? (
              <button
                type="button"
                onClick={onForget}
                style={{ marginLeft: 8, background: "none", border: 0, color: "#2c6ef2", cursor: "pointer", padding: 0 }}
              >
                {tt("忘记本机记忆")}
              </button>
            ) : null}
          </div>
        ) : null}
        {rootMissing && !gradleText ? (
          <div className="axv-sign-hint">
            {tt("当前项目还没有可写目录：配置会先存到本地草稿，打开项目或选中保存目录后再点一次「写入」即可落盘到 build.gradle")}
          </div>
        ) : (
          !prefill && !keyPassword && !stored?.keyPass && !stored?.storePass && (
            <div className="axv-sign-hint">
              {tt("注意：keystore 文件本身要手动生成（keytool）或后续版本自动补；这里先把配置写进 build.gradle")}
            </div>
          )
        )}
        {/* M192：一键打包 → 安装调试 */}
        {onBuildApk ? (
          <div className="axv-sign-row" style={{ display: "block", borderTop: "1px solid rgba(0,0,0,.08)", paddingTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="axv-sign-primary"
                disabled={!!apkBusy}
                onClick={() => {
                  remember();
                  void onBuildApk({
                    storeFile: storeFile || "",
                    storePass: keyPassword || "",
                    alias: alias || "",
                    keyPass: keyPassword || "",
                  });
                }}
                title={tt("资源编译 → 注入壳 dex → 对齐 → apksig 签名，产出一个可直接安装的 APK")}
              >
                {apkBusy ? tt("打包中…") : tt("打包并安装 APK")}
              </button>
              {apkResult?.ok && apkResult.path && onInstallApk ? (
                <button type="button" onClick={() => onInstallApk(apkResult.path!)}>
                  {tt("安装到本机")}
                </button>
              ) : null}
              {apkResult?.ok && apkResult.path && onShareApk ? (
                <button type="button" onClick={() => onShareApk(apkResult.path!)}>
                  {tt("分享 APK")}
                </button>
              ) : null}
              {onOpenRepack ? (
                <button
                  type="button"
                  onClick={() => onOpenRepack()}
                  title={tt("拿一个现成 APK，换里面的图片/assets 等原始资源，然后重新签名")}
                >
                  {tt("导入 APK 换图重签")}
                </button>
              ) : null}
            </div>
            {apkResult ? (
              apkResult.ok ? (
                <div className="axv-sign-ok" style={{ marginTop: 6 }}>
                  {tt("已生成 {name}（{kb} KB，{ms} ms）", {
                    name: apkResult.name || "",
                    kb: String(Math.round((apkResult.bytes || 0) / 1024)),
                    ms: String(apkResult.ms || 0),
                  })}
                  <div style={{ opacity: 0.7, wordBreak: "break-all", fontSize: 11 }}>{apkResult.path}</div>
                </div>
              ) : (
                <div className="axv-sign-issue axv-sign-issue-error" style={{ marginTop: 6, display: "block" }}>
                  <div>{tt("打包失败（{step}）", { step: apkResult.step || "?" })}</div>
                  <pre
                    style={{
                      margin: "6px 0 0",
                      fontSize: 11,
                      maxHeight: 160,
                      overflow: "auto",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {apkResult.log || ""}
                  </pre>
                </div>
              )
            ) : null}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={busy}>{tt("取消")}</button>
          <button type="button" className="axv-sign-primary" onClick={() => void submit()} disabled={busy}>
            {busy ? tt("写入中…") : tt("写入 build.gradle")}
          </button>
        </div>
      </div>
    </div>
  );
}
