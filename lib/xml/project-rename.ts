// lib/xml/project-rename.ts — M176：改「项目名称」（目录名）与「应用名称」（strings.xml app_name）
//
// 目录结构约定：工作目录/<项目名>/app/src/main/...
//   → 项目名 = 目录名，改它要真改目录（native bridge.renameEntry），并同步：
//        settings.gradle 的 rootProject.name
//        res/values/themes.xml 里 <style name="Theme.XXX">（骨架用项目名生成）
//        AndroidManifest.xml 的 android:theme="@style/Theme.XXX"
//   → 应用名称 = res/values/strings.xml 的 app_name（图标下显示的名字），只改 XML 文本
//
// 这里只放纯函数（可单测）+ native 目录改名；读写文件由调用方用 ProjectSaveRoot 完成。

import { nativeBridge } from "./native-save";

/* ---------------- app_name ---------------- */

/** 从 strings.xml 读 app_name（找不到返回 null） */
export function readAppName(src: string): string | null {
  const m = /<string\s+name="app_name"\s*>([\s\S]*?)<\/string>/.exec(src);
  if (!m) return null;
  return decodeEntities(m[1]);
}

/** 改写 strings.xml 的 app_name；没有该条目则插到 <resources> 里第一条 */
export function setAppName(src: string, appName: string): string {
  const value = escapeXml(appName.trim());
  const re = /(<string\s+name="app_name"\s*>)([\s\S]*?)(<\/string>)/;
  if (re.test(src)) return src.replace(re, (_m, a: string, _v: string, c: string) => `${a}${value}${c}`);
  // 没有 app_name：插在 <resources> 第一行后
  const m = /<resources[^>]*>\n?/.exec(src);
  if (!m) return src;
  const at = m.index + m[0].length;
  const indent = "    ";
  const line = `${indent}<string name="app_name">${value}</string>\n`;
  return src.slice(0, at) + line + src.slice(at);
}

/* ---------------- settings.gradle ---------------- */

export function readRootProjectName(src: string): string | null {
  const m = /rootProject\.name\s*=\s*['"]([^'"]*)['"]/.exec(src);
  return m ? m[1] : null;
}

export function setRootProjectName(src: string, name: string): string {
  const re = /(rootProject\.name\s*=\s*['"])[^'"]*(['"])/;
  if (!re.test(src)) return src;
  return src.replace(re, (_m, a: string, b: string) => `${a}${name}${b}`);
}

/* ---------------- 主题名 Theme.XXX ---------------- */

/** 从 themes.xml 读第一个 <style name="Theme.X"> 的 name */
export function readThemeName(src: string): string | null {
  const m = /<style\s+name="(Theme\.[^"]+)"/.exec(src);
  return m ? m[1] : null;
}

/** <style name="old"> → <style name="new">（只改这一处定义） */
export function renameThemeDef(src: string, oldTheme: string, newTheme: string): string {
  if (!oldTheme || oldTheme === newTheme) return src;
  const esc = escapeRe(oldTheme);
  return src.replace(new RegExp(`(<style\\s+name=")${esc}(")`), `$1${newTheme}$2`);
}

/** AndroidManifest 里 android:theme="@style/old" → @style/new */
export function renameThemeRef(src: string, oldTheme: string, newTheme: string): string {
  if (!oldTheme || oldTheme === newTheme) return src;
  const esc = escapeRe(oldTheme);
  return src.replace(new RegExp(`(@style/)${esc}(?=["'])`, "g"), `$1${newTheme}`);
}

/* ---------------- 目录改名（native only） ---------------- */

export interface DirRenameResult {
  ok: boolean;
  /** 改名后的项目根绝对路径（成功才有） */
  newRoot?: string;
  reason?: string;
}

/** 把 <workspaceRoot>/<oldName> 改成 <workspaceRoot>/<newName>。web 没有 rename API，返回 ok:false */
export function renameProjectDirNative(workspaceRoot: string, oldName: string, newName: string): DirRenameResult {
  const b = nativeBridge();
  if (!b) return { ok: false, reason: "web" };
  const bridge = b as unknown as { renameEntry?: (from: string, to: string) => string };
  if (typeof bridge.renameEntry !== "function") return { ok: false, reason: "网页版不支持改项目目录名，请在 APK 里操作" };
  const base = workspaceRoot.replace(/[/\\]+$/, "");
  const from = `${base}/${oldName}`;
  const to = `${base}/${newName}`;
  if (from === to) return { ok: true, newRoot: to };
  try {
    const raw = bridge.renameEntry(from, to);
    const r = JSON.parse(raw || "{}") as { ok?: boolean; error?: string };
    if (r.ok) return { ok: true, newRoot: to };
    return { ok: false, reason: r.error || "目录改名失败" };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "目录改名失败" };
  }
}

/** 从项目根绝对路径取目录名 */
export function dirNameOf(abs: string): string {
  return abs.split(/[/\\]/).filter(Boolean).pop() ?? "";
}

/** 新建项目时给个不重名的默认名：MyApp → MyApp2 → MyApp3…（避免建出同名目录互相覆盖） */
export function uniqueProjectName(taken: string[]): string {
  const set = new Set(taken.filter(Boolean));
  const base = "MyApp";
  if (!set.has(base)) return base;
  let i = 2;
  while (set.has(`${base}${i}`)) i += 1;
  return `${base}${i}`;
}

/** 把 <...>/<oldName> 换成 <...>/<newName> */
export function replaceTailDir(abs: string, newName: string): string {
  const clean = abs.replace(/[/\\]+$/, "");
  const idx = Math.max(clean.lastIndexOf("/"), clean.lastIndexOf("\\"));
  return idx < 0 ? newName : `${clean.slice(0, idx)}/${newName}`;
}

/* ---------------- 小工具 ---------------- */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
