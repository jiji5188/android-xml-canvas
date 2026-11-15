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
import { buildResNameIndex, missingResourceRefs, collectExternalImports, missingLibPackages } from "@/lib/xml/resource-refs";
import { withCurrentSource, withCurrentXml } from "@/lib/xml/editor-buffer";
import { prepareFiles } from "@/lib/xml/native-render";
import { deriveLauncherFromSources, findLauncherActivity, readProjectManifest, forceManifestPkg, dominantJavaPackage, rPackageFromSources, rPackagesFromSources, parseManifestLauncher } from "@/lib/xml/find-launcher";
import { collectProjectLibs } from "@/lib/xml/project-libs";
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
  /** M252：打包完成后把完整日志推进左侧「构建日志」抽屉（不再只塞在签名弹窗里） */
  onBuildLog?: (entry: {
    id: string;
    ok: boolean;
    stage: string;
    ms?: number;
    log?: string;
    files?: number;
    bytes?: number;
  }) => void;
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
    onBuildLog,
  } = deps;

  // M252：把一次打包（含成功/失败）的完整日志推进左侧抽屉「构建日志」tab。
  // 之前日志只存在 apkResult 里、只能在签名弹窗的 <pre> 里看；现在进抽屉，
  // 跟其它构建日志统一在一个滚动容器（.axv-drawer-body）里，方便回看/复制。
  const pushBuildLog = (
    ok: boolean,
    stage: string,
    log: string | undefined,
    files?: number,
    bytes?: number,
    ms?: number,
  ) => {
    if (!onBuildLog) return;
    onBuildLog({
      id: `apk-${Date.now()}`,
      ok,
      stage,
      log,
      files,
      bytes,
      ms,
    });
  };

  const [apkBusy, setApkBusy] = useState(false);
  const [apkResult, setApkResult] = useState<BuildApkResult | null>(null);

  const doBuildApk = useCallback(
    async (o: { storeFile: string; storePass: string; alias: string; keyPass?: string }) => {
      if (apkBusy) return;
      setApkResult(null);
      if (!hasBuildApk()) {
        const msg = tt("当前环境不支持打包（网页版没有 aapt2/apksig），请在手机上操作");
        setApkResult({ ok: false, step: "env", log: msg });
        // M260：早失败也要进抽屉构建日志，否则用户只看到弹窗短提示，无处回看
        pushBuildLog(false, tt("打包失败（env）"), msg);
        return;
      }
      const b = nativeBridge();
      const root = projectSaveRoot(activeProject);
      const base = root?.kind === "native" ? root.base.replace(/[/\\]+$/, "") : b?.getDefaultWorkspace?.() || "";
      if (!base) {
        const msg = tt("没有可写的项目目录");
        setApkResult({ ok: false, step: "keystore", log: msg });
        pushBuildLog(false, tt("打包失败（keystore）"), msg);
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
            const msg = tt("项目里没找到布局文件（layout/*.xml）。请先在左侧资源新建或打开一个布局，再打包。");
            setApkResult({
              ok: false,
              step: "compile",
              log: msg,
            });
            pushBuildLog(false, tt("打包失败（compile）"), msg);
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
        const javaSrc = await loadProjectJavaFiles(aiFileIo, 30, {
          nativeRoot: activeProject?.rootPath || activeProject?.dirPath || null,
        }, (rp) => {
          // M278/P0-1：把「扫到几个 / 跳过了哪些 / 为什么」推进构建日志，漏文件时可排查
          if (rp.skipped.length || rp.truncated) {
            const parts = ["收集 Java 源码：成功 " + rp.collected + " 个"];
            if (rp.truncated) parts.push("触到上限（" + rp.maxFiles + " 文件 / 深度 " + rp.maxDepth + "）");
            if (rp.skipped.length) parts.push("跳过 " + rp.skipped.length + " 个：" + rp.skipped.slice(0, 10).map((s) => s.rel + "（" + s.reason + "）").join("、") + (rp.skipped.length > 10 ? " 等" : "") + "）");
            pushBuildLog(rp.skipped.length > 0, tt("Java 源码收集"), parts.join("\n"));
          }
        });
        const javaSrcMapped = javaSrc.map((j) => ({ path: j.rel, code: j.text }));
        const javaSources = withCurrentSource(javaSrcMapped, relNow, xml);
        // M271：R.java 的包名以「源码实际引用 R 的地方」为准（最准），
        // 其次才是 package 声明多数决。改包名改一半时，R 引用方暴露真实期望包。
        const rPkg = rPackageFromSources(javaSources);
        const domPkg = rPkg || dominantJavaPackage(javaSources);
        if (domPkg && domPkg !== pkg) {
          pushBuildLog(false, tt("包名不一致提示"), tt("源码引用 R 的包是 {p}，但当前配置是 {c}。已按 {p} 生成 R.java 并打包，请同步 manifest/build.gradle。", { p: domPkg, c: pkg }));
          pkg = domPkg;
        }
        // M266：项目依赖库（libs/*.jar|aar）→ 设备端 ECJ classpath
        setExportNote(tt("正在收集依赖库…"));
        const libsRes = await collectProjectLibs(aiFileIo, activeProject?.rootPath || activeProject?.dirPath || null);
        if (libsRes.libs.length) {
          setExportNote(tt("发现 {n} 个依赖库，一起加进 classpath", { n: String(libsRes.libs.length) }));
        }
        // M258：清单里找不到 MAIN/LAUNCHER 时，从源码推入口（extends Activity 的那个类）——
        //  否则 ShellActivity 拿不到 axv.launcher，永远停在壳上，用户代码跑不起来。
        // M262：同时把项目 manifest 原文读出来给 BuildApkHelper 用（aapt2 link 不再合成清单）
        const manifestInfo = await readProjectManifest(aiFileIo, pkg);
        let manifest = manifestInfo.launcher || "";
        // M268：把 manifest 里的 package 强制对齐到权威 pkg（Java 源码多数包名）
        let manifestTextForBuild = manifestInfo.text;
        if (manifestInfo.text) {
          const forced = forceManifestPkg(manifestInfo.text, pkg);
          if (forced.changed) {
            manifestTextForBuild = forced.text;
            pushBuildLog(false, tt("manifest 包名已对齐"), tt("manifest 里的 package 属性已从旧值改为 {p}（与 Java 源码一致）", { p: pkg }));
          }
        }
        if (!manifest && manifestTextForBuild) {
          manifest = parseManifestLauncher(manifestTextForBuild, pkg);
        }
        if (!manifest && javaSources.length) {
          manifest = deriveLauncherFromSources(javaSources, pkg);
          if (manifest) setExportNote(tt("清单里没找到 launcher，已从源码推断入口：{n}", { n: manifest }));
        }
        if (javaSources.length) setExportNote(tt("{n} 个 Java/Kotlin 源码将在设备上编译", { n: javaSources.length }));
        if (javaSources !== javaSrcMapped && javaSources.length) {
          setExportNote(tt("{f} 还没保存，这次打包用的是编辑器里的最新内容", { f: (relNow.split("/").pop() || relNow) }));
        }
        setExportNote(tt("正在编译资源并签名（设备端，约十几秒）…"));
        const prep = prepareFiles(layout, files);
        if (prep.blocked) {
          setApkResult({ ok: false, step: "compile", log: prep.blocked });
          pushBuildLog(false, tt("打包失败（compile）"), prep.blocked);
          noteTimed(tt("打包失败：{msg}", { msg: "compile" }), 12000);
          return;
        }
        // M278/P2：打包前预检查——代码引用的 R.xxx 资源在 res/ 里是否都齐，缺的提前列出来
        try {
          const resNames = prep.files.map((f) => f.path);
          const valuesTexts: Record<string, string> = {};
          for (const f of prep.files) {
            if (f.path.startsWith("values") && typeof f.text === "string") valuesTexts[f.path] = f.text;
          }
          const idx = buildResNameIndex(resNames, valuesTexts);
          const missing = missingResourceRefs(javaSources.map((j) => j.code), idx);
          if (missing.length) {
            const top = missing.slice(0, 12).map((m) => `${m.type}/${m.name}(${m.files}文件)`).join("、");
            pushBuildLog(false, tt("资源预检查（不阻断，仅提示）"),
              tt("代码里引用了 res/ 里找不到的资源：{l}{more}",
                { l: top, more: missing.length > 12 ? `（还有 ${missing.length - 12} 个）` : "" }) +
                "\n" +
                tt("这些会 ECJ 报「cannot be resolved or is not a field」。可补 res/ 资源、放 aar 进 libs/、或改代码不用它们。",
                {}));
          }
          // P2：第三方依赖预检查——import 的顶层包在 libs 里对不上就提示
          const extImports = collectExternalImports(javaSources.map((j) => j.code), [pkg]);
          const libPaths = libsRes.libs.map((l) => l.rel);
          const missLibs = missingLibPackages(extImports, libPaths);
          if (missLibs.length) {
            const top = missLibs.slice(0, 10).join("、");
            pushBuildLog(false, tt("依赖预检查（不阻断，仅提示）"),
              tt("代码 import 了这些第三方包，但 libs/ 里没找到对应 jar/aar：{l}{more}",
                { l: top, more: missLibs.length > 10 ? `（还有 ${missLibs.length - 10} 个）` : "" }) +
                "\n" +
                tt("请把这些依赖的 jar 放进项目 libs/ 目录再打包。", {}));
          }
        } catch (e) { /* 预检查失败不阻断 */ }
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
          manifestText: manifestTextForBuild || "",
          libs: libsRes.libs.length ? libsRes.libs.map((l) => ({ path: l.rel, base64: l.base64 })) : undefined,
          rPackages: rPackagesFromSources(javaSources),
        });
        setApkResult(r);
        if (r.ok) {
          pushBuildLog(true, tt("打包成功"), r.log, undefined, r.bytes, r.ms);
          const base = tt("打包完成：{name}", { name: r.name || "" });
          const cm = compileModeOf(r);
          const dex = cm.dex || 0;
          const classes = cm.classes || 0;
          if (cm.mode === "java" && dex > 0) {
            // M254：真的注入了 dex（>0）就是能跑逻辑——哪怕 classes=0（编译缓存命中，class 数未知）
            noteTimed(
              classes > 0
                ? tt("{base}（已编译 {n} 个 Java 类，注入 {d} 个 dex）", { base, n: String(classes), d: String(dex) })
                : tt("{base}（命中编译缓存，注入 {d} 个 dex）", { base, d: String(dex) }),
              8000,
            );
          } else if (cm.mode === "java") {
            noteTimed(tt("{base}（⚠ 未注入 Java dex，实际还是布局壳）", { base }), 12000);
          } else if (cm.mode === "shell") {
            noteTimed(tt("{base}（项目无 .java，生成的是布局壳，不运行任何逻辑）", { base }), 10000);
          } else {
            noteTimed(base, 8000);
          }
        } else {
          pushBuildLog(false, tt("打包失败（{step}）", { step: r.step || "?" }), r.log);
          noteTimed(tt("打包失败（{step}）", { step: r.step || "?" }), 12000);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setApkResult({ ok: false, step: "js", log: msg });
        pushBuildLog(false, tt("打包失败（js）"), msg);
        noteTimed(tt("打包失败：{msg}", { msg }), 12000);
      } finally {
        setApkBusy(false);
      }
    },
    [apkBusy, activeProject, gradleForSign, signAppName, aiFileIo, openRel, docKind, xml, buildSaveInput, noteTimed, setExportNote, onBuildLog],
  );

  return { apkBusy, apkResult, doBuildApk };
}
