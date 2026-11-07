// components/TreeFileMenu.tsx — M46：项目结构树的长按操作菜单 + 新建/重命名弹窗
//
// 设计要点：
//   · 菜单是「浮层」，按长按点的坐标定位（mobile 上会 clamp 进视口）；
//   · 只有 native（APK）后端支持重命名/删除/移动/复制（FSA 无这些 API），
//     web 后端把这些项置灰并提示「网页版暂不支持，请用 APK」；
//   · 所有弹窗都是受控组件，状态由 ProjectPanel 持有。

import { useEffect, useRef, useState, type ReactNode } from "react";
import { t as tt } from "@/lib/i18n-src";
import { isValidResName, cleanResNameInput } from "@/lib/xml/resname";
import { createPortal } from "react-dom";

/** M46c：所有浮层挂到 .axv-main 下（用户要求），拿不到就回 body */
export function Overlay({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const el = document.querySelector(".axv-main");
    setHost((el as HTMLElement) || document.body);
  }, []);
  if (!host) return null;
  return createPortal(children, host);
}

export type MenuAction = "new" | "rename" | "move" | "copy" | "paste" | "delete" | "fill";

/** M46d：路径太长时只留尾部 —— `app/src/main/java/com/returngoods/app` → `.../app/`
 *  规则：从尾部往前拼，整段超过 max 就停（保证至少留最后一级）。 */
export function shortPath(p: string, max = 14): string {
  const segs = p.split("/").filter(Boolean);
  if (!segs.length) return "";
  const whole = segs.join("/");
  if (whole.length <= max) return `${whole}/`;
  let tail = segs[segs.length - 1];
  for (let i = segs.length - 2; i >= 0; i--) {
    const cand = `${segs[i]}/${tail}`;
    if (cand.length > max) break;
    tail = cand;
  }
  return `.../${tail}/`;
}

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
  /** M180：选中的是 drawable/mipmap 图标文件时，多一项「填入选中控件」 */
  canFill?: boolean;
  onAction: (a: MenuAction) => void;
  onClose: () => void;
}

const MENU_W = 168;
const MENU_H = 7 * 38 + 12;

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
    { key: "new", label: tt("新建"), hint: p.target.isDir ? tt("在 {name} 内", { name: p.target.name }) : tt("同层") },
    { key: "rename", label: tt("重命名"), disabled: !p.canWrite },
    { key: "move", label: tt("移动"), disabled: !p.canWrite },
    { key: "copy", label: tt("复制") },
    {
      key: "paste",
      label: tt("粘贴"),
      disabled: !p.hasClipboard || !p.canWrite,
      hint: p.hasClipboard ? undefined : tt("先复制一项"),
    },
    { key: "delete", label: tt("删除"), disabled: !p.canWrite, danger: true },
  ];
  // M180：图标文件 → 直接填给选中控件的 src/背景
  if (p.canFill) items.unshift({ key: "fill", label: tt("填入选中控件") });

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
  // M156：res/ 下的文件名也要遵守 aapt2 规则（BgRound.xml / btn-bg.xml / 1_bg.xml / 背景.xml 都会被拒），
  // 只查 stem（去掉 .xml 之类扩展名），其它目录（src/、docs/）不管。
  const inRes = /(^|\/)res(\/|$)/.test(parentRel);
  const resBad =
    inRes && !isDir && finalName
      ? (() => {
          const dot = finalName.lastIndexOf(".");
          const stem = dot > 0 ? finalName.slice(0, dot) : finalName;
          return isValidResName(stem)
            ? ""
            : tt("Android 资源名只能用小写字母、数字、下划线，且不能以数字开头（例：bg_round.xml）");
        })()
      : "";
  const canSubmit = finalName.length > 0 && !dup && !/[/\\]/.test(finalName) && !resBad;

  return (
    <div className="axv-tfm-mask">
      <div className="axv-dlg" role="dialog" aria-label={tt("新建")}>
        <div className="axv-dlg-title">{tt("新建")}</div>
        <label className="axv-dlg-row">
          <span className="axv-dlg-label">{tt("名称")}</span>
          <input
            className="axv-dlg-input"
            autoFocus
            value={name}
            spellCheck={false}
            placeholder={isDir ? tt("新文件夹名") : tt("新文件名，如 detail.xml")}
            onChange={(e) => {
              const raw = e.target.value;
              if (!inRes || isDir) {
                setName(raw);
                return;
              }
              // res 下：只清洗扩展名之前的部分，保留 .xml
              const dot = raw.lastIndexOf(".");
              setName(dot > 0 ? cleanResNameInput(raw.slice(0, dot)) + raw.slice(dot) : cleanResNameInput(raw));
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && canSubmit) p.onSubmit({ name: finalName, isDir, parentRel });
            }}
          />
          <label className="axv-dlg-check" title={tt("勾选=建文件夹，不勾=建文件")}>
            <input type="checkbox" checked={isDir} onChange={(e) => setIsDir(e.target.checked)} />
            <span>{tt("文件夹")}</span>
          </label>
        </label>

        {p.target.isDir ? (
          <label className="axv-dlg-row axv-dlg-sub">
            <span className="axv-dlg-label">{tt("位置")}</span>
            <span className="axv-dlg-radio-group">
              <label className="axv-dlg-radio">
                <input
                  type="radio"
                  checked={!inThisDir}
                  onChange={() => setInThisDir(false)}
                />
                <span>{tt("同层（{p}）", { p: shortPath(parentOf(p.target.rel)) || tt("项目根") })}</span>
              </label>
              <label className="axv-dlg-radio">
                <input type="radio" checked={inThisDir} onChange={() => setInThisDir(true)} />
                <span>{tt("目录内（{p}）", { p: shortPath(p.target.rel) || tt("项目根") })}</span>
              </label>
            </span>
          </label>
        ) : null}

        <div className="axv-dlg-hint">
          {resBad
            ? resBad
            : dup
              ? tt("「{name}」已存在，请换个名字", { name: finalName })
              : tt("将创建到：{p}/", { p: parentRel || tt("项目根") })}
        </div>

        <div className="axv-dlg-actions">
          <button className="axv-btn axv-ghost" onClick={p.onClose}>
            {tt("取消")}
          </button>
          <button
            className="axv-btn"
            disabled={!canSubmit}
            onClick={() => p.onSubmit({ name: finalName, isDir, parentRel })}
          >
            {tt("确定")}
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
  const isDir = p.target?.isDir ?? false;
  // M156：res/ 下重命名同样限死小写字母/数字/下划线、小写开头
  const inRes = /(^|\/)res(\/|$)/.test(p.target?.rel ?? "");
  const resBad =
    inRes && !isDir && trimmed
      ? (() => {
          const dot = trimmed.lastIndexOf(".");
          const stem = dot > 0 ? trimmed.slice(0, dot) : trimmed;
          return isValidResName(stem)
            ? ""
            : tt("Android 资源名只能用小写字母、数字、下划线，且不能以数字开头（例：bg_round.xml）");
        })()
      : "";
  const canSubmit = trimmed.length > 0 && !dup && !/[/\\]/.test(trimmed) && !same && !resBad;

  return (
    <div className="axv-tfm-mask">
      <div className="axv-dlg" role="dialog" aria-label={p.title || tt("重命名")}>
        <div className="axv-dlg-title">{p.title || tt("重命名")}</div>
        <label className="axv-dlg-row">
          <span className="axv-dlg-label">{tt("新名称")}</span>
          <input
            className="axv-dlg-input"
            autoFocus
            value={name}
            spellCheck={false}
            onChange={(e) => {
              const raw = e.target.value;
              if (!inRes || isDir) {
                setName(raw);
                return;
              }
              const dot = raw.lastIndexOf(".");
              setName(dot > 0 ? cleanResNameInput(raw.slice(0, dot)) + raw.slice(dot) : cleanResNameInput(raw));
            }}
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
          {resBad
            ? resBad
            : dup
              ? tt("「{name}」已存在，请换个名字", { name: trimmed })
              : (p.desc ?? tt("原名称：{name}", { name: start }))}
        </div>
        <div className="axv-dlg-actions">
          <button className="axv-btn axv-ghost" onClick={p.onClose}>
            {tt("取消")}
          </button>
          <button className="axv-btn" disabled={!canSubmit} onClick={() => p.onSubmit(trimmed)}>
            {p.submitLabel || tt("确定")}
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
            {tt("知道了")}
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
  /** M101：正文下方的附加说明（如删除前的影响面：被几处引用） */
  detail?: string;
  danger?: boolean;
  onOk: () => void;
  onClose: () => void;
}) {
  return (
    <div className="axv-tfm-mask">
      <div className="axv-dlg" role="dialog" aria-label={p.title}>
        <div className="axv-dlg-title">{p.title}</div>
        <div className="axv-dlg-hint axv-dlg-multiline">{p.text}</div>
        {p.detail ? <div className="axv-dlg-hint axv-dlg-multiline axv-dlg-detail">{p.detail}</div> : null}
        <div className="axv-dlg-actions">
          <button className="axv-btn axv-ghost" onClick={p.onClose}>
            {tt("取消")}
          </button>
          <button className={"axv-btn" + (p.danger ? " axv-btn-danger" : "")} onClick={p.onOk}>
            {tt("确定")}
          </button>
        </div>
      </div>
    </div>
  );
}
