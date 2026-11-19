// components/use-res-editors.ts — M366 step：资源编辑器（drawable / 图标）保存逻辑
//
// XmlEditor JSX 里 resShape / resIcon 两个 PluginEditorHost 块各塞了 ~50 行内联保存逻辑
// （写 generatedDrawables、落盘项目 res/、提示语、图标 4 文件 + ls 记忆、属性回指）。
// 抽成独立 hook，JSX 只剩传参。
//
// 命名避开 use-icon-shape-actions.ts 里已有的 onSaveShape（签名不同）。
// deps-getter 模式（同 use-icon-shape-actions）：晚声明的依赖（onRenameAsset/commitAttr）
// 走 getter 解引用，渲染期不 evaluate。

import { useCallback, useEffect, useMemo, useRef } from "react";
import { saveResFiles, type ProjectSaveRoot } from "@/lib/xml/project-save";
import { LS_KEY_APP_ICON, lsSet } from "@/lib/xml/storage";
import { sanitizeResName } from "@/lib/xml/resname";
import { t as tt } from "@/lib/i18n-src";

export interface UseResEditorsDeps {
  resIcon: { name: string; xml: string; attr?: string } | null;
  resShape: { name: string; xml: string; forceTree?: boolean } | null;
  setResIcon: (v: { name: string; xml: string; attr?: string } | null) => void;
  setResShape: (v: { name: string; xml: string; forceTree?: boolean } | null) => void;
  setAppIconRes: (v: Record<string, string>) => void;
  setGeneratedDrawables: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  projRoot: ProjectSaveRoot | null;
  onRenameAsset: (oldName: string, newName: string) => void;
  commitAttr: (attr: string, value: string) => void;
  setExportNote: (msg: string) => void;
  flashNote: (msg: string, ms?: number) => void;
}

export interface UseResEditorsReturn {
  onCloseShape: () => void;
  /** M4u/M172：drawable 形状保存 → 写内存 + 项目 res/drawable + 提示 */
  onResShapeSave: (resourceName: string, shapeXml: string) => void;
  onCloseIcon: () => void;
  /** M171/M174：应用图标 4 文件 → 存内存 + 写项目 res/ + ls 记参数 */
  onAppIconGen: (p: { files: { path: string; text: string }[]; bgColor: string; contentDp: number }) => void;
  /** M11p/M172：图标 XML 保存 → 内存（改名清旧）+ 资源改名 + 属性回指 + 项目 res/ */
  onResIconSave: (safeName: string, iconXml: string) => void;
}

export function useResEditors(getDeps: () => UseResEditorsDeps): UseResEditorsReturn {
  const depsRef = useRef<UseResEditorsDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as UseResEditorsDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as unknown as Record<string, unknown>)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onCloseShape = useCallback(() => {
    D.setResShape(null);
  }, [D]);

  const onResShapeSave = useCallback(
    (resourceName: string, shapeXml: string) => {
      const safe = sanitizeResName(resourceName, "bg");
      D.setGeneratedDrawables((m) => ({ ...m, [safe]: shapeXml }));
      D.setResShape(null);
      const file = safe + ".xml";
      if (D.projRoot) {
        void saveResFiles(D.projRoot, [{ path: `drawable/${file}`, text: shapeXml }]).then((r) => {
          D.flashNote(
            r.ok
              ? tt("已保存 res/drawable/{file}，已写入项目 res 目录", { file })
              : tt("已保存到内存，但写入项目失败：{reason}", {
                  reason: r.failed[0] || tt("目录不可写"),
                }),
            4200,
          );
        });
      } else {
        D.setExportNote(tt("已保存 res/drawable/{file}", { file }));
        window.setTimeout(() => D.setExportNote(" "), 3200);
      }
    },
    [D],
  );

  const onCloseIcon = useCallback(() => {
    D.setResIcon(null);
  }, [D]);

  const onAppIconGen = useCallback(
    (p: { files: { path: string; text: string }[]; bgColor: string; contentDp: number }) => {
      const map: Record<string, string> = {};
      for (const f of p.files) map[f.path] = f.text;
      D.setAppIconRes(map);
      lsSet(LS_KEY_APP_ICON, JSON.stringify({ bgColor: p.bgColor, contentDp: p.contentDp }));
      const total = p.files.length;
      if (D.projRoot) {
        void saveResFiles(
          D.projRoot,
          p.files.map((f) => ({ path: f.path, text: f.text })),
        ).then((r) => {
          D.setExportNote(
            r.ok
              ? tt("已设为应用图标：{n}/{total} 个文件写入 res/（背景 {color}）", {
                  n: r.written,
                  total: r.total,
                  color: p.bgColor,
                })
              : tt("生成成功但写入失败：{reason}", {
                  reason: r.failed[0] || tt("目录不可写"),
                }),
          );
          window.setTimeout(() => D.setExportNote(""), 6000);
        });
      } else {
        D.setExportNote(
          tt("已生成 {n} 个图标文件（背景 {color}），导 res.zip 或真机渲染时一起带走", {
            n: total,
            color: p.bgColor,
          }),
        );
        window.setTimeout(() => D.setExportNote(""), 6000);
      }
    },
    [D],
  );

  const onResIconSave = useCallback(
    (safeName: string, iconXml: string) => {
      const oldName = D.resIcon?.name;
      D.setGeneratedDrawables((m) => {
        const next = { ...m };
        if (oldName && safeName !== oldName) delete next[oldName];
        next[safeName] = iconXml;
        return next;
      });
      if (oldName && safeName !== oldName) D.onRenameAsset(oldName, safeName);
      if (D.resIcon?.attr) D.commitAttr(D.resIcon.attr, "@drawable/" + safeName);
      D.setResIcon(null);
      const file = safeName + ".xml";
      if (D.projRoot) {
        void saveResFiles(D.projRoot, [{ path: `drawable/${file}`, text: iconXml }]).then((r) => {
          D.setExportNote(
            r.ok
              ? tt("已保存 res/drawable/{file}，已写入项目 res 目录", { file })
              : tt("已保存到内存，但写入项目失败：{reason}", {
                  reason: r.failed[0] || tt("目录不可写"),
                }),
          );
          window.setTimeout(() => D.setExportNote(""), 4200);
        });
      } else {
        D.setExportNote(tt("已保存 res/drawable/{file}", { file }));
        window.setTimeout(() => D.setExportNote(" "), 3200);
      }
    },
    [D],
  );

  return { onCloseShape, onResShapeSave, onCloseIcon, onAppIconGen, onResIconSave };
}
