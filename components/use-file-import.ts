// components/use-file-import.ts — M308：从 XmlEditor.tsx 抽出的「导入文件」域
// 包含：loadXmlFile（打开 .xml 进项目）、onPickRes（上传 res/ 目录解析资源）
// 依赖通过 getDeps() 延迟取值，避免 hook 调用点早于 useState/useCallback 声明导致 TDZ。

"use client";

import { useCallback } from "react";
import { addFile, MAX_FILES, type Project } from "@/lib/xml/multi-file";
import { buildResourceExtras, type ResourceExtras } from "@/lib/xml/resdir";
import { parseLayoutXml } from "@/lib/xml/parser";
import { t as tt } from "@/lib/i18n-src";

export interface FileImportDeps {
  setExportNote: (v: string) => void;
  project: Project;
  setProject: (p: Project) => void;
  setXmlAndTrack: (next: string, mergeKey?: string) => void;
  setMobileTab: (v: "preview" | "xml" | "values") => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  setFocusLine: (v: number) => void;
  setFocusTick: (fn: (n: number) => number) => void;
  setResExtras: (v: ResourceExtras) => void;
}

export function useFileImport(getDeps: () => FileImportDeps) {
  const loadXmlFile = useCallback(
    (f: File) => {
      const d = getDeps();
      const { setExportNote } = d;
      // 1) 类型校验：后缀必须 .xml
      if (!/\.xml$/i.test(f.name)) {
        setExportNote(tt("「{name}」不是 .xml 文件，已忽略", { name: f.name }));
        window.setTimeout(() => setExportNote(""), 3600);
        return;
      }
      // 2) 大小上限（5MB），防止巨型文件卡死浏览器
      if (f.size > 5 * 1024 * 1024) {
        setExportNote(tt("「{name}」超过 5MB，不加载", { name: f.name }));
        window.setTimeout(() => setExportNote(""), 4000);
        return;
      }
      // 3) 读取（try/catch，File.text() 会 reject）
      f.text()
        .then((txt) => {
          // 4) M22：坏文件也照常载入 —— 由用户在代码面板修正，而不是被拒之门外
          let parseOk = true;
          let firstErr = "";
          try {
            const { root, issues } = parseLayoutXml(txt);
            const errs = issues.filter((i) => i.level === "error");
            if (!root) {
              parseOk = false;
              firstErr = errs[0]?.message || tt("没有可识别的根布局节点");
            } else if (errs.length > 0) {
              firstErr = errs[0].message;
            }
          } catch (e) {
            parseOk = false;
            firstErr = e instanceof Error ? e.message : String(e);
          }

          // M9：打开的文件作为项目里的一个新文件（同名自动加序号），不再冲掉当前内容
          const res2 = addFile(d.project, f.name, txt);
          if (res2.id) d.setProject(res2.project);
          d.setXmlAndTrack(txt);

          if (!parseOk) {
            // 解析失败 → 切到代码视图，让用户就地改；画布会显示失败说明，不会崩
            // M187：代码视图在主区 tab（原来是 setLeftView("code") + 打开左面板，而左面板根本没有 code 页）
            d.setMobileTab("xml");
            d.setLeftOpen(false);
            d.setRightOpen(false);
            d.setFocusLine(1);
            d.setFocusTick((t) => t + 1);
            setExportNote(
              tt("「{name}」有不完整或错误的结构（{err}），已切到代码面板，改好画布会自动恢复", {
                name: f.name,
                err: firstErr,
              }),
            );
            window.setTimeout(() => setExportNote(""), 7000);
            return;
          }
          if (firstErr) {
            setExportNote(
              tt("已载入「{name}」，但有结构问题：{err}（可在代码面板修正）", {
                name: f.name,
                err: firstErr,
              }),
            );
            window.setTimeout(() => setExportNote(""), 6000);
          } else if (!res2.id) {
            setExportNote(
              tt("项目文件已达上限（{max} 个），仍已载入「{name}」但未入项目", {
                max: MAX_FILES,
                name: f.name,
              }),
            );
            window.setTimeout(() => setExportNote(""), 4600);
          } else {
            setExportNote(tt("已载入「{name}」", { name: f.name }));
            window.setTimeout(() => setExportNote(""), 2400);
          }
        })
        .catch((err) => {
          console.error("[axv] 读取 xml 文件失败", err); // i18n-ignore
          setExportNote(tt("读取「{name}」失败，请重试", { name: f.name }));
          window.setTimeout(() => setExportNote(""), 4000);
        });
    },
    [getDeps],
  );

  /** M3b：上传 res/ 目录，解析 drawable/vector/values/styles。
   *  带容错：文件数为空、全部不是 res 结构、buildResourceExtras 抛错都有友好提示 */
  const onPickRes = useCallback(
    async (fileList: FileList | null) => {
      const d = getDeps();
      const { setExportNote } = d;
      if (!fileList || fileList.length === 0) {
        setExportNote(tt("未选择任何文件（目录选择器取消或目录为空）"));
        window.setTimeout(() => setExportNote(""), 3000);
        return;
      }
      const items = Array.from(fileList).map((f) => {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        return { name: f.name, path: rel, file: f };
      });
      // 提示：选到的是目录吗？（webkitRelativePath 存在 = 目录模式；否则 = 散件模式）
      const isDirMode = items.some((it) => it.path !== it.name);
      if (!isDirMode) {
        setExportNote(tt("提示：选中的是散文件，建议选整个 res 目录（含 drawable/ values/ layout/）效果最佳"));
      }
      try {
        const extras = await buildResourceExtras(items);
        d.setResExtras(extras);
        const c = extras.counts;
        setExportNote(
          tt("已读取 res：图片 {img} / 矢量 {vec} / values {val} / 样式 {sty}", {
            img: c.images,
            vec: c.vectors,
            val: c.values,
            sty: c.styles,
          }) + (isDirMode ? "" : tt("（散件模式，可能不完整）")),
        );
        window.setTimeout(() => setExportNote(""), 3600);
      } catch (err) {
        console.error("[axv] 读取 res 失败", err); // i18n-ignore
        setExportNote(tt("读取 res 失败，请确认目录结构合法（参考 console）"));
        window.setTimeout(() => setExportNote(""), 4000);
      }
    },
    [getDeps],
  );

  return { loadXmlFile, onPickRes };
}
