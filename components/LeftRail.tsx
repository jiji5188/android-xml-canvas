// components/LeftRail.tsx — 左侧滑面板的容器：52px 图标条 + 标题栏 + 内容
//
// M25g 从 XmlEditor.tsx 抽出。这里只管「导航条长什么样、当前选中哪个视图」，
// 各视图的内容（组件 / 图层 / AI / 资源 / 项目管理 / 设置 / 关于）由调用方作为 children 塞进来。

import type { ReactNode } from "react";

export type LeftView = "parts" | "layers" | "ai" | "code" | "res" | "assets" | "settings" | "about";

interface RailItem {
  view: LeftView;
  icon: string;
  titleKey: string;
  fallback: string;
}

/** 上半部分：工作相关 */
const TOP_ITEMS: RailItem[] = [
  { view: "parts", icon: "widgets", titleKey: "rail.parts", fallback: "组件" },
  { view: "layers", icon: "account_tree", titleKey: "rail.layers", fallback: "图层" },
  { view: "ai", icon: "auto_awesome", titleKey: "rail.ai", fallback: "AI 助手" },
  { view: "assets", icon: "category", titleKey: "rail.assets", fallback: "已生成资源" },
  { view: "res", icon: "folder_open", titleKey: "rail.res", fallback: "项目管理" },
];

/** 下半部分：设置 / 关于（中间用弹性空隙顶到底部） */
const BOTTOM_ITEMS: RailItem[] = [
  { view: "settings", icon: "settings", titleKey: "rail.settings", fallback: "设置" },
  { view: "about", icon: "info", titleKey: "rail.about", fallback: "关于" },
];

const TITLES: Record<LeftView, { key: string; fallback: string }> = {
  parts: { key: "rail.parts", fallback: "组件" },
  layers: { key: "rail.layers", fallback: "图层" },
  ai: { key: "rail.ai", fallback: "AI 助手" },
  code: { key: "rail.code", fallback: "XML 代码" },
  res: { key: "rail.res", fallback: "项目管理" },
  assets: { key: "rail.assets", fallback: "已生成资源" },
  settings: { key: "rail.settings", fallback: "设置" },
  about: { key: "rail.about", fallback: "关于" },
};

export interface LeftRailProps {
  tr: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
  view: LeftView;
  open: boolean;
  onPick: (v: LeftView) => void;
  onClose: () => void;
  children: ReactNode;
}

export function LeftRail(props: LeftRailProps) {
  const { tr, view, open, onPick, onClose, children } = props;

  const item = (it: RailItem, idx: number) => {
    const on = view === it.view;
    const title = tr(it.titleKey, it.fallback);
    return (
      <button
        key={it.view}
        className={"axv-rail-btn" + (on ? " on" : "")}
        title={title}
        aria-label={title}
        aria-pressed={on}
        data-rail-index={idx}
        onClick={() => onPick(it.view)}
      >
        <span
          className="msr"
          aria-hidden="true"
          data-fill={on ? "1" : "0"}
          style={{ fontSize: 24 }}
        >
          {it.icon}
        </span>
      </button>
    );
  };

  return (
    <aside className={"axv-slide-left" + (open ? " axv-open" : "")}>
      <div className="axv-rail">
        {TOP_ITEMS.map(item)}
        <div className="axv-rail-gap" />
        {BOTTOM_ITEMS.map((it, i) => item(it, TOP_ITEMS.length + i))}
      </div>

      <div className="axv-rail-body">
        <div className="axv-rail-head">
          <span className="axv-rail-title">{tr(TITLES[view].key, TITLES[view].fallback)}</span>
          <button
            className="axv-icon-btn"
            title={tr("rail.close", "关闭面板")}
            aria-label={tr("rail.close", "关闭面板")}
            onClick={onClose}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 24 }}>
              left_panel_close
            </span>
          </button>
        </div>
        {children}
      </div>
    </aside>
  );
}
