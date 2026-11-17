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
