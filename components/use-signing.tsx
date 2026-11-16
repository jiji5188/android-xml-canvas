import { useState, useMemo, useCallback, type RefObject } from "react";
import { projectSaveRoot, projectFileExists, readProjectFile, readAppGradle, saveProjectFile } from "@/lib/xml/project-save";
import type { ActiveProject } from "./XmlEditor";
import { readSigningFromGradle } from "@/lib/xml/signing";
import { readStoredSigning, writeStoredSigning, clearStoredSigning, type StoredSigning } from "@/lib/xml/sign-store";
import { nativeBridge } from "@/lib/xml/native-save";
import { readAppName } from "@/lib/xml/project-rename";

/**
 * M336c：签名对话框状态 + 逻辑从 XmlEditor 抽出（8 useState + signStored + 4 handler）。
 * 主组件里 <SigningDialog> 的 JSX 保留，这里只管 state 和逻辑。
 */
export interface SigningDeps {
  activeProject: ActiveProject | null;
  tt: (s: string, vars?: Record<string, string | number>) => string;
  setExportNote: (s: string) => void;
  noteTimerRef: RefObject<number | null>;
}

export function useSigning(deps: SigningDeps) {
  const { activeProject, tt, setExportNote, noteTimerRef } = deps;
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [gradleForSign, setGradleForSign] = useState<string | null>(null);
  const [gradleRelForSign, setGradleRelForSign] = useState<string>("app/build.gradle");
  const [signRootMissing, setSignRootMissing] = useState(false);
  const [signKeystoreExists, setSignKeystoreExists] = useState<boolean | undefined>(undefined);
  const [signAppName, setSignAppName] = useState<string | null>(null);
  const [signIconDefault, setSignIconDefault] = useState<boolean | undefined>(undefined);
  const [signStoredRev, setSignStoredRev] = useState(0);
  const LS_KEY_SIGN_DRAFT = "axv.signing.draft";

  const signStored = useMemo(
    () => readStoredSigning(activeProject?.name),
    [activeProject?.name, signDialogOpen, signStoredRev],
  );

  const openSignDialog = useCallback(async () => {
    const root = projectSaveRoot(activeProject);
    // M188c：统一走 readProjectFile（native 用 readTextQueued，web 用目录句柄）
    // M220b：支持 .kts 与无 app/ 前缀布局，并记住命中的路径供写回
    const found = await readAppGradle(root);
    const txt = found?.text ?? null;    // 没有可写根时，读 localStorage 里的草稿
    setGradleRelForSign(found?.rel ?? "app/build.gradle");
    const missing = !root;
    let use = txt;
    if (missing && !use) {
      try {
        const draft = window.localStorage.getItem(LS_KEY_SIGN_DRAFT);
        if (draft) use = draft;
      } catch { /* ignore */ }
    }
    // M189：查一下 keystore 文件在不在（发布前检查用）
    let exists: boolean | undefined;
    if (root && use) {
      const store = readSigningFromGradle(use)?.storeFile || ".axv/release.keystore";
      exists = await projectFileExists(root, store);
    }
    // M189+：读 strings.xml 的 app_name 和 manifest 图标，判断是否还是默认值
    let appName: string | null = null;
    let iconDefault: boolean | undefined;
    if (root) {
      const strings = await readProjectFile(root, "app/src/main/res/values/strings.xml");
      appName = strings ? readAppName(strings) : null;
      const mf = await readProjectFile(root, "app/src/main/AndroidManifest.xml");
      if (mf) {
        const m = /android:icon\s*=\s*"([^"]*)"/.exec(mf);
        const v = m ? m[1] : "";
        iconDefault = !v || /@(mipmap|drawable)\/ic_launcher(_round)?$/.test(v);
      }
    }
    setGradleForSign(use);
    setSignRootMissing(missing);
    setSignKeystoreExists(exists);
    setSignAppName(appName);
    setSignIconDefault(iconDefault);
    setSignDialogOpen(true);
  }, [activeProject]);

  /** M191：在设备上生成 keystore */
  const makeKeystoreOnDevice = useCallback(
    async (rel: string, o: { alias: string; password: string; cn: string; years: number }) => {
      const b = nativeBridge();
      if (!b?.makeKeystore) return { ok: false, msg: tt("当前 APK 版本还不支持在设备上生成，请升级到 1.16.27 以上") };
      const root = projectSaveRoot(activeProject);
      const base = root?.kind === "native" ? root.base.replace(/[/\\]+$/, "") : b.getDefaultWorkspace?.() || "";
      if (!base) return { ok: false, msg: tt("没有可写的项目目录") };
      const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
      const abs = `${base}/${clean}`;
      try {
        const r = b.makeKeystore(abs, o.alias, o.password, o.cn, "Android", o.years);
        if (r.startsWith("ok:")) return { ok: true, msg: r };
        return { ok: false, msg: r.replace(/^err:/, "") || tt("生成失败") };
      } catch (e) {
        return { ok: false, msg: e instanceof Error ? e.message : String(e) };
      }
    },
    [activeProject, tt],
  );

  /** M237：带自动消失的提示 */
  const noteTimed = useCallback((msg: string, ms = 6000) => {
    if (noteTimerRef.current) window.clearTimeout(noteTimerRef.current);
    setExportNote(msg);
    noteTimerRef.current = window.setTimeout(() => setExportNote(""), ms);
  }, [setExportNote]);

  // M220b：写回同一个文件（readAppGradle 命中的那个）
  const writeGradleForSign = useCallback(
    async (next: string) => {
      const root = projectSaveRoot(activeProject);
      if (!root) {
        try { window.localStorage.setItem(LS_KEY_SIGN_DRAFT, next); } catch { /* ignore */ }
        return true;
      }
      const ok = await saveProjectFile(root, gradleRelForSign, next);
      if (ok) {
        try { window.localStorage.removeItem(LS_KEY_SIGN_DRAFT); } catch { /* ignore */ }
      }
      return ok;
    },
    [activeProject, gradleRelForSign],
  );

  return {
    signDialogOpen, setSignDialogOpen,
    gradleForSign, gradleRelForSign, signRootMissing, signKeystoreExists, signAppName, signIconDefault,
    signStored, signStoredRev, setSignStoredRev,
    openSignDialog, makeKeystoreOnDevice, noteTimed, writeGradleForSign,
    onRemember: (s: StoredSigning) => writeStoredSigning(activeProject?.name, s),
    onForget: () => { clearStoredSigning(activeProject?.name); setSignStoredRev((v) => v + 1); },
  };
}
// readAppName 从 project-rename 引入，供 openSignDialog 使用
