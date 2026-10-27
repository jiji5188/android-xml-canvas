"use client";

// components/ResImagePreview.tsx — M4u：资源树里点图片 → 弹预览框
// 只做「看一眼」：图片居中、棋盘格底（看透明度）、显示资源名/路径/尺寸，Esc 或点遮罩关闭。

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  /** res/drawable-hdpi/ic_home.png */
  rel: string;
  /** 资源名（ic_home） */
  name: string;
  /** dataURL 或 http(s) URL；空 = 没解析到 */
  url: string;
  onClose: () => void;
}

export function ResImagePreview({ rel, name, url, onClose }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className="axv-modal-backdrop" onClick={onClose}>
      <div className="axv-modal axv-imgprev" onClick={(e) => e.stopPropagation()}>
        <div className="axv-modal-head">
          <span className="axv-modal-title">
            🖼 {name}
            <span className="axv-imgprev-meta">
              {rel}
              {size ? ` · ${size.w}×${size.h}` : ""}
            </span>
          </span>
          <button className="axv-icon-btn" onClick={onClose} title="关闭（Esc）">
            ✕
          </button>
        </div>
        <div className="axv-imgprev-body">
          {url ? (
            <img
              src={url}
              alt={name}
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setSize({ w: el.naturalWidth, h: el.naturalHeight });
              }}
            />
          ) : (
            <div className="axv-imgprev-empty">
              没解析到这张图的内容
              <br />
              <span style={{ fontSize: 12, opacity: 0.7 }}>
                可能是该文件不是图片、或导入时被跳过了（只收 png/jpg/webp/gif/bmp 与 vector xml）
              </span>
            </div>
          )}
        </div>
        <div className="axv-imgprev-foot">
          <code>@drawable/{name}</code>
          <button
            className="axv-btn"
            onClick={() => {
              void navigator.clipboard?.writeText(`@drawable/${name}`);
            }}
            title="复制资源引用"
          >
            复制引用
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
