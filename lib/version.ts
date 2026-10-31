// lib/version.ts — 应用版本号唯一来源
//
// 之前 XmlEditor.tsx 里硬编码了一份、AndroidManifest 里一份，两边会走偏
// （2026-10-30 就出现过 APK 是 1.14、界面还显示 1.13）。
// 现在只有这里一份：apk/bump-version.mjs 在升版本时会同时改本文件 + AndroidManifest。

export const APP_VERSION = "1.14.5";
