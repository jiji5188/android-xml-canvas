// components/use-build-apk.ts — M238：把「一键打包 APK」整块逻辑从 XmlEditor 里拆出来
// 之前 doBuildApk 150+ 行直接嵌在 5700 行的大文件里，每次改打包逻辑都要碰主文件、
// 上下文压力拉满。抽成 hook 后：
//   - XmlEditor 只 import { useBuildApk } 并传几个 deps
//   - 打包相关改动全在 use-build-apk.ts 里，~200 行，好定位
//   - 测试可以直接 mock 这个 hook 的 deps

import { useCallback, useState } from "react";
import type { BuildApkResult } from "@/lib/xml/native-apk";
import { buildApk, hasBuildApk, compileModeOf } from "@/lib/xml/native-apk";
import { nativeBridge } from "@/lib/xml/native-save";
import { projectSaveRoot, readAppGradle } from "@/lib/xml/project-save";
import { parseGradlePackage } from "@/lib/xml/project-info";
import { packageOf } from "@/lib/xml/new-project";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { collectProjectDex, numberDexFiles } from "@/lib/xml/project-dex";
import { loadProjectJavaFiles } from "@/lib/xml/java-files";
import { withCurrentSource, withCurrentXml } from "@/lib/xml/editor-buffer";
import { prepareFiles } from "@/lib/xml/native-render";
import { findLauncherActivity } from "@/lib/xml/find-launcher";
import { pickProjectLayout } from "@/lib/xml/pick-layout";
import { buildRealRenderFiles, type SaveInput } from "@/lib/xml/save-flow";
import { t as tt } from "@/lib/i18n-src";

export interface UseBuildApkDeps {
  /** 当前项目（activeProject），null = 没打开项目 */
  activeProject: { name: string; dirPath?: string; rootPath?: string } | null;
  /** 打开签名弹层时读到的 build.gradle 文本（缓存，打包时再读一次磁盘为准） */
  gradleForSign: string | null;
  /** 项目里 app_name（签名弹层填的） */
  signAppName: string | null;
  /** 文件 IO 通道（native / handle / null） */
  aiFileIo: any;
  /** 当前打开文件的相对路径 */
  openRel: string | null;
  /** 当前文档是布局还是代码 */
  docKind: string;
  /** 编辑器当前正文 */
  xml: string;
  /** 构建 SaveInput（画布/代码面板当前内容 + 资源 extras） */
  buildSaveInput: () => SaveInput;
  /** 提示 toast（带自动消失） */
  noteTimed: (msg: string, ms?: number) => void;
  /** 提示 toast（进度类，不自动消失，会被下一个 noteTimed 顶掉） */
  setExportNote: (msg: string) => void;
}

export interface UseBuildApkReturn {
  apkBusy: boolean;
  apkResult: BuildApkResult | null;
  doBuildApk: (o: { storeFile: string; storePass: string; alias: string; keyPass?: string }) => Promise<void>;
}

/** M188b：没可写根时签名配置存 localStorage 草稿 */
const LS_KEY_SIGN_DRAFT = "axv-sign-draft";

export function useBuildApk(deps: UseBuildApkDeps): UseBuildApkReturn {
  const {
    activeProject,
    gradleForSign,
    signAppName,
    aiFileIo,
    openRel,
    docKind,
    xml,
    buildSaveInput,
    noteTimed,
    setExportNote,
  } = deps;

  const [apkBusy, setApkBusy] = useState(false);
  const [apkResult, setApkResult] = useState<BuildApkResult | null>(null);

  const doBuildApk = useCallback(
    async (o: { storeFile: string; storePass: string; alias: string; keyPass?: string }) => {
      if (apkBusy) return;
      setApkResult(null);
      if (!hasBuildApk()) {
        setApkResult({ ok: false, step: "env", log: tt("当前环境不支持打包（网页版没有 aapt2/apksig），请在手机上操作") });
        return;
      }
      const b = nativeBridge();
      const root = projectSaveRoot(activeProject);
      const base = root?.kind === "native" ? root.base.replace(/[/\\]+$/, "") : b?.getDefaultWorkspace?.() || "";
      if (!base) {
        setApkResult({ ok: false, step: "keystore", log: tt("没有可写的项目目录") });
        return;
      }
      const clean = (o.storeFile || "").replace(/\\/g, "/").replace(/^\/+/, "");
      const keystore = clean ? `${base}/${clean}` : "";
      let gradlePkg = gradleForSign;
      if (root) {
        const fresh = await readAppGradle(root);
        if (fresh?.text) gradlePkg = fresh.text;
      }
      let pkg = activeProject?.name ? packageOf(activeProject.name) : "com.axv.app";
      if (gradlePkg) {
        const pg = parseGradlePackage(gradlePkg);
        if (pg.applicationId || pg.namespace) pkg = pg.applicationId || pg.namespace || pkg;
      }
      const input = buildSaveInput();
      setApkBusy(true);
      setExportNote(tt("正在收集资源…"));
      try {
        const openRelNorm = (openRel || input.name || "").replace(/\\/g, "/");
        const relLayout = openRelNorm.match(/(?:^|\/)layout(?:-[^/]+)?\/(.+)\.xml$/i);
        const isLayoutDoc = docKind === "layout" && !!relLayout;
        let layout = isLayoutDoc && relLayout ? relLayout[1] : "";
        let baseInput = input;
        if (!layout) {
          const want = (xml.match(/R\.layout\.([A-Za-z_][A-Za-z0-9_]*)/) || [])[1] || "";
          const picked = await pickProjectLayout(aiFileIo, openRel, want);
          if (!picked) {
            setApkResult({
              ok: false,
              step: "compile",
              log: tt("项目里没找到布局文件（layout/*.xml）。请先在左侧资源新建或打开一个布局，再打包。"),
            });
            setExportNote(tt("打包失败：{msg}", { msg: "compile" }));
            return;
          }
          layout = picked.name;
          baseInput = { ...input, name: picked.rel, xml: picked.text };
        }
        const collected = await collectProjectRes(aiFileIo, openRel, buildRealRenderFiles(baseInput));
        const relNow = (openRel || input.name || "").replace(/\\/g, "/");
        const files = /\.xml$/i.test(relNow) ? withCurrentXml(collected.files, relNow, xml) : collected.files;
        const dexGot = await collectProjectDex(aiFileIo);
        const dexFiles = numberDexFiles(dexGot).map((d) => ({ name: d.name, base64: d.base64 }));
        if (dexGot.length) {
          setExportNote(tt("发现 {n} 个已编译 dex，一起打进包", { n: dexGot.length }));
        }
        setExportNote(tt("正在收集 Java 源码…"));
        const javaSrc = await loadProjectJavaFiles(aiFileIo, 8, {
          nativeRoot: activeProject?.rootPath || activeProject?.dirPath || null,
        });
        const javaSrcMapped = javaSrc.map((j) => ({ path: j.rel, code: j.text }));
        const javaSources = withCurrentSource(javaSrcMapped, relNow, xml);
        const manifest = javaSources.length ? await findLauncherActivity(aiFileIo) : "";
        if (javaSources.length) setExportNote(tt("{n} 个 Java/Kotlin 源码将在设备上编译", { n: javaSources.length }));
        if (javaSources !== javaSrcMapped && javaSources.length) {
          setExportNote(tt("{f} 还没保存，这次打包用的是编辑器里的最新内容", { f: (relNow.split("/").pop() || relNow) }));
        }
        setExportNote(tt("正在编译资源并签名（设备端，约十几秒）…"));
        const prep = prepareFiles(layout, files);
        if (prep.blocked) {
          setApkResult({ ok: false, step: "compile", log: prep.blocked });
          noteTimed(tt("打包失败：{msg}", { msg: "compile" }), 12000);
          return;
        }
        const r = await buildApk({
          pkg,
          layout,
          appName: signAppName || layout,
          files: prep.files,
          keystore,
          storePass: o.storePass,
          alias: o.alias,
          keyPass: o.keyPass,
          outName: `${pkg}-${layout}.apk`,
          extraDex: dexFiles,
          javaSources,
          launchActivity: manifest || "",
        });
        setApkResult(r);
        if (r.ok) {
          const base = tt("打包完成：{name}", { name: r.name || "" });
          const cm = compileModeOf(r);
          if (cm.mode === "java" && cm.classes > 0) {
            noteTimed(tt("{base}（已编译 {n} 个 Java 类）", { base, n: String(cm.classes) }), 8000);
          } else if (cm.mode === "java") {
            noteTimed(tt("{base}（⚠ 未注入 Java dex，实际还是布局壳）", { base }), 12000);
          } else if (cm.mode === "shell") {
            noteTimed(tt("{base}（项目无 .java，生成的是布局壳，不运行任何逻辑）", { base }), 10000);
          } else {
            noteTimed(base, 8000);
          }
        } else {
          noteTimed(tt("打包失败（{step}）", { step: r.step || "?" }), 12000);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setApkResult({ ok: false, step: "js", log: msg });
        noteTimed(tt("打包失败：{msg}", { msg }), 12000);
      } finally {
        setApkBusy(false);
      }
    },
    [apkBusy, activeProject, gradleForSign, signAppName, aiFileIo, openRel, docKind, xml, buildSaveInput, noteTimed, setExportNote],
  );

  return { apkBusy, apkResult, doBuildApk };
}
