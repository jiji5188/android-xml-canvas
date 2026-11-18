// lib/xml/pkg-rename.ts — M274：把「多个残留包名」一次性统一到目标包名
//
// 背景（用户报）：项目属性里改包名后，工程里出现 ReturnSystem / ReturnSystem2 /
// ReturnSystem3 三个包共存——因为老版同步只用「gradle 里读到的那个包名」做替换，
// 一旦之前某次改名没改全（或用户手改了一半），残留的旧包名就永远不会被换掉。
//
// 本模块做两件事：
//   1. detectPkgState() —— 扫描全项目，列出所有真实存在的包名（源码 package 声明 +
//      manifest package + gradle namespace/applicationId）以及各自文件数。
//   2. unifyPackageTo() —— 把一组旧包名一次性替换成目标包名：
//      · 所有 .java/.kt/.xml 内容里的点分 token（package 声明 / import / 全限定引用 / 字符串）
//      · AndroidManifest 的 package 与各属性值
//      · build.gradle 的 namespace / applicationId
//      · 源码目录合并（旧包目录内容搬进新包目录，保留子包层次，同名目录递归合并）
// 替换采用「最长优先 + 词边界」正则，ReturnSystem2 不会被 ReturnSystem 误伤。

import type { ProjectSource } from "./project-browse";
import { isJavaSrcName } from "./project-browse";
import { saveProjectFile, type ProjectSaveRoot } from "./project-save";
import { createEntry, deleteEntry, moveEntry, listNames, type FileOpsCtx } from "./file-ops";
import { discoverSrcRoots, listAllTextFiles, rewriteManifestPkg } from "./pkg-sync";
import { setGradlePackage } from "./project-info";

export interface PkgCount {
  pkg: string;
  count: number;
}

export interface PkgState {
  /** 源码里真实声明的包（按文件数降序） */
  sourcePkgs: PkgCount[];
  /** AndroidManifest 的 package 属性 */
  manifestPkg: string | null;
  /** build.gradle 的 applicationId / namespace */
  gradlePkg: string | null;
  /** 全部去重后的包名（源码 + manifest + gradle） */
  all: string[];
  /** 文件数最多的源码包（没有任何源码时为 null） */
  dominant: string | null;
  /** 只有一个包名 = 一致 */
  consistent: boolean;
}

const GRADLE_CANDIDATES = ["app/build.gradle", "app/build.gradle.kts", "build.gradle", "build.gradle.kts"];

/** 抠出第一行 package 声明（Java/Kotlin 通用） */
export function extractPackageDecl(text: string): string | null {
  const m = /^[ \t]*package\s+([A-Za-z_][\w.]*)\s*;?/m.exec(text || "");
  return m ? m[1] : null;
}

/** 去掉重复的 import 行（改名后两个旧包可能并成同一个 import） */
export function dedupeImports(text: string): string {
  const lines = text.split("\n");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const t = l.trim();
    if (/^import\s+[\w.*]+\s*;\s*$/.test(t)) {
      if (seen.has(t)) continue;
      seen.add(t);
    }
    out.push(l);
  }
  return out.join("\n");
}

function escRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 按映射把文本里的旧包名 token 全换成新包名。
 * 边界：前不能是 [A-Za-z0-9_.]，后不能是 [A-Za-z0-9_]（点号允许，留给 .Foo / .R）。
 * 多个旧包名时按长度降序，避免短名吃掉长名前缀。
 */
export function rewritePkgMap(text: string, map: Record<string, string>): { text: string; changed: boolean } {
  if (!text) return { text, changed: false };
  const olds = Object.keys(map)
    .filter((k) => k && map[k] && k !== map[k])
    .sort((a, b) => b.length - a.length);
  if (!olds.length) return { text, changed: false };
  const re = new RegExp("(?<![A-Za-z0-9_.])(" + olds.map(escRe).join("|") + ")(?![A-Za-z0-9_])", "g");
  let hit = false;
  const replaced = text.replace(re, (m) => {
    const to = map[m];
    if (to === undefined) return m;
    hit = true;
    return to;
  });
  if (!hit) return { text, changed: false };
  const out = dedupeImports(replaced);
  return out === text ? { text, changed: false } : { text: out, changed: true };
}

/** 可能含 package 的清单文件 */
async function findManifestFiles(source: ProjectSource): Promise<string[]> {
  const found: string[] = [];
  const cands = ["AndroidManifest.xml", "app/AndroidManifest.xml"];
  try {
    const kids = await source.listChildren("app/src").catch(() => []);
    if (Array.isArray(kids)) {
      for (const e of kids) {
        if (e.kind === "dir") cands.push(`app/src/${e.name}/AndroidManifest.xml`);
      }
    }
  } catch {
    /* ignore */
  }
  for (const rel of cands) {
    const t = await source.readText(rel).catch(() => null);
    if (t && /<manifest[\s>]/.test(t)) found.push(rel);
  }
  return found;
}

/**
 * 扫描项目当前包名状态。gradleRel/gradleText 可由调用方传入（弹窗里已经读过），
 * 不传则内部自己找 build.gradle。
 */
export async function detectPkgState(
  source: ProjectSource,
  gradleText?: string | null,
): Promise<PkgState> {
  const counts = new Map<string, number>();
  const srcRoots = await discoverSrcRoots(source);
  const seen = new Set<string>();
  for (const root of srcRoots) {
    const files = await listAllTextFiles(source, root);
    for (const rel of files) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (!isJavaSrcName(rel)) continue;
      const text = await source.readText(rel).catch(() => null);
      if (!text) continue;
      const p = extractPackageDecl(text);
      if (p) counts.set(p, (counts.get(p) || 0) + 1);
    }
  }
  const sourcePkgs: PkgCount[] = [...counts.entries()]
    .map(([pkg, count]) => ({ pkg, count }))
    .sort((a, b) => b.count - a.count || a.pkg.localeCompare(b.pkg));

  // manifest
  let manifestPkg: string | null = null;
  for (const rel of await findManifestFiles(source)) {
    const t = await source.readText(rel).catch(() => null);
    if (!t) continue;
    const m = /<manifest[^>]*\spackage\s*=\s*"([^"]+)"/.exec(t);
    if (m) {
      manifestPkg = m[1];
      break;
    }
  }

  // gradle
  let gradlePkg: string | null = null;
  let gText = gradleText ?? null;
  if (!gText) {
    for (const rel of GRADLE_CANDIDATES) {
      const t = await source.readText(rel).catch(() => null);
      if (t) {
        gText = t;
        break;
      }
    }
  }
  if (gText) {
    const app = /applicationId\s*=?\s*["']([^"']+)["']/.exec(gText);
    const ns = /namespace\s*=?\s*["']([^"']+)["']/.exec(gText);
    gradlePkg = (app && app[1]) || (ns && ns[1]) || null;
  }

  const allSet = new Set<string>();
  for (const s of sourcePkgs) allSet.add(s.pkg);
  if (manifestPkg) allSet.add(manifestPkg);
  if (gradlePkg) allSet.add(gradlePkg);
  const all = [...allSet].sort();

  return {
    sourcePkgs,
    manifestPkg,
    gradlePkg,
    all,
    dominant: sourcePkgs.length ? sourcePkgs[0].pkg : null,
    consistent: all.length <= 1,
  };
}

/** 建议改名的旧包名：所有不是 target 的（调用方通常让用户勾选）
 *  只留「最小集」：若某个包已被另一个待改包的父包覆盖（com.a.b 与 com.a），
 *  只留父包——前缀替换后子包层次自然保留（com.a.b → new.b），
 *  否则两个都改会把 com.a.b 拍平成 new，子包结构全丢。 */
export function suggestOldPkgs(state: PkgState, target: string): string[] {
  return planPkgRename(state, target).roots;
}

/** M402：改名计划（把「要改哪些包」的判定集中到一处，弹窗与 unify 共用）
 *
 *  规则：
 *   1. 目标包自己的子包（target.data）**不是**旧包名——它们本来就对，前缀替换根包时
 *      会自动变成 new.data，层次保留。若把它们列进来，反而会被拍平成 new。
 *   2. 目标包的祖先包（target = com.a.b.c，而 com.a.b 存在）无法安全前缀替换
 *      （com.a.b → com.a.b.c 会把 com.a.b.c 自身变成 com.a.b.c.c），只告警让人工确认。
 *   3. 剩下的候选折叠成「最上层根包」，靠前缀替换覆盖全部子包。
 */
export interface PkgRenamePlan {
  /** 需要前缀替换的根包（子包层次自动保留） */
  roots: string[];
  /** 目标包的祖先包（不会自动改，需人工确认） */
  ancestors: string[];
}

export function planPkgRename(state: PkgState, target: string): PkgRenamePlan {
  const tgt = (target || "").trim();
  if (!tgt) return { roots: [], ancestors: [] };
  const all = Array.from(new Set(state.all.filter(Boolean)));
  const ancestors = all.filter((p) => p !== tgt && tgt.startsWith(p + "."));
  const cands = all.filter(
    (p) => p !== tgt && !p.startsWith(tgt + ".") && !ancestors.includes(p),
  );
  const roots = cands.filter((p) => !cands.some((q) => q !== p && p.startsWith(q + ".")));
  return { roots, ancestors };
}

export interface UnifyResult {
  ok: boolean;
  /** 内容被改写的文件（相对项目根） */
  files: string[];
  /** 改写过的 manifest */
  manifests: string[];
  /** 改写过的 gradle 文件 */
  gradles: string[];
  /** 移动/合并过的旧包目录 */
  movedDirs: string[];
  /** 目标已存在同名文件而没敢覆盖的 */
  conflicts: string[];
  /** 非致命告警（web 不支持移动目录等） */
  warnings: string[];
  /** M280：res/xml 里替换过的自定义 View/Fragment 全限定类名引用（文件列表） */
  resClassRefs: string[];
  /** M280：assets 等文本里发现旧包名硬编码的文件（仅提示，不自动改——避免误伤字符串字面量） */
  assetsHints: string[];
}

/** 递归建目录（rel 相对项目根，逐段 createEntry；已存在则忽略失败） */
async function ensureDir(ctx: FileOpsCtx, rel: string): Promise<boolean> {
  const parts = rel.split("/").filter(Boolean);
  let cur = "";
  for (const name of parts) {
    const r = await createEntry(ctx, { parentRel: cur, name, isDir: true });
    if (!r.ok && !/已存在|exists/i.test(r.reason || "")) {
      // 再探一次：可能本就存在但 bridge 报错
      const probe = await listNamesSafe(ctx, cur);
      if (!probe.includes(name)) return false;
    }
    cur = cur ? `${cur}/${name}` : name;
  }
  return true;
}

async function listNamesSafe(ctx: FileOpsCtx, rel: string): Promise<string[]> {
  try {
    return await listNames(ctx, rel);
  } catch {
    return [];
  }
}

/**
 * 把 srcRel 目录下的内容搬进 dstDirRel（保留子目录层次；同名目录递归合并；
 * 同名文件冲突则改名为 name_dup.ext 并记录）。
 * skipFirstChild：嵌套改名时跳过通往目标目录的那一枝。
 */
async function moveTreeInto(
  ctx: FileOpsCtx,
  source: ProjectSource,
  srcRel: string,
  dstDirRel: string,
  res: UnifyResult,
  skipNames: Set<string>,
): Promise<void> {
  const kids = await source.listChildren(srcRel).catch(() => []);
  for (const e of kids) {
    if (skipNames.has(e.name)) continue;
    const childRel = `${srcRel}/${e.name}`;
    if (e.kind === "dir") {
      const sub = `${dstDirRel}/${e.name}`;
      // 目标同名目录 → 递归合并；不存在 → 直接整目录搬
      const dstHas = await listNamesSafe(ctx, dstDirRel);
      if (dstHas.includes(e.name)) {
        const okDir = await ensureDir(ctx, sub);
        if (!okDir) {
          res.conflicts.push(sub);
          continue;
        }
        await moveTreeInto(ctx, source, childRel, sub, res, new Set());
        await deleteEntry(ctx, childRel, true).catch(() => undefined);
      } else {
        const okDir = await ensureDir(ctx, dstDirRel);
        if (!okDir) {
          res.conflicts.push(dstDirRel);
          continue;
        }
        const mv = await moveEntry(ctx, childRel, dstDirRel, e.name);
        if (!mv.ok) res.conflicts.push(`${dstDirRel}/${e.name}`);
      }
    } else {
      const dstHas = await listNamesSafe(ctx, dstDirRel);
      let asName = e.name;
      if (dstHas.includes(e.name)) {
        const dot = e.name.lastIndexOf(".");
        asName = dot > 0 ? `${e.name.slice(0, dot)}_dup${e.name.slice(dot)}` : `${e.name}_dup`;
        res.conflicts.push(`${dstDirRel}/${asName}`);
      }
      const okDir = await ensureDir(ctx, dstDirRel);
      if (!okDir) {
        res.conflicts.push(dstDirRel);
        continue;
      }
      const mv = await moveEntry(ctx, childRel, dstDirRel, asName);
      if (!mv.ok) res.conflicts.push(`${dstDirRel}/${asName}`);
    }
  }
}

/** M280：列 assets（或任意目录）下的文本文件，用于硬编码包名扫描。限深度+数量防卡。 */
async function listAssetsTextFiles(source: ProjectSource, root: string): Promise<string[]> {
  const out: string[] = [];
  const re = /\.(json|js|ts|xml|properties|conf|txt|ini|yaml|yml|gradle)$/i;
  let depth = 0;
  const walk = async (rel: string): Promise<void> => {
    depth++;
    if (depth > 12 || out.length > 500) return;
    const kids = await listEntriesSafe(source, rel);
    for (const e of kids) {
      const full = rel ? `${rel}/${e.name}` : e.name;
      if (e.kind === "dir") await walk(full);
      else if (re.test(e.name)) out.push(full);
    }
    depth--;
  };
  await walk(root);
  return out;
}

async function listEntriesSafe(source: ProjectSource, rel: string) {
  try {
    const r = await source.listChildren(rel);
    return Array.isArray(r) ? r : [];
  } catch {
    return [];
  }
}

/** M280：列项目里所有 res 目录（多模块 app/src/<v>/res + 单模块 src/<v>/res） */
async function discoverResDirs(source: ProjectSource): Promise<string[]> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const base of ["app/src", "src"]) {
    let variants: string[] = [];
    try {
      const kids = await source.listChildren(base).catch(() => []);
      if (Array.isArray(kids)) variants = kids.filter((e) => e.kind === "dir").map((e) => e.name);
    } catch { /* 跳过 */ }
    for (const v of variants) {
      const rel = `${base}/${v}/res`;
      const probe = await listEntriesSafe(source, rel);
      if (probe.length && !seen.has(rel)) { seen.add(rel); out.push(rel); }
    }
  }
  return out;
}

/**
 * 把 olds 里的包名全部统一成 target。
 * 执行顺序：内容替换 → manifest → gradle → 目录合并（避免目录搬完找不到文件）。
 */
export async function unifyPackageTo(
  source: ProjectSource,
  saveRoot: ProjectSaveRoot | null,
  fileOpsCtx: FileOpsCtx | null,
  target: string,
  olds: string[],
  gradleRel?: string | null,
): Promise<UnifyResult> {
  const res: UnifyResult = {
    ok: true,
    files: [],
    manifests: [],
    gradles: [],
    movedDirs: [],
    conflicts: [],
    warnings: [],
    resClassRefs: [],
    assetsHints: [],
  };
  const tgt = (target || "").trim();
  if (!tgt) {
    res.ok = false;
    res.warnings.push("pkg-empty");
    return res;
  }
  const map: Record<string, string> = {};
  const raw = Array.from(new Set(olds.map((o) => (o || "").trim()))).filter((p) => p && p !== tgt);
  // M402 三重守卫（都是为了防止「统一成一棵拍平的树 / 套两层」）：
  //  ① 目标包的子包 → 不能用「包名 → 目标」的整串替换，否则 Com.a.data 变 Com.a（层次丢失）；
  //     它们应靠根包前缀替换自然得到 target.data。
  //  ② 目标包的祖先包 → 前缀替换会把 target 自身再套一层（target.xxx → target.xxx.xxx），不自动改。
  //  ③ 其余候选折叠成最上层根包（父包优先，子包靠前缀覆盖）。
  const noSub = raw.filter((p) => !p.startsWith(tgt + "."));
  const safe = noSub.filter((p) => !tgt.startsWith(p + "."));
  const skippedAncestors = noSub.filter((p) => tgt.startsWith(p + "."));
  for (const p of safe) {
    if (safe.some((q) => q !== p && p.startsWith(q + "."))) continue;
    map[p] = tgt;
  }
  if (skippedAncestors.length) {
    res.warnings.push(`pkg-ancestor-skipped:${skippedAncestors.join(",")}`);
  }
  // M282：以前 map 空就直接 return，导致「源码已是新包名、只差 gradle」的情况下 gradle 也不改。
  // 现在：map 空时源码/manifest 各段自然是 no-op（rewritePkgMap 空 map 返回 unchanged），
  // 但仍会跑 gradle / res / assets 同步。

  // 1) 源码 + xml 内容
  const srcRoots = await discoverSrcRoots(source);
  const seen = new Set<string>();
  for (const root of srcRoots) {
    const files = await listAllTextFiles(source, root);
    for (const rel of files) {
      if (seen.has(rel)) continue;
      seen.add(rel);
      if (rel.endsWith(".xml")) continue; // xml 里的包名引用在 manifest/res 阶段按需处理
      const text = await source.readText(rel).catch(() => null);
      if (!text) continue;
      const r = rewritePkgMap(text, map);
      if (!r.changed) continue;
      if (!saveRoot) {
        res.ok = false;
        res.warnings.push("no-save-root");
        continue;
      }
      const ok = await saveProjectFile(saveRoot, rel, dedupeImports(r.text));
      if (!ok) res.ok = false;
      res.files.push(rel);
    }
  }

  // 2) AndroidManifest（package 属性 + 属性值里的完整包名）
  for (const rel of await findManifestFiles(source)) {
    const text = await source.readText(rel).catch(() => null);
    if (!text) continue;
    let next = text;
    let changed = false;
    for (const o of Object.keys(map)) {
      const t = rewriteManifestPkg(next, o, tgt);
      if (t && t !== next) {
        next = t;
        changed = true;
      }
    }
    if (!changed) continue;
    if (!saveRoot) {
      res.ok = false;
      res.warnings.push("no-save-root");
      continue;
    }
    const ok = await saveProjectFile(saveRoot, rel, next);
    if (!ok) res.ok = false;
    res.manifests.push(rel);
  }

  // 3) build.gradle 的 namespace / applicationId
  // M282：以前 blindly 用 gradleRel 或第一个候选，读不到 / 改不动就静默跳过，
  // 用户以为「包名改了但 gradle 没变」。现在：逐个候选找存在的、失败给明确告警。
  {
    const cands = gradleRel ? [gradleRel, ...GRADLE_CANDIDATES] : GRADLE_CANDIDATES;
    let gRel: string | null = null;
    let gText: string | null = null;
    for (const rel of cands) {
      const t = await source.readText(rel).catch(() => null);
      if (t) { gRel = rel; gText = t; break; }
    }
    if (!gRel || !gText) {
      res.warnings.push("gradle-not-found");
    } else {
      const r = setGradlePackage(gText, tgt);
      if (!r.ok) {
        res.warnings.push(`gradle-unsupported:${gRel}:${r.msg || ""}`);
      } else if (r.text !== gText) {
        if (!saveRoot) {
          res.ok = false;
          res.warnings.push("no-save-root");
        } else {
          const ok = await saveProjectFile(saveRoot, gRel, r.text);
          if (!ok) {
            res.ok = false;
            res.warnings.push(`gradle-save-failed:${gRel}`);
          } else {
            res.gradles.push(gRel);
          }
        }
      }
    }
  }

  // 3.5) M280/清单§3：res 里 xml（layout/anim 等）的自定义 View/Fragment 全限定类名引用
  //  以及 §4：assets 等文本里硬编码的旧包名（仅提示，不自动改——字符串字面量不能误伤）。
  //  普通 @id / @drawable 资源引用不受包名变更影响，不动。
  {
    const resDirs = await discoverResDirs(source);
    for (const dir of resDirs) {
      const files = await listAllTextFiles(source, dir);
      for (const rel of files) {
        if (!/\.xml$/i.test(rel)) continue;
        const text = await source.readText(rel).catch(() => null);
        if (!text) continue;
        let next = text;
        let hit = false;
        for (const o of Object.keys(map)) {
          // 只替换「类全限定名引用」场景：android:name="com.old.X"（自定义 View/Fragment/Provider）
          const r = rewritePkgMap(next, { [o]: tgt });
          if (r.changed) { next = r.text; hit = true; }
        }
        if (hit && saveRoot) {
          const ok = await saveProjectFile(saveRoot, rel, next);
          if (!ok) res.ok = false;
          else res.resClassRefs.push(rel);
        }
      }
    }
    // assets：扫文本文件里的旧包名，列出提示（不自动替换）
    const assetFiles = await listAssetsTextFiles(source, "assets");
    for (const rel of assetFiles) {
      const text = await source.readText(rel).catch(() => null);
      if (!text) continue;
      if (Object.keys(map).some((o) => text.includes(o))) res.assetsHints.push(rel);
    }
  }

  // 4) 目录合并
  if (!fileOpsCtx) {
    res.warnings.push("pkg-move-unsupported");
    return res;
  }
  const newDir = tgt.replace(/\./g, "/");
  for (const srcRoot of srcRoots) {
    const newRel = `${srcRoot}/${newDir}`;
    for (const o of Object.keys(map)) {
      const oldDir = o.replace(/\./g, "/");
      if (oldDir === newDir) continue;
      const oldRel = `${srcRoot}/${oldDir}`;
      // 旧目录存在吗
      const probe = await listEntriesSafe(source, oldRel);
      if (!probe.length) continue;
      // 嵌套改名（old 是 new 的前缀）：跳过通往 new 的那一枝
      const skip = new Set<string>();
      if (newRel.startsWith(`${oldRel}/`)) {
        const rest = newRel.slice(oldRel.length + 1);
        const first = rest.split("/")[0];
        if (first) skip.add(first);
      } else if (oldRel.startsWith(`${newRel}/`)) {
        // new 是 old 的祖先（把子包合并到父包），正常搬
      }
      const okDir = await ensureDir(fileOpsCtx, newRel);
      if (!okDir) {
        res.conflicts.push(newRel);
        continue;
      }
      await moveTreeInto(fileOpsCtx, source, oldRel, newRel, res, skip);
      if (!skip.size) {
        const del = await deleteEntry(fileOpsCtx, oldRel, true).catch(() => null);
        if (del && !del.ok) res.warnings.push(`del-failed:${oldRel}`);
      }
      res.movedDirs.push(oldRel);
    }
  }

  return res;
}
