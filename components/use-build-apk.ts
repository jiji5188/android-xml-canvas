// components/use-build-apk.ts — M238：把「一键打包 APK」整块逻辑从 XmlEditor 里拆出来
// 之前 doBuildApk 150+ 行直接嵌在 5700 行的大文件里，每次改打包逻辑都要碰主文件、
// 上下文压力拉满。抽成 hook 后：
//   - XmlEditor 只 import { useBuildApk } 并传几个 deps
//   - 打包相关改动全在 use-build-apk.ts 里，~200 行，好定位
//   - 测试可以直接 mock 这个 hook 的 deps

import { useCallback, useState } from "react";
import type { BuildApkResult } from "@/lib/xml/native-apk";
import { buildApk, hasBuildApk, compileModeOf, installApk, shareApkFile } from "@/lib/xml/native-apk";
import { nativeBridge } from "@/lib/xml/native-save";
import { projectSaveRoot, readAppGradle } from "@/lib/xml/project-save";
import { parseGradlePackage } from "@/lib/xml/project-info";
import { packageOf } from "@/lib/xml/new-project";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { collectProjectDex, numberDexFiles } from "@/lib/xml/project-dex";
import { loadProjectJavaFiles } from "@/lib/xml/java-files";
import { buildResNameIndex, missingResourceRefs, collectExternalImports, missingLibPackages, stubMissingRefs } from "@/lib/xml/resource-refs";
import { withCurrentSource, withCurrentXml } from "@/lib/xml/editor-buffer";
import { prepareFiles } from "@/lib/xml/native-render";
import type { RenderFile } from "@/lib/xml/native-render";
import { deriveLauncherFromSources, findLauncherActivity, readProjectManifest, forceManifestPkg, dominantJavaPackage, rPackageFromSources, rPackagesFromSources, parseManifestLauncher } from "@/lib/xml/find-launcher";
import { axvRuntimeSources, injectAxvLogProvider } from "@/lib/xml/axv-runtime";
import { autofixJavaSources } from "@/lib/xml/java-autofix";
import { collectProjectLibs, collectSharedLibs } from "@/lib/xml/project-libs";
import { showNativeProgress, setNativeProgress, closeNativeDialog } from "@/lib/xml/system-download";
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
    level?: "ok" | "fail" | "info";
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
  doBuildApk: (o: { storeFile: string; storePass: string; alias: string; keyPass?: string }) => Promise<BuildApkResult | undefined>;
}

/** M188b：没可写根时签名配置存 localStorage 草稿 */
const LS_KEY_SIGN_DRAFT = "axv-sign-draft";

/** M297：从构建日志里提取前 N 条关键错误，用于 toast 快速定位 */
function extractTopErrors(log: string, n: number): string {
  if (!log) return "";
  const lines = log.split(/\n/);
  const interesting: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (!l) continue;
    // ECJ / aapt2 / D8 常见错误行
    if (/(ERROR|error:|FATAL|cannot be resolved|unresolved reference|error|Error|Exception|failed|失败)/i.test(l)) {
      interesting.push(l);
      if (interesting.length >= n) break;
    }
  }
  if (interesting.length === 0) {
    // 没匹配到就取后几行非空行
    const tail = lines.filter(Boolean).slice(-n);
    return tail.map((l) => "  " + l).join("\n");
  }
  return interesting.map((l) => "  " + l).join("\n");
}

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
    level?: "ok" | "fail" | "info",
  ) => {
    if (!onBuildLog) return;
    onBuildLog({
      id: `apk-${Date.now()}`,
      ok,
      level: level || (ok ? "ok" : "fail"),
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
      // M361：打包 ProgressDialog（不可关闭，成功/失败自动关）
      showNativeProgress(tt("正在打包"), tt("收集资源…"), false, "build");
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
            const parts: string[] = [tt("收集 Java 源码：成功 {n} 个", { n: rp.collected })];
            if (rp.truncated) parts.push(tt("触到上限（{f} 文件 / 深度 {d}）", { f: rp.maxFiles, d: rp.maxDepth }));
            if (rp.skipped.length)
              parts.push(
                tt("跳过 {n} 个：{l}{more}", {
                  n: rp.skipped.length,
                  l: rp.skipped.slice(0, 10).map((s) => s.rel + "（" + s.reason + "）").join("、"),
                  more: rp.skipped.length > 10 ? "…" : "",
                }),
              );
            pushBuildLog(true, tt("Java 源码收集"), parts.join("\n"), undefined, undefined, undefined, "info");
          }
        });
        const javaSrcMapped = javaSrc.map((j) => ({ path: j.rel, code: j.text }));
        const javaSources = withCurrentSource(javaSrcMapped, relNow, xml);
        // M271：R.java 的包名以「源码实际引用 R 的地方」为准（最准），
        // 其次才是 package 声明多数决。改包名改一半时，R 引用方暴露真实期望包。
        const rPkg = rPackageFromSources(javaSources);
        const domPkg = rPkg || dominantJavaPackage(javaSources);
        if (domPkg && domPkg !== pkg) {
          pushBuildLog(true, tt("包名不一致提示"), tt("源码引用 R 的包是 {p}，但当前配置是 {c}。已按 {p} 生成 R.java 并打包，请同步 manifest/build.gradle。", { p: domPkg, c: pkg }), undefined, undefined, undefined, "info");
          pkg = domPkg;
        }
        // M266：项目依赖库（libs/*.jar|aar）→ 设备端 ECJ classpath
        setExportNote(tt("正在收集依赖库…"));
        const libsRes = await collectProjectLibs(aiFileIo, activeProject?.rootPath || activeProject?.dirPath || null);
        // M361：共享库 /AndroidUIIDE/libs 也进 classpath（maven 坐标引用的库实体存这里）
        // M379：Array.isArray 守卫——上游任何异常形状都不能再抛 "is not iterable"（M367/M379 两次事故）
        const sharedLibs = await collectSharedLibs();
        const projectLibsArr = Array.isArray(libsRes?.libs) ? libsRes.libs : [];
        const sharedLibsArr = Array.isArray(sharedLibs) ? sharedLibs : [];
        const allBuildLibs = [...projectLibsArr, ...sharedLibsArr];
        if (allBuildLibs.length) {
          setExportNote(tt("发现 {n} 个依赖库（项目 {a} + 共享 {b}），一起加进 classpath", { n: String(allBuildLibs.length), a: String(projectLibsArr.length), b: String(sharedLibsArr.length) }));
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
            pushBuildLog(true, tt("manifest 包名已对齐"), tt("manifest 里的 package 属性已从旧值改为 {p}（与 Java 源码一致）", { p: pkg }), undefined, undefined, undefined, "info");
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
        setNativeProgress("build", tt("编译资源并签名…"), -1);
        const prep = prepareFiles(layout, files);
        if (prep.blocked) {
          setApkResult({ ok: false, step: "compile", log: prep.blocked });
          pushBuildLog(false, tt("打包失败（compile）"), prep.blocked);
          noteTimed(tt("打包失败：{msg}", { msg: "compile" }), 12000);
          return;
        }
        // M278/P2：打包前预检查——代码引用的 R.xxx 资源在 res/ 里是否都齐，缺的提前列出来
        let buildFiles: RenderFile[] = prep.files;
        let resIndex: Map<string, Set<string>> | null = null;
        try {
          const resNames = prep.files.map((f) => f.path);
          const valuesTexts: Record<string, string> = {};
          for (const f of prep.files) {
            // M284：layout/menu 里的 @+id/x 也算 id 声明，全部 xml 文本都传进去
            if (/\.xml$/i.test(f.path) && typeof f.text === "string") valuesTexts[f.path] = f.text;
          }
          const idx = buildResNameIndex(resNames, valuesTexts);
          resIndex = idx;
          const missing = missingResourceRefs(javaSources.map((j) => j.code), idx);
          if (missing.length) {
            const top = missing.slice(0, 12).map((m) => `${m.type}/${m.name}(${m.files}文件)`).join("、");
            // M284：不只警告——自动补占位让编译能过，并明确告知哪些是占位（运行时可能还是找不到控件）
            const stub = stubMissingRefs(prep.files, missing);
            buildFiles = stub.files;
            pushBuildLog(true, tt("资源预检查（已自动补占位）"),
              tt("代码里引用了 res/ 里找不到的资源：{l}{more}",
                { l: top, more: missing.length > 12 ? `（还有 ${missing.length - 12} 个）` : "" }) +
                "\n" +
                tt("已自动生成占位（{n} 个）让编译通过：{s}",
                  { n: stub.stubbed.length, s: stub.stubbed.slice(0, 20).join("、") }) +
                "\n" +
                tt("注意：占位只保证编译过，运行时 findViewById 仍可能返回 null。要么在 layout 里真加上 android:id，要么改代码不用它们。", {}),
              undefined, undefined, undefined, "info");
          }
          // P2：第三方依赖预检查——import 的顶层包在 libs 里对不上就提示
          const extImports = collectExternalImports(javaSources.map((j) => j.code), [pkg]);
          const libPaths = libsRes.libs.map((l) => l.rel);
          const missLibs = missingLibPackages(extImports, libPaths);
          if (missLibs.length) {
            const top = missLibs.slice(0, 10).join("、");
            pushBuildLog(true, tt("依赖预检查（不阻断，仅提示）"),
              tt("代码 import 了这些第三方包，但 libs/ 里没找到对应 jar/aar：{l}{more}",
                { l: top, more: missLibs.length > 10 ? `（还有 ${missLibs.length - 10} 个）` : "" }) +
                "\n" +
                tt("请把这些依赖的 jar 放进项目 libs/ 目录再打包。", {}),
              undefined, undefined, undefined, "info");
          }
        } catch (e) { /* 预检查失败不阻断 */ }
        // M298：有自定义 keystore = 发布包 → 不注入调试日志抽屉；没 keystore = 调试包 → 默认自动调试 keystore + 日志抽屉
        const isRelease = !!o.storeFile.trim();
        // M286：往包里注入「运行日志抽屉」（provider + 生命周期/崩溃钩子 + 半屏抽屉）
        // M287：编译前先自动修机械错（补 import / 修 R 大小写），修了什么写进日志
        let javaSourcesForBuild = javaSources;
        let axvLogOn = false;
        if (!isRelease) {
          pushBuildLog(true, tt("调试签名"),
            tt("调试包使用 /AndroidUIIDE/axv-debug.keystore（首次打包自动生成，之后每次复用同一个调试签名）。", {}),
            undefined, undefined, undefined, "info");
        }
        if (javaSources.length) {
          const fixed = autofixJavaSources(javaSources, { resIndex, pkg });
          javaSourcesForBuild = fixed.sources;
          if (fixed.reports.length) {
            const lines = fixed.reports.slice(0, 12).map((r) => `${r.path}\n    ${r.fixes.join("\n    ")}`);
            pushBuildLog(true, tt("编译前自动修复（{n} 个文件）", { n: fixed.reports.length }), lines.join("\n\n") +
              (fixed.reports.length > 12 ? `\n…还有 ${fixed.reports.length - 12} 个文件` : ""),
              undefined, undefined, undefined, "info");
          }
          if (!isRelease) {
            const rt = axvRuntimeSources(pkg);
            javaSourcesForBuild = [...javaSourcesForBuild, ...rt];
            const inj = injectAxvLogProvider(manifestTextForBuild, pkg);
            manifestTextForBuild = inj.text;
            axvLogOn = true;
            pushBuildLog(true, tt("已注入运行日志抽屉"),
              inj.injected
                ? tt("生成的 APK 左上角会多一个「▤ 日志」把手：运行你的 App 时点开就能看生命周期/崩溃/自定义日志，长按把手可隐藏。", {})
                : tt("已生成日志类，但清单里没找到 <application> 无法挂上 provider（注入失败：{r}）。App 仍能跑，只是没有日志抽屉。", { r: String(inj.reason || "?") }),
              undefined, undefined, undefined, "info");
          } else {
            pushBuildLog(true, tt("发布包模式（未注入调试日志）"),
              tt("当前指定了自定义 keystore，按发布包处理：不往 App 里植入「▤ 日志」抽屉，保持包体干净。", {}),
              undefined, undefined, undefined, "info");
          }
        }
        const r = await buildApk({
          pkg,
          layout,
          appName: signAppName || layout,
          files: buildFiles,
          keystore,
          storePass: o.storePass,
          alias: o.alias,
          keyPass: o.keyPass,
          outName: `${pkg}-${layout}.apk`,
          extraDex: dexFiles,
          javaSources: javaSourcesForBuild,
          launchActivity: manifest || "",
          manifestText: manifestTextForBuild || "",
          axvLog: axvLogOn,
          libs: allBuildLibs.length ? allBuildLibs.map((l) => ({ path: l.rel, base64: l.base64 })) : undefined,
          rPackages: rPackagesFromSources(javaSources),
        });
        setApkResult(r);
        if (r.ok) {
          pushBuildLog(true, tt("打包成功"), r.log, undefined, r.bytes, r.ms);
          const base = tt("打包完成：{name}", { name: r.name || "" });
          const cm = compileModeOf(r);
          const dex = cm.dex || 0;
          const classes = cm.classes || 0;
          let suffix = "";
          if (cm.mode === "java" && dex > 0) {
            suffix = classes > 0
              ? tt("（已编译 {n} 个 Java 类，注入 {d} 个 dex）", { n: String(classes), d: String(dex) })
              : tt("（命中编译缓存，注入 {d} 个 dex）", { d: String(dex) });
          } else if (cm.mode === "java") {
            suffix = tt("（⚠ 未注入 Java dex，实际还是布局壳）");
          } else if (cm.mode === "shell") {
            suffix = tt("（项目无 .java，生成的是布局壳，不运行任何逻辑）");
          }
          // 打包成功后自动引导安装/分享
          let installMsg = "";
          if (r.path) {
            const inst = installApk(r.path);
            if (inst.ok) {
              installMsg = tt("已调起系统安装器");
            } else {
              const sh = shareApkFile(r.path);
              if (sh.ok) {
                installMsg = tt("已调起分享（可发到微信/QQ/文件）");
              } else {
                installMsg = tt("APK 已生成：{path}（当前环境无法自动安装/分享，请手动复制路径）", { path: r.path });
              }
            }
          } else {
            installMsg = tt("APK 已生成：{name}", { name: r.name || "" });
          }
          noteTimed(base + suffix + (installMsg ? "\n" + installMsg : ""), 12000);
        } else {
          pushBuildLog(false, tt("打包失败（{step}）", { step: r.step || "?" }), r.log);
          const topErr = extractTopErrors(r.log || "", 3);
          noteTimed(
            tt("打包失败（{step}）", { step: r.step || "?" }) +
            (topErr ? "\n" + topErr : "") +
            "\n" +
            tt("详细错误在「问题/日志」抽屉 →「构建日志」查看", {}),
            15000,
          );
        }
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const bad: BuildApkResult = { ok: false, step: "js", log: msg };
        setApkResult(bad);
        pushBuildLog(false, tt("打包失败（js）"), msg);
        noteTimed(tt("打包失败：{msg}", { msg }), 12000);
        return bad;
      } finally {
        setApkBusy(false);
        closeNativeDialog("build");
      }
    },
    [apkBusy, activeProject, gradleForSign, signAppName, aiFileIo, openRel, docKind, xml, buildSaveInput, noteTimed, setExportNote, onBuildLog],
  );

  return { apkBusy, apkResult, doBuildApk };
}
