// components/CanvasBoundary.tsx — M22：画布渲染兜底
//
// 解析出错已经由解析层挡住了，但「约束求解 / 样式生成 / 装饰层」仍可能因为
// 畸形数据抛异常。React 里组件抛异常会卸载整棵树 → 用户看到白屏。
// 这里用 ErrorBoundary 把画布圈起来：崩了只丢画布，工具栏/代码面板还在，能继续修。

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Labels {
  title: string;
  hint: string;
  fix: string;
  retry: string;
}

interface Props {
  children: ReactNode;
  /** 点「去代码面板」时的回调（由 XmlEditor 传 gotoLine(1)） */
  onFix?: () => void;
  /** 依赖变化（如 xml 内容）时允许自动重试一次，避免一次崩溃永久卡死 */
  resetKey?: string;
  /** M23：文案由外部按当前界面语言传入 */
  labels?: Labels;
}

const DEFAULT_LABELS: Labels = {
  title: "画布渲染出错了",
  hint: "这不是你操作的问题，多半是某段布局数据超出了支持范围。到「代码」面板改一下（哪怕加个空格再删掉）画布会自动重试。",
  fix: "去代码面板修正",
  retry: "重试渲染",
};

interface State {
  error: Error | null;
  lastKey?: string;
}

export default class CanvasBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    // 内容变了就清掉错误，让用户改完代码能直接看到恢复
    if (state.error && props.resetKey !== state.lastKey) {
      return { error: null, lastKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[axv] 画布渲染崩溃", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const L = this.props.labels || DEFAULT_LABELS;
    return (
      <div className="axv-parse-fail" role="alert">
        <span className="msr axv-parse-fail-icon" aria-hidden="true">
          bug_report
        </span>
        <div className="axv-parse-fail-title">{L.title}</div>
        <div className="axv-parse-fail-msg">{error.message || "未知渲染错误"}</div>
        <div className="axv-parse-fail-hint">{L.hint}</div>
        <div className="axv-parse-fail-btns">
          <button className="axv-parse-fail-btn" onClick={() => this.props.onFix?.()}>
            <span className="msr" aria-hidden="true" style={{ fontSize: 17 }}>
              code
            </span>
            {L.fix}
          </button>
          <button className="axv-parse-fail-btn ghost" onClick={() => this.setState({ error: null })}>
            {L.retry}
          </button>
        </div>
      </div>
    );
  }
}
