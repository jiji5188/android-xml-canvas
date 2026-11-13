"use client";

// M230：全屏子页编辑器（drawable / 图标 …）的「真机预览」统一动作
//
// 背景：DrawableEditor 和 IconCanvasEditor 各自写了一份「收集嵌套引用 → 打包 →
// 丢给原生 aapt2 编译 → 打开真控件页」的流程（doRealPreview）。M230 起收敛到这一处，
// 两个编辑器只保留「按钮可见性」（hasRealRender）与提示文案。
//
// 用法：
//   const real = useRealPreview({ io, docRel });
//   real.show && <button onClick={() => real.run({ name, xml, kind: "drawable" })}>真机预览</button>

import { useCallback, useMemo, useState } from "react";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { buildResourcePreviewFiles, type ResPreviewKind } from "@/lib/xml/res-preview";
import { hasRealRender, renderReal } from "@/lib/xml/native-render";

export interface RealPreviewOptions {
  io?: AiFileIo | null;
  docRel?: string | null;
}

export interface RealPreviewInput {
  /** 资源名（保存后的最终名） */
  name: string;
  /** 当前 XML 原文 */
  xml: string;
  /** res 目录类型，默认 drawable */
  kind?: ResPreviewKind;
  /** 已有同名 xml 资源时用于嵌套引用解析（如 res/drawable/bg_x.xml） */
  refXml?: Record<string, string> | null;
}

export function useRealPreview({ io, docRel }: RealPreviewOptions) {
  const [busy, setBusy] = useState(false);
  const show = useMemo(() => hasRealRender(), []);

  const run = useCallback(
    async (input: RealPreviewInput): Promise<{ ok: boolean; message: string }> => {
      if (busy) return { ok: false, message: "正在编译" };
      const kind = input.kind ?? "drawable";
      const preview = buildResourcePreviewFiles(input.name, input.xml, kind, input.refXml ?? null);
      setBusy(true);
      try {
        const collected = await collectProjectRes(io ?? null, docRel ?? null, preview.files);
        const r = await renderReal(preview.layoutName, collected.files);
        if (r.ok) {
          return {
            ok: true,
            message: `真机预览：${r.files ?? 0} 个文件 → 资源包 ${Math.round((r.bytes ?? 0) / 1024)} KB（编译 ${r.ms ?? 0} ms），已打开真控件页`,
          };
        }
        return { ok: false, message: `真机预览失败（${r.stage || "未知"}）：${(r.log || "").slice(0, 260)}` };
      } catch (e) {
        return { ok: false, message: `真机预览失败：${String(e)}` };
      } finally {
        setBusy(false);
      }
    },
    [busy, io, docRel],
  );

  return { show, busy, run };
}
