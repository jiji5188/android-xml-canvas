// lib/xml/code-sel-menu.ts - M470：代码编辑区「复制/粘贴」菜单的弹出规则（纯逻辑，可单测）
//
// 用户反馈（2026-11-21 22:51）：
//   「复制粘贴弹窗弹出规则改一下，规则：用户选择文本松手后才弹出来，不要乱弹遮挡视线」
//
// 以前的规则（M404）：pointerdown 起 450ms 计时，时间到就弹 → 用户正长按选词/拖选时菜单已经盖住正文。
// 现在的规则：
//   1. 没有选区 → 一律不弹（粘贴改用系统原生长按菜单 / 桌面右键）
//   2. 手指/鼠标还按着 → 不弹（拖选过程中绝不打扰）
//   3. 菜单已经打开 → 不弹（避免重复覆盖）
//   4. 程序自己改选区（例如「全选」）→ 本次不弹（suppressed）
// 只有全部条件满足（已选好文本 + 已松开 + 没有菜单）才允许弹出。

export interface SelMenuGate {
  /** 当前选区是否为空（无选区） */
  selectionEmpty: boolean;
  /** 指针是否还处于按下状态（拖选中） */
  pointerDown: boolean;
  /** 菜单是否已经打开 */
  menuOpen: boolean;
  /** 本次选区变化是否由程序自身触发（全选/粘贴等），需要跳过 */
  suppressed: boolean;
}

/** 是否允许弹出「复制/粘贴」菜单 */
export function shouldOpenSelMenu(g: SelMenuGate): boolean {
  if (g.selectionEmpty) return false;
  if (g.pointerDown) return false;
  if (g.menuOpen) return false;
  if (g.suppressed) return false;
  return true;
}

/** 选区变化（拖选择手柄）停止后等待多久再弹菜单：足够长到「松手」，又不至于让人等 */
export const SEL_MENU_SETTLE_MS = 350;

/** 手指抬起后等一帧量选区坐标的延迟（选区在 DOM 里落定再量才准） */
export const SEL_MENU_AFTER_UP_MS = 60;
