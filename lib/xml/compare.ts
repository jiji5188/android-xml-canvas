// lib/xml/compare.ts — M165 并排对比：纯函数层，给 ComparePreview 用
//
// 同一份 XML 在多台设备上分别 buildRenderModel，拿到各设备的渲染结果。
// measured（wrap 实测表）不跨设备复用——它是按当前设备的浏览器像素量出来的，
// 换台设备会算错，所以对比时统一传 undefined（wrap 内容区尺寸略有偏差可接受）。

import { buildRenderModel } from "./css";
import type { RenderModel } from "./types";
import type { DevicePreset } from "./theme";
import { deviceById } from "./theme";

export interface CompareEntry {
  device: DevicePreset;
  model: RenderModel | null;
  err?: string;
}

/** 并排对比的默认预设：小屏 / 标准手机 / 平板 / 折叠屏 */
export const COMPARE_DEFAULTS = ["small", "phone", "tablet", "fold"];

/** 可勾选的设备池（和「预览设备」菜单同一份数据，这里只挑对比常用的） */
export const COMPARE_POOL: string[] = [
  "small",
  "phone",
  "phone-892",
  "compact",
  "tablet",
  "tablet-10",
  "fold",
  "tv",
  "watch",
];

export function buildCompareModels(
  root: unknown,
  resources: unknown,
  layouts: Record<string, string> | undefined,
  theme: unknown,
  deviceIds: string[],
  scale = 2,
): CompareEntry[] {
  return deviceIds.map((id) => {
    const device = deviceById(id);
    try {
      const model = buildRenderModel(
        root as never,
        resources as never,
        scale,
        layouts,
        { w: device.w, h: device.h },
        undefined,
        theme as never,
      );
      return { device, model };
    } catch (e) {
      return { device, model: null, err: e instanceof Error ? e.message : String(e) };
    }
  });
}
