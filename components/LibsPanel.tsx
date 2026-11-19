// components/LibsPanel.tsx — M295：库管理面板（本地库 / 项目库 + 下载）
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nativeBridge } from "@/lib/xml/native-save";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import {
  groupCatalog,
  libDownloadUrls,
  libKey,
  LIBRARY_CATALOG,
  LAN_LIBS_BASE,
  type LibEntry,
} from "@/lib/xml/library-catalog";
import {
  parseGradleDepsDetailed,
  parseFileTrees,
  gradleDepDownloadUrls,
  gradleDepFname,
  insertImplementation,
  insertRepoUrl,
  mavenCoord,
  removeImplementation,
  updateImplementation,
  removeExcludeFromDep,
  insertFileTree,
  updateFileTree,
  removeFileTree,
  findDepConflicts,
  findConflictsForNew,
  addExcludesToGradle,
  applyConflictExcludes,
  type GradleDep,
  type GradleUnresolved,
  type GradleFileTree,
  type DepConflict,
} from "@/lib/xml/gradle-deps";
import { systemDownload } from "@/lib/xml/system-download";
import { orderBySecurity, verifyDownloadedLib, type VerifyResult } from "@/lib/xml/lib-integrity";
import { formatBytes, matchLibQuery, matchGradleDep, sortLibFiles, matchFileTreeInclude, normFtDir } from "@/lib/xml/libs-utils";
import { LibsItemMenu, useLongPress, type LibsItemMenuState, type LibsMenuItem } from "@/components/LibsItemMenu";

interface LibsPanelProps {
  /** 当前激活项目的 SAF 源（可 list/read）；没有则项目库列不出来 */
  aiFileIo?: AiFileIo | null;
  /** 项目根绝对路径（native），用于项目库目录 */
  nativeProjectRoot?: string | null;
  /** 刷新信号：变化时重新列目录 */
  refreshKey?: number;
  onNote?: (text: string) => void;
  /** 翻译函数（由父组件传入，避免 hook 依赖） */
  tr: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
}

interface LibFile {
  name: string;
  rel: string;
  size?: number;
  /** M425：产生该文件的候选目录 rel（标准 libs / fileTree dir），用于项目库 tab 按目录分组展示 */
  src?: string;
}

type LibTab = "local" | "project" | "catalog";

function isJarAar(name: string) {
  return /\.(jar|aar)$/i.test(name);
}

/** fileTree include 过滤 / 目录规范化统一在 libs-utils（M380：打包侧 collectProjectLibs 共用同一套规则） */

/** 项目库候选目录：标准 app/src/main/libs + 每个 fileTree 的 dir（带各自的 include 过滤） */
interface ProjectLibCandidate {
  rel: string;
  abs: string | null;
  includes: string[];
  /** M425：对应哪个 fileTree（gradleFileTrees 下标），undefined=标准 libs */
  ftIdx?: number;
}

async function fetchBase64(url: string): Promise<{ b64: string; ok: boolean; error?: string; size?: number }> {
  try {
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) return { b64: "", ok: false, error: `HTTP ${r.status}` };
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const b64 = btoa(bin);
    return { b64, ok: true, size: bytes.length };
  } catch (e: any) {
    return { b64: "", ok: false, error: e?.message || String(e) };
  }
}

function listDirViaNative(abs: string): LibFile[] {
  const b = nativeBridge();
  if (!b?.listDir) return [];
  try {
    const json = b.listDir(abs);
    if (!json) return [];
    const p = JSON.parse(json);
    if (!p?.ok || !Array.isArray(p.items)) return [];
    return p.items
      .filter((it: { kind: string; name: string }) => it.kind === "file" && isJarAar(it.name))
      .map((it: { name: string; path?: string; size?: number }) => ({
        name: it.name,
        rel: it.path || `${abs}/${it.name}`,
        size: typeof it.size === "number" ? it.size : undefined,
      }));
  } catch {
    return [];
  }
}

async function listDirViaIo(io: AiFileIo, rel: string): Promise<LibFile[]> {
  const out: LibFile[] = [];
  const r = await io.list(rel);
  if (!r.ok || !r.items) return out;
  for (const it of r.items) {
    if (it.kind === "file" && isJarAar(it.name)) {
      out.push({ name: it.name, rel: rel ? `${rel}/${it.name}` : it.name });
    }
  }
  return out;
}

/** M424：模块级读写 helper（applyMaven / removeFromProject 共用）。
 *  native writeText 走 b64（防中文乱码）；aiFileIo 是 async，直写文本。读不到返回空串，写失败返回 false。 */
async function readOneVia(
  rel: string,
  abs: string,
  native: ReturnType<typeof nativeBridge>,
  aiFileIo?: AiFileIo | null,
): Promise<string> {
  if (native?.readText) {
    try { const t = String(native.readText?.(abs) ?? ""); if (t && !t.startsWith("err:")) return t; } catch {}
  }
  if (aiFileIo?.read) {
    try { const r = await aiFileIo.read(rel); if (r.ok && r.text) return r.text; } catch {}
  }
  return "";
}

async function writeOneVia(
  rel: string,
  abs: string,
  text: string,
  native: ReturnType<typeof nativeBridge>,
  aiFileIo?: AiFileIo | null,
): Promise<boolean> {
  if (native?.writeText) {
    try {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      const r = String(native.writeText?.(abs, b64) ?? "");
      if (r && !r.startsWith("err:")) return true;
    } catch {}
  }
  if (aiFileIo?.write) {
    try {
      const r = await aiFileIo.write(rel, text);
      return r.ok;
    } catch {}
  }
  return false;
}

/** M424：移除结果 → 提示条目（纯函数，可单测）。
 *  四象限：
 *   - 成功（含「本来就没文件只有声明」）：删了能删的 → remove_done
 *   - 文件删了但声明没删成功：remove_decl_fail（提示可手动删）
 *   - 声明删了但文件没删成：remove_decl_only
 *   - 都没删成：remove_fail
 *  ok = 是否要 refresh（前三种都算部分/全部成功，刷新列表现状） */
export function removeNoteKind(o: {
  hadFile: boolean; fileOk: boolean; declWanted: boolean; declRemoved: boolean; lastErr: string; declErr: string;
}): { key: string; fallback: string; vars: Record<string, string>; ok: boolean } {
  if ((o.fileOk || !o.hadFile) && (o.declRemoved || !o.declWanted))
    return { key: "libs.remove_done", fallback: "{lib} 已从项目移除", vars: {}, ok: true };
  if (o.fileOk && o.declWanted)
    return { key: "libs.remove_decl_fail", fallback: "{lib} 文件已删除，但依赖声明删除失败（可在 build.gradle 里手动删 {where}）", vars: { where: o.declErr || "dependencies" }, ok: true };
  if (o.declRemoved)
    return { key: "libs.remove_decl_only", fallback: "{lib} 依赖声明已从 build.gradle 删除，但文件删除失败：{err}", vars: { err: o.lastErr }, ok: true };
  return { key: "libs.remove_fail", fallback: "{lib} 移除失败：{err}", vars: { err: o.lastErr || o.declErr || "?" }, ok: false };
}

export function LibsPanel({ aiFileIo, nativeProjectRoot, refreshKey, onNote, tr }: LibsPanelProps) {
  const [tab, setTab] = useState<LibTab>("local");
  const [localLibs, setLocalLibs] = useState<LibFile[]>([]);
  const [projectLibs, setProjectLibs] = useState<LibFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [catBusy, setCatBusy] = useState<Record<string, string>>({}); // libKey -> 'downloading' | 'done' | 'err:msg'
  const [dlOpen, setDlOpen] = useState(false);
  const [dlUrl, setDlUrl] = useState("");
  const [dlName, setDlName] = useState("");
  const [dlBusy, setDlBusy] = useState(false);
  // M345：从 build.gradle 解析依赖并自动下载
  const [gradleBusy, setGradleBusy] = useState(false);
  const [gradleDeps, setGradleDeps] = useState<GradleDep[]>([]);
  const [gradleUnresolved, setGradleUnresolved] = useState<GradleUnresolved[]>([]);
  const [gradleScanned, setGradleScanned] = useState(false);
  const [gradleFileTrees, setGradleFileTrees] = useState<GradleFileTree[]>([]);
  const [gradleBusyKey, setGradleBusyKey] = useState<Record<string, string>>({});
  const [gradleMsg, setGradleMsg] = useState<string | null>(null);
  /** M425：项目库 tab 里 fileTree 目录组折叠状态（按 gradleFileTrees 下标） */
  const [ftExpanded, setFtExpanded] = useState<Record<number, boolean>>({});
  // M388：表项次要动作（存 libs/删除/移除/应用到项目）走长按弹菜单，不再挂内联按钮
  const [libMenu, setLibMenu] = useState<LibsItemMenuState | null>(null);
  const closeLibMenu = useCallback(() => setLibMenu(null), []);
  // M388：行级长按/右键 → 弹菜单（同一时刻只有一行在被按，单例 ref）
  const bindLongPress = useLongPress<LibsMenuItem[]>((x, y, items) => setLibMenu({ x, y, items }));

  const native = nativeBridge();

  // 本地库目录：默认工作目录（/sdcard/AndroidUIIDE/Project）的**上级** /libs
  //  即 /sdcard/AndroidUIIDE/libs —— 所有下载的库都先存这里，再在本地库列表选择是否应用到项目
  const localDir = useMemo(() => {
    if (!native) return null;
    const def = native.getDefaultWorkspace?.();
    if (def) {
      const clean = def.replace(/[\\/]+$/, "");
      // /sdcard/AndroidUIIDE/Project → /sdcard/AndroidUIIDE/libs
      const parent = clean.replace(/[\\/]Project$/i, "");
      return parent !== clean ? `${parent}/libs` : `${clean}/libs`;
    }
    return "/storage/emulated/0/AndroidUIIDE/libs";
  }, [native]);

  /** M346/M358：项目库标准目录 = 项目根/app/src/main/libs（标准安卓工程布局）。
   *  M370：+ build.gradle 里 fileTree(dir: 'libs') 指定的目录（真实老项目常见 app/libs），
   *  否则这些 jar 在项目库列表里永远看不到，且「应用到项目」会写错地方。 */
  const projectLibsBases = useMemo(() => {
    if (!nativeProjectRoot) return [] as string[];
    const root = nativeProjectRoot.replace(/[\\/]+$/, "");
    const bases = [`${root}/app/src/main/libs`];
    for (const ft of gradleFileTrees) {
      const d = (ft.dir || "")
        .trim()
        .replace(/^\.\//, "")
        .replace(/^\/+/, "")
        .replace(/[\\/]+$/, "");
      if (!d) continue;
      // dir 相对模块目录（app/）；写全路径（app/...）时按项目根解
      for (const cand of [`${root}/app/${d}`, `${root}/${d}`]) {
        if (!bases.includes(cand)) bases.push(cand);
      }
    }
    return bases;
  }, [nativeProjectRoot, gradleFileTrees]);
  /** 首选写入目录（应用到项目 / gradle 依赖下载都写这里）。
   *  M370：build.gradle 配了 fileTree → 写 fileTree 目录（写 app/src/main/libs 编译不生效）；
   *  否则仍用标准位置 app/src/main/libs。 */
  const primaryLibBase = useMemo(() => {
    if (!nativeProjectRoot) return null;
    const root = nativeProjectRoot.replace(/[\\/]+$/, "");
    for (const ft of gradleFileTrees) {
      const d = (ft.dir || "")
        .trim()
        .replace(/^\.\//, "")
        .replace(/^\/+/, "")
        .replace(/[\\/]+$/, "");
      if (!d) continue;
      return /^app([\\/]|$)/.test(d) ? `${root}/${d}` : `${root}/app/${d}`;
    }
    return projectLibsBases[0] ?? null;
  }, [nativeProjectRoot, gradleFileTrees, projectLibsBases]);

  /** M372：项目库候选目录（rel + abs + 各自 include 过滤）。
   *  native 和 SAF（aiFileIo）两路都用 fileTree 指向的目录，不再只扫标准 libs。 */
  const projectLibCandidates = useMemo(() => {
    const out: ProjectLibCandidate[] = [
      { rel: "app/src/main/libs", abs: null, includes: [] },
    ];
    const root = (nativeProjectRoot || "").replace(/[\\/]+$/, "");
    gradleFileTrees.forEach((ft, ftIdx) => {
      const d = normFtDir(ft.dir);
      if (!d) return;
      const rels = /^app(\/|$)/.test(d) ? [d] : [`app/${d}`, d];
      for (const rel of rels) {
        if (out.some((c) => c.rel === rel)) continue;
        out.push({ rel, abs: root ? `${root}/${rel}` : null, includes: ft.includes, ftIdx });
      }
    });
    if (root) out[0].abs = `${root}/app/src/main/libs`;
    return out;
  }, [nativeProjectRoot, gradleFileTrees]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      if (tab === "local") {
        if (!localDir) {
          setLocalLibs([]);
        } else {
          // 先确保目录存在
          native?.createEntry?.(localDir, true);
          setLocalLibs(listDirViaNative(localDir));
        }
      } else {
        // 项目库：标准 libs + build.gradle fileTree 指向的目录（按 include 过滤）
        if (nativeProjectRoot && native) {
          let all: LibFile[] = [];
          for (const c of projectLibCandidates) {
            if (!c.abs) continue;
            native.createEntry?.(c.abs, true);
            const items = listDirViaNative(c.abs).filter((f) => matchFileTreeInclude(f.name, c.includes)).map((f) => ({ ...f, src: c.rel }));
            all = all.concat(items);
          }
          setProjectLibs(all);
        } else if (aiFileIo) {
          let all: LibFile[] = [];
          for (const c of projectLibCandidates) {
            const items = (await listDirViaIo(aiFileIo, c.rel)).filter((f) => matchFileTreeInclude(f.name, c.includes)).map((f) => ({ ...f, src: c.rel }));
            all = all.concat(items);
          }
          setProjectLibs(all);
        } else {
          setProjectLibs([]);
        }
      }
    } finally {
      setBusy(false);
    }
  }, [tab, localDir, nativeProjectRoot, aiFileIo, native, refreshKey, projectLibCandidates]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** M385：下载后校验（Maven .sha1/.sha256）；拿不到校验和 → unverifiable（不阻断，日志写明） */
  const verifyLib = useCallback(
    async (urls: string[], path: string): Promise<VerifyResult> => {
      const fileHash = native?.fileHash;
      if (!fileHash) return { status: "unverifiable", reason: "原生 fileHash 不可用" };
      return verifyDownloadedLib(
        {
          fetchText: async (u: string) => {
            try {
              const r = await fetch(u, { cache: "no-store" });
              if (!r.ok) return null;
              return await r.text();
            } catch {
              return null;
            }
          },
          hashFile: async (p: string, algo) => {
            try {
              const r = String(fileHash.call(native, p, algo) || "");
              return r.startsWith("ok:") ? r.slice(3) : null;
            } catch {
              return null;
            }
          },
        },
        urls,
        path,
      );
    },
    [native],
  );

  /** M365：系统下载器优先（后台 + 系统通知 + 进度弹窗）；全失败则回退 HttpURLConnection
   *  downloadLib（保证文件仍下到共享库，只是没系统通知）。返回 { ok, error?, via, integrity }。 */
  const dlWithFallback = useCallback(
    async (urls: string[], fname: string, destDir: string): Promise<{ ok: boolean; error?: string; via?: "system" | "direct"; integrity?: VerifyResult }> => {
      // M385：只认 https（局域网镜像例外）——http 源的 jar 可能被中间人直接换掉
      const safeUrls = orderBySecurity(urls);
      if (!safeUrls.length) return { ok: false, error: tr("libs.no_secure_source", "没有可用的安全下载源（仅接受 https；局域网镜像除外）") };
      const target = `${destDir}/${fname}`;
      const res = await systemDownload(safeUrls, fname, destDir, { showNativeProgress: true });
      if (res.missingPermission) return { ok: false, error: tr("libs.cat_no_perm", "缺 All-files-access 权限，下载不到") };
      if (res.ok) {
        const integrity = await verifyLib(safeUrls, target);
        if (integrity.status === "mismatch") {
          try { native?.deleteEntry?.(target, false); } catch { /* ignore */ }
          return { ok: false, error: tr("libs.hash_mismatch", "校验失配：文件内容与仓库校验和不一致（可能被篡改），已删除") };
        }
        return { ok: true, via: "system", integrity };
      }
      // 系统下载器全失败 → 回退原生 HttpURLConnection（同步、能下到共享库）
      if (native?.downloadLib) {
        native.createEntry?.(destDir, true);
        let r = "";
        try { r = String(native.downloadLib(JSON.stringify(safeUrls), target) ?? ""); } catch (e2) { r = "throw:" + String(e2); }
        if (r.startsWith("ok")) {
          const integrity = await verifyLib(safeUrls, target);
          if (integrity.status === "mismatch") {
            try { native?.deleteEntry?.(target, false); } catch { /* ignore */ }
            return { ok: false, error: tr("libs.hash_mismatch", "校验失配：文件内容与仓库校验和不一致（可能被篡改），已删除") };
          }
          return { ok: true, via: "direct", integrity };
        }
        return { ok: false, error: r.slice(4) || tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") };
      }
      return { ok: false, error: res.error || tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") };
    },
    [native, tr, verifyLib],
  );

  /** M385：给提示文字拼校验结果后缀（通过才说通过；拿不到校验和就说未校验，不装成功） */
  const integSuffix = useCallback(
    (v?: VerifyResult) =>
      v?.status === "ok"
        ? tr("libs.verify_ok", "（{algo} 校验通过）", { algo: (v.algo || "sha1").toUpperCase() })
        : v?.status === "unverifiable"
          ? tr("libs.verify_skip", "（未校验：仓库无校验和）")
          : "",
    [tr],
  );

  const doDownload = useCallback(async () => {
    const url = dlUrl.trim();
    if (!url) return;
    const name = dlName.trim() || url.split("/").pop() || "library.jar";
    setDlBusy(true);
    onNote?.(tr("libs.downloading", "正在下载…"));
    // M357/M358：下载目标 = 共享库 /AndroidUIIDE/libs（跨项目复用，不再按 tab/项目写到 src/main/libs）
    const targetBase = localDir || null;
    const target = targetBase ? `${targetBase}/${name}` : null;

    if (targetBase) {
      // M357/M365：系统 DownloadManager（后台 + 通知 + 弹窗）；失败回退 HttpURLConnection
      const res = await dlWithFallback([url], name, targetBase);
      if (res.ok) {
        setDlOpen(false); setDlUrl(""); setDlName("");
        onNote?.(tr("libs.download_saved", "已保存到 {path}" + (res.via === "direct" ? "（直连下载，无系统通知）" : ""), { path: `${targetBase}/${name}` }) + integSuffix(res.integrity));
        void refresh();
      } else {
        onNote?.(tr("libs.download_failed", "下载失败：{err}", { err: res.error || "unknown" }));
      }
      setDlBusy(false);
      return;
    }

    // 无共享库目录（浏览器 / 权限没给）→ 浏览器原生下载
    const r = await fetchBase64(url);
    if (!r.ok) {
      onNote?.(tr("libs.download_failed", "下载失败：{err}", { err: r.error || "unknown" }));
      setDlBusy(false);
      return;
    }
    onNote?.(tr("libs.download_no_target", "当前没有可写的共享库目录（浏览器已下到 Downloads）"));
    setDlBusy(false);
  }, [dlUrl, dlName, localDir, onNote, tr, refresh, setDlOpen, setDlUrl, setDlName, setDlBusy, dlWithFallback, integSuffix]);

  const currentList = tab === "local" ? localLibs : projectLibs;

  // M368：搜索过滤（四个列表共用一个框）+ 名称排序
  const [libQuery, setLibQuery] = useState("");
  const visibleList = useMemo(
    () => sortLibFiles(currentList.filter((f) => matchLibQuery(f.name, f.rel, libQuery))),
    [currentList, libQuery],
  );
  /** M425：项目库文件按来源目录分组——fileTree 目录各成一组（可折叠），标准 libs 单独。
   *  每个 file 的 src 是候选目录 rel；候选 rel 的 ftIdx 告诉它属于哪个 fileTree。 */
  const projectLibGroups = useMemo(() => {
    const q = libQuery;
    const match = (f: LibFile) => matchLibQuery(f.name, f.rel, q);
    const srcToFtIdx = new Map<string, number | undefined>();
    for (const c of projectLibCandidates) srcToFtIdx.set(c.rel, c.ftIdx);
    const ftGroups: { ft: GradleFileTree; index: number; files: LibFile[] }[] = [];
    for (let i = 0; i < gradleFileTrees.length; i++) {
      const files = projectLibs.filter((f) => f.src !== undefined && srcToFtIdx.get(f.src) === i && match(f));
      ftGroups.push({ ft: gradleFileTrees[i], index: i, files: sortLibFiles(files) });
    }
    const stdFiles = projectLibs.filter((f) => {
      if (f.src === undefined) return true;
      const idx = srcToFtIdx.get(f.src);
      return idx === undefined && match(f);
    });
    return { ftGroups, stdFiles: sortLibFiles(stdFiles) };
  }, [projectLibs, gradleFileTrees, projectLibCandidates, libQuery]);

  /** M426：maven 依赖冲突（同名多版本 / 跨 group 同名）——项目库 tab 顶部黄条提示 */
  const depConflicts = useMemo(() => findDepConflicts(gradleDeps), [gradleDeps]);

  /** M425：项目库单个文件行（fileTree 组 / 标准组公用）——行内无按钮，长按弹「移除」 */
  const renderProjectFileRow = (f: LibFile) => (
    <div key={f.rel} className="axv-libs-item" {...bindLongPress([
      { key: "remove", label: tr("libs.remove", "移除"), danger: true, onClick: () => void removeFromProject(f.name) },
    ])}>
      <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>archive</span>
      <div className="axv-libs-item-text">
        <div className="axv-libs-item-name">
          {f.name}
          <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>{formatBytes(f.size) || ""}</span>
        </div>
        <div className="axv-libs-item-rel">{f.rel}</div>
      </div>
    </div>
  );
  // 删除共享库文件（deleteEntry + 确认；项目库不提供删，避免误删工程内文件）
  const [deleteBusy, setDeleteBusy] = useState<string | null>(null);
  const deleteLocalLib = useCallback(
    (f: LibFile) => {
      if (!native?.deleteEntry) return;
      // eslint-disable-next-line no-alert
      if (!window.confirm(tr("libs.delete_confirm", "删除 {name}？（共享库里的文件，删了别的项目也用不了）", { name: f.name }))) return;
      setDeleteBusy(f.rel);
      try {
        const r = native.deleteEntry(f.rel, false);
        let ok = false;
        try {
          ok = !!JSON.parse(r || "").ok;
        } catch {
          ok = false;
        }
        if (ok) {
          onNote?.(tr("libs.deleted", "已删除 {name}", { name: f.name }));
          setLocalLibs((m) => m.filter((x) => x.rel !== f.rel));
        } else {
          onNote?.(tr("libs.delete_failed", "删除失败：{r}", { r: r || "unknown" }));
        }
      } catch (e: unknown) {
        onNote?.(tr("libs.delete_failed", "删除失败：{r}", { r: String(e) }));
      }
      setDeleteBusy(null);
      void refresh();
    },
    [native, onNote, tr, refresh],
  );

  /** M330：从内置目录一键下载某个库到项目 libs/（优先原生多镜像，浏览器回退 fetch） */
  const downloadCat = useCallback(
    async (e: LibEntry) => {
      const key = libKey(e);
      setCatBusy((m) => ({ ...m, [key]: "downloading" }));
      onNote?.(tr("libs.cat_downloading", "正在下载 {lib}…（多镜像）", { lib: e.artifact }));
      const fname = e.artifact + "-" + e.version + (e.isAar ? ".aar" : ".jar");
      // M335：一律先存到本地库 /AndroidUIIDE/libs，用户在本地库列表里选择是否应用到项目
      let targetBase: string | null = null;
      if (localDir) targetBase = localDir;
      const target = targetBase ? `${targetBase}/${fname}` : null;
      if (targetBase) {
        // M357/M365：系统 DownloadManager（后台 + 通知 + 弹窗）；失败回退 HttpURLConnection
        const res = await dlWithFallback(libDownloadUrls(e), fname, targetBase);
        if (res.ok) {
          setCatBusy((m) => ({ ...m, [key]: "done" }));
          onNote?.(tr("libs.cat_download_saved", "{lib} 已下载到共享库（去「共享库」点「应用到项目」加入项目）", { lib: e.artifact }) + integSuffix(res.integrity));
          void refresh();
        } else {
          setCatBusy((m) => ({ ...m, [key]: "err:" + (res.error || "download failed") }));
          onNote?.(tr("libs.cat_download_failed", "{lib} 下载失败：{err}", { lib: e.artifact, err: res.error || "?" }));
        }
        return;
      }
      if (target && typeof native?.downloadLib === "function") {
        // 原生多镜像下载（APK）
        const urlsJson = JSON.stringify(libDownloadUrls(e));
        let r = "";
        try { r = String(native.downloadLib(urlsJson, target) ?? ""); } catch (e2) { r = "throw:" + String(e2); }
        if (r.startsWith("ok")) {
          const parts = r.slice(3).split("@");
          const savedPath = parts[2] || "";
          const isFallback = parts[3] === "fallback";
          // fallback：存到应用目录了，尝试拷回项目 libs（用 writeText）
          if (isFallback && savedPath && native.writeText && target) {
            try {
              const b64 = native.readBase64?.(savedPath);
              if (b64) {
                const w = native.writeText(target, b64);
                if (typeof w === "string" && w.startsWith("ok")) {
                  setCatBusy((m) => ({ ...m, [key]: "done" }));
                  onNote?.(tr("libs.cat_download_saved", "{lib} 已下载（已拷入项目 libs/）", { lib: e.artifact }));
                  void refresh();
                  return;
                }
              }
            } catch {}
            setCatBusy((m) => ({ ...m, [key]: "err:fallback" }));
            onNote?.(tr("libs.cat_fallback", "{lib} 已下载到临时目录 {p}（项目 libs 写不了，请手动拷进去）", { lib: e.artifact, p: savedPath }));
            return;
          }
          setCatBusy((m) => ({ ...m, [key]: "done" }));
          onNote?.(tr("libs.cat_download_saved", "{lib} 已下载到共享库（去「共享库」点「应用到项目」加入项目）", { lib: e.artifact }));
          void refresh();
        } else {
          setCatBusy((m) => ({ ...m, [key]: "err:" + (r.slice(4) || "download failed") }));
          onNote?.(tr("libs.cat_download_failed", "{lib} 下载失败：{err}", { lib: e.artifact, err: r.slice(4) || "?" }));
        }
        return;
      }
      // 浏览器回退：逐镜像 fetch
      for (const url of libDownloadUrls(e)) {
        const r = await fetchBase64(url);
        if (!r.ok) continue;
        if (targetBase && native) {
          native.createEntry?.(targetBase, true);
          const w = native.writeText?.(target!, r.b64);
          const ok = typeof w === "string" && w.startsWith("ok");
          if (ok) {
            setCatBusy((m) => ({ ...m, [key]: "done" }));
            onNote?.(tr("libs.cat_download_saved", "{lib} 已下载", { lib: e.artifact }));
            void refresh();
          } else {
            setCatBusy((m) => ({ ...m, [key]: "err:" + (w || "save failed") }));
            onNote?.(tr("libs.cat_download_failed", "{lib} 保存失败：{err}", { lib: e.artifact, err: w || "?" }));
          }
          return;
        }
        setCatBusy((m) => ({ ...m, [key]: "err:" + tr("libs.cat_no_target", "没有可写的 libs 目录") }));
        onNote?.(tr("libs.cat_no_target", "没有可写的 libs 目录（需先打开项目）"));
        return;
      }
      setCatBusy((m) => ({ ...m, [key]: "err:" + tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") }));
      onNote?.(tr("libs.cat_all_failed", "{lib} 下载失败：全部镜像都试过了（网络不通或源 404）", { lib: e.artifact }));
    },
    [native, nativeProjectRoot, localDir, onNote, tr, refresh, dlWithFallback],
  );

  /** 已下载判定：本地/项目库列表里已有同名文件 */
  const presentNames = useMemo(() => {
    const s = new Set<string>();
    for (const f of [...localLibs, ...projectLibs]) s.add(f.name);
    return s;
  }, [localLibs, projectLibs]);

  /** M335：项目库已有的文件名（判断本地库是否已应用到项目） */
  const projectNames = useMemo(() => new Set(projectLibs.map((f) => f.name)), [projectLibs]);
  const [applyBusy, setApplyBusy] = useState<Record<string, string>>({}); // 本地库 name -> 'applying' | 'done' | 'err'
  const canApply = !!(nativeProjectRoot && native?.copyEntry);

  /** 应用到打开的项目：/AndroidUIIDE/libs/x → 项目/app/src/main/libs/x（标准位置） */
  const applyToLocalProject = useCallback(
    (f: LibFile) => {
      if (!canApply || !nativeProjectRoot || !native) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
        return;
      }
      const dstBase = primaryLibBase || `${nativeProjectRoot.replace(/[\\/]+$/, "")}/app/src/main/libs`;
      native.createEntry?.(dstBase, true);
      const dst = `${dstBase}/${f.name}`;
      setApplyBusy((m) => ({ ...m, [f.name]: "applying" }));
      try {
        const r = String(native.copyEntry?.(f.rel, dst, false) ?? "");
        if (r.startsWith("err:")) {
          setApplyBusy((m) => ({ ...m, [f.name]: "err:" + r.slice(4) }));
          onNote?.(tr("libs.apply_fail", "{lib} 应用失败：{err}", { lib: f.name, err: r.slice(4) }));
          return;
        }
        let p: { ok?: boolean } = {};
        try { p = JSON.parse(r || "{}"); } catch { p = {}; }
        if (p?.ok) {
          setApplyBusy((m) => ({ ...m, [f.name]: "done" }));
          onNote?.(
            tr("libs.apply_done", "{lib} 已应用到 {path}（打包时会带上）", {
              lib: f.name,
              path: dstBase.replace(nativeProjectRoot.replace(/[\\/]+$/, "") + "/", "") || dstBase,
            }),
          );
          void refresh();
        } else {
          setApplyBusy((m) => ({ ...m, [f.name]: "err:fail" }));
          onNote?.(tr("libs.apply_fail", "{lib} 应用失败：{err}", { lib: f.name, err: "?" }));
        }
      } catch {
        setApplyBusy((m) => ({ ...m, [f.name]: "err:copy failed" }));
        onNote?.(tr("libs.apply_fail", "{lib} 应用失败：{err}", { lib: f.name, err: "copy" }));
      }
    },
    [canApply, nativeProjectRoot, primaryLibBase, native, onNote, tr, refresh],
  );

  /** M375：把已下载到共享库的文件拷到项目 fileTree 目录（「存 libs」按钮）。
   *  不看 tab 当前缓存，直接用 localDir + 文件名构造源路径。 */
  const saveSharedToLibs = useCallback(
    (fname: string) => {
      if (!localDir) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
        return;
      }
      applyToLocalProject({ name: fname, rel: `${localDir}/${fname}` });
    },
    [localDir, applyToLocalProject, onNote, tr],
  );

  /** M359：应用到项目 = 写 maven 坐标（不拷文件，防源码膨胀）。
   *  把 group:artifact:version 写进 app/build.gradle（implementation）+ 仓库 url 写进 settings.gradle / 根 build.gradle（repositories）。
   *  设备端打包时按 maven 坐标去共享库 /AndroidUIIDE/libs 找实体文件（M361 接）。 */
  const applyMaven = useCallback(
    async (coord: string, repoUrl: string, libName: string) => {
      if (!nativeProjectRoot) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
        return;
      }
      const root = nativeProjectRoot.replace(/[\\/]+$/, "");
      setApplyBusy((m) => ({ ...m, [libName]: "maven" }));
      // M427：加依赖前检测与现有依赖的冲突（同名多版本 / 跨 group 同名），确认后给旧 dep 加 exclude
      const [newG, newN, newV] = coord.split(":");
      const conflicts = findConflictsForNew(gradleDeps, { group: newG, name: newN, version: newV });
      if (conflicts.length > 0) {
        const detail = conflicts.map((c) => {
          const old = mavenCoord(c.existing.group, c.existing.name, c.existing.version);
          return c.kind === "version"
            ? tr("libs.conflict_version", "{old} → 排掉同名 {mod}（避免传递带入旧版）", { old, mod: c.existing.name })
            : tr("libs.conflict_name", "{old} 与新依赖同名 {mod}（跨 group）", { old, mod: c.existing.name });
        }).join("\n");
        const okConfirm = window.confirm(
          tr("libs.conflict_confirm", "检测到 {n} 处依赖冲突，确认用 exclude 排掉旧的同名库？\n\n{detail}\n\n（继续 = 加新依赖 + 排旧；取消 = 仍加新依赖，不加 exclude）", {
            n: conflicts.length,
            detail,
          }),
        );
        if (!okConfirm) {
          // 用户取消 → 仍加新依赖（不排旧），但提示冲突存在
          onNote?.(tr("libs.conflict_skip", "已跳过 exclude（{n} 处冲突未处理），新依赖已加入", { n: conflicts.length }));
        }
      }
      try {
        // M424：读写改用模块级 helper（readOneVia/writeOneVia），逻辑同 removeFromProject
        const writeOne = (rel: string, abs: string, text: string) => writeOneVia(rel, abs, text, native, aiFileIo);
        const readOne = (rel: string, abs: string) => readOneVia(rel, abs, native, aiFileIo);
        // 1) app/build.gradle（groovy 优先，kts 兑底）
        let appRel = "app/build.gradle";
        let appText = await readOne(appRel, root + "/" + appRel);
        let kts = false;
        if (!appText) {
          appRel = "app/build.gradle.kts"; appText = await readOne(appRel, root + "/" + appRel);
          kts = true;
        }
        if (appText) {
          let [newApp, existed] = insertImplementation(appText, coord, kts);
          // M427/M433b：给【新依赖】加 exclude 排掉旧的同名库（旧依赖不能自我排除）
          if (conflicts.length > 0) {
            const [withEx] = applyConflictExcludes(newApp, { group: newG, name: newN, version: newV }, conflicts, kts);
            newApp = withEx;
          }
          const ok = await writeOne(appRel, root + "/" + appRel, newApp);
          if (ok && !existed)
            onNote?.(tr("libs.maven_written", "{lib} 已写入 maven 坐标 {coord}（不拷文件，防源码膨胀）", { lib: libName, coord }));
        } else {
          // 项目没 build.gradle → 建一个最小 app/build.gradle 带 implementation
          appRel = "app/build.gradle"; kts = false;
          const newApp = "plugins { id 'com.android.application' }\n\ndependencies {\n    implementation '${coord}'\n}\n";
          await writeOne(appRel, root + "/" + appRel, newApp);
        }
        // 2) 仓库 url 写进 settings.gradle（现代）或根 build.gradle
        if (repoUrl) {
          let repoText = await readOne("settings.gradle", root + "/settings.gradle");
          let repoRel = "settings.gradle"; let rkts = false;
          if (!repoText) { repoText = await readOne("settings.gradle.kts", root + "/settings.gradle.kts"); repoRel = "settings.gradle.kts"; rkts = true; }
          if (!repoText) { repoText = await readOne("build.gradle", root + "/build.gradle"); repoRel = "build.gradle"; }
          if (repoText) {
            const [newRepo] = insertRepoUrl(repoText, repoUrl, rkts);
            await writeOne(repoRel, root + "/" + repoRel, newRepo);
          }
        }
        setApplyBusy((m) => ({ ...m, [libName]: "done" }));
        onNote?.(tr("libs.maven_done", "{lib} 已应用到项目（写 maven 配置，不拷文件）", { lib: libName }));
        void refresh();
      } catch {
        setApplyBusy((m) => ({ ...m, [libName]: "err:写 maven 配置失败" }));
        onNote?.(tr("libs.apply_fail", "{lib} 应用失败：{err}", { lib: libName, err: "写 maven 配置" }));
      }
    },
    [nativeProjectRoot, native, aiFileIo, onNote, tr, refresh, gradleDeps],
  );

  /** M424：从项目完整移除 = ① 删 build.gradle 依赖声明（有对应依赖时）→ ② 删 libs 目录里的实体文件。
   *  项目库三类条目都走这里：gradle 依赖行直接传 dep；文件行按文件名（artifact-version.ext）反查 gradleDeps。
   *  文件删除依次试 标准 app/src/main/libs + fileTree 目录 + 兕底 项目根/libs（项目库可能来自三处任一个）。 */
  const removeFromProject = useCallback(
    async (name: string, dep?: GradleDep) => {
      if (!nativeProjectRoot || !native) return;
      const root = nativeProjectRoot.replace(/[\\/]+$/, "");

      // ① 依赖声明：gradle 行传 dep；文件行按文件名反查（material-1.12.0.aar ↔ group:name:version）
      const target = dep ?? gradleDeps.find((d) => gradleDepFname(d) === name);
      let declRemoved = false;
      let declErr = "";
      if (target) {
        const coord = `${target.group}:${target.name}:${target.version}`;
        const rels = ["app/build.gradle", "app/build.gradle.kts", "build.gradle", "build.gradle.kts"];
        for (const rel of rels) {
          const abs = `${root}/${rel}`;
          const text = await readOneVia(rel, abs, native, aiFileIo);
          if (!text) continue;
          const [next, hit] = removeImplementation(text, coord);
          if (!hit) continue;
          if (await writeOneVia(rel, abs, next, native, aiFileIo)) {
            declRemoved = true;
            break;
          }
          declErr = rel;
        }
      }

      // ② 实体文件
      const bases = projectLibsBases.length
        ? projectLibsBases
        : [`${root}/libs`];
      let fileOk = false;
      let lastErr = "?";
      for (const base of bases) {
        const dst = `${base}/${name}`;
        try {
          const r = String(native.deleteEntry?.(dst, false) ?? "");
          if (r.startsWith("err:")) {
            lastErr = r.slice(4);
            continue;
          }
          let p: { ok?: boolean } = {};
          try { p = JSON.parse(r || "{}"); } catch { p = {}; }
          if (p?.ok) { fileOk = true; break; }
        } catch {}
      }

      // ③ 汇总提示：文件本来就不在（只是声明行）→ 删完声明就是干净成功
      const hadFile = presentNames.has(name);
      const note = removeNoteKind({
        hadFile, fileOk, declWanted: !!target, declRemoved, lastErr, declErr,
      });
      onNote?.(tr(note.key, note.fallback, { lib: name, ...note.vars }));
      if (note.ok) void refresh();
    },
    [nativeProjectRoot, native, aiFileIo, gradleDeps, projectLibsBases, presentNames, onNote, tr, refresh],
  );

  const catGroups = useMemo(() => groupCatalog(), []);

  /** M359：按库文件名找 maven 坐标（catalog + 项目 gradle deps）。找到返回 {coord,repoUrl}，找不到 null（用拷贝兑底）。 */
  const findCoordForLib = useCallback(
    (name: string): { coord: string; repoUrl: string } | null => {
      // 文件名可能像 material-1.12.0.aar / jxl-2.9.3.jar。去掉版本号 + 扩展去匹配 artifact。
      const base = name.replace(/\.(jar|aar)$/i, "");
      const noVer = base.replace(/-\d.*$/, "");
      const catHit = LIBRARY_CATALOG.find(
        (e) => e.artifact.toLowerCase() === noVer.toLowerCase() ||
          e.artifact.toLowerCase() === base.toLowerCase(),
      );
      if (catHit)
        return { coord: mavenCoord(catHit.group, catHit.artifact, catHit.version), repoUrl: catHit.kind === "material" || catHit.kind === "androidx" ? "https://dl.google.com/dl/android/maven2" : "https://repo.maven.apache.org/maven2" };
      // catalog 没中，看项目 gradle deps（同名 artifact）
      const gHit = gradleDeps.find((d) => d.name.toLowerCase() === noVer.toLowerCase() || d.name.toLowerCase() === base.toLowerCase());
      if (gHit) return { coord: mavenCoord(gHit.group, gHit.name, gHit.version), repoUrl: gHit.isAar ? "https://dl.google.com/dl/android/maven2" : "https://repo.maven.apache.org/maven2" };
      return null;
    },
    [gradleDeps],
  );

  /** M400：共享库行「应用」——把 maven 坐标写进项目 build.gradle（implementation）+ 仓库 url 写进 settings.gradle（maven 下载地址）。
   *  与「存 libs」（拷物理文件到 app/src/main/libs）不同：本项不拷文件，走 maven 声明。
   *  没 maven 坐标（不在内置目录/项目依赖）→ 提示改用「存 libs」。 */
  const applyLocalMaven = useCallback(
    async (name: string) => {
      if (!nativeProjectRoot) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
        return;
      }
      const c = findCoordForLib(name);
      if (!c) {
        onNote?.(
          tr(
            "libs.apply_no_maven",
            "{lib} 没有 maven 坐标（不在内置目录/项目依赖里），请改用「存 libs」把文件拷进项目",
            { lib: name },
          ),
        );
        return;
      }
      await applyMaven(c.coord, c.repoUrl, name);
    },
    [nativeProjectRoot, findCoordForLib, applyMaven, onNote, tr],
  );

  /** M345：读项目根 build.gradle / build.gradle.kts + app 子目录，解析依赖
   *  M370：同时解析 fileTree(dir/include) —— 本地库声明，指向真实目录
   *  M371：模块/编译标记/app 配置/构建插件等元信息改到「项目属性」弹窗展示（ProjectPropsDialog），
   *  这里只解析「当前项目被引用的库」。 */
  const scanGradleDeps = useCallback(async () => {
    setGradleBusy(true);
    setGradleMsg(null);
    setGradleScanned(false);
    setGradleDeps([]);
    setGradleUnresolved([]);
    setGradleFileTrees([]);

    // 读单个文件：native.readText 优先（SAF/外部路径），失败再 aiFileIo（相对项目根）
    const readOne = async (abs: string, rel: string): Promise<string> => {
      if (native) {
        try {
          const t = String(native.readText?.(abs) ?? "");
          if (t && !t.startsWith("err:")) return t;
        } catch {}
      }
      if (aiFileIo) {
        try {
          const r = await aiFileIo.read(rel);
          if (r.ok && r.text) return r.text;
        } catch {}
      }
      return "";
    };
    const root = (nativeProjectRoot || "").replace(/[\\/]+$/, "");
    const abs = (p: string) => (root ? root + "/" + p : p);

    // 各文件：根 build.gradle + app/build.gradle（依赖与 fileTree 都在这里）
    const rootBuild = await readOne(abs("build.gradle"), "build.gradle");
    if (!rootBuild) await readOne(abs("build.gradle.kts"), "build.gradle.kts");
    const appBuild = await readOne(abs("app/build.gradle"), "app/build.gradle");
    if (!appBuild) await readOne(abs("app/build.gradle.kts"), "app/build.gradle.kts");

    // 依赖（根 + app build.gradle 的 implementation 等）
    // M370：fileTree(dir/include) 一并解析 —— 本地库声明，无坐标但指向真实目录
    const depTexts = [rootBuild, appBuild].filter(Boolean) as string[];
    if (depTexts.length === 0) {
      setGradleMsg(
        tr("libs.gradle_notfound", "没找到 build.gradle / build.gradle.kts（需在项目根或 app/ 下）"),
      );
      setGradleFileTrees([]);
      setGradleBusy(false);
      return;
    }
    const all = depTexts.flatMap((t) => parseGradleDepsDetailed(t));
    // 去重（同一坐标在多个 gradle 文件出现）
    const seen = new Set<string>();
    const deps = all
      .flatMap((r) => r.deps)
      .filter((d) => {
        const k = d.group + ":" + d.name + ":" + d.version;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    // 未解析变量：同一坐标去重
    const unSeen = new Set<string>();
    const unresolved = all
      .flatMap((r) => r.unresolved)
      .filter((u) => {
        if (unSeen.has(u.coord)) return false;
        unSeen.add(u.coord);
        return true;
      });
    setGradleDeps(deps);
    setGradleUnresolved(unresolved);
    // M370：fileTree 去重（dir+include 相同算同一条）
    const ftSeen = new Set<string>();
    const fts = depTexts
      .flatMap((t) => parseFileTrees(t))
      .filter((ft) => {
        const k = ft.dir + "|" + ft.includes.join(",");
        if (ftSeen.has(k)) return false;
        ftSeen.add(k);
        return true;
      });
    setGradleFileTrees(fts);
    setGradleScanned(true);
    setGradleBusy(false);
    onNote?.(tr("libs.gradle_scanned", "解析到 {n} 条依赖", { n: deps.length }));
  }, [nativeProjectRoot, native, aiFileIo, onNote, tr]);

  /** M345：下载一条 gradle 依赖（优先原生多镜像，浏览器回退 fetch）。
   *  M358/M359：一律下到共享库 /AndroidUIIDE/libs（跨项目复用），不再按「是否打开项目」写到
   *  app/src/main/libs。应用到项目=写 maven 坐标（M359），编译时从共享库取实体（M361），
   *  不预拷进项目目录。 */
  const downloadGradleDep = useCallback(
    async (d: GradleDep) => {
      const key = d.group + ":" + d.name + ":" + d.version;
      if (gradleBusyKey[key] === "downloading") return;
      setGradleBusyKey((m) => ({ ...m, [key]: "downloading" }));
      const fname = gradleDepFname(d);
      // M358/M359：固定下到共享库 localDir（/AndroidUIIDE/libs），不看是否打开项目
      const targetBase: string | null = localDir || null;
      const target = targetBase ? `${targetBase}/${fname}` : null;
      const urls = gradleDepDownloadUrls(d);
      if (targetBase) {
        // M357/M365：系统 DownloadManager（后台 + 通知 + 弹窗）；失败回退 HttpURLConnection
        const res = await dlWithFallback(urls, fname, targetBase);
        if (res.ok) {
          setGradleBusyKey((m) => ({ ...m, [key]: "done" }));
          onNote?.(tr("libs.gradle_dl_done_shared", "{lib} 已下载到共享库（跨项目复用）", { lib: key }) + integSuffix(res.integrity));
          void refresh();
        } else {
          setGradleBusyKey((m) => ({ ...m, [key]: "err:" + (res.error || "download failed") }));
          onNote?.(tr("libs.gradle_dl_fail", "{lib} 下载失败：{err}", { lib: key, err: res.error || "?" }));
        }
        return;
      }
      if (target && typeof native?.downloadLib === "function") {
        native.createEntry?.(targetBase!, true);
        let r = "";
        try { r = String(native.downloadLib(JSON.stringify(urls), target) ?? ""); } catch (e2) { r = "throw:" + String(e2); }
        if (r.startsWith("ok")) {
          setGradleBusyKey((m) => ({ ...m, [key]: "done" }));
          onNote?.(tr("libs.gradle_dl_done_shared", "{lib} 已下载到共享库（跨项目复用）", { lib: key }));
          void refresh();
          return;
        }
        setGradleBusyKey((m) => ({ ...m, [key]: "err:" + (r.slice(4) || "download failed") }));
        onNote?.(tr("libs.gradle_dl_fail", "{lib} 下载失败：{err}", { lib: key, err: r.slice(4) || "?" }));
        return;
      }
      // 浏览器回退（web 没有共享库概念，下到浏览器 Downloads；APK 不会走这里）
      for (const url of orderBySecurity(urls)) {
        const r = await fetchBase64(url);
        if (!r.ok) continue;
        if (targetBase && native) {
          native.createEntry?.(targetBase, true);
          const w = native.writeText?.(target!, r.b64);
          if (typeof w === "string" && w.startsWith("ok")) {
            setGradleBusyKey((m) => ({ ...m, [key]: "done" }));
            onNote?.(tr("libs.gradle_dl_done_shared", "{lib} 已下载到共享库（跨项目复用）", { lib: key }));
            void refresh();
            return;
          }
        }
      }
      setGradleBusyKey((m) => ({ ...m, [key]: "err:" + tr("libs.cat_all_failed", "全部镜像下载失败（网络不通或源 404）") }));
      onNote?.(tr("libs.gradle_dl_fail", "{lib} 下载失败：全部镜像都试过了（网络不通或源 404）", { lib: key }));
    },
    [localDir, native, onNote, tr, refresh, dlWithFallback, integSuffix],
  );

  /** M345：一键下载（只下尚未下载、且不在本地库的） */
  const downloadAllGradleDeps = useCallback(async () => {
    const missing = gradleDeps.filter((d) => {
      const k = d.group + ":" + d.name + ":" + d.version;
      if (gradleBusyKey[k] === "done") return false;
      if (presentNames.has(gradleDepFname(d))) return false;
      return true;
    });
    if (missing.length === 0) {
      onNote?.(tr("libs.download_all_none", "依赖都已下载，没有要补的"));
      return;
    }
    setGradleBusy(true);
    try {
      for (const d of missing) {
        await downloadGradleDep(d);
      }
    } finally {
      setGradleBusy(false);
    }
  }, [gradleDeps, gradleBusyKey, presentNames, downloadGradleDep, onNote, tr]);

  // ===== M401/M430：统一「添加依赖」弹窗（Maven / 本地库目录 两个 tab）=====
  /** 要改哪个 fileTree 声明（null = 新建一条）；ftIncludes 多选（*.jar/*.aar…） */
  const [ftTarget, setFtTarget] = useState<number | null>(null);
  const [ftDir, setFtDir] = useState("");
  const [ftIncludes, setFtIncludes] = useState<string[]>([]);
  /** 加依赖弹窗 */
  const [depOpen, setDepOpen] = useState(false);
  const [depModalTab, setDepModalTab] = useState<"maven" | "ft">("maven");
  const [depInput, setDepInput] = useState("");
  const [depBusy, setDepBusy] = useState(false);
  // M430：依赖 exclude 展开状态（key = g:n:v）
  const [depExOpen, setDepExOpen] = useState<Record<string, boolean>>({});
  // M430：编辑依赖弹窗 / exclude 弹窗（add 与 edit 共用：old=null 是添加）/ 编辑 fileTree
  const [depEdit, setDepEdit] = useState<GradleDep | null>(null);
  const [editForm, setEditForm] = useState({ group: "", name: "", version: "", config: "implementation" });
  const [exTarget, setExTarget] = useState<{ dep: GradleDep; old: { group: string; module: string } | null } | null>(null);
  const [exForm, setExForm] = useState({ group: "", module: "" });

  const openFtModal = useCallback((idx: number | null) => {
    if (!nativeProjectRoot) {
      onNote?.(tr("libs.ft_need_project", "请先打开一个项目，才能改 build.gradle 的 fileTree"));
      return;
    }
    if (idx === null) {
      setFtTarget(null);
      setFtDir("");
      setFtIncludes(["*.jar", "*.aar"]);
    } else {
      const ft = gradleFileTrees[idx];
      setFtTarget(idx);
      setFtDir(ft?.dir || "");
      setFtIncludes(ft?.includes?.length ? ft.includes : ["*.jar", "*.aar"]);
    }
    setDepModalTab("ft");
    setDepOpen(true);
  }, [nativeProjectRoot, gradleFileTrees, onNote, tr]);

  /** 写 gradle 文件：native 优先（绝对路径），失败回退 aiFileIo（相对路径） */
  const writeGradleFile = useCallback(
    async (rel: string, text: string) => {
      const root = nativeProjectRoot?.replace(/[\\/]+$/, "");
      if (root && native?.writeText) {
        try {
          const r = String(native.writeText(root + "/" + rel, btoa(unescape(encodeURIComponent(text)))) ?? "");
          if (r.startsWith("ok")) return true;
        } catch { /* fall through */ }
      }
      if (aiFileIo?.write) {
        try { const r = await aiFileIo.write(rel, text); if (r.ok) return true; } catch { /* ignore */ }
      }
      return false;
    },
    [nativeProjectRoot, native, aiFileIo],
  );

  /** M430：复制文本（坐标 / 排除项）到剪贴板 */
  const copyCoord = useCallback(
    async (text: string) => {
      try {
        if (navigator?.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          onNote?.(tr("libs.copied", "已复制：{t}", { t: text }));
          return;
        }
      } catch { /* fall through */ }
      onNote?.(tr("libs.copy_fail", "复制失败，请手动选中：{t}", { t: text }));
    },
    [onNote, tr],
  );

  /** M430：对 build.gradle 做文本变换并写回（app/ 优先，其次根目录；.kts 自动识别）。
   *  读/写双通道：native 绝对路径优先，失败回退 aiFileIo 相对路径（web/SAF 项目也能改 gradle）。 */
  const applyGradleEdit = useCallback(
    async (
      fn: (text: string, kts: boolean) => [string, boolean],
      okNote: (rel: string) => string,
      failNote: string,
    ): Promise<boolean> => {
      if (!nativeProjectRoot && !aiFileIo) {
        onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能改 build.gradle"));
        return false;
      }
      const root = (nativeProjectRoot || "").replace(/[\\/]+$/, "");
      for (const rel of ["app/build.gradle", "app/build.gradle.kts", "build.gradle", "build.gradle.kts"]) {
        let text = "";
        if (root && native?.readText) {
          try {
            const t = String(native.readText(root + "/" + rel) ?? "");
            if (t && !t.startsWith("err:")) text = t;
          } catch { /* fall through */ }
        }
        if (!text && aiFileIo?.read) {
          try {
            const r = await aiFileIo.read(rel);
            if (r.ok) text = r.text || "";
          } catch { /* ignore */ }
        }
        if (!text) continue;
        const [next, changed] = fn(text, rel.endsWith(".kts"));
        if (!changed) continue;
        if (!(await writeGradleFile(rel, next))) continue;
        onNote?.(okNote(rel));
        void refresh();
        void scanGradleDeps();
        return true;
      }
      onNote?.(failNote);
      return false;
    },
    [nativeProjectRoot, aiFileIo, native, writeGradleFile, onNote, tr, refresh, scanGradleDeps],
  );

  /** M430：保存 fileTree 配置（新建 / 编辑），走 updateFileTree / insertFileTree 纯函数 */
  const saveFtConfig = useCallback(async () => {
    const dir = ftDir.trim();
    if (!dir) { onNote?.(tr("libs.ft_dir_empty", "目录不能为空")); return; }
    const inc = ftIncludes.map((s) => s.trim()).filter(Boolean);
    const desc = `${dir}${inc.length ? " · " + inc.join(", ") : ""}`;
    if (ftTarget === null) {
      let dup = false;
      const ok = await applyGradleEdit(
        (text, kts) => {
          const [t, existed] = insertFileTree(text, { dir, includes: inc }, kts);
          if (existed) { dup = true; return [text, false]; }
          return [t, true];
        },
        (rel) => tr("libs.ft_added2", "已加 fileTree {d}（{f}）", { d: desc, f: rel }),
        tr("libs.ft_save_fail2", "写 fileTree 失败：没找到可写的 build.gradle（app/build.gradle 或根目录）"),
      );
      if (dup && !ok) onNote?.(tr("libs.ft_dup", "该库目录配置已存在：{d}", { d: desc }));
      if (ok) setDepOpen(false);
      return;
    }
    const oldDir = gradleFileTrees[ftTarget]?.dir || "";
    const ok = await applyGradleEdit(
      (text, kts) => updateFileTree(text, oldDir, { dir, includes: inc }, kts),
      (rel) => tr("libs.ft_saved2", "fileTree 已改为 {d}（{f}）", { d: desc, f: rel }),
      tr("libs.ft_save_fail", "没找到含该 fileTree 的 gradle 文件（或写失败）"),
    );
    if (ok) setDepOpen(false);
  }, [ftDir, ftIncludes, ftTarget, gradleFileTrees, applyGradleEdit, onNote, tr]);

  /** M430：删一条 fileTree 声明 */
  const removeFtConfig = useCallback(
    async (dir: string) => {
      if (!dir) return;
      await applyGradleEdit(
        (text, kts) => removeFileTree(text, dir),
        (rel) => tr("libs.ft_removed", "已移除库目录 {d} 的 fileTree 声明（{f}）", { d: dir, f: rel }),
        tr("libs.ft_remove_fail", "没找到该 fileTree 声明（或写失败）"),
      );
    },
    [applyGradleEdit, tr],
  );

  /** M430：删掉某条依赖的某一条 exclude */
  const removeOneExclude = useCallback(
    async (d: GradleDep, ex: { group: string; module: string }) => {
      await applyGradleEdit(
        (text, kts) =>
          removeExcludeFromDep(text, { group: d.group, name: d.name, version: d.version }, ex, kts),
        () => tr("libs.ex_removed", "已删 exclude {g}:{m}", { g: ex.group, m: ex.module }),
        tr("libs.ex_remove_fail", "没找到该 exclude 条目（或写失败）"),
      );
    },
    [applyGradleEdit, tr],
  );

  /** M431：exclude 弹窗提交 —— old=null 是添加；old 有值是编辑（删旧+写新，一次 applyGradleEdit 内完成） */
  const submitAddExclude = useCallback(async () => {
    const t = exTarget;
    if (!t) return;
    const g = exForm.group.trim();
    const m = exForm.module.trim();
    if (!g || !m) { onNote?.(tr("libs.ex_invalid", "group 和 module 都要填")); return; }
    const coord = { group: t.dep.group, name: t.dep.name, version: t.dep.version };
    const old = t.old;
    const ok = await applyGradleEdit(
      (text, kts) => {
        if (!old) return addExcludesToGradle(text, coord, [{ group: g, module: m }], kts);
        const [t1, ok1] = removeExcludeFromDep(text, coord, old, kts);
        if (!ok1) return [text, false];
        return addExcludesToGradle(t1, coord, [{ group: g, module: m }], kts);
      },
      () => (old ? tr("libs.ex_edited", "exclude 已改为 {g}:{m}", { g, m }) : tr("libs.ex_added", "已加 exclude {g}:{m}", { g, m })),
      tr(old ? "libs.ex_edit_fail" : "libs.ex_add_fail", old ? "改 exclude 失败：没找到该条目（或写失败）" : "加 exclude 失败：没找到该依赖声明（或写失败）"),
    );
    if (ok) { setExTarget(null); setExForm({ group: "", module: "" }); }
  }, [exTarget, exForm, applyGradleEdit, onNote, tr]);

  /** M430：保存「编辑依赖」（改坐标 / 配置类型，保 exclude 块） */
  const submitDepEdit = useCallback(async () => {
    const d = depEdit;
    if (!d) return;
    const g = editForm.group.trim();
    const n = editForm.name.trim();
    const v = editForm.version.trim();
    if (!g || !n || !v) { onNote?.(tr("libs.dep_edit_invalid", "group / artifact / version 都不能为空")); return; }
    const cfg = editForm.config || "implementation";
    const ok = await applyGradleEdit(
      (text, kts) =>
        updateImplementation(text, `${d.group}:${d.name}:${d.version}`, { group: g, name: n, version: v, config: cfg }, kts),
      () => tr("libs.dep_edited", "依赖已改为 {c}", { c: `${cfg} ${g}:${n}:${v}` }),
      tr("libs.dep_edit_fail", "改依赖失败：没找到该声明（或写失败）"),
    );
    if (ok) setDepEdit(null);
  }, [depEdit, editForm, applyGradleEdit, onNote, tr]);


  /** M401：加 maven 依赖弹窗——解析输入，去重后写 build.gradle 的 implementation + settings.gradle 的 repositories */
  const openDepModal = useCallback((tab: "maven" | "ft" = "maven") => {
    if (!nativeProjectRoot) {
      onNote?.(tr("libs.apply_need_project", "请先打开一个项目，才能应用库"));
      return;
    }
    setDepInput("");
    setDepModalTab(tab);
    if (tab === "ft") { setFtTarget(null); setFtDir(""); setFtIncludes(["*.jar", "*.aar"]); }
    setDepOpen(true);
  }, [nativeProjectRoot, onNote, tr]);

  const submitNewDep = useCallback(async () => {
    // 解析：支持 "group:artifact:version"（可多个，空格/分号/换行分隔）或仅 "artifact"（默认 gson 坐标）
    const raws = depInput.split(/[\s;]+/).map((s) => s.trim()).filter(Boolean);
    if (!raws.length) return;
    const newDeps: GradleDep[] = [];
    const skipped: string[] = [];
    const dup = new Set<string>();
    const gradleRe = /^(\w[\w.]*):([\w.-]+):([\w.$-]+)/;
    for (const raw of raws) {
      let d: GradleDep | null = null;
      const m = raw.match(gradleRe);
      if (m) {
        d = { group: m[1], name: m[2], version: m[3], raw, config: "implementation", isAar: m[1].startsWith("androidx.") || m[1].startsWith("com.google.android.") };
      } else if (/^[\w.-]+$/.test(raw)) {
        // 仅 artifact 名 → 在内置目录里找坐标，找不到就 group=com.example
        const cat = LIBRARY_CATALOG.find((e) => e.artifact.toLowerCase() === raw.toLowerCase());
        d = {
          group: cat ? cat.group : "com.example",
          name: cat ? cat.artifact : raw,
          version: cat ? cat.version : "1.0",
          raw: cat ? mavenCoord(cat.group, cat.artifact, cat.version) : raw,
          config: "implementation",
          isAar: cat?.isAar ?? false,
        };
      }
      if (!d) { skipped.push(raw + tr("libs.dep_bad_format", "（格式认不出）")); continue; }
      const key = d.group + ":" + d.name + ":" + d.version;
      if (gradleDeps.some((x) => x.group + ":" + x.name + ":" + x.version === key) || dup.has(key)) {
        skipped.push(key + tr("libs.dep_dup", "（重复）"));
        continue;
      }
      dup.add(key);
      newDeps.push(d);
    }
    if (!newDeps.length) {
      onNote?.(tr("libs.dep_all_skipped", "没有可加的依赖：{l}", { l: skipped.join("、") || depInput }));
      setDepOpen(false);
      return;
    }
    setDepBusy(true);
    try {
      // 每个新依赖：写 implementation + 仓库 url（google/mavenCentral 按 group 判定）
      for (const d of newDeps) {
        const repoUrl = d.isAar || d.group.startsWith("androidx.") || d.group.startsWith("com.google.android.")
          ? "https://dl.google.com/dl/android/maven2"
          : "https://repo.maven.apache.org/maven2";
        await applyMaven(mavenCoord(d.group, d.name, d.version), repoUrl, d.name);
      }
      const extra = skipped.length ? tr("libs.dep_skipped", "；跳过：") + skipped.join("、") : "";
      onNote?.(tr("libs.dep_added", "已加 {n} 条 maven 依赖{extra}", { n: String(newDeps.length), extra }));
      setDepOpen(false);
      void scanGradleDeps();
      void refresh();
    } finally {
      setDepBusy(false);
    }
  }, [depInput, gradleDeps, applyMaven, onNote, tr, scanGradleDeps, refresh]);


  /** M360：打开项目时自动检查依赖 + 一键补齐。
   *  M372：native 项目或有 SAF 源（aiFileIo）都自动扫一次，不再需要手动按钮。
   *  不静默自动下载（省流量/可控），只扫出缺失，banner 上「自动补齐」一键下。 */
  const lastAutoScanRoot = useRef<string | null>(null);
  const scanKey = nativeProjectRoot || (aiFileIo ? "io" : null);
  useEffect(() => {
    if (!scanKey) { lastAutoScanRoot.current = null; return; }
    if (lastAutoScanRoot.current === scanKey) return; // 同项目不重扫
    lastAutoScanRoot.current = scanKey;
    void scanGradleDeps();
  }, [scanKey, scanGradleDeps]);

  return (
    <div className="axv-libs-panel">
      <div className="axv-libs-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "local"}
          className={tab === "local" ? "on" : ""}
          onClick={() => setTab("local")}
        >
          {tr("libs.local", "共享库")}{localLibs.length > 0 ? ` (${localLibs.length})` : ""}
        </button>
        <button
          role="tab"
          aria-selected={tab === "project"}
          className={tab === "project" ? "on" : ""}
          onClick={() => setTab("project")}
        >
          {tr("libs.project", "项目库")}{projectLibs.length > 0 ? ` (${projectLibs.length})` : ""}
        </button>
        <button
          role="tab"
          aria-selected={tab === "catalog"}
          className={tab === "catalog" ? "on" : ""}
          onClick={() => setTab("catalog")}
        >
          {tr("libs.catalog", "常用库")}
        </button>
      </div>

      <div className="axv-libs-actions">
        <input
          type="search"
          className="axv-libs-search"
          value={libQuery}
          onChange={(e) => setLibQuery(e.target.value)}
          placeholder={tr("libs.search_hint", "搜库名 / 包名…")}
          aria-label={tr("libs.search", "搜索库")}
        />
        <button type="button" className="axv-libs-btn" onClick={() => setDlOpen(true)}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>download</span>
          {tr("libs.download", "下载库文件")}
        </button>
      </div>

      {/* M373：列表上方一键下载（缺的依赖在列表里直接看得到，不再弹警告条）
          M431：刷新按钮移到这一行（始终渲染，任何 tab 都能刷）；一键下载仅项目 tab 有依赖时显示 */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, margin: "0 8px 6px" }}>
        {tab === "project" && gradleDeps.length > 0 && (
          <button
            type="button"
            className="axv-libs-btn primary"
            style={{ fontSize: 11, padding: "4px 8px", whiteSpace: "nowrap" }}
            disabled={gradleBusy}
            onClick={() => void downloadAllGradleDeps()}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 15, verticalAlign: "middle", marginRight: 3 }}>cloud_download</span>
            {gradleBusy ? tr("libs.downloading", "下载中…") : tr("libs.download_all", "一键下载")}
          </button>
        )}
        <button
          type="button"
          className="axv-libs-btn"
          disabled={busy || gradleBusy}
          onClick={() => {
            // M431b：点刷新 = 文件列表重扫 + build.gradle 重解析（外部改了 gradle 也能刷出来）
            void refresh();
            void scanGradleDeps();
          }}
        >
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>refresh</span>
          {tr("refresh", "刷新")}
        </button>
      </div>

      <div className="axv-libs-list axv-rail-scroll">
        {tab === "local" && (
          <div style={{ fontSize: 10, opacity: 0.6, margin: "2px 6px 6px", lineHeight: 1.5, wordBreak: "break-all" }}>
            {tr("libs.local_hint", "共享库目录：{path}", { path: localDir || "/AndroidUIIDE/libs" })}
          </div>
        )}
        {tab === "project" && gradleScanned && (gradleDeps.length > 0 || gradleFileTrees.length > 0) && (
          <div style={{ fontSize: 10, opacity: 0.6, margin: "2px 6px 6px", lineHeight: 1.5, wordBreak: "break-all" }}>
            {tr("libs.project_hint", "build.gradle：maven {n} 条（下方可下）；本地目录 {dirs}", {
              n: gradleDeps.length,
              dirs: gradleFileTrees.length
                ? gradleFileTrees.map((f) => f.dir).join(", ")
                : tr("libs.none", "无"),
            })}
          </div>
        )}
        {/* M426：依赖冲突黄条——同名多版本 / 跨 group 同名 */}
        {tab === "project" && depConflicts.length > 0 && (
          <div style={{ background: "#fff3cd", border: "1px solid #ffc107", borderRadius: 6, margin: "4px 8px 6px", padding: "6px 8px", fontSize: 11, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 600, color: "#856404", marginBottom: 4 }}>
              {tr("libs.dep_conflict", "依赖冲突：{n} 处", { n: depConflicts.length })}
            </div>
            {depConflicts.map((c, i) => (
              <div key={i} style={{ color: "#856404", marginBottom: 2, wordBreak: "break-all" }}>
                {c.kind === "version"
                  ? tr("libs.dep_conflict_version", "{a} 多版本：{v}（Gradle 会按规则取一个，建议手动统一到最新）", {
                      a: c.artifact,
                      v: c.coords.join(", "),
                    })
                  : tr("libs.dep_conflict_name", "{a} 同名来自不同 group：{g}（注意包名冲突）", {
                      a: c.artifact,
                      g: c.coords.join(", "),
                    })}
              </div>
            ))}
          </div>
        )}
        {/* M372：build.gradle 解析出的引用库直接进列表（打开项目自动解析，无需按钮） */}
        {tab === "project" && (
          <>
            {gradleMsg && (
              <div className="axv-libs-empty" style={{ padding: "4px 8px", fontSize: 11 }}>{gradleMsg}</div>
            )}
            {gradleScanned && gradleDeps.length === 0 && !gradleMsg && gradleUnresolved.length === 0 && (
              <div className="axv-libs-empty" style={{ padding: "8px", fontSize: 11, lineHeight: 1.6 }}>
                {tr("libs.gradle_none", "没解析到 maven 依赖（fileTree / project 除外）")}
                <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                  <button type="button" className="axv-libs-btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => openDepModal("maven")}>
                    + {tr("libs.dep_add", "加依赖（Maven）")}
                  </button>
                  <button type="button" className="axv-libs-btn" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => openFtModal(null)}>
                    + {tr("libs.ft_new", "新建库目录")}
                  </button>
                </div>
              </div>
            )}
            {gradleUnresolved.length > 0 && (
              <div
                className="axv-libs-empty"
                style={{ padding: "4px 8px", fontSize: 11 }}
                title={gradleUnresolved.map((u) => u.raw).join("\n")}
              >
                {tr("libs.gradle_unresolved", "{n} 条依赖的版本是变量且本文件未定义，已跳过（在 build.gradle 里给变量赋值后可重新解析）", {
                  n: gradleUnresolved.length,
                })}
              </div>
            )}
            {gradleUnresolved.map((u) => (
              <div key={u.coord} className="axv-libs-item" style={{ alignItems: "center", opacity: 0.6 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="axv-libs-item-name" style={{ fontSize: 12 }}>
                    {u.coord.split(":")[1] || u.coord}
                    <span style={{ marginLeft: 6, fontSize: 10 }}>{u.config}</span>
                  </div>
                  <div className="axv-libs-item-rel" style={{ fontSize: 10 }} title={u.raw}>
                    {tr("libs.gradle_unresolved_vars", "未定义变量：{vars}", { vars: u.vars.join(", ") || "?" })}
                  </div>
                </div>
              </div>
            ))}
            {/* M430：maven 依赖行 —— 有 exclude 的可展开，长按菜单支持编辑/加排除/复制/移除 */}
            {gradleDeps.filter((d) => matchGradleDep(d, libQuery)).map((d) => {
              const key = d.group + ":" + d.name + ":" + d.version;
              const st = gradleBusyKey[key] || "";
              const present = presentNames.has(gradleDepFname(d));
              const exs = d.excludes || [];
              const exOpen = !!depExOpen[key];
              return (
                <div key={key}>
                  <div
                    className="axv-libs-item"
                    style={{ alignItems: "center" }}
                    {...bindLongPress([
                      {
                        key: "add",
                        label: tr("libs.dep_add_menu", "添加依赖"),
                        onClick: () => openDepModal("maven"),
                      },
                      {
                        key: "ftadd",
                        label: tr("libs.ft_new", "新建库目录"),
                        onClick: () => openFtModal(null),
                      },
                      {
                        key: "edit",
                        label: tr("libs.edit", "编辑"),
                        onClick: () => {
                          setDepEdit(d);
                          setEditForm({ group: d.group, name: d.name, version: d.version, config: d.config || "implementation" });
                        },
                      },
                      {
                        key: "exadd",
                        label: tr("libs.ex_add", "添加 exclude"),
                        onClick: () => { setExTarget({ dep: d, old: null }); setExForm({ group: "", module: "" }); },
                      },
                      { key: "copy", label: tr("libs.copy", "复制"), onClick: () => void copyCoord(key) },
                      ...(present || st === "done"
                        ? [{ key: "save", label: tr("libs.save_libs", "存 libs"), onClick: () => saveSharedToLibs(gradleDepFname(d)) }]
                        : []),
                      { key: "remove", label: tr("libs.remove", "移除"), danger: true, onClick: () => void removeFromProject(gradleDepFname(d), d) },
                    ])}
                  >
                    {exs.length > 0 ? (
                      <button
                        type="button"
                        aria-label={tr("libs.ex_toggle", "展开 / 收起 exclude")}
                        onClick={() => setDepExOpen((m) => ({ ...m, [key]: !m[key] }))}
                        style={{ background: "none", border: "none", padding: 0, marginRight: 2, cursor: "pointer", display: "flex" }}
                      >
                        <span className="msr" aria-hidden="true" style={{ fontSize: 18, opacity: 0.6 }}>
                          {exOpen ? "expand_more" : "chevron_right"}
                        </span>
                      </button>
                    ) : null}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="axv-libs-item-name" style={{ fontSize: 12 }}>
                        {(present || st === "done") && <span style={{ color: "#1a7f37", marginRight: 4 }}>✓</span>}
                        {d.name}
                        <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 11 }}>{d.version}</span>
                        <span style={{ opacity: 0.4, marginLeft: 6, fontSize: 10 }}>{d.config}</span>
                        {exs.length > 0 && (
                          <span
                            style={{
                              marginLeft: 6, fontSize: 9, padding: "0 4px", borderRadius: 3,
                              background: "rgba(0,0,0,0.07)", color: "#555", whiteSpace: "nowrap",
                            }}
                          >
                            {tr("libs.ex_badge", "exclude {n}", { n: exs.length })}
                          </span>
                        )}
                      </div>
                      <div className="axv-libs-item-rel" style={{ fontSize: 10, opacity: 0.6 }} title={key}>
                        {d.group}
                      </div>
                    </div>
                    {present || st === "done" ? (
                      <span style={{ fontSize: 11, color: "#1a7f37", whiteSpace: "nowrap", marginRight: 6 }}>
                        {tr("libs.cat_present", "已下载")}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="axv-libs-btn"
                        style={{ whiteSpace: "nowrap", fontSize: 11, padding: "2px 8px", marginRight: 6 }}
                        disabled={st === "downloading"}
                        onClick={() => void downloadGradleDep(d)}
                      >
                        {st === "downloading" ? tr("libs.downloading", "下载中…") : tr("libs.cat_download", "下载")}
                      </button>
                    )}
                    {st && st.startsWith("err:") && (
                      <span style={{ fontSize: 10, color: "#c62828", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={st.slice(4)}>
                        ✗ {st.slice(4)}
                      </span>
                    )}
                  </div>
                  {exOpen && exs.length > 0 && (
                    <div style={{ paddingLeft: 26 }}>
                      {exs.map((ex) => (
                        <div
                          key={ex.group + ":" + ex.module}
                          className="axv-libs-item"
                          style={{ alignItems: "center", padding: "2px 6px", background: "rgba(0,0,0,0.02)" }}
                          {...bindLongPress([
                            {
                              key: "exedit",
                              label: tr("libs.ex_edit", "编辑 exclude"),
                              onClick: () => { setExTarget({ dep: d, old: ex }); setExForm({ group: ex.group, module: ex.module }); },
                            },
                            { key: "copy", label: tr("libs.copy", "复制"), onClick: () => void copyCoord(ex.group + ":" + ex.module) },
                            { key: "del", label: tr("libs.ex_del", "删除这条 exclude"), danger: true, onClick: () => void removeOneExclude(d, ex) },
                          ])}
                        >
                          <div style={{ flex: 1, minWidth: 0, fontSize: 10, opacity: 0.75, fontFamily: "monospace", wordBreak: "break-all" }}>
                            {ex.group} : {ex.module}
                          </div>
                          <button
                            type="button"
                            title={tr("libs.ex_del", "删除这条 exclude")}
                            onClick={() => void removeOneExclude(d, ex)}
                            style={{ background: "none", border: "none", color: "#c62828", fontSize: 14, padding: "0 4px", cursor: "pointer", lineHeight: 1 }}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {/* M425：fileTree 配置二级列表 —— 组头可折叠，展开显示该目录下的库文件；组头右侧编辑按钮 */}
            {gradleFileTrees.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {projectLibGroups.ftGroups.map((g) => {
                  const open = !!ftExpanded[g.index];
                  return (
                    <div key={"ft" + g.index}>
                      <div
                        className="axv-libs-item"
                        style={{ alignItems: "center", cursor: "pointer", background: "rgba(0,0,0,0.03)" }}
                        onClick={() => setFtExpanded((m) => ({ ...m, [g.index]: !m[g.index] }))}
                        title={g.ft.dir}
                        {...bindLongPress([
                          { key: "edit", label: tr("libs.ft_edit", "编辑库目录"), onClick: () => openFtModal(g.index) },
                          { key: "ftadd", label: tr("libs.ft_new", "新建库目录"), onClick: () => openFtModal(null) },
                          {
                            key: "del",
                            label: tr("libs.ft_remove", "移除这条 fileTree"),
                            danger: true,
                            onClick: () => void removeFtConfig(g.ft.dir),
                          },
                        ])}
                      >
                        <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
                          {open ? "expand_more" : "chevron_right"}
                        </span>
                        <div className="axv-libs-item-text">
                          <div className="axv-libs-item-name" style={{ fontWeight: 600 }}>
                            {tr("libs.ft_group", "库目录")} · {g.ft.dir || "?"}
                            <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>
                              ({g.files.length})
                            </span>
                          </div>
                          <div className="axv-libs-item-rel" style={{ opacity: 0.6 }}>
                            {g.ft.includes.length
                              ? tr("libs.ft_inc", "include: {inc}", { inc: g.ft.includes.join(", ") })
                              : tr("libs.ft_include_all", "include: 全部 jar/aar")}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="axv-libs-btn"
                          style={{ fontSize: 11, padding: "2px 8px", whiteSpace: "nowrap", flex: "0 0 auto" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            openFtModal(g.index);
                          }}
                          title={tr("libs.ft_edit", "编辑库目录")}
                        >
                          <span className="msr" aria-hidden="true" style={{ fontSize: 15, verticalAlign: "middle", marginRight: 3 }}>edit</span>
                          {tr("libs.edit", "编辑")}
                        </button>
                      </div>
                      {open && (
                        g.files.length > 0 ? (
                          <div style={{ paddingLeft: 14 }}>
                            {g.files.map((f) => renderProjectFileRow(f))}
                          </div>
                        ) : (
                          <div className="axv-libs-empty" style={{ padding: "2px 8px 6px 30px", fontSize: 11 }}>
                            {tr("libs.ft_empty", "该目录下暂无库文件（把 jar/aar 放进去后点刷新）")}
                          </div>
                        )
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {/* M431：列表底部常驻入口已删（功能在右键菜单：添加依赖；空项目时上方空态有入口） */}
            {/* 标准目录（app/src/main/libs 等，不被任何 fileTree 覆盖）的文件直接列出 */}
            {projectLibGroups.stdFiles.length > 0 && (
              <div style={{ marginTop: 4 }}>
                <div style={{ fontSize: 10, opacity: 0.6, margin: "2px 6px 4px" }}>
                  {tr("libs.std_dir", "标准目录（app/src/main/libs 等）")}
                </div>
                {projectLibGroups.stdFiles.map((f) => renderProjectFileRow(f))}
              </div>
            )}
          </>
        )}
        {tab === "catalog" ? (
          <div>
            <div style={{ fontSize: 11, opacity: 0.6, margin: "4px 6px 8px", lineHeight: 1.5 }}>
              {tr("libs.catalog_hint", "常用库目录：点「下载」自动存入共享库 /AndroidUIIDE/libs，再去「共享库」选择是否应用到项目；打包时项目 libs/ 的库自动进编译。")}
            </div>
            {catGroups.filter((g) => !libQuery.trim() || g.libs.some((e) => matchGradleDep({ name: e.artifact, group: e.group }, libQuery))).map((g) => (
              <div key={g.kind} style={{ margin: "6px 4px" }}>
                <div style={{ fontSize: 11, fontWeight: 600, opacity: 0.7, margin: "2px 6px 6px" }}>
                  {g.label}（{g.libs.length}）
                </div>
                {g.libs.filter((e) => matchGradleDep({ name: e.artifact, group: e.group }, libQuery)).map((e) => {
                  const key = libKey(e);
                  const st = catBusy[key];
                  const present = presentNames.has(e.artifact + "-" + e.version + (e.isAar ? ".aar" : ".jar")) || st === "done";
                  return (
                    <div
                      key={key}
                      className="axv-libs-item"
                      style={{ alignItems: "center" }}
                      {...(present
                        ? bindLongPress([
                            { key: "save", label: tr("libs.save_libs", "存 libs"), onClick: () => saveSharedToLibs(e.artifact + "-" + e.version + (e.isAar ? ".aar" : ".jar")) },
                            {
                              key: "maven",
                              label: tr("libs.apply_maven", "应用到项目（maven）"),
                              onClick: () =>
                                void applyMaven(
                                  mavenCoord(e.group, e.artifact, e.version),
                                  e.kind === "material" || e.kind === "androidx"
                                    ? "https://dl.google.com/dl/android/maven2"
                                    : "https://repo.maven.apache.org/maven2",
                                  e.artifact,
                                ),
                            },
                          ])
                        : {})}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="axv-libs-item-name" style={{ fontSize: 12 }}>
                          {present && <span style={{ color: "#1a7f37", marginRight: 4 }}>✓</span>}
                          {e.artifact}
                          <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 11 }}>{e.version}</span>
                        </div>
                        <div className="axv-libs-item-rel" style={{ fontSize: 10, opacity: 0.6 }} title={e.group + ":" + e.artifact + ":" + e.version}>
                          {e.note}
                        </div>
                      </div>
                      {present ? (
                        <span style={{ fontSize: 11, color: "#1a7f37", whiteSpace: "nowrap", marginRight: 6 }}>
                          {tr("libs.cat_present", "已下载")}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="axv-libs-btn"
                          style={{ whiteSpace: "nowrap", fontSize: 11, padding: "2px 8px", marginRight: 6 }}
                          disabled={st === "downloading"}
                          onClick={() => void downloadCat(e)}
                        >
                          {st === "downloading" ? tr("libs.downloading", "下载中…") : tr("libs.cat_download", "下载")}
                        </button>
                      )}
                      {st && st.startsWith("err:") && (
                        <span style={{ fontSize: 10, color: "#c62828", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={st.slice(4)}>
                          ✗ {st.slice(4)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        ) : visibleList.length === 0 && !(tab === "project" && (gradleDeps.length > 0 || gradleFileTrees.length > 0 || gradleUnresolved.length > 0)) ? (
          <div className="axv-libs-empty">
            {libQuery.trim()
              ? tr("libs.search_empty", "没匹配「{q}」的库", { q: libQuery.trim() })
              : tr("libs.empty", "暂无库文件")}
            {tab === "project" && !aiFileIo && !nativeProjectRoot
              ? ` (${tr("libs.empty_hint", "需先打开项目目录")})`
              : ""}
          </div>
        ) : tab === "local" ? (
          visibleList.map((f) => {
            const applied = projectNames.has(f.name);
            const ab = applyBusy[f.name];
            // M388：本地库行 —— 删除/存 libs/移除 全走长按；行内只留状态（已应用）
            // 项目库行 —— 文件已在项目里，只需长按「移除」
            const menuItems: LibsMenuItem[] =
              tab === "local"
                ? [
                    { key: "apply", label: tr("libs.apply_dep", "应用"), disabled: ab === "maven" || ab === "applying", onClick: () => void applyLocalMaven(f.name) },
                    ...(applied
                      ? [
                          { key: "remove", label: tr("libs.remove", "移除"), danger: true, onClick: () => void removeFromProject(f.name) },
                        ]
                      : [
                          { key: "save", label: tr("libs.save_libs", "存 libs"), disabled: ab === "applying", onClick: () => void applyToLocalProject(f) },
                        ]),
                    ...(native?.deleteEntry
                      ? [
                          { key: "delete", label: tr("libs.delete", "删除"), danger: true, disabled: deleteBusy === f.rel, onClick: () => void deleteLocalLib(f) },
                        ]
                      : []),
                  ]
                : [
                    { key: "remove", label: tr("libs.remove", "移除"), danger: true, onClick: () => void removeFromProject(f.name) },
                  ];
            return (
              <div key={f.rel} className="axv-libs-item" {...bindLongPress(menuItems)}>
                <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>archive</span>
                <div className="axv-libs-item-text">
                  <div className="axv-libs-item-name">
                    {f.name}
                    <span style={{ opacity: 0.5, marginLeft: 6, fontSize: 10 }}>{formatBytes(f.size) || ""}</span>
                  </div>
                  <div className="axv-libs-item-rel">{f.rel}</div>
                </div>
                {tab === "local" && applied ? (
                  <span style={{ fontSize: 10, color: "#1a7f37", flex: "0 0 auto" }}>{tr("libs.applied", "已应用")}</span>
                ) : null}
                {ab === "applying" ? (
                  <span style={{ fontSize: 10, opacity: 0.6, flex: "0 0 auto" }}>{tr("libs.applying", "应用中…")}</span>
                ) : null}
                {deleteBusy === f.rel ? (
                  <span style={{ fontSize: 10, opacity: 0.6, flex: "0 0 auto" }}>{tr("libs.deleting", "…")}</span>
                ) : null}
              </div>
            );
          })
        ) : null}
        {busy && <div className="axv-libs-loading">{tr("loading", "加载中…")}</div>}
      </div>

      {dlOpen && (
        <div className="axv-libs-dl-overlay" onClick={() => setDlOpen(false)}>
          <div className="axv-libs-dl-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="axv-libs-dl-title">{tr("libs.download", "下载库文件")}</div>
            <label className="axv-libs-field">
              <span>{tr("libs.url", "下载地址")}</span>
              <input
                value={dlUrl}
                onChange={(e) => setDlUrl(e.target.value)}
                placeholder="https://example.com/lib.jar"
              />
            </label>
            <label className="axv-libs-field">
              <span>{tr("libs.file_name", "文件名（可选）")}</span>
              <input
                value={dlName}
                onChange={(e) => setDlName(e.target.value)}
                placeholder="my-lib.jar"
              />
            </label>
            <div className="axv-libs-hint">
              {tr("libs.save_to", "保存到 {tab}", { tab: tab === "local" ? tr("libs.local", "共享库") : tr("libs.project", "项目库") })}
            </div>
            <div className="axv-libs-dl-actions">
              <button type="button" className="axv-libs-btn" onClick={() => setDlOpen(false)}>
                {tr("cancel", "取消")}
              </button>
              <button
                type="button"
                className="axv-libs-btn primary"
                disabled={dlBusy || !dlUrl.trim()}
                onClick={() => void doDownload()}
              >
                {dlBusy ? tr("libs.downloading", "正在下载…") : tr("libs.start_download", "开始下载")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* M430：统一「添加依赖」弹窗 —— Maven 库 / 本地库目录 两个 tab */}
      {depOpen && (
        <div className="axv-libs-dl-overlay" onClick={() => setDepOpen(false)}>
          <div className="axv-libs-dl-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 340 }}>
            <div className="axv-libs-dl-title">{tr("libs.add_dep_title", "添加依赖")}</div>
            <div style={{ display: "flex", gap: 6, margin: "6px 0 10px" }}>
              <button
                type="button"
                className={"axv-libs-btn" + (depModalTab === "maven" ? " primary" : "")}
                style={{ flex: 1, fontSize: 12 }}
                onClick={() => setDepModalTab("maven")}
              >
                {tr("libs.tab_maven", "Maven 库")}
              </button>
              <button
                type="button"
                className={"axv-libs-btn" + (depModalTab === "ft" ? " primary" : "")}
                style={{ flex: 1, fontSize: 12 }}
                onClick={() => setDepModalTab("ft")}
              >
                {tr("libs.tab_ft", "本地库目录")}
              </button>
            </div>

            {depModalTab === "maven" ? (
              <>
                <div style={{ fontSize: 11, opacity: 0.6, margin: "0 0 8px", lineHeight: 1.5, wordBreak: "break-all" }}>
                  {tr("libs.dep_hint", "一行一个，格式 group:artifact:version，例如 org.json:json:20231013。只输库名时按内置目录找坐标；已存在的依赖自动跳过。写进 build.gradle 的 implementation，仓库地址写进 settings.gradle；缺实体文件的依赖在列表里显示「下载」。")}
                </div>
                <textarea
                  className="axv-libs-dl-input"
                  value={depInput}
                  onChange={(e) => setDepInput(e.target.value)}
                  placeholder="com.google.code.gson:gson:2.10.1"
                  rows={4}
                  style={{ width: "100%", padding: "5px 8px", fontSize: 12, boxSizing: "border-box", border: "1px solid #ddd", borderRadius: 4, fontFamily: "monospace" }}
                />
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                  <button type="button" className="axv-libs-btn" onClick={() => setDepOpen(false)}>
                    {tr("cancel", "取消")}
                  </button>
                  <button type="button" className="axv-libs-btn primary" onClick={() => void submitNewDep()}
                    disabled={depBusy || !depInput.trim()}>
                    {depBusy ? tr("libs.downloading", "处理中…") : tr("libs.dep_submit", "添加")}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, opacity: 0.6, margin: "0 0 8px", lineHeight: 1.5 }}>
                  {tr("libs.ft_hint", "dir 是 build.gradle fileTree 的库目录（相对模块目录 app/，也可写全路径 app/libs）；include 是文件后缀名通配符。")}
                </div>
                <label className="axv-libs-dl-label" style={{ display: "block", marginBottom: 6 }}>
                  <span style={{ fontSize: 11, opacity: 0.7, display: "block", marginBottom: 2 }}>{tr("libs.ft_dir", "目录（dir）")}</span>
                  <input
                    className="axv-libs-dl-input"
                    type="text"
                    value={ftDir}
                    onChange={(e) => setFtDir(e.target.value)}
                    placeholder={tr("libs.dir_ph", "libs 或 ../libs")}
                    list="axv-ft-dir-list"
                    style={{ width: "100%", padding: "5px 8px", fontSize: 12, boxSizing: "border-box", border: "1px solid #ddd", borderRadius: 4 }}
                  />
                  <datalist id="axv-ft-dir-list">
                    <option value="libs" />
                    <option value="app/libs" />
                    <option value="app/src/main/libs" />
                  </datalist>
                </label>
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 4 }}>{tr("libs.ft_include", "后缀名（include，可多选）")}</div>
                  {["*.jar", "*.aar", "*.so", "*.zip"].map((p) => (
                    <label key={p} style={{ display: "inline-flex", alignItems: "center", gap: 4, marginRight: 10, fontSize: 12 }}>
                      <input
                        type="checkbox"
                        checked={ftIncludes.includes(p)}
                        onChange={(e) =>
                          setFtIncludes((prev) =>
                            e.target.checked ? [...prev, p] : prev.filter((x) => x !== p),
                          )
                        }
                      />
                      {p}
                    </label>
                  ))}
                </div>
                {ftDir.trim() && (
                  <div style={{ fontSize: 10, opacity: 0.55, marginBottom: 6, fontFamily: "monospace", wordBreak: "break-all" }}>
                    {`implementation fileTree(dir: '${ftDir.trim()}', include: [${ftIncludes.map((i) => `'${i}'`).join(", ")}])`}
                  </div>
                )}
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
                  <button type="button" className="axv-libs-btn" onClick={() => setDepOpen(false)}>
                    {tr("cancel", "取消")}
                  </button>
                  <button type="button" className="axv-libs-btn primary" onClick={() => void saveFtConfig()}
                    disabled={!ftDir.trim()}>
                    {tr("save", "保存")}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* M430：编辑依赖（改坐标 / 配置类型，保留 exclude 块） */}
      {depEdit && (
        <div className="axv-libs-dl-overlay" onClick={() => setDepEdit(null)}>
          <div className="axv-libs-dl-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 320 }}>
            <div className="axv-libs-dl-title">{tr("libs.dep_edit", "编辑依赖")}</div>
            {(["group", "name", "version"] as const).map((k) => (
              <label key={k} style={{ display: "block", marginBottom: 6 }}>
                <span style={{ fontSize: 11, opacity: 0.7, display: "block", marginBottom: 2 }}>
                  {k === "group" ? "group" : k === "name" ? "artifact" : "version"}
                </span>
                <input
                  className="axv-libs-dl-input"
                  type="text"
                  value={editForm[k]}
                  onChange={(e) => setEditForm((p) => ({ ...p, [k]: e.target.value }))}
                  style={{ width: "100%", padding: "5px 8px", fontSize: 12, boxSizing: "border-box", border: "1px solid #ddd", borderRadius: 4 }}
                />
              </label>
            ))}
            <label style={{ display: "block", marginBottom: 6 }}>
              <span style={{ fontSize: 11, opacity: 0.7, display: "block", marginBottom: 2 }}>{tr("libs.dep_config", "配置类型")}</span>
              <select
                value={editForm.config}
                onChange={(e) => setEditForm((p) => ({ ...p, config: e.target.value }))}
                style={{ width: "100%", padding: "5px 8px", fontSize: 12, boxSizing: "border-box", border: "1px solid #ddd", borderRadius: 4 }}
              >
                {["implementation", "api", "compileOnly", "runtimeOnly"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
            {depEdit.excludes?.length ? (
              <div style={{ fontSize: 10, opacity: 0.6, marginBottom: 4 }}>
                {tr("libs.dep_edit_keep_ex", "该依赖有 {n} 条 exclude，改坐标后原样保留", { n: depEdit.excludes.length })}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button type="button" className="axv-libs-btn" onClick={() => setDepEdit(null)}>
                {tr("cancel", "取消")}
              </button>
              <button type="button" className="axv-libs-btn primary" onClick={() => void submitDepEdit()}>
                {tr("save", "保存")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* M430/M431：给依赖添加 / 编辑一条 exclude */}
      {exTarget && (
        <div className="axv-libs-dl-overlay" onClick={() => setExTarget(null)}>
          <div className="axv-libs-dl-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ maxWidth: 320 }}>
            <div className="axv-libs-dl-title">{exTarget.old ? tr("libs.ex_edit", "编辑 exclude") : tr("libs.ex_add", "添加 exclude")}</div>
            <div style={{ fontSize: 11, opacity: 0.6, margin: "0 0 8px", lineHeight: 1.5, wordBreak: "break-all" }}>
              {exTarget.dep.group}:{exTarget.dep.name}:{exTarget.dep.version}
            </div>
            <label style={{ display: "block", marginBottom: 6 }}>
              <span style={{ fontSize: 11, opacity: 0.7, display: "block", marginBottom: 2 }}>group</span>
              <input
                className="axv-libs-dl-input"
                type="text"
                value={exForm.group}
                onChange={(e) => setExForm((p) => ({ ...p, group: e.target.value }))}
                placeholder="com.android.support"
                style={{ width: "100%", padding: "5px 8px", fontSize: 12, boxSizing: "border-box", border: "1px solid #ddd", borderRadius: 4 }}
              />
            </label>
            <label style={{ display: "block", marginBottom: 6 }}>
              <span style={{ fontSize: 11, opacity: 0.7, display: "block", marginBottom: 2 }}>module</span>
              <input
                className="axv-libs-dl-input"
                type="text"
                value={exForm.module}
                onChange={(e) => setExForm((p) => ({ ...p, module: e.target.value }))}
                placeholder="support-v4"
                style={{ width: "100%", padding: "5px 8px", fontSize: 12, boxSizing: "border-box", border: "1px solid #ddd", borderRadius: 4 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 10 }}>
              <button type="button" className="axv-libs-btn" onClick={() => setExTarget(null)}>
                {tr("cancel", "取消")}
              </button>
              <button type="button" className="axv-libs-btn primary" onClick={() => void submitAddExclude()}
                disabled={!exForm.group.trim() || !exForm.module.trim()}>
                {exTarget.old ? tr("save", "保存") : tr("libs.ex_submit", "添加")}
              </button>
            </div>
          </div>
        </div>
      )}

      {libMenu ? <LibsItemMenu state={libMenu} onClose={closeLibMenu} /> : null}
    </div>
  );
}
