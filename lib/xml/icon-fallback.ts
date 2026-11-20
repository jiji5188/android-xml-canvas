// lib/xml/icon-fallback.ts — M380
//
// 背景：用户项目 manifest 写了 android:icon="@mipmap/app"、android:roundIcon="@mipmap/app_round"，
// 但项目 res 里实际没有这两个文件（网页版建的项目 / 图标没同步过来）→ aapt2 link 直接失败：
//   error: resource mipmap/app not found
//   error: failed processing manifest.
// 这类「manifest 引用必填资源却缺失」不该让整个打包卡死：补一张默认矢量图标（API 24+ 原生支持
// VectorDrawable，一个 xml 就够，不用按密度出 png），构建能过，用户也能看到图标。
//
// 只在「确实一处都没有」时补；用户自己有的图标（含 mipmap-hdpi/app.png、mipmap-anydpi-v26/app.xml）不覆盖。

import type { RenderFile } from "./native-render";

/** 默认图标矢量（绿底 + 白色机器人头），108×108 视口，任意密度清晰 */
export const FALLBACK_ICON_VECTOR = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="108"
    android:viewportHeight="108">
  <path android:fillColor="#3FBFA0" android:pathData="M0,0h108v108H0z"/>
  <path android:fillColor="#FFFFFF" android:pathData="M54,22a17,17 0,1 1,0 34a17,17 0,1 1,0 -34z"/>
  <path android:fillColor="#FFFFFF" android:pathData="M30,90a24,24 0,0 1 48,0z"/>
</vector>
`;

const ICON_ATTR_RE = /android:(?:round)?[Ii]con\s*=\s*"@(mipmap|drawable)\/([A-Za-z0-9_.]+)"/g;

/** manifest 里声明的图标引用（type/name，已剥扩展名） */
export function manifestIconRefs(manifestText: string): { type: string; name: string }[] {
  const out: { type: string; name: string }[] = [];
  const seen = new Set<string>();
  if (!manifestText) return out;
  for (const m of manifestText.matchAll(ICON_ATTR_RE)) {
    const type = m[1].toLowerCase();
    const name = m[2].replace(/\.(9\.)?(png|jpg|jpeg|webp|gif|xml)$/i, "");
    const key = `${type}/${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, name });
  }
  return out;
}

/** 这批资源文件里是否已经有 type/name（任意限定符目录、任意图片/矢量格式都算） */
export function hasResFile(files: RenderFile[], type: string, name: string): boolean {
  const re = new RegExp(
    `^${type}(-[^/]+)?/${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.(xml|png|jpg|jpeg|webp|gif)$`,
    "i",
  );
  return files.some((f) => re.test(f.path || ""));
}

/** M458：一批文件里，manifest 各图标引用实际进包的是哪些路径（供构建日志「图标进包」明细） */
export function iconFilesForRefs(
  files: RenderFile[],
  refs: { type: string; name: string }[],
): string[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const out: string[] = [];
  for (const r of refs) {
    const re = new RegExp(`^${esc(r.type)}(-[^/]+)?/${esc(r.name)}\\.(xml|png|jpg|jpeg|webp|gif)$`, "i");
    const hit = files.find((f) => re.test(f.path || ""));
    if (hit) out.push(hit.path);
  }
  return out;
}

/** 补齐 manifest 引用但项目里没有的图标：返回新文件清单 + 补了哪些（供构建日志） */
export function injectMissingManifestIcons(
  files: RenderFile[],
  manifestText: string,
): { files: RenderFile[]; injected: string[] } {
  const refs = manifestIconRefs(manifestText);
  if (!refs.length) return { files, injected: [] };
  const injected: string[] = [];
  const out = [...files];
  for (const r of refs) {
    if (hasResFile(out, r.type, r.name)) continue;
    const path = `${r.type}/${r.name}.xml`;
    out.push({ path, text: FALLBACK_ICON_VECTOR });
    injected.push(`@${r.type}/${r.name}`);
  }
  return { files: out, injected };
}
