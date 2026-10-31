"use client";

// components/GenAssetsPanel.tsx — M5b 已生成资源管理面板
// 列出编辑器生成的全部 drawable（图标 vector / shape / selector…），支持：
// 预览缩略图、引用计数、改名（同步改布局里的 @drawable/x）、删除（被引用时二次确认）、
// 复制 / 下载 xml。

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  assetKind,
  countReferences,
  humanSize,
  kindLabel,
} from "@/lib/xml/asset-refs";
import { vectorToDataUrl } from "@/lib/xml/vector-svg";
import { parseShapeSpec, specToCss } from "@/lib/xml/shape-gen";
import { sanitizeResName } from "@/lib/xml/resname";
import { saveTextNative } from "@/lib/xml/native-save";
import { saveResFiles, type ProjectSaveRoot } from "@/lib/xml/project-save";

interface Props {
  /** 已生成资源：资源名 → xml 原文 */
  assets: Record<string, string>;
  /** 当前布局，用于统计引用 */
  layoutXml: string;
  /** 改名：原名 → 新名（父级负责改 xml 引用 + 存储） */
  onRename: (oldName: string, newName: string) => void;
  /** 删除（父级负责从存储里移除） */
  onDelete: (name: string) => void;
  onClose: () => void;
  /** 提示（例如「已改名，布局里 N 处引用同步更新」） */
  onNote?: (text: string) => void;
  /** M11：内嵌到左侧 tab 面板里（不用弹窗/遮罩层） */
  inline?: boolean;
  /** M11：双击形状资源 → 打开形状编辑器改内容 */
  onEditShape?: (name: string, xml: string) => void;
  /** M11j：双击图标（vector）→ 打开图标编辑器 */
  onEditIcon?: (name: string, xml: string) => void;
  /** M36：当前项目的可写根（有则「下载」直接写进 app/src/main/res/drawable/） */
  projectRoot?: ProjectSaveRoot | null;
  /** M36：项目名（写盘提示用） */
  projectName?: string;
}

/** 缩略图：vector → data URL；shape/selector/layer-list → 按 CSS 近似画个色块 */
function thumb(name: string, xml: string): { url?: string; css?: CSSProperties } {
  if (/<vector[\s>]/.test(xml)) {
    const u = vectorToDataUrl(xml);
    if (u) return { url: u };
  }
  const spec = parseShapeSpec(xml);
  if (spec) {
    const css = specToCss(spec);
    return { css: css as CSSProperties };
  }
  return { css: { background: "#EDE7F6", border: "1px dashed #9575CD" } };
}

export function GenAssetsPanel({
  assets,
  layoutXml,
  onRename,
  onDelete,
  onClose,
  onNote,
  inline,
  onEditShape,
  onEditIcon,
  projectRoot,
  projectName,
}: Props) {
  const [q, setQ] = useState("");
  /** 正在改名的资源名 */
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [err, setErr] = useState("");
  /** 等待二次确认删除的资源名 */
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  const rows = useMemo(() => {
    const list = Object.entries(assets).map(([name, xml]) => ({
      name,
      xml,
      kind: assetKind(xml),
      refs: countReferences(layoutXml, name),
      size: new Blob([xml]).size,
    }));
    const kw = q.trim().toLowerCase();
    const filtered = kw ? list.filter((r) => r.name.toLowerCase().includes(kw)) : list;
    // 被引用的排前面，其次按名字
    return filtered.sort((a, b) => b.refs - a.refs || a.name.localeCompare(b.name));
  }, [assets, layoutXml, q]);

  const total = Object.keys(assets).length;

  const startRename = (name: string) => {
    setEditing(name);
    setDraft(name);
    setErr("");
    setConfirmDel(null);
  };

  const submitRename = () => {
    if (!editing) return;
    const safe = sanitizeResName(draft, "ic");
    if (!safe) {
      setErr("资源名不能为空（只能用 a-z 0-9 _，且字母开头）");
      return;
    }
    if (safe !== draft.trim()) {
      // 允许自动纠正，但要说清楚
      setDraft(safe);
      setErr(`已按 aapt 规则纠正为 ${safe}，再点一次「确定」`);
      return;
    }
    if (safe !== editing && safe in assets) {
      setErr(`已存在同名资源 ${safe}`);
      return;
    }
    const refs = countReferences(layoutXml, editing);
    onRename(editing, safe);
    onNote?.(
      refs > 0
        ? `已改名 ${editing} → ${safe}，布局里 ${refs} 处引用已同步`
        : `已改名 ${editing} → ${safe}`
    );
    setEditing(null);
    setErr("");
  };

  const submitDelete = (name: string) => {
    const refs = countReferences(layoutXml, name);
    if (refs > 0 && confirmDel !== name) {
      setConfirmDel(name);
      return;
    }
    onDelete(name);
    onNote?.(refs > 0 ? `已删除 ${name}（布局里 ${refs} 处引用会变成缺失资源）` : `已删除 ${name}`);
    setConfirmDel(null);
  };

  const copyXml = async (name: string, xml: string) => {
    try {
      await navigator.clipboard.writeText(xml);
      onNote?.(`已复制 ${name} 的 xml`);
    } catch {
      onNote?.("复制失败（浏览器不允许写剪贴板）");
    }
  };

  const downloadXml = (name: string, xml: string) => {
    // M36：有打开的项目 → 直接写进它的 res/drawable，不再丢到下载目录
    if (projectRoot) {
      void saveResFiles(projectRoot, [{ path: `drawable/${name}.xml`, text: xml }]).then((r) => {
        onNote?.(
          r.ok
            ? `已写入《${projectName || "项目"}》app/src/main/res/drawable/${name}.xml`
            : `写入项目失败：${r.failed[0] || "目录不可写"}`,
        );
      });
      return;
    }
    if (saveTextNative(`${name}.xml`, xml, "text/xml")) return;
    const blob = new Blob([xml], { type: "text/xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.xml`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** 内嵌版：整块塞进左侧 tab 面板（无遮罩、无标题栏、无关闭按钮） */
  if (inline) {
    return (
      <div className="axv-assets-inline" aria-label="已生成资源">
      <div className="axv-assets-search">
        <span className="msr" aria-hidden="true" style={{ fontSize: 18, opacity: 0.6 }}>
          search
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索资源名…"
          aria-label="搜索资源名"
        />
      </div>


      {total === 0 ? (
        <div className="axv-assets-empty">
          还没有生成过资源。用属性面板的 <b>🖼</b> 选图标 / <b>⬛</b> 建形状，生成后会出现在这里。
        </div>
      ) : rows.length === 0 ? (
        <div className="axv-assets-empty">没有匹配「{q}」的资源</div>
      ) : (
        <div className="axv-assets-list">
          {rows.map((r) => {
            const t = thumb(r.name, r.xml);
            const isEditing = editing === r.name;
            return (
              <div
                className={
                  "axv-assets-row" +
                  ((onEditShape && r.kind === "shape") || (onEditIcon && r.kind === "vector")
                    ? " axv-assets-row-editable"
                    : "")
                }
                key={r.name}
                onDoubleClick={() => {
                  if (r.kind === "shape" && onEditShape) onEditShape(r.name, r.xml);
                  else if (r.kind === "vector" && onEditIcon) onEditIcon(r.name, r.xml);
                }}
                title={
                  r.kind === "shape" && onEditShape
                    ? "双击编辑形状内容"
                    : r.kind === "vector" && onEditIcon
                      ? "双击编辑图标（颜色 / 尺寸 / 路径 / 旋转）"
                      : undefined
                }
              >
                <div className="axv-assets-thumb">
                  {t.url ? (
                    <img src={t.url} alt="" />
                  ) : (
                    <span className="axv-assets-swatch" style={t.css} />
                  )}
                </div>

                <div className="axv-assets-main">
                  {isEditing ? (
                    <input
                      className="axv-assets-input"
                      value={draft}
                      autoFocus
                      onChange={(e) => {
                        setDraft(e.target.value);
                        setErr("");
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitRename();
                        if (e.key === "Escape") {
                          setEditing(null);
                          setErr("");
                        }
                      }}
                    />
                  ) : (
                    <div className="axv-assets-name">
                      {r.name}
                      <span className="axv-assets-kind">{kindLabel(r.kind)}</span>
                      {r.refs === 0 ? (
                        <span className="axv-assets-badge is-unused">未引用</span>
                      ) : (
                        <span className="axv-assets-badge">引用 {r.refs}</span>
                      )}
                    </div>
                  )}
                  <div className="axv-assets-sub">
                    drawable/{r.name}.xml · {humanSize(r.size)}
                  </div>
                  {isEditing && err ? <div className="axv-assets-err">{err}</div> : null}
                </div>

                <div className="axv-assets-actions">
                  {isEditing ? (
                    <>
                      <button className="axv-btn axv-btn-sm" onClick={submitRename}>
                        确定
                      </button>
                      <button
                        className="axv-btn axv-btn-sm axv-ghost"
                        onClick={() => {
                          setEditing(null);
                          setErr("");
                        }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="axv-icon-btn"
                        title="改名（会同步改布局里的引用）"
                        aria-label="改名"
                        onClick={() => startRename(r.name)}
                      >
                        <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>
                          edit
                        </span>
                      </button>
                      <button
                        className="axv-icon-btn"
                        title="复制 xml"
                        aria-label="复制 xml"
                        onClick={() => void copyXml(r.name, r.xml)}
                      >
                        <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>
                          content_copy
                        </span>
                      </button>
                      <button
                        className="axv-icon-btn"
                        title="下载 xml 文件"
                        aria-label="下载 xml"
                        onClick={() => downloadXml(r.name, r.xml)}
                      >
                        <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>
                          download
                        </span>
                      </button>
                      <button
                        className={
                          "axv-icon-btn" + (confirmDel === r.name ? " is-danger" : "")
                        }
                        title={
                          confirmDel === r.name
                            ? `再点一次确认删除（${r.refs} 处引用会变缺失）`
                            : "删除资源"
                        }
                        aria-label="删除"
                        onClick={() => submitDelete(r.name)}
                      >
                        <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>
                          {confirmDel === r.name ? "warning" : "delete"}
                        </span>
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}


      <div className="axv-assets-foot">
        <span>
          改名 / 删除只影响编辑器里生成的资源；已上传 res 目录里的同名文件不会被改动。
          形状资源双击可直接改内容。
        </span>
      </div>

      </div>
    );
  }

  const body = (
    <div
      className="axv-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="axv-modal axv-assets-modal" role="dialog" aria-label="已生成资源">
        <div className="axv-modal-head">
          <span>已生成资源 · {total}</span>
          <button className="axv-icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="axv-assets-search">
          <span className="msr" aria-hidden="true" style={{ fontSize: 18, opacity: 0.6 }}>
            search
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索资源名…"
            aria-label="搜索资源名"
          />
        </div>

        {total === 0 ? (
          <div className="axv-assets-empty">
            还没有生成过资源。用属性面板的 <b>🖼</b> 选图标 / <b>⬛</b> 建形状，生成后会出现在这里。
          </div>
        ) : rows.length === 0 ? (
          <div className="axv-assets-empty">没有匹配「{q}」的资源</div>
        ) : (
          <div className="axv-assets-list">
            {rows.map((r) => {
              const t = thumb(r.name, r.xml);
              const isEditing = editing === r.name;
              return (
                <div className="axv-assets-row" key={r.name}>
                  <div className="axv-assets-thumb">
                    {t.url ? (
                      <img src={t.url} alt="" />
                    ) : (
                      <span className="axv-assets-swatch" style={t.css} />
                    )}
                  </div>

                  <div className="axv-assets-main">
                    {isEditing ? (
                      <input
                        className="axv-assets-input"
                        value={draft}
                        autoFocus
                        onChange={(e) => {
                          setDraft(e.target.value);
                          setErr("");
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename();
                          if (e.key === "Escape") {
                            setEditing(null);
                            setErr("");
                          }
                        }}
                      />
                    ) : (
                      <div className="axv-assets-name">
                        {r.name}
                        <span className="axv-assets-kind">{kindLabel(r.kind)}</span>
                        {r.refs === 0 ? (
                          <span className="axv-assets-badge is-unused">未引用</span>
                        ) : (
                          <span className="axv-assets-badge">引用 {r.refs}</span>
                        )}
                      </div>
                    )}
                    <div className="axv-assets-sub">
                      drawable/{r.name}.xml · {humanSize(r.size)}
                    </div>
                    {isEditing && err ? <div className="axv-assets-err">{err}</div> : null}
                  </div>

                  <div className="axv-assets-actions">
                    {isEditing ? (
                      <>
                        <button className="axv-btn axv-btn-sm" onClick={submitRename}>
                          确定
                        </button>
                        <button
                          className="axv-btn axv-btn-sm axv-ghost"
                          onClick={() => {
                            setEditing(null);
                            setErr("");
                          }}
                        >
                          取消
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="axv-icon-btn"
                          title="改名（会同步改布局里的引用）"
                          aria-label="改名"
                          onClick={() => startRename(r.name)}
                        >
                          <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>
                            edit
                          </span>
                        </button>
                        <button
                          className="axv-icon-btn"
                          title="复制 xml"
                          aria-label="复制 xml"
                          onClick={() => void copyXml(r.name, r.xml)}
                        >
                          <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>
                            content_copy
                          </span>
                        </button>
                        <button
                          className="axv-icon-btn"
                          title="下载 xml 文件"
                          aria-label="下载 xml"
                          onClick={() => downloadXml(r.name, r.xml)}
                        >
                          <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>
                            download
                          </span>
                        </button>
                        <button
                          className={
                            "axv-icon-btn" + (confirmDel === r.name ? " is-danger" : "")
                          }
                          title={
                            confirmDel === r.name
                              ? `再点一次确认删除（${r.refs} 处引用会变缺失）`
                              : "删除资源"
                          }
                          aria-label="删除"
                          onClick={() => submitDelete(r.name)}
                        >
                          <span className="msr" aria-hidden="true" style={{ fontSize: 19 }}>
                            {confirmDel === r.name ? "warning" : "delete"}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="axv-assets-foot">
          <span>
            改名 / 删除只影响编辑器里生成的资源；已上传 res 目录里的同名文件不会被改动
          </span>
          {inline ? null : (
            <button className="axv-btn" onClick={onClose}>
              关闭
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return typeof document === "undefined" ? body : createPortal(body, document.body);
}
