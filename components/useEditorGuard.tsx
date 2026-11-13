"use client";

// M230：全屏子页编辑器的统一接入层 —— 未保存守卫 + 系统返回键，两件事合一套
//
// 背景：DrawableEditor 和 IconCanvasEditor 各自重复写
//   useUnsavedGuard({dirty,onSave}) + useOverlayBack(true, closeRef) + closeRef 回填
// 三件套。抽成 hook 之后，编辑器组件只需声明「脏了没 / 保存入口 / 对象名 / 怎么关」，
// 返回键（WebView 哨兵）与未保存提示对话框自动就位。
//
// 用法（编辑器组件内）：
//   const guard = useEditorGuard({ dirty, onSave, hint: tt("这个 drawable"), onClose });
//   <button onClick={guard.close}>返回</button>
//   {guard.dialog}

import { useRef, type ReactNode } from "react";
import { useUnsavedGuard } from "./UnsavedGuard";
import { useOverlayBack } from "@/lib/overlay-back";

export interface EditorGuardOptions {
  /** 有未保存改动（内容或资源名变化都算） */
  dirty: boolean;
  /** 保存入口；保存成功后由调用方自己决定是否关页 */
  onSave: () => void;
  /** 有校验错误时保存按钮置灰 */
  canSave?: boolean;
  /** 提示里指代的对象，如「这个 drawable」「这个图标」 */
  hint?: string;
  /** 真正关闭页面的动作（宿主 onClose）；不传则「放弃/保存后」只清对话框（测试用） */
  onClose?: () => void;
}

export interface EditorGuard {
  /** 统一的「关闭」入口：不脏直接关，脏了弹未保存对话框（保存/放弃后关） */
  close: () => void;
  /** 未保存对话框节点，渲染在组件根部 */
  dialog: ReactNode;
  /** 对话框是否打开（测试断言用） */
  open: boolean;
}

export function useEditorGuard({ dirty, onSave, canSave, hint, onClose }: EditorGuardOptions): EditorGuard {
  const guard = useUnsavedGuard({ dirty, onSave, canSave, hint });
  const doClose = () => {
    if (onClose) onClose();
  };
  // 返回键要调的就是守卫后的关闭；closeRef 每帧回填，避免闭包拿到旧 dirty
  const closeRef = useRef<() => void>(() => {});
  closeRef.current = () => guard.requestClose(doClose);
  // 哨兵条目：浮层一挂载就压一条，返回键走 popstate → closeRef（统一过上面的守卫）
  useOverlayBack(true, () => closeRef.current());
  return {
    close: () => closeRef.current(),
    dialog: guard.dialog,
    open: guard.open,
  };
}
