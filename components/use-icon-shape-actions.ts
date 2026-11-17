// components/use-icon-shape-actions.ts — M366 step9（路线 2 拆解）：图标/形状资源动作
//
// 从 XmlEditor.tsx 抽出（原 782-870 + 2964 区域）：onPickIcon / onSaveShape / onFillIconAttr。
// 共同域：把生成的矢量/形状 xml 存进 generatedDrawables（+ 磁盘 res/drawable），并把选中控件的
// 属性写成 @drawable/<资源名>。
//
// deps-getter + 延迟 Proxy（与 use-xml-project-fns.ts 同款）：commitAttrRef（壳 ~1952 行）/flashNote
// （~2159 行）声明晚于本 hook 的调用点，渲染期不能 evaluate getter。
"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { projectSaveRoot, saveResFiles } from "@/lib/xml/project-save";
import { sanitizeResName } from "@/lib/xml/resname";
import { t as tt } from "@/lib/i18n-src";
import type { ActiveProject } from "./XmlEditor";

export interface IconShapeActionsDeps {
  setGeneratedDrawables: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectedPath: string | null;
  commitAttrRef: React.MutableRefObject<(name: string, value: string) => void>;
  activeProject: ActiveProject | null;
  setExportNote: (v: string) => void;
  flashNote: (msg: string, ms?: number) => void;
}

export interface IconShapeActions {
  onPickIcon: (attrName: string, resourceName: string, vectorXml: string) => void;
  onSaveShape: (attrName: string, resourceName: string, shapeXml: string) => void;
  onFillIconAttr: (attr: string, resourceName: string, vectorXml: string) => void;
}

export function useIconShapeActions(getDeps: () => IconShapeActionsDeps): IconShapeActions {
  // 延迟 Proxy：渲染期不 evaluate（避 TDZ），回调执行时才解引用（拿最新值）
  const depsRef = useRef<IconShapeActionsDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as IconShapeActionsDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** M3g：选中图标 → 存矢量原文 + 把属性写成 @drawable/资源名 */
  const onPickIcon = useCallback(
    (attrName: string, resourceName: string, vectorXml: string) => {
      // M4f：资源名必须是 aapt 合法的 a-z0-9_，否则会落成 #00c853.xml 之类编译不过的文件
      const safe = sanitizeResName(resourceName, "ic");
      D.setGeneratedDrawables((m) => ({ ...m, [safe]: vectorXml }));
      if (D.selectedPath) {
        // 通过 commitAttr 把属性改成 @drawable/<资源名>
        D.commitAttrRef.current(attrName, `@drawable/${safe}`);
      }
      const file = safe + ".xml";
      const root = projectSaveRoot(D.activeProject);
      // M172：有打开的项目就直接写进 res/drawable，不只存内存
      if (root) {
        void saveResFiles(root, [{ path: `drawable/${file}`, text: vectorXml }]).then((r) => {
          D.setExportNote(
            r.ok
              ? tt("已写入 res/drawable/{file}，属性指向它", { file })
              : tt("已生成 drawable/{file}（内存），但写入项目失败：{reason}", { file, reason: r.failed[0] || tt("目录不可写") }),
          );
          window.setTimeout(() => D.setExportNote(""), 4200);
        });
        return;
      }
      D.setExportNote(tt("已生成 res/drawable/{file}，属性指向它（导出 res 包时会自动包含）", { file }));
      window.setTimeout(() => D.setExportNote(""), 3600);
    },
    [D],
  );

  /** M3h：形状 → 存 xml + 把属性写成 @drawable/资源名（与图标同一存储） */
  const onSaveShape = useCallback(
    (attrName: string, resourceName: string, shapeXml: string) => {
      const safe = sanitizeResName(resourceName, "bg");
      D.setGeneratedDrawables((m) => ({ ...m, [safe]: shapeXml }));
      if (D.selectedPath) D.commitAttrRef.current(attrName, `@drawable/${safe}`);
      const file = safe + ".xml";
      const root = projectSaveRoot(D.activeProject);
      // M172：有打开的项目就直接写进 res/drawable，不只存内存
      if (root) {
        void saveResFiles(root, [{ path: `drawable/${file}`, text: shapeXml }]).then((r) => {
          D.setExportNote(
            r.ok
              ? tt("已写入 res/drawable/{file}，属性指向它（水波纹？{yn}）", {
                  file,
                  yn: shapeXml.includes("<ripple") ? tt("是") : tt("否"),
                })
              : tt("已生成 drawable/{file}（内存），但写入项目失败：{reason}", {
                  file,
                  reason: r.failed[0] || tt("目录不可写"),
                }),
          );
          window.setTimeout(() => D.setExportNote(""), 4200);
        });
        return;
      }
      D.setExportNote(tt("已生成 res/drawable/{file}（含水波纹？{yn}），属性指向它", { file, yn: shapeXml.includes("<ripple") ? tt("是") : tt("否") }));
      window.setTimeout(() => D.setExportNote(""), 3600);
    },
    [D],
  );

  /** M180：项目树里选中的图标 → 直接写进当前选中控件的属性（attr 由调用方给，通常 src） */
  const onFillIconAttr = useCallback(
    (attr: string, resourceName: string, vectorXml: string) => {
      if (!D.selectedPath) {
        D.flashNote(tt("先在画布上选一个控件（比如 ImageView），再点「填入选中控件」"));
        return;
      }
      const safe = sanitizeResName(resourceName, "ic");
      if (vectorXml) D.setGeneratedDrawables((m) => ({ ...m, [safe]: vectorXml }));
      D.commitAttrRef.current(attr, `@drawable/${safe}`);
      D.flashNote(tt("已填入 {attr} = @drawable/{name}", { attr, name: safe }));
    },
    [D],
  );

  return { onPickIcon, onSaveShape, onFillIconAttr };
}
