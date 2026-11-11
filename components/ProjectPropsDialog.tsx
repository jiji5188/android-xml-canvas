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
import { syncPkgInSource } from "@/lib/xml/pkg-sync";
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
      if (gradle && pkg && pkg !== origin.pkg) {
        const r = setGradlePackage(gradle.text, pkg);
        if (!r.ok) {
          setMsg(r.msg || tt("包名写入失败"));
          return;
        }
        setGradle({ ...gradle, text: r.text });
        // M209：同步 .java/.kt 的 package 声明 + 按包名建的源码目录
        if (p.saveRoot) {
          const sync = await syncPkgInSource(p.source, origin.pkg, pkg, p.saveRoot, p.fileOpsCtx ?? null);
          if (sync.files.length > 0 || sync.moved || sync.manifests.length > 0) {
            const mv = sync.moved
              ? tt("目录已移动")
              : sync.moveWarn === "pkg-move-unsupported"
                ? tt("需手动改目录名")
                : sync.moveWarn === "pkg-nested-rename"
                  ? tt("包名是嵌套关系（如 com.a → com.a.b），内容已改，目录层次请手动调整")
                  : tt("未能自动移动目录（{r}）", { r: sync.moveWarn || "" });
            setMsg(
              sync.manifests.length > 0
                ? tt("包名已同步：{n} 个源码文件 + {m} 个 AndroidManifest，{mv}", {
                    n: sync.files.length,
                    m: sync.manifests.length,
                    mv,
                  })
                : tt("包名已同步：{n} 个源码文件，{mv}", { n: sync.files.length, mv }),
            );
            // M219c：回传旧/新包名，让父层把“当前打开文件”的路径重映射到新目录。
            p.onPkgSynced?.(origin.pkg, pkg);
          }
        }
      }
      // 4) 依赖（gradle 正文已在内存里改过）
      if (gradle) {
        const ok = await saveRel(p, gradle.rel, gradle.text);
        if (!ok) {
          setMsg(tt("build.gradle 写入失败（可能没有写权限）。"));
          return;
        }
      }
      setOrigin({ dir: dir.trim() || origin.dir, appName, pkg });
      p.onSaved();
      // 保留第 3 步的包名同步详情（「已保存」会把具体结果冲掉）：
      // 有同步结果就展示它，没有就展示「已保存」
      setMsg(msg.startsWith("包名已同步") ? msg : tt("已保存"));
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
