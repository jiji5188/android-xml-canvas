// components/Inspector.tsx — 右侧属性面板（M25h 从 XmlEditor.tsx 抽出）
//
// 只负责「属性面板长什么样」：include 只读提示 → ConstraintPanel（在 ConstraintLayout 里才出）
// → AttrPanel（属性列表 / 图标 / 形状编辑入口）。所有状态都在 XmlEditor，这里纯展示 + 回调。

import type { ResolvedNode } from "@/lib/xml/types";
import type { ResourceExtras } from "@/lib/xml/resdir";
import { AttrPanel } from "./AttrPanel";
import { ConstraintPanel, type SibOption } from "./ConstraintPanel";

export interface InspectorProps {
  open: boolean;
  onClose: () => void;

  /** 当前选中的节点；null → 显示空态提示 */
  node: ResolvedNode | null;
  /** 当前节点的祖先链（AttrPanel 用来显示路径面包屑） */
  chain: { tag: string; path: string; id?: string }[];

  /* —— 约束（仅 ConstraintLayout 的直接子控件） —— */
  isChildOfCL: boolean;
  clSiblings: SibOption[];
  onCommitMany: (changes: [string, string | null][]) => void;
  onAutoConstrain: () => void;
  onClearConstraints: () => void;
  autoNotes?: string[];

  /* —— 属性 —— */
  onSelectPath: (path: string) => void;
  onCommitAttr: (name: string, value: string) => void;
  onRemoveAttr: (name: string) => void;
  onAddAttr: () => void;
  onDeleteNode: (path: string) => void;
  resExtras: ResourceExtras | null;

  /* —— 图标 / 形状 —— */
  onPickIcon?: (attr: string, resourceName: string, vectorXml: string) => void;
  onEditIconResource?: (name: string, xml: string | undefined, attr: string) => void;
  iconNames: string[];
  onSaveShape?: (attr: string, resourceName: string, xml: string) => void;
  generatedXml: Record<string, string>;
}

export function Inspector(props: InspectorProps) {
  const { open, onClose, node, chain } = props;

  return (
    <aside className={"axv-slide-right" + (open ? " axv-open" : "")}>
      <div className="axv-slide-head">
        <span>属性</span>
        <button className="axv-icon-btn" title="关闭面板" aria-label="关闭面板" onClick={onClose}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 24 }}>
            right_panel_close
          </span>
        </button>
      </div>
      <div className="axv-slide-body">
        {node ? (
          <div className="axv-panel-stack">
            {node.sourceFile ? (
              <div
                className="axv-include-readonly"
                title="include 展开进来的节点：主 XML 里没有它的实体，改不了（要改去那个文件）"
              >
                ⚠ 来自 <b>{node.sourceFile}</b>（include 展开，只读）
              </div>
            ) : null}
            {props.isChildOfCL && (
              <ConstraintPanel
                node={node}
                siblings={props.clSiblings}
                onCommitMany={props.onCommitMany}
                onAuto={props.onAutoConstrain}
                onClear={props.onClearConstraints}
                autoNotes={props.autoNotes}
              />
            )}
            <AttrPanel
              node={node}
              chain={chain}
              onSelectPath={props.onSelectPath}
              onCommit={props.onCommitAttr}
              onRemove={props.onRemoveAttr}
              onAddAttr={props.onAddAttr}
              resExtras={props.resExtras}
              onDeleteNode={() => props.onDeleteNode(node.path)}
              onPickIcon={props.onPickIcon}
              onEditIconResource={props.onEditIconResource}
              iconNames={props.iconNames}
              onSaveShape={props.onSaveShape}
              generatedXml={props.generatedXml}
            />
          </div>
        ) : (
          <div className="axv-attr-hint">在画布或图层树上点任意控件查看并编辑属性</div>
        )}
      </div>
    </aside>
  );
}
