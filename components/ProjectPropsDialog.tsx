// components/ProjectPropsDialog.tsx — M181：项目属性弹窗（项目列表长按 → 属性）
//
// 只做「能安全改」的四件事：
//   · 项目名（目录）—— 复用调用方的改名流程（会同步 gradle/settings/主题名）
//   · 应用名 app_name —— 改 res/values/strings.xml
//   · 包名 —— 改 app/build.gradle 的 namespace + applicationId
//   · 依赖 —— 列 gradle 依赖 + app/libs 下的 jar，支持增删 gradle 坐标（jar 只读展示）
// 图标只读展示（改图标要走图标编辑器生成 adaptive-icon 文件，不是一行文本能表达的）。

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import { t as tt } from "@/lib/i18n-src";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";
import { DEFAULT_ICON_URL } from "@/lib/xml/default-icon";
import { LIBRARY_CATALOG } from "@/lib/xml/library-catalog";
import type { WsProject } from "@/lib/xml/workspace";
import { readAppName, setAppName } from "@/lib/xml/project-rename";
import { addGradleDep, listGradleDeps, parseGradlePackage, removeGradleDep, setAppConfigField, setGradlePackage, type AppConfigField } from "@/lib/xml/project-info";
import {
  parseSettingsModules,
  parseGradleProperties,
  parseSettingsRepos,
  parseAppConfig,
  parseBuildscriptClasspath,
  mavenCoord,
  type GradleProps,
  type ClasspathDep,
  type GradleRepo,
  type AppConfig,
} from "@/lib/xml/gradle-deps";
import {
  parseRepoScope,
  addRepoUrl,
  removeRepoUrl,
  readGradleProp,
  setGradleProp,
  listGradleProps,
  parseBuildFeatures,
  setBuildFeature,
  type RepoScope,
} from "@/lib/xml/gradle-edit";
import { saveProjectFile, type ProjectSaveRoot } from "@/lib/xml/project-save";
import type { FileOpsCtx } from "@/lib/xml/file-ops";
import { detectPkgState, planPkgRename, unifyPackageTo } from "@/lib/xml/pkg-rename";
import { Overlay } from "@/components/TreeFileMenu";
import { useEditorGuard } from "@/components/useEditorGuard";

export interface ProjectPropsDialogProps {
  item: WsProject;
  source: ProjectSource;
  saveRoot: ProjectSaveRoot | null;
  /** M209：文件操作上下文（native 目录改名用）；web 传 null 则只改文件内容不移动目录 */
  fileOpsCtx?: FileOpsCtx | null;
  iconUrl?: string | null;
  onClose: () => void;
  /** 改目录名（复用现有改名流程，成功后会重命名目录并同步 grader/settings/主题） */
  onRenameProject?: (item: WsProject, dir: string, app: string) => Promise<{ ok: boolean; msg: string }>;
  /** 任何写操作完成后回调（让列表刷新） */
  onSaved: () => void;
  /** M219c：包名同步成功后回传旧/新包名（供父层重映射当前打开文件的路径） */
  onPkgSynced?: (oldPkg: string, newPkg: string) => void;
}

interface GradleFile {
  rel: string;
  text: string;
}

/** M371：Gradle 配置摘要（从 LibsPanel 搬过来的：模块/编译标记/app/构建插件/仓库） */
interface GradleMeta {
  rootName?: string;
  modules: string[];
  props: GradleProps | null;
  app: AppConfig | null;
  classpath: ClasspathDep[];
  repos: GradleRepo[];
}

const STRINGS_REL = "app/src/main/res/values/strings.xml";

export function ProjectPropsDialog(p: ProjectPropsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState("");
  const [appRel, setAppRel] = useState("");
  const [gradle, setGradle] = useState<GradleFile | null>(null);
  const [strings, setStrings] = useState<{ rel: string; text: string } | null>(null);
  const [jars, setJars] = useState<BrowseEntry[]>([]);
  const [gradleMeta, setGradleMeta] = useState<GradleMeta | null>(null);

  const [dir, setDir] = useState(p.item.name);
  const [appName, setAppNameInput] = useState("");
  const [pkg, setPkg] = useState("");
  const [depInput, setDepInput] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [pkgWarn, setPkgWarn] = useState("");

  // M387：Gradle 可编辑表单（SDK/版本）；namespace/applicationId 走已有的 pkg 字段（同步改两个）
  const [gradleForm, setGradleForm] = useState<Record<string, string>>({});
  // M403：按文件折叠分组的可编辑区
  const [propsText, setPropsText] = useState("");
  const [propsKey, setPropsKey] = useState("");
  const [propsVal, setPropsVal] = useState("");
  const [propsOrigin, setPropsOrigin] = useState("");
  //  仓库（区分 buildscript / allprojects 两 scope，可增删；保存时统一写回）
  const [repoUrl, setRepoUrl] = useState("");
  const [repoOps, setRepoOps] = useState<
    { kind: "add" | "remove"; scope: RepoScope; url: string; id?: number }[]
  >([]);
  const repoOpsRef = useRef(0);
  //  加载到的各文件原文（保存仓库操作时的基础）
  const [settingsText, setSettingsText] = useState("");
  const [rootBuildText, setRootBuildText] = useState("");
  const [settingsRel, setSettingsRel] = useState("");
  const [rootBuildRel, setRootBuildRel] = useState("");
  //  app/build.gradle 的 buildFeatures 开关
  const [bf, setBf] = useState<Record<string, boolean>>({});
  const [bfOrigin, setBfOrigin] = useState<Record<string, boolean>>({});
  // M418：折叠区开合状态（默认只展开 app/build.gradle —— 最常改 SDK/版本）
  const [secOpen, setSecOpen] = useState({ props: false, settings: false, rootBuild: false, app: true });
  const secBind = (k: "props" | "settings" | "rootBuild" | "app") => ({
    open: secOpen[k],
    onToggle: (e: SyntheticEvent<HTMLDetailsElement>) => {
      const next = e.currentTarget.open;
      setSecOpen((m) => (m[k] === next ? m : { ...m, [k]: next }));
    },
  });
  const addRepo = (scope: RepoScope) => {
    const u = repoUrl.trim();
    if (!u) return;
    setRepoOps((o) => [...o, { kind: "add", scope, url: u, id: repoOpsRef.current++ }]);
    setRepoUrl("");
  };
  const removeRepo = (scope: RepoScope, id: number, url: string) => {
    setRepoOps((o) => {
      const addIdx = o.findIndex((x) => x.kind === "add" && x.url === url && x.scope === scope);
      if (addIdx >= 0) {
        const c = o.slice();
        c.splice(addIdx, 1);
        return c;
      }
      return [...o, { kind: "remove" as const, scope, url, id }];
    });
  };

  // 原始值（判断哪些字段真改了）
  const [origin, setOrigin] = useState({
    dir: p.item.name,
    appName: "",
    pkg: "",
    gradle: {} as Record<string, string>,
  });

  useEffect(() => {
    let alive = true;
    void (async () => {
      setLoading(true);
      setLoadMsg("");
      try {
        // 找 app 子目录（标准工程 <root>/app/…）；没有就把根当模块
        const root = await p.source.listChildren("").catch(() => []);
        const appDir = root.find((e) => e.kind === "dir" && e.name === "app");
        const base = appDir ? "app" : "";
        if (alive) setAppRel(base);

        const gRel = base ? `${base}/build.gradle` : "build.gradle";
        const gKts = base ? `${base}/build.gradle.kts` : "build.gradle.kts";
        let g: GradleFile | null = null;
        for (const rel of [gRel, gKts]) {
          const t = await p.source.readText(rel).catch(() => null);
          if (t) {
            g = { rel, text: t };
            break;
          }
        }
        // strings.xml 可能在 base/res 或 app/src/main/res
        const sCandidates = [
          base ? `${base}/src/main/res/values/strings.xml` : "src/main/res/values/strings.xml",
          STRINGS_REL,
        ];
        let s: { rel: string; text: string } | null = null;
        for (const rel of sCandidates) {
          const t = await p.source.readText(rel).catch(() => null);
          if (t) {
            s = { rel, text: t };
            break;
          }
        }
        // app/libs 下的 jar
        const libsRel = base ? `${base}/libs` : "libs";
        const libs = await p.source.listChildren(libsRel).catch(() => [] as BrowseEntry[]);

        // M371：Gradle 配置摘要（模块/编译标记/app/构建插件/仓库）—— 从 LibsPanel 搬过来
        const readFirst = async (rels: string[]): Promise<string> => {
          for (const rel of rels) {
            const t = await p.source.readText(rel).catch(() => null);
            if (t) return t;
          }
          return "";
        };
        const settingsText = await readFirst(["settings.gradle", "settings.gradle.kts"]);
        const propsText = await readFirst(["gradle.properties"]);
        // base="app" 时根 build.gradle 是另一份文件；否则 g 就是根
        const rootBuildText = base === "app" ? await readFirst(["build.gradle", "build.gradle.kts"]) : g?.text ?? "";
        // M403：记录命中的 rel（仓库操作写回时按文件定位）
        const readFirstRel = async (rels: string[]): Promise<string> => {
          for (const rel of rels) {
            const t = await p.source.readText(rel).catch(() => null);
            if (t) return rel;
          }
          return "";
        };
        const settingsRelFound = await readFirstRel(["settings.gradle", "settings.gradle.kts"]);
        const rootBuildRelFound = base === "app" ? await readFirstRel(["build.gradle", "build.gradle.kts"]) : g?.rel ?? "";

        if (!alive) return;
        setGradle(g);
        setStrings(s);
        setJars(libs.filter((e) => e.kind === "file" && /\.(jar|aar)$/i.test(e.name)));
        {
          const sm = settingsText ? parseSettingsModules(settingsText) : null;
          const gpParsed = propsText ? parseGradleProperties(propsText) : null;
          const repos = settingsText ? parseSettingsRepos(settingsText) : [];
          const cp = rootBuildText ? parseBuildscriptClasspath(rootBuildText) : [];
          const ac = g ? parseAppConfig(g.text) : null;
          setGradleMeta({
            rootName: sm?.rootProjectName,
            modules: sm?.modules ?? [],
            props: gpParsed,
            app: ac,
            classpath: cp,
            repos,
          });
        }
        // M403：仓库/props/buildFeatures 初值（可编辑折叠区）
        if (alive) {
          setSettingsText(settingsText);
          setRootBuildText(rootBuildText);
          setSettingsRel(settingsRelFound);
          setRootBuildRel(rootBuildRelFound);
          setPropsOrigin(propsText);
          setPropsText(propsText);
          if (g) {
            const bfParsed = parseBuildFeatures(g.text);
            const bfInit: Record<string, boolean> = {};
            for (const k of bfParsed.keys) bfInit[k] = (bfParsed as unknown as Record<string, boolean | undefined>)[k] ?? false;
            setBf(bfInit);
            setBfOrigin(bfInit);
          }
        }
        const gp = g ? parseGradlePackage(g.text) : { namespace: null, applicationId: null };
        const an = s ? readAppName(s.text) || "" : "";
        const pkgVal = gp.applicationId || gp.namespace || "";
        setPkg(pkgVal);
        setAppNameInput(an);
        // M387：可编辑 Gradle 字段的初值 + 原始值（判断脏）
        const ac = g ? parseAppConfig(g.text) : null;
        const form: Record<string, string> = {
          compileSdk: ac?.compileSdk || "",
          minSdk: ac?.minSdk || "",
          targetSdk: ac?.targetSdk || "",
          versionCode: ac?.versionCode || "",
          versionName: ac?.versionName || "",
        };
        setGradleForm(form);
        setOrigin({ dir: p.item.name, appName: an, pkg: pkgVal, gradle: form });
        if (!g && !s) setLoadMsg(tt("没找到 build.gradle / strings.xml，只能改项目名。"));
        // M274：打开时探测全项目包名；M402 重写判定：
        //  ① 目标包自己的子包（target.data/.util）是正常工程结构，不算残留旧包名；
        //  ② 只有「既不是 target、也不是 target 子包」的残留包才提示统一；
        //  ③ manifest/gradle 与 target 不一致也算待同步。
        //  数字与清单一致：{n} = 残留包个数，清单只列残留包（不再混进目标包）。
        if (g && pkgVal) {
          const st = await detectPkgState(p.source, g.text).catch(() => null);
          if (alive && st) {
            const plan = planPkgRename(st, pkgVal);
            const cnt = new Map(st.sourcePkgs.map((x) => [x.pkg, x.count] as const));
            const strayParts = plan.roots
              .slice(0, 4)
              .map((p) => (cnt.get(p) ? `${p}(${cnt.get(p)})` : p))
              .join("、");
            if (plan.roots.length) {
              setPkgWarn(
                tt("检测到 {n} 个残留包名：{l}。保存时会把 {o} 统一到 {t}，子包层次保留（工程共 {m} 个包）。",
                  { n: plan.roots.length, l: strayParts, o: plan.roots.slice(0, 3).join("、"), t: pkgVal, m: st.sourcePkgs.length }),
              );
            } else if (
              (st.manifestPkg && st.manifestPkg !== pkgVal && !st.manifestPkg.startsWith(pkgVal + ".")) ||
              (st.gradlePkg && st.gradlePkg !== pkgVal)
            ) {
              setPkgWarn(
                tt("AndroidManifest / build.gradle 的包名与 {t} 不一致，保存时会同步为 {t}。", { t: pkgVal }),
              );
            } else {
              setPkgWarn("");
            }
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [p.source, p.item.name]);

  const deps = useMemo(() => (gradle ? listGradleDeps(gradle.text) : []), [gradle]);

  // M418：折叠摘要用计数（gradle.properties 有效键值行数）
  const propsCount = useMemo(
    () => propsText.split(/\r?\n/).filter((l) => /^\s*[^#\s][^=]*=\s*\S/.test(l)).length,
    [propsText],
  );

  // 记住打开时的 gradle 原文（判断依赖有没有被增删）
  const originalGradleText = useOriginalText(gradle);

  const dirty =
    dir.trim() !== origin.dir ||
    appName !== origin.appName ||
    pkg !== origin.pkg ||
    (!!gradle && gradle.text !== originalGradleText.current) ||
    Object.keys(gradleForm).some((k) => (gradleForm[k] || "") !== (origin.gradle[k] || "")) ||
    // M403：编译标记 / 仓库 / buildFeatures 的改动也算脏
    (!!propsText && propsText !== propsOrigin) ||
    repoOps.length > 0 ||
    Object.keys(bf).some((k) => bf[k] !== (bfOrigin[k] ?? false));

  // M387：子页面未保存守卫 + 系统返回键（DrawableEditor 同款）
  const guard = useEditorGuard({
    dirty: dirty && !loading,
    onSave: () => void doSave(),
    hint: tt("项目属性"),
    onClose: () => p.onClose(),
  });

  const addDep = () => {
    const raw = depInput.trim();
    if (!raw || !gradle) return;
    // M418：只填库名也能加（okhttp / material / gson → 内置目录补全坐标）
    const c = resolveDepCoord(raw);
    const r = addGradleDep(gradle.text, c);
    if (!r.ok) {
      setMsg(r.msg || tt("添加失败"));
      return;
    }
    setGradle({ ...gradle, text: r.text });
    setDepInput("");
    setMsg(c !== raw ? tt("已补全为 {c}", { c }) : "");
  };

  const delDep = (c: string) => {
    if (!gradle) return;
    const r = removeGradleDep(gradle.text, c);
    if (!r.ok) {
      setMsg(r.msg || tt("删除失败"));
      return;
    }
    setGradle({ ...gradle, text: r.text });
    setMsg("");
  };

  const doSave = async () => {
    if (busy) return;
    setBusy(true);
    setMsg("");
    try {
      let rootRel = p.item.rel;
      // 1) 目录改名（走现有流程，改动面最大，先做）
      if (dir.trim() && dir.trim() !== origin.dir) {
        if (!p.onRenameProject) {
          setMsg(tt("当前环境不支持改项目名。"));
          return;
        }
        const r = await p.onRenameProject(p.item, dir.trim(), appName || origin.appName);
        if (!r.ok) {
          setMsg(r.msg || tt("改名失败"));
          return;
        }
        rootRel = rootRel.replace(/[^/]+$/, dir.trim());
        setOrigin((o) => ({ ...o, dir: dir.trim(), appName }));
      }
      // 2) 应用名
      if (strings && appName !== origin.appName) {
        const next = setAppName(strings.text, appName);
        if (next === strings.text) {
          setMsg(tt("应用名没写进去（strings.xml 里没找到 app_name）。"));
        } else {
          const ok = await saveRel(p, strings.rel, next);
          if (!ok) {
            setMsg(tt("应用名写入失败（可能没有写权限）。"));
            return;
          }
          setStrings({ ...strings, text: next });
        }
      }
      // 3) 包名：gradle 的 namespace/applicationId + 源码 package 声明 + 源码目录
      // M282：修复「改了包名但 build.gradle 没变」——以前第 4 步用 gradle.text（React state
      // 闭包里还是旧值，setGradle 只是排队更新）把旧内容写回磁盘，覆盖了 unify 刚改好的 gradle。
      // 改：用局部变量 gradleTextToSave 记新文本，第 4 步写它。
      let gradleTextToSave: string | null = gradle ? gradle.text : null;
        let pkgDetail: string | null = null; // M289：第 3 步的包名同步详情（非空就展示它，否则展示「已保存」）
      // M402：只要检测到残留包名/manifest与gradle不一致就统一，
      // 不再要求「包名字段被改过」——残留旧包不管你是改没改名，保存时都应清掉（不能漏改）。
      let unifyState: Awaited<ReturnType<typeof detectPkgState>> | null = null;
      let olds: string[] = [];
      if (gradle && pkg) {
        unifyState = await detectPkgState(p.source, gradle.text).catch(() => null);
        const plan = unifyState ? planPkgRename(unifyState, pkg) : null;
        olds = plan
          ? plan.roots
          : pkg !== origin.pkg
            ? [origin.pkg].filter(Boolean)
            : [];
        const manMismatch = !!unifyState?.manifestPkg && unifyState.manifestPkg !== pkg && !unifyState.manifestPkg.startsWith(pkg + ".");
        const gradMismatch = !!unifyState?.gradlePkg && unifyState.gradlePkg !== pkg;
        const needUnify = olds.length > 0 || manMismatch || gradMismatch;
        if (pkg !== origin.pkg) {
          const r = setGradlePackage(gradle.text, pkg);
          if (!r.ok) {
            setMsg(r.msg || tt("包名写入失败"));
            return;
          }
          gradleTextToSave = r.text;
          setGradle({ ...gradle, text: r.text });
        }
        // M274/M402：一次把所有「残留包名」（不止 gradle 那一个）统一到目标包名，
        //  源码 / manifest / gradle / 源码目录全改，ReturnSystem/2/3 共存这种后遗症一并清掉；
        //  目标包自己的子包不进映射，靠根包前缀替换保留层次
        if (p.saveRoot && needUnify) {
          const unify = await unifyPackageTo(
            p.source,
            p.saveRoot,
            p.fileOpsCtx ?? null,
            pkg,
            olds,
            gradle.rel,
          );
          const didSomething =
            unify.files.length > 0 ||
            unify.manifests.length > 0 ||
            unify.gradles.length > 0 ||
            unify.movedDirs.length > 0 ||
            unify.resClassRefs.length > 0 ||
            unify.assetsHints.length > 0;
          if (didSomething) {
            const parts: string[] = [];
            parts.push(tt("{n} 个源码文件", { n: unify.files.length }));
            if (unify.manifests.length) parts.push(tt("{n} 个 AndroidManifest", { n: unify.manifests.length }));
            if (unify.gradles.length) parts.push(tt("{n} 个 build.gradle", { n: unify.gradles.length }));
            if (unify.resClassRefs.length) parts.push(tt("{n} 个 res 类名引用已替换", { n: unify.resClassRefs.length }));
            const mvText = unify.movedDirs.length
              ? tt("{n} 个目录已合并", { n: unify.movedDirs.length })
              : unify.warnings.includes("pkg-move-unsupported")
                ? tt("目录需手动改（本环境不支持自动移动）")
                : "";
            if (mvText) parts.push(mvText);
            let base = tt("包名已统一：{s}", { s: parts.join("，") });
            if (olds.length) {
              base += tt("（旧包名 {l} → {t}，子包层次保留）", { l: olds.slice(0, 4).join("、"), t: pkg });
            }
            if (unify.conflicts.length) {
              base += tt("\n冲突 {n} 处：{l}", { n: unify.conflicts.length, l: unify.conflicts.slice(0, 4).join("、") });
            }
            if (unify.assetsHints.length) {
              base += tt("\n⚠ assets 里 {n} 个文件疑似硬编码旧包名（未自动改，请自查）：{l}",
                { n: unify.assetsHints.length, l: unify.assetsHints.slice(0, 4).join("、") });
            }
            const anc = unify.warnings.find((w) => w.startsWith("pkg-ancestor-skipped:"));
            if (anc) {
              base += tt("\n⚠ {l} 是新包名的父包，未自动改（会套两层后缀），请人工确认", {
                l: anc.slice("pkg-ancestor-skipped:".length),
              });
            }
            const gw = unify.warnings.find((w) => w.startsWith("gradle-"));
            if (gw) {
              base += tt("\n⚠ build.gradle 未同步：{m}（请手动改 namespace/applicationId）", {
                m: gw === "gradle-not-found" ? tt("没找到 build.gradle") : gw.replace(/^gradle-\w+:/, ""),
              });
            }
            // M402：保存后复检，防止漏改（真机读的是写盘后的内容；测试内存源不含新写入）
            try {
              const after = await detectPkgState(p.source, null).catch(() => null);
              const left = after ? planPkgRename(after, pkg).roots : [];
              if (left.length) {
                base += tt("\n⚠ 复检仍有 {n} 个包名未统一：{l}（可能写入失败或目录冲突）", {
                  n: left.length, l: left.slice(0, 4).join("、"),
                });
              }
            } catch { /* 复检失败不影响保存 */ }
            setMsg(base);
          pkgDetail = base;
            for (const o of olds) p.onPkgSynced?.(o, pkg);
          } else {
            setMsg(tt("包名未变（没找到需要同步的旧包名）"));
            p.onPkgSynced?.(origin.pkg, pkg);
          }
        }
      }
      // 3.5) M387：SDK/版本表单字段（compileSdk/minSdk/targetSdk/versionCode/versionName）
      if (gradle && gradleTextToSave !== null) {
        const kts = gradle.rel.endsWith(".kts");
        const fields: AppConfigField[] = ["compileSdk", "minSdk", "targetSdk", "versionCode", "versionName"];
        for (const f of fields) {
          const val = (gradleForm[f] || "").trim();
          if (val === (origin.gradle[f] || "").trim()) continue;
          const r = setAppConfigField(gradleTextToSave, f, val, kts);
          if (!r.ok) {
            setMsg(tt("build.gradle 改 {f} 失败：{m}", { f, m: r.msg || "" }));
            return;
          }
          gradleTextToSave = r.text;
        }
        setGradle({ ...gradle, text: gradleTextToSave });
      }
      // 3.6) M403：buildFeatures 开关（写 app/build.gradle）
      if (gradle && gradleTextToSave !== null) {
        const kts = gradle.rel.endsWith(".kts");
        for (const [k, v] of Object.entries(bf)) {
          if (v === undefined) continue;
          const r = setBuildFeature(gradleTextToSave, k, v, kts);
          if (!r.ok) {
            setMsg(tt("buildFeatures 改 {k} 失败：{m}", { k, m: r.msg || "" }));
            return;
          }
          gradleTextToSave = r.text;
        }
      }
      // 3.7) M403：gradle.properties 编译标记（写 gradle.properties）
      if (propsText && p.saveRoot) {
        // 编辑过的 key=value（propsText 是当前编辑文本，与 propsOrigin 比对）
        const nextProps = propsText;
        if (nextProps !== propsOrigin) {
          const ok = await saveRel(p, "gradle.properties", nextProps);
          if (!ok) {
            setMsg(tt("gradle.properties 写入失败。"));
            return;
          }
        }
      }
      // 3.8) M403：仓库增删（按 scope 写对应文件）
      //  注意：目标文件若是 gradle 自己（base≠app 时根 build.gradle = gradle.rel），
      //  必须改在 gradleTextToSave 上，否则第 4 步会用旧文本覆盖掉仓库改动。
      if (p.saveRoot) {
        for (const op of repoOps) {
          const targetFile =
            op.scope === "settings" ? settingsRel : rootBuildRel;
          if (!targetFile) {
            setMsg(tt("仓库 {s} 找不到对应文件", { s: op.scope }));
            return;
          }
          const sameAsGradle = !!gradle && targetFile === gradle.rel;
          let src: string;
          if (sameAsGradle) {
            src = gradleTextToSave ?? gradle.text;
          } else if (targetFile === settingsRel) {
            src = settingsText || "";
          } else {
            src = rootBuildText || "";
          }
          const kts = targetFile.endsWith(".kts");
          let next = src;
          if (op.kind === "add") {
            const r = addRepoUrl(next, op.scope, op.url!, kts);
            if (!r.ok) {
              setMsg(tt("加仓库失败：{m}", { m: r.msg || "" }));
              return;
            }
            next = r.text;
          } else {
            const r = removeRepoUrl(next, op.scope, op.url!);
            if (!r.ok) {
              setMsg(tt("删仓库失败：{m}", { m: r.msg || "" }));
              return;
            }
            next = r.text;
          }
          if (sameAsGradle) {
            gradleTextToSave = next;
            setGradle({ ...gradle, text: next });
          } else {
            const ok = await saveRel(p, targetFile, next);
            if (!ok) {
              setMsg(tt("{f} 写入失败", { f: targetFile }));
              return;
            }
          }
        }
      }
      // 4) 依赖（gradle 正文已在内存里改过）
      // M282：必须写 gradleTextToSave（含包名新值），不能写闭包里的 gradle.text（旧值）
      if (gradle && gradleTextToSave !== null) {
        const ok = await saveRel(p, gradle.rel, gradleTextToSave);
        if (!ok) {
          setMsg(tt("build.gradle 写入失败（可能没有写权限）。"));
          return;
        }
      }
      setOrigin({ dir: dir.trim() || origin.dir, appName, pkg, gradle: { ...gradleForm } });
      // M403：重置折叠区的脏状态（保存成功后回到「未改动」）
      setPropsOrigin(propsText);
      setBfOrigin({ ...bf });
      setRepoOps([]);
      p.onSaved();
      // 保留第 3 步的包名同步详情（「已保存」会把具体结果冲掉）：
      // 有同步结果就展示它，没有就展示「已保存」
      setMsg(pkgDetail ?? tt("已保存"));
      window.setTimeout(() => p.onClose(), 550);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay>
      <div className="axv-icon-page axv-cv-page" role="dialog" aria-label={tt("项目属性")}>
        <div className="axv-shape-head">
          <button className="axv-icon-back" onClick={guard.close} aria-label={tt("返回")} title={tt("返回")}>
            <span className="msr" aria-hidden="true">arrow_back</span>
          </button>
          <span className="axv-shape-title">{tt("项目属性")}</span>
          <span className="axv-prop-rel" title={p.item.rel}>{p.item.rel}</span>
        </div>
        <div className="axv-prop-body">

          {loading ? <div className="axv-saveas-hint">{tt("正在读取项目信息…")}</div> : null}
          {loadMsg ? <div className="axv-saveas-hint">{loadMsg}</div> : null}

          {!loading ? (
            <>
              {/* 图标 + 基本信息 */}
              <div className="axv-prop-head">
                <img className="axv-prop-icon" src={p.iconUrl || DEFAULT_ICON_URL} alt="" />
                <div className="axv-prop-icon-hint">{tt("应用图标：res/mipmap-anydpi-v26/ic_launcher.xml（在图标编辑器里改）")}</div>
              </div>

              <label className="axv-saveas-field">
                <span>{tt("项目名（目录）")}</span>
                <input
                  className="axv-saveas-input"
                  value={dir}
                  spellCheck={false}
                  onChange={(e) => setDir(e.target.value)}
                />
              </label>

              <label className="axv-saveas-field">
                <span>{tt("应用名 app_name")}</span>
                <input
                  className="axv-saveas-input"
                  value={appName}
                  spellCheck={false}
                  placeholder={tt("没读到 strings.xml")}
                  onChange={(e) => setAppNameInput(e.target.value)}
                />
              </label>

              <label className="axv-saveas-field">
                <span>{tt("包名 applicationId")}</span>
                <input
                  className="axv-saveas-input"
                  value={pkg}
                  spellCheck={false}
                  placeholder="com.example.app"
                  onChange={(e) => setPkg(e.target.value)}
                />
                {pkgWarn ? <div className="axv-saveas-hint axv-pkg-warn">{pkgWarn}</div> : null}
              </label>

              {/* M371 摘要（只读：模块/编译标记/构建插件/仓库）+ M387 表单（可改：SDK/版本） */}
              {gradle ? (
                <>
                  <div className="axv-prop-sec-title">{tt("Gradle 配置")}</div>
                {/* M403：按文件折叠分组（gradle.properties / settings.gradle / build.gradle / app/build.gradle）
                    M418：开合状态受控 + 摘要行显示关键信息（收起也能扫一眼） */}
                <details className="axv-prop-file" {...secBind("props")}>
                  <summary>
                    <span className="axv-prop-file-t">{tt("gradle.properties（编译标记）")}</span>
                    <span className="axv-prop-file-sum">{propsCount > 0 ? tt("{n} 项", { n: propsCount }) : tt("空")}</span>
                  </summary>
                  {propsText ? (
                    <div className="axv-prop-props">
                      <textarea
                        className="axv-saveas-input axv-prop-props-ta"
                        value={propsText}
                        spellCheck={false}
                        rows={Math.min(10, Math.max(3, propsText.split("\n").length))}
                        onChange={(e) => setPropsText(e.target.value)}
                      />
                      <div className="axv-prop-props-add">
                        <input
                          className="axv-saveas-input"
                          value={propsKey}
                          spellCheck={false}
                          placeholder={tt("键，如 android.useAndroidX")}
                          onChange={(e) => setPropsKey(e.target.value)}
                        />
                        <input
                          className="axv-saveas-input"
                          value={propsVal}
                          spellCheck={false}
                          placeholder={tt("值，如 true")}
                          onChange={(e) => setPropsVal(e.target.value)}
                        />
                        <button
                          type="button"
                          className="axv-set-btn"
                          disabled={!propsKey.trim()}
                          onClick={() => {
                            const r = setGradleProp(propsText, propsKey.trim(), propsVal.trim());
                            setPropsText(r.text);
                            setPropsKey("");
                            setPropsVal("");
                          }}
                        >
                          {tt("添加")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="axv-saveas-hint">{tt("没找到 gradle.properties")}</div>
                  )}
                </details>

                <details className="axv-prop-file" {...secBind("settings")}>
                  <summary>
                    <span className="axv-prop-file-t">{tt("settings.gradle（仓库·模块）")}</span>
                    <span className="axv-prop-file-sum">{tt("{n} 个模块", { n: gradleMeta?.modules.length ?? 0 })}</span>
                  </summary>
                  {(gradleMeta?.rootName || (gradleMeta?.modules.length ?? 0) > 0) && (
                    <div className="axv-prop-meta-row">
                      <span className="axv-prop-meta-k">{tt("模块")}</span>
                      <span className="axv-prop-meta-v">
                        {gradleMeta?.rootName ? tt("根工程 {name}", { name: gradleMeta.rootName }) + " " : ""}
                        {gradleMeta?.modules.join(", ") || "—"}
                      </span>
                    </div>
                  )}
                  {/* M418：settings.gradle 里声明的仓库（只读展示；增删在根 build.gradle 面板） */}
                  <div className="axv-prop-meta-row" title={tt("settings.gradle 里声明的仓库（只读）")}>
                    <span className="axv-prop-meta-k">{tt("仓库")}</span>
                    <span className="axv-prop-meta-v" style={{ opacity: 0.7 }}>
                      {(gradleMeta?.repos.length ?? 0) > 0
                        ? (gradleMeta?.repos ?? [])
                            .map((r) => (r.url ? r.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : r.name))
                            .join("、")
                        : tt("无")}
                    </span>
                  </div>
                </details>

                <details className="axv-prop-file" {...secBind("rootBuild")}>
                  <summary>
                    <span className="axv-prop-file-t">{tt("build.gradle（根·仓库）")}</span>
                    <span className="axv-prop-file-sum">
                      {parseRepoScope(rootBuildText, "buildscript").length + parseRepoScope(rootBuildText, "allprojects").length > 0
                        ? tt("{n} 个仓库", { n: parseRepoScope(rootBuildText, "buildscript").length + parseRepoScope(rootBuildText, "allprojects").length })
                        : tt("无")}
                    </span>
                  </summary>
                  {gradleMeta && gradleMeta.classpath.length > 0 && (
                    <div className="axv-prop-meta-row" title={tt("根 build.gradle buildscript（构建期插件，不进运行时）")}>
                      <span className="axv-prop-meta-k">{tt("构建插件")}</span>
                      <span className="axv-prop-meta-v" style={{ opacity: 0.7 }}>
                        {gradleMeta.classpath.map((c) => `${c.name}-${c.version}`).join(", ")}
                      </span>
                    </div>
                  )}
                  {/* M403：仓库按 scope（buildscript / allprojects）分列表，可增删 */}
                  <RepoPanel
                    label={tt("仓库（buildscript）")}
                    items={parseRepoScope(rootBuildText, "buildscript")}
                    scope="buildscript"
                    addUrl={repoUrl}
                    setAddUrl={setRepoUrl}
                    onAddClick={addRepo}
                    onRemove={removeRepo}
                    repoOps={repoOps}
                    tt={tt}
                  />
                  <RepoPanel
                    label={tt("仓库（allprojects）")}
                    items={parseRepoScope(rootBuildText, "allprojects")}
                    scope="allprojects"
                    addUrl={repoUrl}
                    setAddUrl={setRepoUrl}
                    onAddClick={addRepo}
                    onRemove={removeRepo}
                    repoOps={repoOps}
                    tt={tt}
                  />
                </details>

                <details className="axv-prop-file" {...secBind("app")}>
                  <summary>
                    <span className="axv-prop-file-t">{tt("app/build.gradle（SDK·版本·特性）")}</span>
                    <span className="axv-prop-file-sum">
                      {gradleForm.versionName || "—"}{gradleForm.versionCode ? ` (${gradleForm.versionCode})` : ""}
                    </span>
                  </summary>
                  {gradle ? (
                    <div className="axv-prop-form">
                      <div className="axv-prop-form-2col">
                        <label className="axv-saveas-field">
                          <span>compileSdk</span>
                          <input
                            className="axv-saveas-input"
                            value={gradleForm.compileSdk || ""}
                            inputMode="numeric"
                            placeholder={tt("没读到，可填 34")}
                            list="axv-sdk-values"
                            spellCheck={false}
                            onChange={(e) => setGradleForm((m) => ({ ...m, compileSdk: e.target.value }))}
                          />
                        </label>
                        <label className="axv-saveas-field">
                          <span>minSdk</span>
                          <input
                            className="axv-saveas-input"
                            value={gradleForm.minSdk || ""}
                            inputMode="numeric"
                            list="axv-sdk-values"
                            placeholder={tt("没读到，可填 24")}
                            spellCheck={false}
                            onChange={(e) => setGradleForm((m) => ({ ...m, minSdk: e.target.value }))}
                          />
                        </label>
                      </div>
                      <div className="axv-prop-form-2col">
                        <label className="axv-saveas-field">
                          <span>targetSdk</span>
                          <input
                            className="axv-saveas-input"
                            value={gradleForm.targetSdk || ""}
                            inputMode="numeric"
                            list="axv-sdk-values"
                            placeholder={tt("没读到，可填 34")}
                            spellCheck={false}
                            onChange={(e) => setGradleForm((m) => ({ ...m, targetSdk: e.target.value }))}
                          />
                        </label>
                        <label className="axv-saveas-field">
                          <span>versionCode</span>
                          <input
                            className="axv-saveas-input"
                            value={gradleForm.versionCode || ""}
                            inputMode="numeric"
                            placeholder={tt("没读到，请手动加")}
                            spellCheck={false}
                            onChange={(e) => setGradleForm((m) => ({ ...m, versionCode: e.target.value }))}
                          />
                        </label>
                      </div>
                      <label className="axv-saveas-field">
                        <span>versionName</span>
                        <input
                          className="axv-saveas-input"
                          value={gradleForm.versionName || ""}
                          placeholder={tt("没读到，请手动加")}
                          spellCheck={false}
                          onChange={(e) => setGradleForm((m) => ({ ...m, versionName: e.target.value }))}
                        />
                      </label>
                      {/* M403：buildFeatures 开关 */}
                      <div className="axv-prop-form">
                        <span className="axv-prop-meta-k">{tt("buildFeatures")}</span>
                        <div className="axv-prop-bf">
                          {(parseBuildFeatures(gradle.text).keys.length
                            ? parseBuildFeatures(gradle.text).keys
                            : ["buildConfig", "viewBinding", "compose"]
                          ).map((k) => (
                            <label key={k} className="axv-prop-bf-item">
                              <input
                                type="checkbox"
                                checked={bf[k] === true}
                                onChange={(e) => setBf((m) => ({ ...m, [k]: e.target.checked }))}
                              />
                              <span>{k}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="axv-saveas-hint">{tt("没找到 app/build.gradle")}</div>
                  )}
                </details>
                </>
              ) : null}
              {/* 依赖列表 */}
              <div className="axv-prop-sec-title">{tt("依赖库（{n}）", { n: deps.length + jars.length })}</div>
              <div className="axv-prop-deps">
                {deps.length === 0 && jars.length === 0 ? (
                  <div className="axv-saveas-hint">{tt("还没有额外依赖")}</div>
                ) : null}
                {deps.map((d) => (
                  <div className="axv-prop-dep" key={d}>
                    <span className="axv-prop-dep-name" title={d}>{d}</span>
                    <button
                      type="button"
                      className="axv-ws-mini"
                      title={tt("删除这条依赖")}
                      aria-label={tt("删除这条依赖")}
                      onClick={() => delDep(d)}
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>delete</span>
                    </button>
                  </div>
                ))}
                {jars.length > 0 && deps.length > 0 ? (
                  <div className="axv-prop-dep-sep">{tt("libs 目录（只读）")}</div>
                ) : null}
                {jars.map((j) => (
                  <div className="axv-prop-dep" key={j.rel}>
                    <span className="axv-prop-dep-name" title={j.rel}>{j.name}</span>
                    <span className="axv-prop-dep-tag">{/\.aar$/i.test(j.name) ? "aar" : "jar"}</span>
                  </div>
                ))}
              </div>

              <div className="axv-prop-add">
                <input
                  className="axv-saveas-input"
                  value={depInput}
                  spellCheck={false}
                  placeholder={tt("库名或坐标，如 okhttp / com.x:y:1.0")}
                  onChange={(e) => setDepInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addDep();
                  }}
                />
                <button className="axv-set-btn" type="button" onClick={addDep}>
                  {tt("添加")}
                </button>
              </div>

              {msg ? <div className="axv-saveas-hint">{msg}</div> : null}

              {/* M418：SDK 输入建议值 */}
              <datalist id="axv-sdk-values">
                {[21, 23, 24, 26, 28, 29, 30, 31, 32, 33, 34, 35].map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>

              <div className="axv-saveas-btns">
                <button className="axv-set-btn" disabled={busy} onClick={guard.close}>
                  {tt("取消")}
                </button>
                <button className="axv-set-btn axv-saveas-ok" disabled={busy || !dirty} onClick={() => void doSave()}>
                  {busy ? tt("保存中…") : tt("保存")}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
      {guard.dialog}
    </Overlay>
  );
}

/** 记住首次拿到的 gradle 正文（用于判断依赖是否被改过） */
function useOriginalText(g: GradleFile | null): { current: string } {
  const [ref] = useState<{ current: string }>({ current: "" });
  useEffect(() => {
    if (g && !ref.current) ref.current = g.text;
  }, [g, ref]);
  return ref;
}

/** base="app" 时，source 里的 rel 已经是相对项目根的，写回也按项目根算 */
async function saveRel(p: ProjectPropsDialogProps, rel: string, text: string): Promise<boolean> {
  if (!p.saveRoot) return false;
  return saveProjectFile(p.saveRoot, rel, text);
}

/** M418：依赖输入简写补全——填库名（okhttp / material / gson…）时按内置目录补成完整坐标；
 *  已含冒号（group:artifact[:version]）就原样返回，交给 addGradleDep 校验。 */
function resolveDepCoord(input: string): string {
  const s = input.trim();
  if (s.includes(":")) return s;
  const key = s.toLowerCase().replace(/\s+/g, "");
  if (!key) return s;
  const exact = LIBRARY_CATALOG.find((e) => e.artifact.toLowerCase() === key);
  if (exact) return mavenCoord(exact.group, exact.artifact, exact.version);
  // 前缀匹配（okh → okhttp）；多个候选时不自作主张，交给校验报错
  const cand = LIBRARY_CATALOG.filter((e) => e.artifact.toLowerCase().startsWith(key));
  if (cand.length === 1) return mavenCoord(cand[0].group, cand[0].artifact, cand[0].version);
  return s;
}

/** M403：单个 scope（buildscript / allprojects）的仓库列表 + 增删 */
function RepoPanel(props: {
  label: string;
  items: import("@/lib/xml/gradle-edit").RepoEntry[];
  scope: import("@/lib/xml/gradle-edit").RepoScope;
  addUrl: string;
  setAddUrl: (s: string) => void;
  onAddClick: (scope: import("@/lib/xml/gradle-edit").RepoScope) => void;
  onRemove: (scope: import("@/lib/xml/gradle-edit").RepoScope, id: number, url: string) => void;
  repoOps: { kind: "add" | "remove"; scope: import("@/lib/xml/gradle-edit").RepoScope; url: string; id?: number }[];
  tt: (s: string, p?: Record<string, string | number>) => string;
}) {
  const { label, items, scope, addUrl, setAddUrl, onAddClick, onRemove, repoOps, tt } = props;
  // 本 scope 待加的 url（还没保存的）
  const pendingAdd = repoOps.filter((o) => o.kind === "add" && o.scope === scope).map((o) => o.url);
  const pendingRemove = new Set(repoOps.filter((o) => o.kind === "remove" && o.scope === scope).map((o) => o.url));
  const all = [...items, ...pendingAdd.map((u) => ({ name: "maven", url: u, raw: u, scope } as import("@/lib/xml/gradle-edit").RepoEntry))];
  return (
    <div className="axv-prop-repo">
      <div className="axv-prop-meta-row">
        <span className="axv-prop-meta-k">{label}</span>
      </div>
      {all.length === 0 && <div className="axv-saveas-hint">{tt("无")}</div>}
      {all.map((r, i) => {
        const ident = r.url || r.name;
        const removed = pendingRemove.has(ident);
        const pending = pendingAdd.includes(ident) && !r.raw;
        return (
          <div key={`${ident}-${i}`} className="axv-prop-repo-item" style={{ opacity: removed ? 0.4 : 1, textDecoration: removed ? "line-through" : "none" }}>
            <span className="axv-prop-repo-name" title={r.url || r.name}>
              {r.url ? r.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : r.name}
            </span>
            {pending ? <span className="axv-prop-repo-tag">{tt("待加")}</span> : null}
            <button
              type="button"
              className="axv-ws-mini"
              title={tt("删除这条仓库")}
              aria-label={tt("删除这条仓库")}
              onClick={() => onRemove(scope, i, ident)}
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 14 }}>delete</span>
            </button>
          </div>
        );
      })}
      <div className="axv-prop-repo-add">
        <input
          className="axv-saveas-input"
          value={addUrl}
          spellCheck={false}
          placeholder={tt("仓库 URL，如 https://maven.aliyun.com/repository/public")}
          onChange={(e) => setAddUrl(e.target.value)}
        />
        <button
          type="button"
          className="axv-set-btn"
          disabled={!addUrl.trim()}
          onClick={() => onAddClick(scope)}
        >
          {tt("加到 {s}", { s: scope })}
        </button>
      </div>
    </div>
  );
}
