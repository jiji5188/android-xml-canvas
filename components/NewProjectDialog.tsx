// components/NewProjectDialog.tsx — M302：从 XmlEditor.tsx 抽出的「新建项目」对话框
// 纯展示组件：状态由父组件持有（M24 起），这里只渲染 + 回调。

"use client";

import { t as tt } from "@/lib/i18n-src";

export interface NewProjectDialogProps {
  open: boolean;
  name: string;
  pkg: string;
  icon: { dataUrl: string; base64: string; mime: string } | null;
  busy: boolean;
  defaultIconUrl: string;
  /** 父组件的 i18n（带命名空间的 tr） */
  tr: (key: string, fallback: string) => string;
  onClose: () => void;
  setName: (v: string) => void;
  setPkg: (v: string) => void;
  setIcon: (v: { dataUrl: string; base64: string; mime: string } | null) => void;
  create: (name: string, pkg: string) => void;
  /** 项目名 → 合法名（父组件传 safeProjectName） */
  safeName: (s: string) => string;
  /** 包名校验，返回错误信息或 null */
  validatePkg: (s: string) => string | null;
  /** 短暂提示（图标过大等） */
  onToast: (msg: string) => void;
}

export function NewProjectDialog({
  open,
  name,
  pkg,
  icon,
  busy,
  defaultIconUrl,
  tr,
  onClose,
  setName,
  setPkg,
  setIcon,
  create,
  safeName,
  validatePkg,
  onToast,
}: NewProjectDialogProps) {
  if (!open) return null;
  return (
    <div
      className="axv-saveas-mask"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-saveas-card">
        <div className="axv-saveas-title">{tr("proj.newTitle", "新建项目")}</div>
        <div className="axv-saveas-hint">
          {tr(
            "proj.newHint",
            tt("会在工作目录里直接建出完整工程：项目名/app/src/main/{java,res,AndroidManifest.xml} + gradle 文件。不选图标就用默认自适应图标。"),
          )}
        </div>
        <label className="axv-saveas-field">
          <span>{tr("proj.newName", "项目名")}</span>
          <input
            className="axv-saveas-input axv-newproj-input"
            value={name}
            autoFocus
            spellCheck={false}
            placeholder="MyApp"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create(name, pkg);
              if (e.key === "Escape") onClose();
            }}
          />
        </label>
        {/* M176：包名（选填，留空按项目名自动 com.example.xxx） */}
        <label className="axv-saveas-field">
          <span>{tr("proj.newPkg", "包名")}</span>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              className="axv-saveas-input"
              style={{ flex: 1 }}
              value={pkg}
              spellCheck={false}
              placeholder={`com.example.${safeName(name).toLowerCase().replace(/_+/g, "")}`}
              onChange={(e) => setPkg(e.target.value)}
            />
            {pkg ? (
              <button
                type="button"
                className="axv-ws-link"
                title={tr("proj.newPkgReset", "清空，按项目名自动生成")}
                onClick={() => setPkg("")}
              >
                {tr("proj.newPkgReset", "清空")}
              </button>
            ) : null}
          </div>
          <span className="axv-saveas-subhint">
            {tr(
              "proj.newPkgHint",
              tt("选填。留空则按项目名自动生成 com.example.{name}，写进 build.gradle 的 namespace / applicationId。"),
            )}
          </span>
        </label>
        {/* M31i：项目图标（不选就是默认自适应图标） */}
        <div className="axv-saveas-field axv-newproj-iconrow">
          <span>{tr("proj.newIcon", "项目图标")}</span>
          <div className="axv-newproj-iconbox">
            <span className="axv-newproj-iconprev" aria-hidden="true">
              {icon ? <img src={icon.dataUrl} alt="" /> : <img src={defaultIconUrl} alt="" />}
            </span>
            <label className="axv-set-btn axv-newproj-iconpick">
              {tr("proj.newPickIcon", "选图片…")}
              <input
                type="file"
                accept="image/png,image/webp,image/jpeg"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (f.size > 2 * 1024 * 1024) {
                    onToast(tt("图标建议小于 2MB"));
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    const dataUrl = String(reader.result || "");
                    const comma = dataUrl.indexOf(",");
                    if (comma < 0) return;
                    setIcon({
                      dataUrl,
                      base64: dataUrl.slice(comma + 1),
                      mime: f.type || "image/png",
                    });
                  };
                  reader.readAsDataURL(f);
                }}
              />
            </label>
            {icon ? (
              <button className="axv-ws-link" onClick={() => setIcon(null)}>
                {tr("proj.newIconReset", "用默认")}
              </button>
            ) : (
              <span className="axv-newproj-icontip">{tr("proj.newIconTip", "默认图标")}</span>
            )}
          </div>
        </div>
        <div className="axv-saveas-btns">
          <button className="axv-set-btn" onClick={onClose} disabled={busy}>
            {tr("save.cancel", "取消")}
          </button>
          <button
            className="axv-set-btn axv-saveas-ok axv-newproj-ok"
            onClick={() => create(name, pkg)}
            disabled={busy || (pkg.trim() !== "" && validatePkg(pkg) !== null)}
          >
            {busy ? tr("proj.newBusy", "创建中…") : tr("proj.newOk", "创建项目")}
          </button>
        </div>
      </div>
    </div>
  );
}
