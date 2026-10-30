// components/AboutPanel.tsx — 「关于」面板（从 XmlEditor.tsx 抽出来的第一块）
//
// 只做展示：项目名/版本/来源致谢/开源组件清单/说明。
// 数据全部来自 lib/xml/credits.ts，改文案只改那边。

import { CREDITS, UPSTREAM, PROJECT_NAME, PROJECT_TAGLINE } from "@/lib/xml/credits";

export interface AboutPanelProps {
  version: string;
  /** i18n 函数（来自 lib/i18n 的 makeT） */
  tr: (key: string, fallback: string) => string;
}

export function AboutPanel({ version, tr }: AboutPanelProps) {
  return (
    <div className="axv-rail-scroll">
      <div className="axv-about-hero">
        {/* M16g：项目 logo（public/logo.svg，也是应用图标） */}
        <img
          className="axv-about-logo"
          src={`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/logo.svg`}
          alt=""
          width={44}
          height={44}
        />
        <div>
          <div className="axv-about-name">{PROJECT_NAME}</div>
          <div className="axv-about-ver">版本 {version}</div>
        </div>
      </div>
      <div className="axv-about-desc">
        {PROJECT_TAGLINE}
        支持 ConstraintLayout 约束求解、shape / selector / vector 资源、图标生成与 res 打包导出。
      </div>

      {/* M16f：项目来源 + 开源致谢（列表数据在 lib/xml/credits.ts，跟 README 同一口径） */}
      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.projectRes", "项目资源")}</div>
        <div className="axv-credit-upstream">
          本项目由 <b>{UPSTREAM.name}</b>（{UPSTREAM.license}，作者 {UPSTREAM.by}）拓展而来。
          {UPSTREAM.role}
          <a href={UPSTREAM.url} target="_blank" rel="noreferrer noopener">
            查看上游仓库
          </a>
        </div>
      </div>

      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.credits", "鸣谢 / 开源组件")}</div>
        <div className="axv-set-hint" style={{ marginBottom: 8 }}>
          这个编辑器能跑到今天，靠的是下面这些开源项目与作者的分享。在此致谢。
        </div>
        <ul className="axv-credit-list">
          {CREDITS.map((c) => (
            <li key={c.name}>
              <a href={c.url} target="_blank" rel="noreferrer noopener">
                {c.name}
              </a>
              <span className="axv-credit-by">{c.by}</span>
              <span className="axv-credit-lic">{c.license}</span>
              <div className="axv-credit-role">{c.role}</div>
            </li>
          ))}
        </ul>
      </div>
      <div className="axv-set-group">
        <div className="axv-set-label">{tr("set.notes", "说明")}</div>
        <div className="axv-set-hint">
          渲染为近似实现，不是 aapt / Android 运行时；个别属性（自定义 View、动画、第三方库）
          只做占位。最终效果以真机为准。
        </div>
      </div>
    </div>
  );
}
