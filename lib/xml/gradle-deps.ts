// lib/xml/gradle-deps.ts — 解析 build.gradle 的依赖声明 → maven 坐标 → 下载 URL 候选
//
// 支持写法：
//   implementation 'com.squareup.okhttp3:okhttp:4.12.0'
//   implementation("com.squareup.retrofit2:retrofit:3.0.0")
//   implementation group: 'com.google.code.gson', name: 'gson', version: '2.10.1'
//   api 'androidx.appcompat:appcompat:1.7.0'
//   compile 'joda-time:joda-time:2.10.14'
//   testImplementation "junit:junit:4.13.2"
//
// 变量解析（真实项目极常见）：
//   def materialVersion = '1.11.0'
//   implementation "com.google.android.material:material:$materialVersion"
//   ext.coreKtx = "1.13.1"   /   rootProject.ext.x = '1.0'   /   x = '1.0'
//   ${var} 与 $var 两种引用都支持；版本变量支持 "1.$minor.0" 这种拼接（能解就解）
//
// 跳过：fileTree / project / platform / 注释行
// 版本解析不出来（变量没在本文件定义）→ 归入 unresolved，不猜、不下载
//
// 复用 library-catalog 的 libDownloadUrls（同一套候选 URL：局域网 → 阿里云 → 腾讯 → 华为 → 官方）

import { libDownloadUrls, type LibEntry } from "./library-catalog";

export interface GradleDep {
  group: string;
  name: string;
  version: string;
  raw: string;
  config: string;
  isAar: boolean;
}

/** 解析不出准确版本、因此不自动下载的条目 */
export interface GradleUnresolved {
  raw: string;
  config: string;
  coord: string;
  /** 没解掉的变量名（去掉 $ / ${}） */
  vars: string[];
}

export interface GradleParseResult {
  deps: GradleDep[];
  unresolved: GradleUnresolved[];
}

const CONFIGS =
  "implementation|api|compile|compileOnly|runtimeOnly|testImplementation|androidTestImplementation";

// maven 坐标片段：group / name 允许 字母数字.$-（core-ktx、joda-time、legacy-support-v4）
//                version 另外允许 {}（$var / ${var} 两种引用都要能匹配到）
const GAV = `([\\w$.\\-{}]+):([\\w$.\\-{}]+):([\\w.+$\\-{}]+)`;

// 形态 A：implementation 'g:a:v'  或  implementation("g:a:v")
const FORM_A = new RegExp(
  "(?:" + CONFIGS + ")\\s*(?:\\(\\s*)?([\"'])" + GAV + "\\1(?:\\s*\\))?",
);
// 形态 B：implementation group: 'g', name: 'n', version: 'v'
const FORM_B = new RegExp(
  "(?:" +
    CONFIGS +
    ")\\s+group\\s*:\\s*([\"'])([\\w$.{}]+)\\1\\s*,\\s*name\\s*:\\s*([\"'])([\\w$.{}]+)\\3\\s*,\\s*version\\s*:\\s*([\"'])([\\w.+$\\-{}]+)\\5",
);
const CONFIG_HEAD = new RegExp("^(?:" + CONFIGS + ")\\b");
const CONFIG_NAME = new RegExp("^(" + CONFIGS + ")\\b");
const SKIP = /\bfileTree\b|\bproject\s*\(|platform\s*\(/;

// 变量声明：def x = 'v' | ext.x = 'v' | rootProject.ext.x = 'v' | x = 'v'
const VAR_DECL = /^(?:def\s+|ext\.|rootProject\.ext\.)?([A-Za-z_]\w*)\s*=\s*(['"])(.*?)\2\s*$/;

function isAarOf(group: string): boolean {
  return group.startsWith("androidx.") || group.startsWith("com.google.android.");
}

/** 第一遍：收集本文件里定义的字符串变量（能多次赋值，后者覆盖） */
export function collectGradleVars(text: string): Map<string, string> {
  const vars = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line || CONFIG_HEAD.test(line)) continue;
    const m = line.match(VAR_DECL);
    if (m) vars.set(m[1], m[3]);
  }
  return vars;
}

/** 把字符串里的 $var / ${var} 替换成变量值；返回未解析出来的变量名列表 */
function substitute(raw: string, vars: Map<string, string>): { value: string; missing: string[] } {
  const missing: string[] = [];
  let value = raw;
  // 最多迭代 5 轮，支持变量套变量
  for (let i = 0; i < 5; i++) {
    if (!/\$\{?[A-Za-z_]/.test(value)) break;
    value = value.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (whole, braced, plain) => {
      const name = braced || plain;
      const v = vars.get(name);
      if (v === undefined) {
        if (!missing.includes(name)) missing.push(name);
        return whole;
      }
      return v;
    });
  }
  return { value, missing };
}

/** 版本串还能不能用作下载路径（必须只剩安全字符，且不含 $） */
function isUsableVersion(v: string): boolean {
  return !!v && !/[$]/.test(v) && /^[\w.+\-]+$/.test(v);
}

/**
 * 详细解析：返回能下载的 deps + 解析不出版本的 unresolved
 */
export function parseGradleDepsDetailed(text: string): GradleParseResult {
  const vars = collectGradleVars(text);
  const deps: GradleDep[] = [];
  const unresolved: GradleUnresolved[] = [];
  const seen = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line || !CONFIG_HEAD.test(line)) continue;
    if (SKIP.test(line)) continue;
    const config = line.match(CONFIG_NAME)?.[1] ?? "";

    let m = line.match(FORM_A);
    let group: string | undefined;
    let name: string | undefined;
    let version: string | undefined;
    if (m) {
      // FORM_A：1=引号, 2=group, 3=name, 4=version
      group = m[2];
      name = m[3];
      version = m[4];
    } else {
      m = line.match(FORM_B);
      if (m) {
        // FORM_B：1=g引号,2=g,3=n引号,4=n,5=v引号,6=v
        group = m[2];
        name = m[4];
        version = m[6];
      }
    }
    if (!group || !name || !version) continue;

    // 变量替换（group/name 也可能带变量，一并处理）
    const g = substitute(group, vars);
    const n = substitute(name, vars);
    const v = substitute(version, vars);
    const coordRaw = group + ":" + name + ":" + version;

    if (g.missing.length || n.missing.length || v.missing.length) {
      unresolved.push({
        raw: rawLine.trim(),
        config,
        coord: coordRaw,
        vars: [...new Set([...g.missing, ...n.missing, ...v.missing])],
      });
      continue;
    }
    if (!isUsableVersion(v.value)) {
      unresolved.push({ raw: rawLine.trim(), config, coord: coordRaw, vars: [] });
      continue;
    }

    const key = g.value + ":" + n.value + ":" + v.value;
    if (seen.has(key)) continue;
    seen.add(key);
    deps.push({
      group: g.value,
      name: n.value,
      version: v.value,
      raw: rawLine.trim(),
      config,
      isAar: isAarOf(g.value),
    });
  }
  return { deps, unresolved };
}

/** 兼容旧接口：只要能下载的依赖列表 */
export function parseGradleDeps(text: string): GradleDep[] {
  return parseGradleDepsDetailed(text).deps;
}

/** 候选下载 URL */
export function gradleDepDownloadUrls(d: GradleDep): string[] {
  const e: LibEntry = {
    group: d.group,
    artifact: d.name,
    version: d.version,
    isAar: d.isAar,
    kind: d.isAar ? "androidx" : "thirdparty",
    note: d.config,
  };
  return libDownloadUrls(e);
}

/** 文件名（artifact-version.ext） */
export function gradleDepFname(d: GradleDep): string {
  return d.name + "-" + d.version + (d.isAar ? ".aar" : ".jar");
}

// ---------------------------------------------------------------------------
// M347：gradle 全局编译标记 + 模块结构（用户 2026-11-17 要求）
// 时序：settings.gradle → 根 build.gradle → app/build.gradle；
// gradle.properties 是全局编译开关（AndroidX / Jetifier / minSdk 等）
// ---------------------------------------------------------------------------

/** 关心的 gradle.properties 键（显示用；不在表里的也照实收） */
const PROPS_FLAG_KEYS = new Set([
  "android.useAndroidX",
  "android.enableJetifier",
  "android.enableResourceOptimizations",
  "android.nonTransitiveRClass",
  "android.nonFinalResIds",
  "org.gradle.jvmargs",
  "org.gradle.parallel",
  "org.gradle.caching",
  "org.gradle.daemon",
  "org.gradle.configureondemand",
  "android.defaults.buildfeatures.buildconfig",
  "android.suppressUnsupportedCompileSdk",
]);

export interface GradleProps {
  /** 全量 key→value（已去注释/空行） */
  raw: Record<string, string>;
  /** 编译相关开关（布尔类 + 数值类），用于 UI 标记展示 */
  flags: { key: string; value: string; known: boolean }[];
  /** 便捷提取的 SDK 号（可能带变量，能解就解） */
  minSdk?: string;
  targetSdk?: string;
  compileSdk?: string;
}

/**
 * 解析 gradle.properties。格式：#注释 / 空行 跳过；key=value（key 可带 : 或 = 转义但这里只做最常用）。
 * value 里的 $var / ${var} 用同一套 substitute 解（gradle.properties 支持跨文件变量，但只在文件内定义才解）。
 */
export function parseGradleProperties(text: string): GradleProps {
  const raw: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue; // 必须 key=value
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    // 去掉行内注释（# 前有空格才算）
    const h = value.search(/\s#/);
    if (h >= 0) value = value.slice(0, h).trim();
    if (key) raw[key] = value;
  }

  // 变量（gradle.properties 也允许 prop 引用其它 prop：${key} / $key；key 可带点/横线）
  const vars = new Map<string, string>();
  for (const [k, v] of Object.entries(raw)) vars.set(k, v);

  // 专用替换：支持点号/横线的属性名（ext.minV / android.useAndroidX / joda-time）
  const subProps = (v: string): string => {
    let out = v;
    for (let i = 0; i < 5; i++) {
      if (!/\$[\{A-Za-z]/.test(out)) break;
      out = out.replace(/\$\{([A-Za-z_.\\-]+)\}|\$([A-Za-z_.\\-]+)(?=[^\w.\\-]|$)/g, (w, braced, plain) => {
        const key = braced || plain;
        const val = vars.get(key);
        return val === undefined ? w : val;
      });
    }
    return out;
  };

  const pick = (k: string): string | undefined => {
    const v = raw[k];
    if (v === undefined) return undefined;
    return subProps(v); // 变量没解掉就带 $ 返回，UI 能看出来
  };

  const flags: GradleProps["flags"] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (!PROPS_FLAG_KEYS.has(k)) continue;
    flags.push({ key: k, value: subProps(v), known: true });
  }

  return {
    raw,
    flags,
    minSdk: pick("minSdkVersion") ?? pick("android.minSdkVersion") ?? pick("android.minSdk"),
    targetSdk: pick("targetSdkVersion") ?? pick("android.targetSdkVersion") ?? pick("android.targetSdk"),
    compileSdk: pick("compileSdkVersion") ?? pick("android.compileSdkVersion") ?? pick("android.compileSdk"),
  };
}

export interface SettingsMeta {
  /** include ':app', ':lib' 解出来的模块名 */
  modules: string[];
  rootProjectName?: string;
}
/**
 * 解析 settings.gradle / settings.gradle.kts：
 *   include ':app', ':feature'
 *   include(":app", ":lib")
 *   rootProject.name = "MyApp"
 */
export function parseSettingsModules(text: string): SettingsMeta {
  const modules: string[] = [];
  let rootProjectName: string | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    // rootProject.name = 'X' / "X" / X
    let m = line.match(/^rootProject\.name\s*=\s*(["'])([^"']+?)\1/);
    if (m) {
      rootProjectName = m[2];
      continue;
    }
    m = line.match(/^rootProject\.name\s*=\s*([A-Za-z_]\w*)$/);
    if (m) {
      rootProjectName = m[1];
      continue;
    }
    // include ':a', ':b'  或  include("a", "b")
    m = line.match(/^include\s*(?:\(([^)]*)\)|(.+?))\s*$/);
    if (m) {
      const body = m[1] !== undefined ? m[1] : m[2] ?? "";
      // 抓所有 :name / "name" / 'name'
      const found = body.matchAll(/[:"']\s*:?([A-Za-z_][\w-]*)/g);
      for (const f of found) {
        const name = f[1];
        if (!modules.includes(name)) modules.push(name);
      }
      // 也抓 include ':a' 里没引号但带冒号的（上面 [:"'] 已含冒号）
    }
  }
  return { modules, rootProjectName };
}

/** 根 build.gradle 的 buildscript classpath 依赖（构建期插件，不进运行时 classpath，只标记展示） */
export interface ClasspathDep {
  group: string;
  name: string;
  version: string;
  raw: string;
}

export function parseBuildscriptClasspath(text: string): ClasspathDep[] {
  const out: ClasspathDep[] = [];
  const vars = collectGradleVars(text);
  const CLASSPATH =
    /classpath\s+(?:["'])([\w$.{}-]+):([\w$.{}-]+):([\w.$+-]+)["']\s*$/m;
  const CLASSPATH_MAP =
    /classpath\s+group\s*:\s*["']([^"']+)["']\s*,\s*name\s*:\s*["']([^"']+)["']\s*,\s*version\s*:\s*["']([^"']+)["']/;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!/^classpath\b/.test(line)) continue;
    let g: string | undefined;
    let n: string | undefined;
    let v: string | undefined;
    let m = line.match(CLASSPATH);
    if (m) {
      g = m[1];
      n = m[2];
      v = m[3];
    } else {
      m = line.match(CLASSPATH_MAP);
      if (m) {
        g = m[1];
        n = m[2];
        v = m[3];
      }
    }
    if (!g || !n || !v) continue;
    const gg = substitute(g, vars).value;
    const nn = substitute(n, vars).value;
    const vv = substitute(v, vars).value;
    if (!isUsableVersion(vv)) continue;
    out.push({ group: gg, name: nn, version: vv, raw: line });
  }
  return out;
}

// ---------------------------------------------------------------------------
// M347b：settings.gradle 的仓库（“仓库在哪”） + app/build.gradle 的模块配置
// ---------------------------------------------------------------------------

export interface GradleRepo {
  /** 展示名：google / mavenCentral / gradlePluginPortal / 自定义 URL */
  name: string;
  /** 自定义 maven 仓库的 url（内置简写为空） */
  url?: string;
}

/**
 * 解析 settings.gradle 里的仓库声明：
 *   google() / mavenCentral() / gradlePluginPortal() / mavenLocal()
 *   maven { url 'https://jitpack.io' } / maven { url = uri("...") }
 * 同时去重（pluginManagement 和 dependencyResolutionManagement 常常重复）。
 */
export function parseSettingsRepos(text: string): GradleRepo[] {
  const out: GradleRepo[] = [];
  const seen = new Set<string>();
  const push = (r: GradleRepo) => {
    const k = r.url || r.name;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(r);
  };
  for (const rawLine of text.split(/\r?\n/)) {
    // 只在 // 前是空白或行首时才当注释（避免把 https:// 里的 // 当注释）
    const line = rawLine.replace(/(^\s*|\s)\/\/.*/g, (m, p1) => p1).trim();
    if (!line) continue;
    if (/^google\s*\(\s*\)/.test(line)) { push({ name: "google" }); continue; }
    if (/^mavenCentral\s*\(\s*\)/.test(line)) { push({ name: "mavenCentral" }); continue; }
    if (/^gradlePluginPortal\s*\(\s*\)/.test(line)) { push({ name: "gradlePluginPortal" }); continue; }
    if (/^mavenLocal\s*\(\s*\)/.test(line)) { push({ name: "mavenLocal" }); continue; }
    // maven { url '...' } 或 maven { url = uri('...') } （可能一行内写完）
    if (/^maven\s*\{/.test(line)) {
      const m =
        line.match(/url\s*=?\s*["']([^"']+)["']/) ||
        line.match(/uri\s*\(\s*["']([^"']+)["']\s*\)/);
      if (m) push({ name: "maven", url: m[1] });
    }
  }
  return out;
}

export interface AppConfig {
  namespace?: string;
  applicationId?: string;
  minSdk?: string;
  targetSdk?: string;
  compileSdk?: string;
  versionCode?: string;
  versionName?: string;
  /** 是否开了 signingConfigs（只标记，不解析密钥） */
  hasSigning?: boolean;
}

/**
 * 解析 app/build.gradle 模块专属配置：
 *   namespace 'com.x.y' / applicationId 'com.x.y'
 *   compileSdk 34 / minSdk 24 / targetSdk 34（也认 xxxSdkVersion 旧写法）
 *   versionCode 1 / versionName "1.0"
 *   signingConfigs { ... }
 */
export function parseAppConfig(text: string): AppConfig {
  const cfg: AppConfig = {};
  const vars = collectGradleVars(text);
  const grab = (re: RegExp): string | undefined => {
    const m = text.match(re);
    if (!m) return undefined;
    const v = substitute(m[1], vars).value;
    return v.replace(/^["']|["']$/g, "").trim() || undefined;
  };
  cfg.namespace = grab(/\bnamespace\s*=?\s*(["'][^"']+["']|[\w.$]+)/);
  cfg.applicationId = grab(/\bapplicationId\s*=?\s*(["'][^"']+["']|[\w.$]+)/);
  cfg.compileSdk = grab(/\bcompileSdk(?:Version)?\s*=?\s*(\d+|[\w.$]+)/);
  cfg.minSdk = grab(/\bminSdk(?:Version)?\s*=?\s*(\d+|[\w.$]+)/);
  cfg.targetSdk = grab(/\btargetSdk(?:Version)?\s*=?\s*(\d+|[\w.$]+)/);
  cfg.versionCode = grab(/\bversionCode\s*=?\s*(\d+|[\w.$]+)/);
  cfg.versionName = grab(/\bversionName\s*=?\s*(["'][^"']+["']|[\w.$]+)/);
  cfg.hasSigning = /\bsigningConfigs\s*\{/.test(text);
  return cfg;
}

/* ===== M359：应用到项目 = 写 maven 坐标（不拷文件，防源码膨胀）=====
 *  把 maven 依赖写进 app/build.gradle（implementation 行）+ 把仓库 url 写进根 build.gradle 或 settings.gradle（repositories 块），
 *  项目就能从 maven 拉到库，不用把物理库拷进项目。kts 用 (..) 括号写法，groovy 用单引号。 */

export function mavenCoord(group: string, artifact: string, version: string): string {
  return `${group}:${artifact}:${version}`;
}

/** 幂等地把一行 implementation 追加进 dependencies 块（没有就建块）。返回 [新文本, 是否已存在]。 */
export function insertImplementation(
  text: string,
  coord: string,
  kts: boolean,
): [string, boolean] {
  const depLine = kts ? `implementation("${coord}")` : `implementation '${coord}'`;
  // 已存在（精确坐标匹配）→ 不动
  if (new RegExp("implementation\\s*(?:\\()?[\"']?" + coord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "[\"']?").test(text)) {
    return [text, true];
  }
  if (/\bdependencies\s*\{/.test(text)) {
    // 有 dependencies 块 → 在其内首个 { 后插一行
    const m = text.match(/\bdependencies\s*\{/);
    if (m) {
      const idx = m.index! + m[0].length;
      return [text.slice(0, idx) + `\n        ${depLine}` + text.slice(idx), false];
    }
  }
  // 没有 → 末尾追加一个块
  const block = kts ? `\n\ndependencies {\n    ${depLine}\n}\n` : `\n\ndependencies {\n    ${depLine}\n}\n`;
  return [text.replace(/\s*$/, "") + "\n" + block, false];
}

/** 把仓库 url 追加进 repositories 块（没有就建）。返回 [新文本, 是否已存在]。 */
export function insertRepoUrl(
  text: string,
  repoUrl: string,
  kts: boolean,
): [string, boolean] {
  if (text.includes(repoUrl)) return [text, true];
  // 已知仓库用系统函数（google()/mavenCentral()），否则用 maven { url }
  const repoLine =
    repoUrl === "https://dl.google.com/dl/android/maven2" || repoUrl === "https://maven.google.com"
      ? `google()`
      : repoUrl === "https://repo.maven.apache.org/maven2"
        ? `mavenCentral()`
        : kts
          ? `maven { url = uri("${repoUrl}") }`
          : `maven { url '${repoUrl}' }`;
  if (/\brepositories\s*\{/.test(text)) {
    const m = text.match(/\brepositories\s*\{/);
    if (m) {
      const idx = m.index! + m[0].length;
      return [text.slice(0, idx) + `\n    ${repoLine}` + text.slice(idx), false];
    }
  }
  const block = `\n\nrepositories {\n    ${repoLine}\n}\n`;
  return [text.replace(/\s*$/, "") + "\n" + block, false];
}
