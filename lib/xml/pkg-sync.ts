// lib/xml/pkg-sync.ts — M209：改包名时同步源码目录
//
// 背景（用户报）：项目属性弹窗里改「包名 applicationId」时，只改了 app/build.gradle 的
// namespace / applicationId，没同步 ① 各 .java/.kt 里的 `package xxx;` 声明 ② 按包名建的
// 源码目录（app/src/main/java/com/old/pkg → com/new/pkg）。两者不同步，编译必炸。
//
// 本函数做三件事（纯逻辑，IO 走传入的 source，落盘走 saveRoot，目录移动走 fileOpsCtx）：
//   1. 递归扫 app/src/main/java 与 app/src/main/kotlin 下所有 .java/.kt，把 `package old;`
//      替换成 `package new;`（只动第一行顶层声明，不误伤字符串里的 package）。
//   2. 把改过的文件写回（saveProjectFile）。
//   3. 若 native 有 fileOpsCtx，且旧包目录存在，则 moveEntry 把 旧包目录 整体移到 新包目录
//      （com/old → com/new 的分叉层）。web 端没有目录改名 API，只改文件内容并提示。

import type { ProjectSource } from "./project-browse";
import type { ProjectSaveRoot } from "./project-save";
import { saveProjectFile } from "./project-save";
import type { FileOpsCtx } from "./file-ops";
import { moveEntry } from "./file-ops";
import { isJavaSrcName } from "./project-browse";

export interface PkgSyncResult {
  ok: boolean;
  /** 被改写的源文件（相对项目根） */
  files: string[];
  /** 被改写的 AndroidManifest（相对项目根） */
  manifests: string[];
  /** 目录是否移动成功 */
  moved: boolean;
  /** 没能移动目录（web / 没 fileOpsCtx / 旧目录不存在） */
  moveWarn?: string;
  /** 是否找到任何源码目录 */
  foundSrc: boolean;
}

const SRC_ROOTS = ["app/src/main/java", "app/src/main/kotlin"];

/** 动态发现源码根：枚举 app/src/<variant>/{java,kotlin}（含 main / debug / release / test / androidTest / flavor）
 *  找不到 app/src 时退回静态 SRC_ROOTS。纯 IO，不抛错。 */
async function discoverSrcRoots(source: ProjectSource): Promise<string[]> {
  const out: string[] = [];
  let variants: string[] = [];
  try {
    const kids = await source.listChildren("app/src").catch(() => []);
    if (Array.isArray(kids)) variants = kids.filter((e) => e.kind === "dir").map((e) => e.name);
  } catch {
    /* 退静态 */
  }
  if (variants.length === 0) return [...SRC_ROOTS];
  for (const v of variants) {
    for (const lang of ["java", "kotlin"]) {
      const rel = `app/src/${v}/${lang}`;
      const probe = await source.listChildren(rel).catch(() => null);
      if (Array.isArray(probe)) out.push(rel);
    }
  }
  // 保底：至少含 main 的两路（即使 probe 失败也不丢主路径）
  if (out.length === 0) return [...SRC_ROOTS];
  return out;
}

/** 旧包名 com.a.b → 各源码根下对应的目录 com/a/b */
function pkgDir(srcRoot: string, pkg: string): string {
  const path = pkg.replace(/\./g, "/").replace(/^\/+|\/+$/g, "");
  return `${srcRoot}/${path}`;
}

/** 递归列出某源码目录下所有 .java/.kt（relative to project root） */
async function listJavaFiles(
  source: ProjectSource,
  baseRel: string,
): Promise<string[]> {
  const out: string[] = [];
  let depth = 0;
  const walk = async (rel: string): Promise<void> => {
    depth++;
    if (depth > 16) return; // 防死循环
    let children;
    try {
      children = await source.listChildren(rel);
    } catch {
      return;
    }
    if (!Array.isArray(children)) {
      depth--;
      return;
    }
    for (const e of children) {
      const full = rel ? `${rel}/${e.name}` : e.name;
      if (e.kind === "dir") {
        await walk(full);
      } else if (isJavaSrcName(e.name)) {
        out.push(full);
      }
    }
    depth--;
  };
  await walk(baseRel);
  return out;
}

/** 把源文件里第一行顶层 `package com.old;` 改成 `package com.new;`（其余行不动） */
export function rewritePkgDecl(text: string, oldPkg: string, newPkg: string): string | null {
  if (!text || !oldPkg || !newPkg) return null;
  const lines = text.split("\n");
  const re = new RegExp(
    "^(package\\s+)" +
      oldPkg.replace(/\./g, "\\.") +
      "(\\s*;\\s*)$",
  );
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i]);
    if (m) {
      lines[i] = m[1] + newPkg + m[2];
      changed = true;
      break;
    }
  }
  return changed ? lines.join("\n") : null;
}

/**
 * 把 AndroidManifest.xml 里引用旧包名的地方换成新包名。
 *
 * 处理（都是属性值里的完整包名）：
 *   package="com.old"
 *   android:name="com.old.MainActivity"
 *   android:taskAffinity="com.old" / android:process="com.old:remote"
 *   android:authorities="com.old.fileprovider"
 *   android:value="com.old.xxx"（meta-data）
 *   <permission android:name="com.old.permission.X">
 *
 * 不碰：android:name=".MainActivity"（相对写法）、${applicationId}.fileprovider（占位符）
 */
export function rewriteManifestPkg(text: string, oldPkg: string, newPkg: string): string | null {
  if (!text || !oldPkg || !newPkg || oldPkg === newPkg) return null;
  const esc = oldPkg.replace(/\./g, "\\.");
  // 前面不能紧跟标识符字符/点（避免 foo.com.old 被误改）
  // 后面必须是 . " 空白 : / 或行尾（避免 com.old 命中 com.older / com.oldx）
  const re = new RegExp(`(^|[^A-Za-z0-9_.$])${esc}(?=[."\\s:/]|$)`, "g");
  const out = text.replace(re, (_m, pre: string) => `${pre}${newPkg}`);
  return out !== text ? out : null;
}

/**
 * M219b：全文件包名 token 替换（比只改第一行 package 声明更宽）。
 * 把 `com.old.pkg` 这种点分 token 在整段文本里全换成 `com.new.pkg`：
 *   import com.old.pkg.Foo; → import com.new.pkg.Foo;
 *   com.old.pkg.R.id.x / new com.old.pkg.MainActivity() / package com.old.pkg;
 * 边界守卫（关键）：
 *   - 前一个字符不能是 [A-Za-z0-9_.]（避免 xcom.old.pkg 或 subcom.old.pkg 误中；也避免 already-renamed 重复）
 *   - 后一个字符不能是 [A-Za-z0-9_]（避免 com.old.pkgExtra 误中；后面是 . 时照常换，留给 .Foo）
 * 返回 { text, changed }。
 */
export function rewritePkgTokens(text: string, oldPkg: string, newPkg: string): { text: string; changed: boolean } {
  if (!text || !oldPkg || !newPkg || oldPkg === newPkg) return { text, changed: false };
  const esc = oldPkg.replace(/\./g, "\\.");
  const re = new RegExp("(?<![A-Za-z0-9_.])" + esc + "(?![A-Za-z0-9_])", "g");
  const out = text.replace(re, newPkg);
  return { text: out, changed: out !== text };
}

/** 递归列出某个目录下所有文本源文件（.java/.kt + 所有 .xml，供包名全量同步用）。相对项目根。 */
export async function listAllTextFiles(source: ProjectSource, startRel: string): Promise<string[]> {
  const out: string[] = [];
  let depth = 0;
  const walk = async (rel: string): Promise<void> => {
    depth++;
    if (depth > 20) return;
    let children;
    try {
      children = await source.listChildren(rel);
    } catch {
      depth--;
      return;
    }
    if (!Array.isArray(children)) {
      depth--;
      return;
    }
    for (const e of children) {
      const full = rel ? `${rel}/${e.name}` : e.name;
      if (e.kind === "dir") {
        await walk(full);
      } else if (isJavaSrcName(e.name) || /\.xml$/i.test(e.name)) {
        out.push(full);
      }
    }
    depth--;
  };
  await walk(startRel);
  return out;
}

/** 可能含包名引用的 manifest 路径（根 / app / app/src/<variant>） */
async function findManifests(source: ProjectSource): Promise<string[]> {
  const found = new Set<string>();
  for (const p of ["AndroidManifest.xml", "app/AndroidManifest.xml"]) {
    const t = await source.readText(p).catch(() => null);
    if (t && /<manifest[\s>]/.test(t)) found.add(p);
  }
  let srcDirs = ["main"];
  try {
    const kids = await source.listChildren("app/src").catch(() => []);
    if (Array.isArray(kids)) {
      const dirs = kids.filter((e) => e.kind === "dir").map((e) => e.name);
      if (dirs.length) srcDirs = dirs;
    }
  } catch {
    /* default main */
  }
  for (const d of srcDirs) {
    const p = `app/src/${d}/AndroidManifest.xml`;
    const t = await source.readText(p).catch(() => null);
    if (t && /<manifest[\s>]/.test(t)) found.add(p);
  }
  return [...found];
}

/**
 * 改包名同步。oldPkg/newPkg 都是完整包名（com.a.b）。
 * 返回改写的文件清单 + 目录是否移动成功。
 */
export async function syncPkgInSource(
  source: ProjectSource,
  oldPkg: string,
  newPkg: string,
  saveRoot: ProjectSaveRoot,
  fileOpsCtx: FileOpsCtx | null,
): Promise<PkgSyncResult> {
  const result: PkgSyncResult = { ok: true, files: [], manifests: [], moved: false, foundSrc: false };
  if (!oldPkg || !newPkg || oldPkg === newPkg) return result;

  // 0) AndroidManifest.xml：package 属性 + 所有引用完整包名的属性值
  const manifests = await findManifests(source);
  for (const rel of manifests) {
    const text = await source.readText(rel).catch(() => null);
    if (!text) continue;
    const next = rewriteManifestPkg(text, oldPkg, newPkg);
    if (next && next !== text) {
      const ok = await saveProjectFile(saveRoot, rel, next);
      if (!ok) result.ok = false;
      result.manifests.push(rel);
    }
  }

  // 1) M219b：全项目 token 扫描（.java/.kt/.xml 全量）——
  //  旧版只改旧包目录里的第一行 package 声明，会漏掉：其它包 import com.old.pkg.Foo、
  //  全限定 new com.old.pkg.MainActivity()、manifest 里的属性值等。这里一次性全换。
  //  扫描范围＝动态发现的源码根（java/kotlin，含各 variant），避免走 res 大目录。
  const srcRoots = await discoverSrcRoots(source);
  const sweepSeen = new Set<string>(); // 避免同一文件被两个源码根重复计
  for (const srcRoot of srcRoots) {
    const allFiles = await listAllTextFiles(source, srcRoot);
    for (const rel of allFiles) {
      if (sweepSeen.has(rel)) continue;
      sweepSeen.add(rel);
      const text = await source.readText(rel).catch(() => null);
      if (!text) continue;
      const r = rewritePkgTokens(text, oldPkg, newPkg);
      if (r.changed) {
        const ok = await saveProjectFile(saveRoot, rel, r.text);
        if (!ok) result.ok = false;
        result.files.push(rel);
        result.foundSrc = true;
      }
    }
  }

  // 2) 找出所有源码文件并改写 package 声明
  const oldDir = oldPkg.replace(/\./g, "/");
  const newDir = newPkg.replace(/\./g, "/");
  // 嵌套改名（com.old → com.old.app）不能直接 move 自己进自己，会报错/递归。
  const nested = newDir.startsWith(oldDir + "/") || oldDir === newDir;
  const seenSrcRoot = new Set<string>();

  for (const srcRoot of srcRoots) {
    const rootDir = pkgDir(srcRoot, oldPkg);
    let baseRel = "";
    try {
      // 旧包根目录是否真实存在：探一下该目录能否列子项（不存在就跳过移动）
      const probe = await source.listChildren(rootDir).catch(() => null);
      if (!Array.isArray(probe)) continue;
      baseRel = rootDir;
      void baseRel;
    } catch {
      continue;
    }
    if (seenSrcRoot.has(srcRoot)) continue;
    seenSrcRoot.add(srcRoot);
    result.foundSrc = true;

    // M219b：文件内容的 package 声明 / 跨包引用 已由上面的全项目 token 扫描统一改过，
    // 这里只负责把旧包目录整体移到新包目录（内容已改完，移完即 package 与目录对齐）。
    if (nested) {
      // 嵌套改名（com.old → com.old.app 或同名）不能直接挪，需用户手动处理目录层次。
      result.moveWarn = "pkg-nested-rename";
      continue;
    }
    const oldFull = `${srcRoot}/${oldDir}`;
    const newFull = `${srcRoot}/${newDir}`;
    const targetParentRel = newFull.slice(0, newFull.lastIndexOf("/") + 1).replace(/\/+$/, "");
    const asName = newDir.split("/").pop() || "";
    if (fileOpsCtx) {
      const mv = await moveEntry(fileOpsCtx, oldFull, targetParentRel, asName);
      if (mv.ok) {
        result.moved = true;
      } else {
        result.moveWarn = mv.reason || "web 环境不支持移动目录";
      }
    } else {
      result.moveWarn = "pkg-move-unsupported";
    }
  }

  return result;
}
