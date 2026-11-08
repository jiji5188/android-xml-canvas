import React, { useState } from "react";

/**
 * M185：通用「底部抽屉 + tab 容器」(ROADMAP L0.5 第22条)
 * - 桌面：默认收起，展开高度 22% 视口；手机：半屏滑出
 * - 通用 tab 容器：Problems / 构建日志（先接 Problems，构建日志随后）
 * - 不挤占画布：absolute 定位在画布区底部，收起时只剩一条 28px 把手
 */

export type DrawerPanel = "problems" | "build-log";

interface DrawerTabDef {
  key: DrawerPanel;
  label: string;
  icon: string;
}

const TABS: DrawerTabDef[] = [
  { key: "problems", label: "问题", icon: "warning_amber" }, // i18n-ignore
  { key: "build-log", label: "构建日志", icon: "terminal" }, // i18n-ignore
];

export interface ProblemsDrawerProps {
  /** 问题列表（空 = 收起时把手不显示红点） */
  problems: { line: number; msg: string }[];
  /** 点击某条问题 → 跳代码行 */
  onGotoLine: (line: number) => void;
  tr: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
}

export function ProblemsDrawer({ problems, onGotoLine, tr }: ProblemsDrawerProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<DrawerPanel>("problems");
  const [logText, setLogText] = useState("");

  const n = problems.length;
  return (
    <div
      className={"axv-drawer" + (open ? " axv-drawer-open" : "")}
      role="region"
      aria-label={tr("drawer.title", "问题 / 日志抽屉")}
    >
      {/* 把手条（收起态的唯一常驻 UI） */}
      <div
        className="axv-drawer-bar"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <span className="msr axv-drawer-chevron" aria-hidden="true">
          {open ? "expand_less" : "expand_more"}
        </span>
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"axv-drawer-tab" + (tab === t.key ? " on" : "")}
            onClick={(e) => {
              e.stopPropagation();
              setTab(t.key);
              setOpen(true);
            }}
            role="tab"
            aria-selected={tab === t.key}
          >
            <span className="msr" aria-hidden="true">
              {t.icon}
            </span>
            {tr("drawer.tab." + t.key, t.label)}
            {t.key === "problems" && n > 0 ? <span className="axv-drawer-badge">{n}</span> : null}
          </button>
        ))}
      </div>
      {open ? (
        <div className="axv-drawer-body">
          {tab === "problems" ? (
            n === 0 ? (
              <div className="axv-drawer-empty">{tr("drawer.none", "当前没有检测到问题")}</div>
            ) : (
              <ul className="axv-drawer-list" role="list">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button
                      className="axv-drawer-item"
                      onClick={() => {
                        onGotoLine(p.line);
                        // M187：跳行后收起抽屉，别让 22vh 的抽屉挡住要看的行
                        setOpen(false);
                      }}
                    >
                      <span className="axv-drawer-line">L{p.line}</span>
                      <span className="axv-drawer-msg">{p.msg}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            /* 构建日志：先给个容器 + 占位（M185 构建功能接入时填 logText） */
            <textarea
              className="axv-drawer-log"
              readOnly
              value={logText || tr("drawer.log.empty", "暂无构建日志。")}
              onChange={(e) => setLogText(e.target.value)}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
