// components/TreeFileMenu.tsx — M46：项目结构树的长按操作菜单 + 新建/重命名弹窗
//
// 设计要点：
//   · 菜单是「浮层」，按长按点的坐标定位（mobile 上会 clamp 进视口）；
//   · 只有 native（APK）后端支持重命名/删除/移动/复制（FSA 无这些 API），
//     web 后端把这些项置灰并提示「网页版暂不支持，请用 APK」；
//   · 所有弹窗都是受控组件，状态由 ProjectPanel 持有。

import { useEffect, useRef, useState } from "react";

export type MenuAction = "new" | "rename" | "move" | "copy" | "paste" | "delete";

export interface TreeNodeRef {
  /** 长按命中的项目内相对路径（目录时可行） */
  rel: string;
  name: string;
  isDir: boolean;
}

export interface TreeFileMenuProps {
  /** 长按位置（视口坐标） */
  x: number;
  y: number;
  target: TreeNodeRef;
  /** 是否支持写操作（native 才有重命名/删除/移动/复制） */
  canWrite: boolean;
  /** 有复制标记时才能粘贴 */
  hasClipboard: boolean;
  onAction: (a: MenuAction) => void;
  onClose: () => void;
}

const MENU_W = 168;
const MENU_H = 6 * 38 + 12;

export function TreeFileMenu(p: TreeFileMenuProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: p.x, top: p.y });

  // 挂载后按实际尺寸 clamp 进视口
  useEffect(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = ref.current;
    const w = el?.offsetWidth || MENU_W;
    const h = el?.offsetHeight || MENU_H;
    setPos({
      left: Math.max(6, Math.min(p.x, vw - w - 6)),
      top: Math.max(6, Math.min(p.y, vh - h - 6)),
    });
  }, [p.x, p.y]);

  // 点外面 / Esc 关闭
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) p.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") p.onClose();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [p]);

  const items: { key: MenuAction; label: string; hint?: string; disabled?: boolean; danger?: boolean }[] = [
    { key: "new", label: "新建", hint: p.target.isDir ? `在 ${p.target.name} 内` : "同层" },
    { key: "rename", label: "重命名", disabled: !p.canWrite },
    { key: "move", label: "移动", disabled: !p.canWrite },
    { key: "copy", label: "复制" },
    {
      key: "paste",
      label: "粘贴",
      disabled: !p.hasClipboard || !p.canWrite,
      hint: p.hasClipboard ? undefined : "先复制一项",
    },
    { key: "delete", label: "删除", disabled: !p.canWrite, danger: true },
  ];

  return (
    <div className="axv-tfm-mask" role="presentation">
      <div className="axv-tfm" ref={ref} style={{ left: pos.left, top: pos.top }} role="menu">
        {items.map((it) => (
          <button
            key={it.key}
            className={"axv-tfm-item" + (it.danger ? " danger" : "")}
            role="menuitem"
            disabled={it.disabled}
            onClick={() => {
              if (it.disabled) return;
              p.onAction(it.key);
            }}
          >
            <span className="axv-tfm-label">{it.label}</span>
            {it.hint ? <span className="axv-tfm-hint">{it.hint}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------------- 新建弹窗 ---------------- */

export interface NewEntryDialogProps {
  /** 长按的节点（目录时默认「建在此目录内」） */
  target: TreeNodeRef;
  /** 同层已有的名字（用于即时查重提示） */
  takenNames: Set<string>;
  onSubmit: (o: { name: string; isDir: boolean; parentRel: string }) => void;
  onClose: () => void;
}

export function NewEntryDialog(p: NewEntryDialogProps) {
  const [name, setName] = useState("");
  const [isDir, setIsDir] = useState(false);
  // 默认：长按目录 → 建在该目录内；长按文件 → 建在同层
  const parentOf = (rel: string) => (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
  const [inThisDir, setInThisDir] = useState(p.target.isDir);

  const parentRel = inThisDir && p.target.isDir ? p.target.rel : parentOf(p.target.rel);
  const finalName = isDir ? name.trim() : name.trim();
  const dup = !!finalName && p.takenNames.has(finalName);
  const canSubmit = finalName.length > 0 && !dup && !/[/\\]/.test(finalName);

  return (
    <div className="axv-tfm-mask">
      <div className="axv-dlg" role="dialog" aria-label="新建">
        <div className="axv-dlg-title">新建</div>
        <label className="axv-dlg-row">
          <span className="axv-dlg-label">名称</span>
          <input
            className="axv-dlg-input"
            autoFocus
            value={name}
            placeholder={isDir ? "新文件夹名" : "新文件名，如 detail.xml"}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) p.onSubmit({ name: finalName, isDir, parentRel });
            }}
          />
          <label className="axv-dlg-check" title="勾选=建文件夹，不勾=建文件">
            <input type="checkbox" checked={isDir} onChange={(e) => setIsDir(e.target.checked)} />
            <span>文件夹</span>
          </label>
        </label>

        {p.target.isDir ? (
          <label className="axv-dlg-row axv-dlg-sub">
            <span className="axv-dlg-label">位置</span>
            <span className="axv-dlg-radio-group">
              <label className="axv-dlg-radio">
                <input
                  type="radio"
                  checked={!inThisDir}
                  onChange={() => setInThisDir(false)}
                />
                <span>同层（{parentOf(p.target.rel) || "项目根"}）</span>
              </label>
              <label className="axv-dlg-radio">
                <input type="radio" checked={inThisDir} onChange={() => setInThisDir(true)} />
                <span>{p.target.name}/ 目录内</span>
              </label>
            </span>
          </label>
        ) : null}

        <div className="axv-dlg-hint">
          {dup ? `「${finalName}」已存在，请换个名字` : `将创建到：${parentRel || "项目根"}/`}
        </div>

        <div className="axv-dlg-actions">
          <button className="axv-btn axv-ghost" onClick={p.onClose}>
            取消
          </button>
          <button
            className="axv-btn"
            disabled={!canSubmit}
            onClick={() => p.onSubmit({ name: finalName, isDir, parentRel })}
          >
            确定
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 重命名弹窗 ---------------- */

export function RenameDialog(p: {
  target?: TreeNodeRef;
  /** 弹窗标题（默认「重命名」） */
  title?: string;
  /** 输入框初始值（默认 = target.name） */
  initial?: string;
  /** 说明行（默认显示原名称） */
  desc?: string;
  /** 提交按钮文字（默认「确定」） */
  submitLabel?: string;
  takenNames: Set<string>;
  onSubmit: (newName: string) => void;
  onClose: () => void;
}) {
  const start = p.initial ?? p.target?.name ?? "";
  const [name, setName] = useState(start);
  const trimmed = name.trim();
  const same = trimmed === start;
  const dup = !same && p.takenNames.has(trimmed);
  const canSubmit = trimmed.length > 0 && !dup && !/[/\\]/.test(trimmed) && !same;
  const isDir = p.target?.isDir ?? false;

  return (
    <div className="axv-tfm-mask">
      <div className="axv-dlg" role="dialog" aria-label={p.title || "重命名"}>
        <div className="axv-dlg-title">{p.title || "重命名"}</div>
        <label className="axv-dlg-row">
          <span className="axv-dlg-label">新名称</span>
          <input
            className="axv-dlg-input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => {
              // 选中不含扩展名的部分，方便只改前缀
              const dot = e.target.value.lastIndexOf(".");
              if (!isDir && dot > 0) e.target.setSelectionRange(0, dot);
              else e.target.select();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) p.onSubmit(trimmed);
            }}
          />
        </label>
        <div className="axv-dlg-hint">
          {dup ? `「${trimmed}」已存在，请换个名字` : (p.desc ?? `原名称：${start}`)}
        </div>
        <div className="axv-dlg-actions">
          <button className="axv-btn axv-ghost" onClick={p.onClose}>
            取消
          </button>
          <button className="axv-btn" disabled={!canSubmit} onClick={() => p.onSubmit(trimmed)}>
            {p.submitLabel || "确定"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 简单的消息提示弹窗 ---------------- */

export function MessageDialog(p: { title: string; text: string; onClose: () => void }) {
  return (
    <div className="axv-tfm-mask">
      <div className="axv-dlg" role="dialog" aria-label={p.title}>
        <div className="axv-dlg-title">{p.title}</div>
        <div className="axv-dlg-hint axv-dlg-multiline">{p.text}</div>
        <div className="axv-dlg-actions">
          <button className="axv-btn" onClick={p.onClose} autoFocus>
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 确认弹窗（删除用） ---------------- */

export function ConfirmDialog(p: {
  title: string;
  text: string;
  danger?: boolean;
  onOk: () => void;
  onClose: () => void;
}) {
  return (
    <div className="axv-tfm-mask">
      <div className="axv-dlg" role="dialog" aria-label={p.title}>
        <div className="axv-dlg-title">{p.title}</div>
        <div className="axv-dlg-hint axv-dlg-multiline">{p.text}</div>
        <div className="axv-dlg-actions">
          <button className="axv-btn axv-ghost" onClick={p.onClose}>
            取消
          </button>
          <button className={"axv-btn" + (p.danger ? " axv-btn-danger" : "")} onClick={p.onOk}>
            确定
          </button>
        </div>
      </div>
    </div>
  );
}
