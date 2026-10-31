// components/ManifestEditor.tsx — M43：AndroidManifest.xml 的「视图」编辑
//
// 只做最常用的清单信息：包名/版本、SDK 版本、application 基本属性、权限、组件。
// intent-filter、meta-data 等复杂结构仍走「代码」页 —— 这里不假装全能。
//
// 所有写回都是 manifest-edit.ts 里的外科手术（只改目标属性/段落），
// 文件里的注释、顺序、缩进保持原样。

"use client";

import { useMemo, useState } from "react";
import {
  COMPONENT_LABEL,
  appendComponent,
  appendPermission,
  attrOfElement,
  parseManifest,
  removeElement,
  removeElementAttr,
  setElementAttr,
  setUsesSdkAttr,
  type ManifestItem,
} from "@/lib/xml/manifest-edit";

export interface ManifestEditorProps {
  xml: string;
  onChange: (next: string) => void;
  onNote?: (msg: string) => void;
  className?: string;
}

const COMMON_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.VIBRATE",
  "android.permission.WAKE_LOCK",
];

const COMPONENT_TYPES = ["activity", "service", "receiver", "provider"] as const;

function isDigits(v: string): boolean {
  return /^\d+$/.test(v.trim());
}

export function ManifestEditor({ xml, onChange, onNote, className }: ManifestEditorProps) {
  const doc = useMemo(() => parseManifest(xml), [xml]);
  const [permDraft, setPermDraft] = useState("");
  const [compType, setCompType] = useState<(typeof COMPONENT_TYPES)[number]>("activity");
  const [compName, setCompName] = useState("");
  const [msg, setMsg] = useState("");

  const note = (s: string) => {
    setMsg(s);
    onNote?.(s);
    window.setTimeout(() => setMsg(""), 2600);
  };

  if (!doc.ok || !doc.manifest) {
    return (
      <div className={"axv-val " + (className || "")}>
        <div className="axv-val-empty">
          <span className="msr" aria-hidden="true">warning</span>
          <div>{doc.reason || "这个文件不是 AndroidManifest.xml"}</div>
          <div className="axv-val-hint">切到「代码」还能直接改原文。</div>
        </div>
      </div>
    );
  }

  const manifest = doc.manifest;
  const read = (el: ManifestItem | null, name: string) => (el ? attrOfElement(xml, el, name) : "");

  const commitManifestAttr = (name: string, raw: string, el?: HTMLInputElement) => {
    const next = raw.trim();
    if (next === read(manifest, name)) return;
    if (!next) {
      note("这个字段不能为空");
      if (el) el.value = read(manifest, name);
      return;
    }
    onChange(setElementAttr(xml, manifest, name, next));
    note(`已改 ${name.replace("android:", "")}`);
  };

  const commitNumberAttr = (name: string, raw: string, el?: HTMLInputElement) => {
    const next = raw.trim();
    if (next === read(manifest, name)) return;
    if (!isDigits(next)) {
      note("版本号要用纯数字");
      if (el) el.value = read(manifest, name);
      return;
    }
    onChange(setElementAttr(xml, manifest, name, next));
    note(`已改 ${name.replace("android:", "")}`);
  };

  const commitSdkAttr = (name: string, raw: string, el?: HTMLInputElement) => {
    const next = raw.trim();
    if (next === read(doc.usesSdk, name)) return;
    if (!isDigits(next)) {
      note("SDK 版本要用纯数字");
      if (el) el.value = read(doc.usesSdk, name);
      return;
    }
    onChange(setUsesSdkAttr(xml, name, next, doc));
    note(`已改 ${name.replace("android:", "")}`);
  };

  const commitAppAttr = (name: string, raw: string, el?: HTMLInputElement) => {
    const cur = read(doc.application, name);
    const next = raw.trim();
    if (next === cur) return;
    if (!doc.application) {
      note("当前清单没有 <application> 节点，去代码里补");
      return;
    }
    if (!next) {
      onChange(removeElementAttr(xml, doc.application, name));
      note(`已清空 ${name.replace("android:", "")}`);
      return;
    }
    onChange(setElementAttr(xml, doc.application, name, next));
    note(`已改 ${name.replace("android:", "")}`);
  };

  const commitAllowBackup = (raw: string) => {
    if (!doc.application) return;
    if (!raw) onChange(removeElementAttr(xml, doc.application, "android:allowBackup"));
    else onChange(setElementAttr(xml, doc.application, "android:allowBackup", raw));
    note("已改 allowBackup");
  };

  const addPermission = () => {
    const name = permDraft.trim();
    if (!name) return;
    if (!name.includes(".")) {
      note("权限名一般形如 android.permission.CAMERA");
      return;
    }
    if (doc.permissions.some((p) => attrOfElement(xml, p, "android:name") === name)) {
      note("这个权限已经有了");
      return;
    }
    onChange(appendPermission(xml, name, doc));
    setPermDraft("");
    note(`已加 ${name.split(".").pop()}`);
  };

  const commitPermissionName = (el: ManifestItem, raw: string, input?: HTMLInputElement) => {
    const cur = attrOfElement(xml, el, "android:name");
    const next = raw.trim();
    if (next === cur) return;
    if (!next || !next.includes(".")) {
      note("权限名不合法");
      if (input) input.value = cur;
      return;
    }
    if (doc.permissions.some((p) => p !== el && attrOfElement(xml, p, "android:name") === next)) {
      note("这个权限已经有了");
      if (input) input.value = cur;
      return;
    }
    onChange(setElementAttr(xml, el, "android:name", next));
    note("已改权限名");
  };

  const addComponent = () => {
    const name = compName.trim();
    if (!name) return;
    if (!/^[A-Za-z_][\w.$]*$/.test(name)) {
      note("组件名只能字母/数字/下划线/点");
      return;
    }
    if (doc.components.some((c) => attrOfElement(xml, c, "android:name") === name)) {
      note("这个组件已经有了");
      return;
    }
    onChange(appendComponent(xml, compType, { "android:name": name }, doc));
    setCompName("");
    note(`已加 ${COMPONENT_LABEL[compType] || compType}`);
  };

  const commitComponentAttr = (
    el: ManifestItem,
    name: string,
    raw: string,
    input?: HTMLInputElement,
  ) => {
    const cur = attrOfElement(xml, el, name);
    const next = raw.trim();
    if (next === cur) return;
    if (!next) {
      if (name === "android:name") {
        note("组件名不能为空");
        if (input) input.value = cur;
        return;
      }
      onChange(removeElementAttr(xml, el, name));
      return;
    }
    onChange(setElementAttr(xml, el, name, next));
  };

  const setExported = (el: ManifestItem, raw: string) => {
    if (!raw) onChange(removeElementAttr(xml, el, "android:exported"));
    else onChange(setElementAttr(xml, el, "android:exported", raw));
    note("已改 exported");
  };

  return (
    <div className={"axv-val axv-mf " + (className || "")}>
      <div className="axv-mf-body">
        {/* ===== 应用信息 ===== */}
        <section className="axv-mf-sec">
          <div className="axv-mf-head">
            <span className="msr" aria-hidden="true">info</span>
            <b>应用信息</b>
          </div>
          <div className="axv-mf-grid">
            <span className="axv-mf-label">包名</span>
            <input
              className="axv-mf-input mono"
              defaultValue={read(manifest, "package")}
              placeholder="com.example.app"
              spellCheck={false}
              onBlur={(e) => commitManifestAttr("package", e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") {
                  (e.target as HTMLInputElement).value = read(manifest, "package");
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <span className="axv-mf-label">versionCode</span>
            <input
              className="axv-mf-input mono"
              defaultValue={read(manifest, "android:versionCode")}
              placeholder="1"
              inputMode="numeric"
              onBlur={(e) => commitNumberAttr("android:versionCode", e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="axv-mf-label">versionName</span>
            <input
              className="axv-mf-input mono"
              defaultValue={read(manifest, "android:versionName")}
              placeholder="1.0"
              onBlur={(e) => commitManifestAttr("android:versionName", e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="axv-mf-label">minSdk</span>
            <input
              className="axv-mf-input mono"
              defaultValue={read(doc.usesSdk, "android:minSdkVersion")}
              placeholder="21"
              inputMode="numeric"
              onBlur={(e) => commitSdkAttr("android:minSdkVersion", e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="axv-mf-label">targetSdk</span>
            <input
              className="axv-mf-input mono"
              defaultValue={read(doc.usesSdk, "android:targetSdkVersion")}
              placeholder="34"
              inputMode="numeric"
              onBlur={(e) => commitSdkAttr("android:targetSdkVersion", e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
          </div>
        </section>

        {/* ===== application ===== */}
        <section className="axv-mf-sec">
          <div className="axv-mf-head">
            <span className="msr" aria-hidden="true">apps</span>
            <b>Application</b>
          </div>
          <div className="axv-mf-grid">
            <span className="axv-mf-label">名称</span>
            <input
              className="axv-mf-input mono"
              defaultValue={read(doc.application, "android:label")}
              placeholder="@string/app_name"
              spellCheck={false}
              onBlur={(e) => commitAppAttr("android:label", e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="axv-mf-label">图标</span>
            <input
              className="axv-mf-input mono"
              defaultValue={read(doc.application, "android:icon")}
              placeholder="@mipmap/ic_launcher"
              spellCheck={false}
              onBlur={(e) => commitAppAttr("android:icon", e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="axv-mf-label">主题</span>
            <input
              className="axv-mf-input mono"
              defaultValue={read(doc.application, "android:theme")}
              placeholder="@style/AppTheme"
              spellCheck={false}
              onBlur={(e) => commitAppAttr("android:theme", e.target.value, e.target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
            />
            <span className="axv-mf-label">allowBackup</span>
            <select
              className="axv-mf-input"
              defaultValue={read(doc.application, "android:allowBackup")}
              onChange={(e) => commitAllowBackup(e.target.value)}
            >
              <option value="">未设置</option>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </div>
          {!doc.application ? (
            <div className="axv-mf-warn">没有 &lt;application&gt; 节点，上面这些字段不可编辑。</div>
          ) : null}
        </section>

        {/* ===== 权限 ===== */}
        <section className="axv-mf-sec">
          <div className="axv-mf-head">
            <span className="msr" aria-hidden="true">lock</span>
            <b>权限</b>
            <span className="axv-mf-count">{doc.permissions.length}</span>
          </div>
          <div className="axv-mf-list">
            {doc.permissions.map((p) => {
              const name = attrOfElement(xml, p, "android:name");
              return (
                <div className="axv-mf-row" key={`perm:${p.from}`}>
                  <span className="axv-mf-tag">权限</span>
                  <input
                    className="axv-mf-input mono wide"
                    defaultValue={name}
                    spellCheck={false}
                    aria-label={`${name} 权限名`}
                    onBlur={(e) => commitPermissionName(p, e.target.value, e.target)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") {
                        (e.target as HTMLInputElement).value = name;
                        (e.target as HTMLInputElement).blur();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="axv-val-del"
                    title={`删除 ${name}`}
                    aria-label={`删除 ${name}`}
                    onClick={() => {
                      onChange(removeElement(xml, p));
                      note(`已删 ${name.split(".").pop()}`);
                    }}
                  >
                    <span className="msr" aria-hidden="true">delete</span>
                  </button>
                </div>
              );
            })}
            {doc.permissions.length === 0 ? (
              <div className="axv-mf-empty">还没有声明权限</div>
            ) : null}
          </div>
          <div className="axv-mf-new">
            <input
              className="axv-mf-input mono"
              list="axv-mf-perm-list"
              value={permDraft}
              placeholder="android.permission.CAMERA"
              aria-label="新权限名"
              onChange={(e) => setPermDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addPermission()}
            />
            <datalist id="axv-mf-perm-list">
              {COMMON_PERMISSIONS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <button type="button" className="axv-val-ok" onClick={addPermission}>加权限</button>
          </div>
        </section>

        {/* ===== 组件 ===== */}
        <section className="axv-mf-sec">
          <div className="axv-mf-head">
            <span className="msr" aria-hidden="true">widgets</span>
            <b>组件</b>
            <span className="axv-mf-count">{doc.components.length}</span>
          </div>
          <div className="axv-mf-list">
            {doc.components.map((c) => {
              const name = attrOfElement(xml, c, "android:name");
              const exported = attrOfElement(xml, c, "android:exported");
              const label = attrOfElement(xml, c, "android:label");
              return (
                <div className="axv-mf-row comp" key={`comp:${c.tag}:${c.from}`}>
                  <span className="axv-mf-tag comp">{COMPONENT_LABEL[c.tag] || c.tag}</span>
                  <input
                    className="axv-mf-input mono wide"
                    defaultValue={name}
                    spellCheck={false}
                    aria-label={`${name} 组件名`}
                    onBlur={(e) => commitComponentAttr(c, "android:name", e.target.value, e.target)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <select
                    className="axv-mf-input sel"
                    defaultValue={exported}
                    aria-label={`${name} exported`}
                    onChange={(e) => setExported(c, e.target.value)}
                  >
                    <option value="">未设置</option>
                    <option value="true">exported</option>
                    <option value="false">不导出</option>
                  </select>
                  <input
                    className="axv-mf-input mono label"
                    defaultValue={label}
                    placeholder="label"
                    spellCheck={false}
                    aria-label={`${name} label`}
                    onBlur={(e) => commitComponentAttr(c, "android:label", e.target.value, e.target)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                  />
                  <button
                    type="button"
                    className="axv-val-del"
                    title={`删除 ${name}`}
                    aria-label={`删除 ${name}`}
                    onClick={() => {
                      onChange(removeElement(xml, c));
                      note(`已删 ${name}`);
                    }}
                  >
                    <span className="msr" aria-hidden="true">delete</span>
                  </button>
                </div>
              );
            })}
            {doc.components.length === 0 ? (
              <div className="axv-mf-empty">还没有 activity / service 等组件</div>
            ) : null}
          </div>
          <div className="axv-mf-new">
            <select
              className="axv-mf-input sel"
              aria-label="新组件类型"
              value={compType}
              onChange={(e) => setCompType(e.target.value as (typeof COMPONENT_TYPES)[number])}
            >
              {COMPONENT_TYPES.map((t) => (
                <option key={t} value={t}>{COMPONENT_LABEL[t]}</option>
              ))}
            </select>
            <input
              className="axv-mf-input mono"
              value={compName}
              placeholder=".DetailActivity"
              aria-label="新组件名"
              onChange={(e) => setCompName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addComponent()}
            />
            <button type="button" className="axv-val-ok" onClick={addComponent}>加组件</button>
          </div>
        </section>

        <div className="axv-val-foot">
          <span className="axv-val-tip">
            intent-filter / meta-data 等复杂结构请切「代码」改
          </span>
          <span className="axv-val-msg">{msg}</span>
        </div>
      </div>
    </div>
  );
}
