// components/ProjectPropsDialog.tsx — M181：项目属性弹窗（项目列表长按 → 属性）
//
// 只做「能安全改」的四件事：
//   · 项目名（目录）—— 复用调用方的改名流程（会同步 gradle/settings/主题名）
//   · 应用名 app_name —— 改 res/values/strings.xml
//   · 包名 —— 改 app/build.gradle 的 namespace + applicationId
//   · 依赖 —— 列 gradle 依赖 + app/libs 下的 jar，支持增删 gradle 坐标（jar 只读展示）
// 图标只读展示（改图标要走图标编辑器生成 adaptive-icon 文件，不是一行文本能表达的）。

import { useEffect, useMemo, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";
import { DEFAULT_ICON_URL } from "@/lib/xml/default-icon";
import type { WsProject } from "@/lib/xml/workspace";
import { readAppName, setAppName } from "@/lib/xml/project-rename";
import { addGradleDep, listGradleDeps, parseGradlePackage, removeGradleDep, setGradlePackage } from "@/lib/xml/project-info";
import { saveProjectFile, type ProjectSaveRoot } from "@/lib/xml/project-save";
import type { FileOpsCtx } from "@/lib/xml/file-ops";
import { detectPkgState, suggestOldPkgs, unifyPackageTo } from "@/lib/xml/pkg-rename";
import { Overlay } from "@/components/TreeFileMenu";

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

const STRINGS_REL = "app/src/main/res/values/strings.xml";

export function ProjectPropsDialog(p: ProjectPropsDialogProps) {
  const [loading, setLoading] = useState(true);
  const [loadMsg, setLoadMsg] = useState("");
  const [appRel, setAppRel] = useState("");
  const [gradle, setGradle] = useState<GradleFile | null>(null);
  const [strings, setStrings] = useState<{ rel: string; text: string } | null>(null);
  const [jars, setJars] = useState<BrowseEntry[]>([]);

  const [dir, setDir] = useState(p.item.name);
  const [appName, setAppNameInput] = useState("");
  const [pkg, setPkg] = useState("");
  const [depInput, setDepInput] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [pkgWarn, setPkgWarn] = useState("");


  // 原始值（判断哪些字段真改了）
  const [origin, setOrigin] = useState({ dir: p.item.name, appName: "", pkg: "" });

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

        if (!alive) return;
        setGradle(g);
        setStrings(s);
        setJars(libs.filter((e) => e.kind === "file" && /\.(jar|aar)$/i.test(e.name)));
        const gp = g ? parseGradlePackage(g.text) : { namespace: null, applicationId: null };
        const an = s ? readAppName(s.text) || "" : "";
        const pkgVal = gp.applicationId || gp.namespace || "";
        setPkg(pkgVal);
        setAppNameInput(an);
        setOrigin({ dir: p.item.name, appName: an, pkg: pkgVal });
        if (!g && !s) setLoadMsg(tt("没找到 build.gradle / strings.xml，只能改项目名。"));
        // M274：打开时探测全项目包名，若有残留多个包名就给提示（保存时会自动统一）
        if (g) {
          const st = await detectPkgState(p.source, g.text).catch(() => null);
          if (alive && st && !st.consistent) {
            const olds = suggestOldPkgs(st, pkgVal);
            const parts = st.sourcePkgs.slice(0, 4).map((x) => `${x.pkg}(${x.count})`).join("、");
            setPkgWarn(
              tt("检测到 {n} 个不同包名：{l}。保存时会把 {o} 全部统一为新包名。",
                { n: olds.length, l: parts, o: olds.slice(0, 3).join("、") }),
            );
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

  // 记住打开时的 gradle 原文（判断依赖有没有被增删）
  const originalGradleText = useOriginalText(gradle);

  const dirty =
    dir.trim() !== origin.dir ||
    appName !== origin.appName ||
    pkg !== origin.pkg ||
    (!!gradle && gradle.text !== originalGradleText.current);

  const addDep = () => {
    const c = depInput.trim();
    if (!c || !gradle) return;
    const r = addGradleDep(gradle.text, c);
    if (!r.ok) {
      setMsg(r.msg || tt("添加失败"));
      return;
    }
    setGradle({ ...gradle, text: r.text });
    setDepInput("");
    setMsg("");
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
      if (gradle && pkg && pkg !== origin.pkg) {
        const r = setGradlePackage(gradle.text, pkg);
        if (!r.ok) {
          setMsg(r.msg || tt("包名写入失败"));
          return;
        }
        gradleTextToSave = r.text;
        setGradle({ ...gradle, text: r.text });
        // M274：一次把所有「残留包名」（不止 gradle 那一个）统一到新包名，
        //  源码 / manifest / gradle / 源码目录全改，ReturnSystem/2/3 共存这种后遗症一并清掉
        if (p.saveRoot) {
          const state = await detectPkgState(p.source, gradle.text).catch(() => null);
          const olds = state ? suggestOldPkgs(state, pkg) : [origin.pkg].filter(Boolean);
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
            if (state && !state.consistent) {
              base += tt("（检测到 {n} 个旧包名 {l}", { n: olds.length, l: olds.join("、") }) + "）";
            }
            if (unify.conflicts.length) {
              base += tt("\n冲突 {n} 处：{l}", { n: unify.conflicts.length, l: unify.conflicts.slice(0, 4).join("、") });
            }
            if (unify.assetsHints.length) {
              base += tt("\n⚠ assets 里 {n} 个文件疑似硬编码旧包名（未自动改，请自查）：{l}",
                { n: unify.assetsHints.length, l: unify.assetsHints.slice(0, 4).join("、") });
            }
            const gw = unify.warnings.find((w) => w.startsWith("gradle-"));
            if (gw) {
              base += tt("\n⚠ build.gradle 未同步：{m}（请手动改 namespace/applicationId）", {
                m: gw === "gradle-not-found" ? tt("没找到 build.gradle") : gw.replace(/^gradle-\w+:/, ""),
              });
            }
            setMsg(base);
          pkgDetail = base;
            for (const o of olds) p.onPkgSynced?.(o, pkg);
          } else {
            setMsg(tt("包名未变（没找到需要同步的旧包名）"));
            p.onPkgSynced?.(origin.pkg, pkg);
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
      setOrigin({ dir: dir.trim() || origin.dir, appName, pkg });
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
      <div className="axv-saveas-mask" role="dialog" aria-modal="true" onClick={(e) => e.target === e.currentTarget && !busy && p.onClose()}>
        <div className="axv-saveas-card axv-prop-card">
          <div className="axv-saveas-title">{tt("项目属性")}</div>
          <div className="axv-saveas-hint">{p.item.rel}</div>

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
                {jars.map((j) => (
                  <div className="axv-prop-dep" key={j.rel}>
                    <span className="axv-prop-dep-name" title={j.rel}>{j.name}</span>
                    <span className="axv-prop-dep-tag">{tt("jar（只读）")}</span>
                  </div>
                ))}
              </div>

              <div className="axv-prop-add">
                <input
                  className="axv-saveas-input"
                  value={depInput}
                  spellCheck={false}
                  placeholder="com.squareup.okhttp3:okhttp:4.12.0"
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

              <div className="axv-saveas-btns">
                <button className="axv-set-btn" disabled={busy} onClick={() => p.onClose()}>
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
