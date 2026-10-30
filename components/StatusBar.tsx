// components/StatusBar.tsx — 底部状态条（M27）
//
// 开发工具没有状态条会让人一直心里没底：当前文件是哪个、设备多宽、缩放多少、
// 有没有未保存改动、有几个问题。这四件必须常驻可见（移动端只保留文件 + 未保存 + 问题数）。
//
// 纯展示：所有数据来自 XmlEditor，点击只回调。

export interface StatusBarProps {
  isMobile?: boolean;
  /** 当前文件名（含 .xml） */
  fileName: string;
  /** 保存目标（原路径或工作目录名），可空 */
  source?: string | null;
  deviceLabel: string;
  deviceSize: string;
  /** 1 = 100% */
  scale: number;
  dirty: boolean;
  issueCount: number;
  /** 点击「N 个问题」——切到问题显示 */
  onIssues?: () => void;
  /** 点击缩放百分比——回到 100% */
  onResetZoom?: () => void;
  /** 上次保存时间文案，如「已保存 14:32」 */
  savedHint?: string | null;
}

export function StatusBar(props: StatusBarProps) {
  const pct = Math.round(props.scale * 100);
  return (
    <div className="axv-appstatus" role="status" aria-live="polite" data-dirty={props.dirty ? "1" : "0"}>
      <span className="axv-sb-file" title={props.source ? `${props.fileName} · ${props.source}` : props.fileName}>
        <span className={"axv-sb-dot" + (props.dirty ? " on" : "")} aria-hidden="true" />
        <span className="axv-sb-name">{props.fileName}</span>
        {props.source && !props.isMobile ? <span className="axv-sb-src">{props.source}</span> : null}
      </span>

      <span className="axv-sb-gap" />

      {props.issueCount > 0 ? (
        <button
          type="button"
          className="axv-sb-item axv-sb-issue"
          onClick={props.onIssues}
          title="显示/隐藏问题标记"
        >
          <span className="msr" aria-hidden="true">error</span>
          {props.issueCount} 个问题
        </button>
      ) : (
        <span className="axv-sb-item axv-sb-ok" title="没有结构性问题">
          <span className="msr" aria-hidden="true">check_circle</span>
          无问题
        </span>
      )}

      {!props.isMobile ? (
        <span className="axv-sb-item" title={`${props.deviceLabel} ${props.deviceSize}`}>
          {props.deviceLabel}
          {props.deviceLabel.includes("×") ? null : <span className="axv-sb-dim">{props.deviceSize}</span>}
        </span>
      ) : null}

      <button
        type="button"
        className="axv-sb-item axv-sb-zoom"
        onClick={props.onResetZoom}
        title="点击恢复 100%"
      >
        {pct}%
      </button>

      {props.savedHint && !props.isMobile ? <span className="axv-sb-item axv-sb-saved">{props.savedHint}</span> : null}
    </div>
  );
}
