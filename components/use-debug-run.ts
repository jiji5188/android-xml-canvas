// components/use-debug-run.ts — M405：调试运行（AIDE 同款不装包）hook
// 流程：收集项目 Java 源码 + 依赖库 → 设备端 compileToDex（ECJ+D8）→ 动态加载执行
//      → 捕获 System.out/err/异常 → 返回结果给编辑器下方「调试日志」面板。

import { useCallback, useState } from "react";
import type { DebugRunResult } from "@/lib/xml/debug-run";
import { androidJavaToolchain } from "@/lib/plugin/toolchains/android-java";
import { loadProjectJavaFiles } from "@/lib/xml/java-files";
import { collectProjectLibs, collectSharedLibs } from "@/lib/xml/project-libs";
import { withCurrentSource } from "@/lib/xml/editor-buffer";
import { rPackageFromSources, dominantJavaPackage } from "@/lib/xml/find-launcher";
import { packageOf } from "@/lib/xml/new-project";
import { projectSaveRoot, readAppGradle } from "@/lib/xml/project-save";
import { parseGradlePackage } from "@/lib/xml/project-info";
import { nativeBridge } from "@/lib/xml/native-save";
import { entryCandidates, genRJavaText } from "@/lib/xml/debug-entry";
import type { ResourceTable } from "@/lib/xml/types";
import { t as tt } from "@/lib/i18n-src";

export interface UseDebugRunDeps {
  activeProject: { name: string; dirPath?: string; rootPath?: string } | null;
  aiFileIo: any;
  openRel: string | null;
  xml: string;
  /** 当前项目资源表（生成 R.java 用） */
  resources: ResourceTable;
  noteTimed: (msg: string, ms?: number) => void;
  setExportNote: (msg: string) => void;
  /** M440：调试日志回写面板——编译日志 → 「构建日志」tab；运行输出 → 「运行日志」tab。
   *  它们本来就是同一个东西的两半：编译日志跟打包编译同性质，运行输出跟 App 运行日志同性质。 */
  pushDebugLog?: (
    entry: Omit<import("./ProblemsDrawer").BuildLogEntry, "kind">,
    kind?: "build" | "debug",
  ) => void;
}

export interface UseDebugRunReturn {
  debugBusy: boolean;
  debugResult: DebugRunResult | null;
  /** 执行一次调试运行（入口可指定；留空自动探测 main/debug） */
  doDebugRun: (o?: { entryClass?: string; entryMethod?: string; args?: string[] }) => Promise<DebugRunResult | undefined>;
  /** 当前环境能不能调试运行（网页版 false） */
  canDebug: boolean;
}

export function useDebugRun(deps: UseDebugRunDeps): UseDebugRunReturn {
  const { activeProject, aiFileIo, openRel, xml, resources, noteTimed, setExportNote, pushDebugLog } = deps;
  const [debugBusy, setDebugBusy] = useState(false);
  const [debugResult, setDebugResult] = useState<DebugRunResult | null>(null);
  const canDebug = androidJavaToolchain.canRun?.() ?? false;

  const doDebugRun = useCallback(
    async (o?: { entryClass?: string; entryMethod?: string; args?: string[] }) => {
      if (debugBusy) return;
      setDebugResult(null);
      if (!androidJavaToolchain.canRun?.()) {
        const msg = tt("当前环境不支持调试运行（网页版没有 ECJ/D8），请在手机上操作");
        setDebugResult({ ok: false, step: "env", log: msg });
        noteTimed(msg, 6000);
        return;
      }
      const b = nativeBridge();
      const root = projectSaveRoot(activeProject);
      const base = root?.kind === "native" ? root.base.replace(/[/\\]+$/, "") : b?.getDefaultWorkspace?.() || "";
      if (!base) {
        const msg = tt("没有可写的项目目录");
        setDebugResult({ ok: false, step: "env", log: msg });
        noteTimed(msg, 6000);
        return;
      }
      setDebugBusy(true);
      setExportNote(tt("正在收集 Java 源码…"));
      try {
        // 1) Java 源码（当前打开的文件用编辑器最新内容）
        const javaSrc = await loadProjectJavaFiles(aiFileIo, 40, {
          nativeRoot: activeProject?.rootPath || activeProject?.dirPath || null,
        });
        const relNow = (openRel || "").replace(/\\/g, "/");
        const javaSources = withCurrentSource(javaSrc.map((j) => ({ path: j.rel, code: j.text })), relNow, xml);
        if (javaSources.length === 0) {
          const msg = tt("项目里没有 Java 源码，没法调试运行");
          setDebugResult({ ok: false, step: "env", log: msg });
          noteTimed(msg, 6000);
          return;
        }
        // 2) 包名（R.java 用）
        let pkg = activeProject?.name ? packageOf(activeProject.name) : "com.axv.app";
        if (root) {
          const fresh = await readAppGradle(root);
          if (fresh?.text) {
            const pg = parseGradlePackage(fresh.text);
            if (pg.applicationId || pg.namespace) pkg = pg.applicationId || pg.namespace || pkg;
          }
        }
        const rPkg = rPackageFromSources(javaSources);
        const domPkg = rPkg || dominantJavaPackage(javaSources);
        if (domPkg) pkg = domPkg;
        // 3) 候选入口类
        const cands = entryCandidates(javaSources);
        // 4) 依赖库
        setExportNote(tt("正在收集依赖库…"));
        let gradleText = "";
        if (root) {
          const g = await readAppGradle(root);
          gradleText = g?.text || "";
        }
        const libNotes: string[] = [];
        const libsRes = await collectProjectLibs(aiFileIo, activeProject?.rootPath || activeProject?.dirPath || null, gradleText, "app/build.gradle");
        libNotes.push(...(libsRes.notes || []));
        const sharedLibs = await collectSharedLibs(libNotes);
        const allLibs = [...(Array.isArray(sharedLibs) ? sharedLibs : []), ...(Array.isArray(libsRes?.libs) ? libsRes.libs : [])];
        // 5) 生成 R.java（代码引用 R 时）
        const codeRefsR = javaSources.some((j) => /\bR\.(id|string|color|dimen|drawable|style|array|attr|layout)\./.test(j.code));
        const finalSources = codeRefsR
          ? [...javaSources, { path: "R.java", code: genRJavaText(resources, pkg, javaSources) }]
          : javaSources;
        // 6) 设备端编译成 dex
        setExportNote(tt("正在设备端编译（ECJ+D8）…"));
        const comp = await androidJavaToolchain.compileDex({
          pkg,
          javaSources: finalSources,
          libs: allLibs.length ? allLibs.map((l) => ({ path: l.rel, base64: l.base64 })) : undefined,
          candidates: cands,
        });
        if (!comp.ok || !comp.dex || comp.dex.length === 0) {
          const msg = tt("编译失败：{log}", { log: (comp.log || "").split("\n").slice(-6).join("\n") });
          setDebugResult({ ok: false, step: comp.step || "compile", log: comp.log || msg });
          // M440：编译日志 → 「构建日志」tab（跟打包编译日志同性质）
          pushDebugLog?.(
            { id: String(Date.now()), ok: false, stage: tt("调试编译失败（{step}）", { step: comp.step || "compile" }), log: comp.log || msg },
            "build",
          );
          noteTimed(msg, 8000);
          return;
        }
        // 7) 动态加载执行
        setExportNote(tt("正在执行（动态加载 dex）…"));
        const r = await androidJavaToolchain.runDex({
          dex: comp.dex,
          entryClass: o?.entryClass,
          entryMethod: o?.entryMethod,
          args: o?.args,
          candidates: cands,
        });
        setDebugResult(r);
        // M440：运行输出 → 「运行日志」tab（跟 App 运行日志同性质）
        pushDebugLog?.({
          id: String(Date.now()),
          ok: r.ok,
          stage: r.ok ? tt("调试运行成功（{ms}ms）", { ms: String(r.ms ?? 0) }) : tt("调试运行失败（{step}）", { step: r.step || "?" }),
          ms: r.ms,
          log: [r.stdout, r.stderr, r.returnValue, r.exception, r.stackTrace].filter(Boolean).join("\n"),
        }, "debug");
        if (r.ok) {
          noteTimed(tt("调试运行成功（{ms}ms）", { ms: String(r.ms ?? 0) }), 5000);
        } else {
          const top = r.exception || (r.log || "").split("\n").slice(-4).join(" | ");
          noteTimed(tt("调试运行{step}：{e}", { step: r.step || "", e: top.slice(0, 200) }), 6000);
        }
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const bad: DebugRunResult = { ok: false, step: "js", log: msg };
        setDebugResult(bad);
        // M440：失败也推送（运行日志 tab 能看到完整错误）
        pushDebugLog?.({ id: String(Date.now()), ok: false, stage: tt("调试运行异常（js）"), log: msg }, "debug");
        noteTimed(tt("调试运行失败：{m}", { m: msg }), 6000);
        return bad;
      } finally {
        setDebugBusy(false);
      }
    },
    [debugBusy, activeProject, aiFileIo, openRel, xml, resources, noteTimed, setExportNote, pushDebugLog],
  );

  return { debugBusy, debugResult, doDebugRun, canDebug };
}
