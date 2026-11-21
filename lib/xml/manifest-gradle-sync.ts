// lib/xml/manifest-gradle-sync.ts — M462：AndroidManifest.xml → build.gradle 同步
//
// 用户诉求（2026-11-21）：在编辑器里改 AndroidManifest 的版本（uses-sdk 的
// android:versionCode / android:versionName）和包名（<manifest package=...>）后，
// build.gradle 也要跟着改，不然「这改一些那改一些容易改乱」。
//
// 策略：manifest 是这次编辑动作的事实来源 —— 有值且与 gradle 不一致才写；
// manifest 没有的属性（比如没有 <uses-sdk>）不碰 gradle。
// 包名走 setGradlePackage（namespace + applicationId 一起换，保持原写法）；
// 版本走 setAppConfigField（缺失时 M461 逻辑会插进 defaultConfig）。

import { parseManifest, attrOfElement } from "./manifest-edit";
import { parseAppConfig } from "./gradle-deps";
import { parseGradlePackage, setGradlePackage, setAppConfigField } from "./project-info";
import { readAppGradle, saveProjectFile, type ProjectSaveRoot } from "./project-save";

export interface ManifestAppAttrs {
  /** <manifest package="..."> */
  pkg: string;
  /** <uses-sdk android:versionCode="..."> */
  versionCode: string;
  /** <uses-sdk android:versionName="..."> */
  versionName: string;
}

/** 从 manifest 文本读 package / versionCode / versionName（没有的属性返回 ""）。
 *  版本属性优先读 <uses-sdk>（现代写法），没有再读 <manifest> 根上的 android:versionCode/Name（旧写法）。 */
export function readManifestAppAttrs(xml: string): ManifestAppAttrs {
  let doc: ReturnType<typeof parseManifest>;
  try {
    doc = parseManifest(xml);
  } catch {
    return { pkg: "", versionCode: "", versionName: "" };
  }
  const pkg = doc.manifest ? attrOfElement(xml, doc.manifest, "package") : "";
  // 版本：uses-sdk 优先，缺失则看 manifest 根（老工程把版本写在 <manifest> 上）
  const vcodeEl = doc.usesSdk ? attrOfElement(xml, doc.usesSdk, "android:versionCode") : "";
  const vnameEl = doc.usesSdk ? attrOfElement(xml, doc.usesSdk, "android:versionName") : "";
  const vcodeRoot = doc.manifest ? attrOfElement(xml, doc.manifest, "android:versionCode") : "";
  const vnameRoot = doc.manifest ? attrOfElement(xml, doc.manifest, "android:versionName") : "";
  return { pkg, versionCode: vcodeEl || vcodeRoot, versionName: vnameEl || vnameRoot };
}

export interface ManifestGradleSyncResult {
  ok: boolean;
  /** 新 gradle 文本（无变化时 = 原文） */
  text: string;
  /** 变更项代码：package / versionCode / versionName */
  changed: string[];
  msg?: string;
}

/** 纯逻辑：manifest 的 package/versionCode/versionName → gradle 文本（无 IO） */
export function syncManifestAttrsToGradle(
  manifestText: string,
  gradleText: string,
  kts = false,
): ManifestGradleSyncResult {
  const attrs = readManifestAppAttrs(manifestText);
  const changed: string[] = [];
  let text = gradleText;

  // 1) 包名：manifest package 与 gradle 的 applicationId（或 namespace）不一致 → 一起换
  if (attrs.pkg) {
    const gp = parseGradlePackage(text);
    const cur = gp.applicationId || gp.namespace || "";
    if (cur && cur !== attrs.pkg) {
      const r = setGradlePackage(text, attrs.pkg);
      if (!r.ok) return { ok: false, text: gradleText, changed, msg: r.msg };
      text = r.text;
      changed.push("package");
    } else if (!cur) {
      // gradle 里连 namespace/applicationId 都没有 → 插 defaultConfig（兜底 android 顶层）
      const r = setAppConfigField(text, "applicationId", attrs.pkg, kts);
      if (r.ok) {
        text = r.text;
        changed.push("package");
      }
    }
  }

  // 2) versionCode / versionName：有值且与 gradle 不一致才写
  const ac = parseAppConfig(text);
  if (attrs.versionCode && (ac.versionCode || "") !== attrs.versionCode) {
    const r = setAppConfigField(text, "versionCode", attrs.versionCode, kts);
    if (!r.ok) return { ok: false, text, changed, msg: r.msg };
    text = r.text;
    changed.push("versionCode");
  }
  if (attrs.versionName && (ac.versionName || "") !== attrs.versionName) {
    const r = setAppConfigField(text, "versionName", attrs.versionName, kts);
    if (!r.ok) return { ok: false, text, changed, msg: r.msg };
    text = r.text;
    changed.push("versionName");
  }

  return { ok: true, text, changed };
}

export interface ManifestGradleSyncIoResult {
  /** gradle 实际写盘成功且有变更 */
  synced: boolean;
  /** 变更项代码（同上） */
  changed: string[];
  /** 命中的 gradle 相对路径（app/build.gradle / build.gradle.kts …） */
  rel?: string;
  msg?: string;
}

/**
 * IO 包装：manifest 写盘成功后调用 —— 读工程 build.gradle → 同步 → 写回。
 * 没有工程根 / 读不到 gradle / 无变更 时静默返回 synced=false（调用方不用提示）。
 */
export async function syncManifestGradleAfterSave(
  root: ProjectSaveRoot | null,
  manifestText: string,
): Promise<ManifestGradleSyncIoResult> {
  if (!root) return { synced: false, changed: [] };
  const g = await readAppGradle(root);
  if (!g) return { synced: false, changed: [] };
  const kts = g.rel.endsWith(".kts");
  const r = syncManifestAttrsToGradle(manifestText, g.text, kts);
  if (!r.ok) return { synced: false, changed: [], rel: g.rel, msg: r.msg };
  if (!r.changed.length) return { synced: false, changed: [], rel: g.rel };
  const ok = await saveProjectFile(root, g.rel, r.text);
  if (!ok) return { synced: false, changed: r.changed, rel: g.rel, msg: "gradle 写入失败" };
  return { synced: true, changed: r.changed, rel: g.rel };
}
