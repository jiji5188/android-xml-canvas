"use client";
// components/HistoryPanel.tsx — M140：历史版本快照面板
//
// 和 diffHistory（会话内 50 步按键撤销）分工不同：这里存的是整份文档，
// 关掉 App 再回来还在，用来「回到昨天那版」。
//
// 交互刻意做得很轻：左侧列表点一下就选中，右侧看差异行数和时间，再点恢复。
// 恢复前会先把「当前这版」存成一条快照 —— 恢复错了还能再回来。

import { useCallback, useEffect, useMemo, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import {
  deleteSnap,
  diffStat,
  fmtSizeParts,
  loadSnaps,
  pushSnap,
  relTimeParts,
  SNAP_LABEL_MANUAL,
  SNAP_LABEL_SAVE,
  SNAP_LABEL_BEFORE_RESTORE,
  type Snap,
} from "@/lib/xml/snapshots";

export interface HistoryPanelProps {
  open: boolean;
  /** 按文件分开存（路径或文件名） */
  fileKey: string;
  /** 面板标题里显示的名字 */
  fileLabel: string;
  /** 当前正文 */
  currentXml: string;
  onRestore: (xml: string, label: string) => void;
  onClose: () => void;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export function HistoryPanel({ open, fileKey, fileLabel, currentXml, onRestore, onClose }: HistoryPanelProps) {
  const [list, setList] = useState<Snap[]>([]);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => {
    setList(loadSnaps(fileKey));
  }, [fileKey]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // 「3 分钟前」会过期，开着面板时每 30s 刷一次显示
  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setTick((v) => v + 1), 30000);
    return () => window.clearInterval(id);
  }, [open]);

  const addSnap = () => {
    const r = pushSnap(fileKey, currentXml, SNAP_LABEL_MANUAL);
    setList(r.list);
  };

  const restore = (s: Snap) => {
    // 先把当前版本存一份，恢复错了还能回来
    pushSnap(fileKey, currentXml, SNAP_LABEL_BEFORE_RESTORE);
    onRestore(s.xml, s.label);
  };

  const del = (id: string) => {
    setList(deleteSnap(fileKey, id));
  };

  const rows = useMemo(() => {
    return list.map((s) => {
      const d = diffStat(s.xml, currentXml);
      const sz = fmtSizeParts(s.xml);
      const rp = relTimeParts(s.at);
      const when =
        rp.unit === "just"
          ? tt("刚刚")
          : rp.unit === "min"
            ? tt("{n} 分钟前", { n: rp.n })
            : rp.unit === "hour"
              ? tt("{n} 小时前", { n: rp.n })
              : rp.unit === "day"
                ? tt("{n} 天前", { n: rp.n })
                : new Date(rp.n).toLocaleDateString();
      const size = sz.kb ? `${fmt(sz.n)} KB` : tt("{n} 字", { n: sz.n });
      return { s, d, when, size, same: s.xml === currentXml };
    });
    // tick 只是为了让相对时间重算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, currentXml, tick]);

  if (!open) return null;

  return (
    <div className="axv-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="axv-modal axv-snap-panel"
        role="dialog"
        aria-modal="true"
        aria-label={tt("历史版本")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="axv-modal-head">
          <span className="axv-modal-title">
            {tt("历史版本")}
            <span className="axv-snap-file">{fileLabel}</span>
          </span>
          <button className="axv-icon-btn" aria-label={tt("关闭")} title={tt("关闭")} onClick={onClose}>
            <span className="msr" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="axv-snap-bar">
          <span className="axv-snap-tip">{tt("最多保留最近 {n} 个版本，存在本机", { n: 12 })}</span>
          <button type="button" className="axv-btn axv-snap-add" onClick={addSnap}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>add</span>
            {tt("存一个快照")}
          </button>
        </div>

        {rows.length === 0 ? (
          <div className="axv-snap-empty">
            <span className="msr" aria-hidden="true" style={{ fontSize: 30 }}>history</span>
            <p>{tt("还没有历史版本。保存文件时会自动存一份，也可以点上面的「存一个快照」。")}</p>
          </div>
        ) : (
          <ul className="axv-snap-list">
            {rows.map(({ s, d, when, size, same }) => (
              <li key={s.id} className={"axv-snap-row" + (same ? " is-same" : "")}>
                <div className="axv-snap-when">
                  <span className="axv-snap-rel">{when}</span>
                  <span className="axv-snap-abs">
                    {new Date(s.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <div className="axv-snap-mid">
                  <span className="axv-snap-label">{s.label === SNAP_LABEL_MANUAL ? tt("手动") : s.label === SNAP_LABEL_SAVE ? tt("保存") : s.label === SNAP_LABEL_BEFORE_RESTORE ? tt("恢复前") : s.label}</span>
                  <span className="axv-snap-meta">
                    {size}
                    {same ? (
                      <span className="axv-snap-same">{tt("与当前相同")}</span>
                    ) : (
                      <>
                        <span className="axv-snap-add-n">+{d.added}</span>
                        <span className="axv-snap-del-n">−{d.removed}</span>
                      </>
                    )}
                  </span>
                </div>
                <div className="axv-snap-acts">
                  <button type="button" className="axv-btn axv-ghost axv-snap-restore" onClick={() => restore(s)}>
                    {tt("恢复")}
                  </button>
                  <button
                    type="button"
                    className="axv-icon-btn axv-snap-del"
                    aria-label={tt("删除这个版本")}
                    title={tt("删除这个版本")}
                    onClick={() => del(s.id)}
                  >
                    <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>delete</span>
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
