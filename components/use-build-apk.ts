// components/use-build-apk.ts — M238：把「一键打包 APK」整块逻辑从 XmlEditor 里拆出来
// 之前 doBuildApk 150+ 行直接嵌在 5700 行的大文件里，每次改打包逻辑都要碰主文件、
// 上下文压力拉满。抽成 hook 后：
//   - XmlEditor 只 import { useBuildApk } 并传几个 deps
//   - 打包相关改动全在 use-build-apk.ts 里，~200 行，好定位
//   - 测试可以直接 mock 这个 hook 的 deps

import { useCallback, useState } from "react";
import type { BuildApkResult } from "@/lib/xml/native-apk";
import { compileModeOf, installApk, shareApkFile } from "@/lib/xml/native-apk";
import { androidJavaToolchain } from "@/lib/plugin/toolchains/android-java";
import { nativeBridge } from "@/lib/xml/native-save";
import { projectSaveRoot, readAppGradle } from "@/lib/xml/project-save";
import { parseGradlePackage } from "@/lib/xml/project-info";
import { parseGradleDepsDetailed } from "@/lib/xml/gradle-deps";
import { packageOf } from "@/lib/xml/new-project";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { injectMissingManifestIcons, manifestIconRefs, iconFilesForRefs } from "@/lib/xml/icon-fallback";
import { dropBrokenAdaptiveIcons } from "@/lib/xml/adaptive-icon-fix";
import { missingGradleEntities, formatMissingList } from "@/lib/xml/pre-build-check";
import { collectProjectDex, numberDexFiles } from "@/lib/xml/project-dex";
import { loadProjectJavaFiles } from "@/lib/xml/java-files";
import { buildResNameIndex, missingResourceRefs, collectExternalImports, missingLibPackages, stubMissingRefs } from "@/lib/xml/resource-refs";
import { withCurrentSource, withCurrentXml } from "@/lib/xml/editor-buffer";
import { prepareFiles } from "@/lib/xml/native-render";
import type { RenderFile } from "@/lib/xml/native-render";
import { deriveLauncherFromSources, findLauncherActivity, readProjectManifest, forceManifestPkg, dominantJavaPackage, rPackageFromSources, rPackagesFromSources, parseManifestLauncher } from "@/lib/xml/find-launcher";
import { axvRuntimeSources, injectAxvLogProvider } from "@/lib/xml/axv-runtime";
import { autofixJavaSources } from "@/lib/xml/java-autofix";
import { collectProjectLibs, collectSharedLibs, dedupAarVersions, filterSharedByDeps, applyExcludes } from "@/lib/xml/project-libs";
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
  doBuildApk: (o: { storeFile: string; storePass: string; alias: string; keyPass?: string; withShell?: boolean }) => Promise<BuildApkResult | undefined>;
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
    async (o: { storeFile: string; storePass: string; alias: string; keyPass?: string; withShell?: boolean }) => {
      if (apkBusy) return;
      setApkResult(null);
      if (!androidJavaToolchain.canBuild()) {
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
      let gradleRel = "app/build.gradle";
      if (root) {
        const fresh = await readAppGradle(root);
        if (fresh?.text) { gradlePkg = fresh.text; gradleRel = fresh.rel; }
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
        // M380：manifest 里的 @mipmap/app、@drawable/ic_... 也是资源引用。
        //  以前 collectProjectRes 只扫布局文件的引用，manifest 引用的图标不进包 →
        //  aapt2 link 报 “resource mipmap/app not found / failed processing manifest”。
        //  必须在收集资源前读出来，作为额外引用源传进去。
        // M458：带 openRel 推导 res 兄弟目录 / main 目录候选（嵌套目录项目以前固定三条全漏）
        const manifestInfo = await readProjectManifest(aiFileIo, pkg, openRel);
        if (!manifestInfo.text) {
          // 静默丢清单 = 桌面绿机器人图标的真凶：合成清单没有 android:icon，图标引用也进不了收集
          pushBuildLog(
            false,
            tt("未读到项目清单（AndroidManifest.xml）"),
            tt(
              "试了 <项目根>/AndroidManifest.xml、app/src/main/、src/main/ 和当前文档推导的 res 兄弟目录都没找到。本次打包用合成清单：清单里的图标、主题、权限、label 全部丢失，桌面会显示系统默认图标。请确认项目目录结构是标准 Android 工程。",
              {},
            ),
          );
        }
        const collected = await collectProjectRes(
          aiFileIo,
          openRel,
          buildRealRenderFiles(baseInput),
          // M460：全量 res 扫描——AIDE/AS 是整个 res 目录全打，我们以前只收 XML 引用到的，
          //  Java 里 R.raw.xxx / R.drawable.xxx 引用但没被任何 XML 引用的资源全漏包
          //  → ECJ 编译 R.raw 报 cannot be resolved → 「Java 编译失败」。budget 放宽到 800。
          800,
          manifestInfo.text ? [manifestInfo.text] : [],
          true,
        );
        // M458：资源收集透明化——res 根没定位到时以前静默跳过，mipmap 全部漏包，日志里查无此因
        if (!collected.resRel) {
          pushBuildLog(
            false,
            tt("项目 res 目录未定位"),
            tt(
              "没找到 res 根目录（试了 app/src/main/res、src/main/res、res 和当前文档所在 res/）——项目磁盘上的资源（含 mipmap 图标）一个都没进包，只带了编辑器内的资源。项目目录结构如果不是标准 Android 工程，请检查。",
              {},
            ),
          );
        } else {
          pushBuildLog(
            true,
            tt("资源收集"),
            tt("res 根：{r}（{n} 个资源目录），新收 {a} 个文件，清单共 {t} 个", {
              r: collected.resRel,
              n: String(collected.dirsCount ?? 0),
              a: String(collected.added),
              t: String(collected.files.length),
            }),
            undefined,
            undefined,
            undefined,
            "info",
          );
        }
        const relNow = (openRel || input.name || "").replace(/\\/g, "/");
        const withCurrent = /\.xml$/i.test(relNow) ? withCurrentXml(collected.files, relNow, xml) : collected.files;
        // M380：manifest 引用的图标（@mipmap/app / @mipmap/app_round）项目里确实没有时，
        //  补一张默认矢量图标——否则 aapt2 link 必报 resource not found，整个打包卡死。
        const iconFix = injectMissingManifestIcons(withCurrent, manifestInfo.text);
        if (iconFix.injected.length) {
          pushBuildLog(
            true,
            tt("已注入默认图标"),
            tt("manifest 引用的图标在项目 res 里不存在，已自动补默认图标：{l}", { l: iconFix.injected.join("、") }),
            undefined,
            undefined,
            undefined,
            "info",
          );
        }
        const files = iconFix.files;
        // M463：坏 adaptive icon（mipmap-anydpi-v26 引用的 drawable 缺失）剔除，让密度 PNG 接管
        //  —— 用户定义的图标在 mipmap-hdpi/…，adaptive XML 背景被 stub 成透明就成「默认图标」
        const adaptiveFix = dropBrokenAdaptiveIcons(files);
        const finalFiles = adaptiveFix.files;
        if (adaptiveFix.dropped.length) {
          pushBuildLog(
            true,
            tt("剔除坏 adaptive icon"),
            tt("mipmap-anydpi-v26 里这些 adaptive icon 引用的 drawable 缺失（会被渲染成默认图标），已剔除改用密度 PNG：{l}", { l: adaptiveFix.dropped.join("、") }),
            undefined,
            undefined,
            undefined,
            "info",
          );
        }
        // M458：图标进包明细——项目自带 / 已注入兜底 / 完全没图标，一眼看清桌面会显示什么
        // M463：用 finalFiles（坏 adaptive 已剔除）——剔了之后密度 PNG 会进包，明细要反映真实情况
        {
          const refs = manifestIconRefs(manifestInfo.text);
          const injectedPaths = new Set(iconFix.injected.map((s) => s.replace(/^@/, "") + ".xml"));
          const iconIn = iconFilesForRefs(finalFiles, refs).filter((p) => !injectedPaths.has(p));
          if (refs.length === 0) {
            pushBuildLog(
              false,
              tt("包内无图标资源"),
              tt("清单没写 android:icon（或没读到清单）——打包后桌面显示系统默认图标。请在 manifest 的 application 节点加 android:icon（如 @mipmap/ic_launcher），并保证 res 里有对应图标文件。", {}),
            );
          } else if (iconIn.length) {
            pushBuildLog(
              true,
              tt("图标进包明细"),
              tt("项目图标已进包：{l}{more}", {
                l: iconIn.slice(0, 6).join("、"),
                more: iconIn.length > 6 ? "…" : "",
              }),
              undefined,
              undefined,
              undefined,
              "info",
            );
          } else {
            pushBuildLog(
              false,
              tt("清单图标未进包"),
              tt("manifest 引用的图标 {r} 在包内找不到，桌面将显示系统默认图标。确认 res 里确实有这些文件（图标编辑器生成的是 mipmap-anydpi-v26/ 下 4 个文件）。", {
                r: refs.map((x) => `@${x.type}/${x.name}`).join("、"),
              }),
            );
          }
        }
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
        // M380：除标准位置 app/src/main/libs，还扫 build.gradle 里 fileTree(dir:) 声明的目录
        setExportNote(tt("正在收集依赖库…"));
        const libNotes: string[] = [];
        const libsRes = await collectProjectLibs(
          aiFileIo,
          activeProject?.rootPath || activeProject?.dirPath || null,
          gradlePkg,
          gradleRel,
        );
        libNotes.push(...(libsRes.notes || []));
        // M361：共享库 /AndroidUIIDE/libs 也进 classpath（maven 坐标引用的库实体存这里）
        // M379：Array.isArray 守卫——上游任何异常形状都不能再抛 "is not iterable"（M367/M379 两次事故）
        const sharedLibs = await collectSharedLibs(libNotes);
        const projectLibsArr = Array.isArray(libsRes?.libs) ? libsRes.libs : [];
        const sharedLibsArr = Array.isArray(sharedLibs) ? sharedLibs : [];
        // M415：共享库按项目依赖过滤——build.gradle 声明了依赖时，只收声明的 artifact
        // （声明版本精确匹配优先，否则最高版）；没声明任何依赖时保持老行为全收
        let filteredShared = sharedLibsArr;
        const gradleDepParsed = parseGradleDepsDetailed(gradlePkg || "");
        const declaredDeps = [
          ...gradleDepParsed.deps.map((d) => ({ name: d.name, version: d.version })),
          ...gradleDepParsed.unresolved.map((u) => ({
            name: (u.coord.split(":")[1] || "").toLowerCase(),
            version: "",
          })),
        ];
        if (declaredDeps.length) {
          const fr = filterSharedByDeps(sharedLibsArr, declaredDeps);
          filteredShared = fr.kept;
          libNotes.push(
            `按项目依赖过滤共享库：声明 ${declaredDeps.length} 个 → 收 ${fr.kept.length} 个` +
              (fr.matched.length
                ? `（${fr.matched.slice(0, 6).map((m) => `${m.declared}→${m.file}`).join("、")}${fr.matched.length > 6 ? "…" : ""}）`
                : "") +
              (fr.excluded.length ? `，排除未声明 ${fr.excluded.length} 个：${fr.excluded.slice(0, 8).join("、")}${fr.excluded.length > 8 ? "…" : ""}` : ""),
          );
          // M467：资源传递依赖补齐（cardview 等）——不补的话 aapt2 link 会报 style/CardView not found
          if (fr.addedTransitive?.length) {
            libNotes.push(
              `按资源依赖补齐 ${fr.addedTransitive.length} 个：` +
                fr.addedTransitive.map((m) => `${m.name}（${m.file}）`).join("、"),
            );
          }
          if (fr.missingTransitive?.length) {
            pushBuildLog(
              true,
              tt("⚠ 缺少资源依赖库"),
              tt("以下库的资源被已选中的 aar 依赖，但共享库目录里没有，aapt2 链接会失败：{list}。请在「库」面板下载这些库后重新打包。", {
                list: fr.missingTransitive.join("、"),
              }),
              undefined,
              undefined,
              undefined,
              "info",
            );
          }
        }
        // M398：共享库在前 —— 同名 jar 共享库赢（BuildApkHelper 的 ECJ classpath / R8 M283 去重都保首个）
        const rawBuildLibs = [...filteredShared, ...projectLibsArr];
        // M414：aar 多版本去重（material-1.12.0 + material-1.0.0 同进 overlay → aapt2 link
        // 「conflicting value for configuration」真机事故；只留最高版）
        const { kept: dedupedLibs, dropped } = dedupAarVersions(rawBuildLibs);
        if (dropped.length) {
          libNotes.push(`aar 多版本去重：跳过 ${dropped.length} 个 → ` + dropped.map((d) => `${d.name}（${d.reason}）`).join("；"));
        }
        // M428：build.gradle 的 exclude 配置真正用上——被 exclude 的 module 不进 classpath
        // （用户真实场景：material:1.0.0 exclude com.android.support:support-*，物理存在的 support-*.jar 必须剔掉）
        const gradleExcludes = gradleDepParsed.deps.flatMap((d) => d.excludes ?? []);
        // M435：exclude 只排传递依赖，直接声明的库永不被排（Gradle 语义）
        const directNames = new Set(gradleDepParsed.deps.map((d) => d.name.toLowerCase()));
        const exRes = applyExcludes(dedupedLibs, gradleExcludes, directNames);
        const allBuildLibs = exRes.kept;
        if (exRes.dropped.length) {
          libNotes.push(
            `exclude 过滤：按 build.gradle 排掉 ${exRes.dropped.length} 个 → ` +
              exRes.dropped.slice(0, 8).map((d) => `${d.name}（${d.by}）`).join("、") +
              (exRes.dropped.length > 8 ? "…" : ""),
          );
        }
        // M383：依赖库收集明细——一眼看出“为什么 classpath 是 0 个库”（上次真实事故）
        pushBuildLog(
          true,
          tt("依赖库收集明细"),
          libNotes.join("\n") +
            (libsRes.failed?.length ? `\n读失败：${libsRes.failed.slice(0, 8).join("、")}` : "") +
            (libsRes.skipped?.length ? `\n超限跳过：${libsRes.skipped.slice(0, 8).join("、")}` : ""),
          undefined,
          undefined,
          undefined,
          "info",
        );
        if (allBuildLibs.length) {
          setExportNote(tt("发现 {n} 个依赖库（共享 {b} + 项目 {a}），共享库优先加进 classpath", { n: String(allBuildLibs.length), a: String(projectLibsArr.length), b: String(sharedLibsArr.length) }));
        }
        // M258：清单里找不到 MAIN/LAUNCHER 时，从源码推入口（extends Activity 的那个类）——
        //  否则 ShellActivity 拿不到 axv.launcher，永远停在壳上，用户代码跑不起来。
        // M262：项目 manifest 原文（M380 起上面已提前读过，这里直接用）
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
        const prep = prepareFiles(layout, finalFiles);
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
          // M398：预检查也要算共享库——以前只传项目库，库在共享目录里会被误报「libs/ 里没找到」
          const libPaths = allBuildLibs.map((l) => l.rel);
          const missLibs = missingLibPackages(extImports, libPaths);
          if (missLibs.length) {
            const top = missLibs.slice(0, 10).join("、");
            pushBuildLog(true, tt("依赖预检查（不阻断，仅提示）"),
              tt("代码 import 了这些第三方包，但 libs/ 里没找到对应 jar/aar：{l}{more}",
                { l: top, more: missLibs.length > 10 ? `（还有 ${missLibs.length - 10} 个）` : "" }) +
                "\n" +
                tt("请把这些依赖的 jar 放进项目 libs/ 目录或共享库 /AndroidUIIDE/libs 再打包。", {}),
              undefined, undefined, undefined, "info");
          }
          // M382：编译前检查①——按引用补齐后仍缺的资源（aapt2 必报 not found 的那些）。
          //  已注入的默认图标不算缺（iconFix 补过了）。
          const injectedKeys = new Set(iconFix.injected.map((s) => s.slice(1)));
          const resMissing = (Array.isArray(collected.missing) ? collected.missing : [])
            .filter((k) => !injectedKeys.has(k));
          if (resMissing.length) {
            const f = formatMissingList(resMissing);
            pushBuildLog(true, tt("编译前检查：缺失资源"),
              tt("这些资源被引用但项目里收集不到（打包会报 not found；若实际来自依赖库可忽略）：{l}{more}",
                { l: f.shown, more: f.more > 0 ? `（还有 ${f.more} 个）` : "" }),
              undefined, undefined, undefined, "info");
          }
          // M382：编译前检查②——gradle 声明的 maven 坐标必须有本地实体（设备端没有 maven）。
          //  缺实体的包编译时必报 package does not exist（2026-11-18 cardview 事故）。
          const missDeps = missingGradleEntities(gradlePkg, allBuildLibs.map((l) => l.rel));
          if (missDeps.length) {
            const f = formatMissingList(missDeps.map((d) => `${d.coord}（${d.fname}）`), 10);
            pushBuildLog(true, tt("编译前检查：依赖缺实体"),
              tt("build.gradle 声明了这些依赖，但项目 libs/共享库里没有对应的 jar/aar：{l}{more}",
                { l: f.shown, more: f.more > 0 ? `（还有 ${f.more} 个）` : "" }) +
              "\n" +
              tt("缺实体的包编译时会报 package does not exist；去「lib 库管理 → 一键下载」补齐后再打包。", {}),
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
            // M464（方案 A）：发布包 = 干净标准包（不注壳 dex、不注 ShellActivity、不注日志抽屉）→ 与 gradle 构建等价，
            // 用户拿去装到手机 / 发应用商店 / 用别的编辑器重新打包都能用
            pushBuildLog(true, tt("发布包模式（未注入调试日志）"),
              tt("当前指定了自定义 keystore，按发布包处理：不注壳 dex、不注「▤ 日志」抽屉，包体与 gradle 构建等价。", {}),
              undefined, undefined, undefined, "info");
          }
        }
        const r = await androidJavaToolchain.build({
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
          releaseMode: typeof o.withShell === "boolean" ? !o.withShell : isRelease,
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
          // M440：弹窗提示缩短——编译/打包结果日志都在「构建日志」抽屉里看，toast 只给短提醒别挡事
          noteTimed(base + suffix + (installMsg ? "\n" + installMsg : ""), 5000);
        } else {
          pushBuildLog(false, tt("打包失败（{step}）", { step: r.step || "?" }), r.log);
          const topErr = extractTopErrors(r.log || "", 3);
          noteTimed(
            tt("打包失败（{step}）", { step: r.step || "?" }) +
            (topErr ? "\n" + topErr : "") +
            "\n" +
            tt("详细错误在「问题/日志」抽屉 →「构建日志」查看", {}),
            8000,
          );
        }
        return r;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const bad: BuildApkResult = { ok: false, step: "js", log: msg };
        setApkResult(bad);
        pushBuildLog(false, tt("打包失败（js）"), msg);
        noteTimed(tt("打包失败：{msg}", { msg }), 5000);
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
