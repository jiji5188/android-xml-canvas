// components/use-canvas-assets.ts — M304：从 XmlEditor.tsx 抽出的画布资产/设备/面板状态域
// 全部无外部依赖（localStorage + react state），可直接复用。

"use client";

import { useCallback, useState } from "react";
import { deviceById } from "@/lib/xml/theme";
import { type LeftView } from "./LeftRail";

export interface UseCanvasAssetsReturn {
  // M11j/M4u：资源编辑抽屉
  resIcon: { name: string; xml: string; attr?: string } | null;
  setResIcon: React.Dispatch<React.SetStateAction<{ name: string; xml: string; attr?: string } | null>>;
  resShape: { name: string; xml: string; forceTree?: boolean } | null;
  setResShape: React.Dispatch<React.SetStateAction<{ name: string; xml: string; forceTree?: boolean } | null>>;
  resImage: { rel: string; name: string; url: string } | null;
  setResImage: React.Dispatch<React.SetStateAction<{ rel: string; name: string; url: string } | null>>;
  // M2r：预览设备
  deviceId: string;
  device: ReturnType<typeof deviceById>;
  changeDevice: (id: string) => void;
  // 面板开合（桌面 + 移动端）
  leftOpen: boolean;
  setLeftOpen: (v: boolean) => void;
  rightOpen: boolean;
  setRightOpen: (v: boolean) => void;
  leftView: LeftView;
  setLeftView: (v: LeftView) => void;
  // M20m：图层锁定
  lockedPaths: Set<string>;
  toggleLockPath: (path: string) => void;
  isPathLocked: (path: string) => boolean;
}

export function useCanvasAssets(): UseCanvasAssetsReturn {
  /** M11j：正在编辑的生成图标（vector） */
  const [resIcon, setResIcon] = useState<{ name: string; xml: string; attr?: string } | null>(null);
  /** M4u：从资源树里直接打开的「绘制编辑器」（drawable/*.xml） */
  const [resShape, setResShape] = useState<{ name: string; xml: string; forceTree?: boolean } | null>(null);
  /** M4u：从资源树里点开的图片预览 */
  const [resImage, setResImage] = useState<{ rel: string; name: string; url: string } | null>(null);

  /** M2r：预览设备尺寸（手机竖屏/横屏/平板…），持久化到 localStorage */
  const [deviceId, setDeviceId] = useState<string>(
    () => (typeof window !== "undefined" ? window.localStorage.getItem("axv.device") ?? "phone" : "phone"),
  );
  const device = deviceById(deviceId);

  const changeDevice = (id: string) => {
    setDeviceId(id);
    try {
      window.localStorage.setItem("axv.device", id);
    } catch {
      /* 静默 */
    }
  };

  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [leftView, setLeftView] = useState<LeftView>("parts");

  /* ===== M20m：图层锁定（锁定后画布点不中、不能拖动/上下移） ===== */
  const [lockedPaths, setLockedPaths] = useState<Set<string>>(new Set());
  const toggleLockPath = useCallback((path: string) => {
    setLockedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);
  /** 自己或任一祖先被锁定 → 视为锁定（路径形如 #0/1/2） */
  const isPathLocked = useCallback(
    (path: string) => {
      let cur = path;
      for (;;) {
        if (lockedPaths.has(cur)) return true;
        const i = cur.lastIndexOf("/");
        if (i < 0) return false;
        cur = cur.slice(0, i);
      }
    },
    [lockedPaths],
  );

  return {
    resIcon,
    setResIcon,
    resShape,
    setResShape,
    resImage,
    setResImage,
    deviceId,
    device,
    changeDevice,
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    leftView,
    setLeftView,
    lockedPaths,
    toggleLockPath,
    isPathLocked,
  };
}
