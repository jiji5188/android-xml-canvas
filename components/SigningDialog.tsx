// components/SigningDialog.tsx — M188a：签名与发布配置弹层
// 读项目里 app/build.gradle → 填表单 → 写回（走 projectSaveRoot 的写通道）
// 纯展示 + 回调，状态全在本地 useState；keystore 文件生成走「占位」——
// 真正 keytool 生成要 native 侧做，这里先把配置落 build.gradle（后续版本补 keytool 调用）。

import { useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { validateSigning, readSigningFromGradle, applySigningToGradle, type SigningParams } from "@/lib/xml/signing";

export interface SigningDialogProps {
  /** 读项目里 app/build.gradle（没有就 null） */
  gradleText: string | null;
  /** M188b：当前项目没有可写根（网页版没选目录 / 示例项目）→ 写入先进 localStorage 草稿 */
  rootMissing?: boolean;
  /** 写回（成功后弹层关闭 + 提示）；返回 true 成功 */
  onWriteGradle: (next: string) => Promise<boolean>;
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

export function SigningDialog({ gradleText, rootMissing, onWriteGradle, onClose, onNote }: SigningDialogProps) {
  const prefill = gradleText ? readSigningFromGradle(gradleText) : null;
  const [alias, setAlias] = useState(prefill?.alias || EMPTY.alias);
  const [keyPassword, setKeyPassword] = useState(prefill?.keyPassword || "");
  const [storeFile, setStoreFile] = useState(prefill?.storeFile || EMPTY.storeFile);
  const [algorithm, setAlgorithm] = useState<"RSA" | "EC">(prefill?.algorithm || "RSA");
  const [keySize, setKeySize] = useState(prefill?.keySize ?? 2048);
  const [validityDays, setValidityDays] = useState(prefill?.validityDays ?? 10000);
  const [v1, setV1] = useState(prefill?.v1 ?? true);
  const [v2, setV2] = useState(prefill?.v2 ?? true);
  const [v3, setV3] = useState(prefill?.v3 ?? true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErr(null);
    const p: SigningParams = { alias, keyPassword, storeFile, algorithm, keySize, validityDays, v1, v2, v3 };
    const check = validateSigning(p);
    if (!check.ok) { setErr(check.error); return; }
    if (!gradleText) { setErr(tt("项目里没有 app/build.gradle，先建项目")); return; }
    setBusy(true);
    const r = applySigningToGradle(gradleText, p);
    if (!r.ok) { setErr(r.error); setBusy(false); return; }
    const ok = await onWriteGradle(r.next);
    setBusy(false);
    if (ok) {
      onNote(tt("签名配置已写入 build.gradle"), 2500);
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
          <input value={storeFile} onChange={(e) => setStoreFile(e.target.value)} />
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
        {rootMissing && !gradleText ? (
          <div className="axv-sign-hint">
            {tt("当前项目还没有可写目录：配置会先存到本地草稿，打开项目或选中保存目录后再点一次「写入」即可落盘到 build.gradle")}
          </div>
        ) : (
          !prefill && !keyPassword && (
            <div className="axv-sign-hint">
              {tt("注意：keystore 文件本身要手动生成（keytool）或后续版本自动补；这里先把配置写进 build.gradle")}
            </div>
          )
        )}
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
