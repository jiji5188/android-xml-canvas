// lib/xml/gradle-deps.ts — 解析 build.gradle 的依赖声明 → maven 坐标 → 下载 URL 候选
//
// 支持写法：
//   implementation 'com.squareup.okhttp3:okhttp:4.12.0'
//   implementation("com.squareup.retrofit2:retrofit:3.0.0")
//   implementation group: 'com.google.code.gson', name: 'gson', version: '2.10.1'
//   api 'androidx.appcompat:appcompat:1.7.0'
//   compile 'joda-time:joda-time:2.10.14'
//   testImplementation "junit:junit:4.13.2"
// 跳过：fileTree / project / platform / 注释行
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

const CONFIGS =
  "implementation|api|compile|compileOnly|runtimeOnly|testImplementation|androidTestImplementation";

// maven 坐标片段：group / name 允许 字母数字.$-（core-ktx、joda-time、legacy-support-v4）
//                version 允许 字母数字.+$-
const GAV = `([\\w$.\\-]+):([\\w$.\\-]+):([\\w.+$\\-]+)`;

// 形态 A：implementation 'g:a:v'  或  implementation("g:a:v")
const FORM_A = new RegExp(
  "(?:" + CONFIGS + ")\\s*(?:\\(\\s*)?([\"'])" + GAV + "\\1(?:\\s*\\))?",
);
// 形态 B：implementation group: 'g', name: 'n', version: 'v'
const FORM_B = new RegExp(
  "(?:" +
    CONFIGS +
    ")\\s+group\\s*:\\s*([\"'])([\\w$.]+)\\1\\s*,\\s*name\\s*:\\s*([\"'])([\\w$.]+)\\3\\s*,\\s*version\\s*:\\s*([\"'])([\\w.+\\$\\-]+)\\5",
);
const CONFIG_HEAD = new RegExp("^(?:" + CONFIGS + ")\\b");
const SKIP = /\bfileTree\b|\bproject\s*\(|platform\s*\(/;

function isAarOf(group: string): boolean {
  return group.startsWith("androidx.") || group.startsWith("com.google.android.");
}

/** 从 build.gradle / build.gradle.kts 文本里抽出所有 maven 依赖 */
export function parseGradleDeps(text: string): GradleDep[] {
  const out: GradleDep[] = [];
  const seen = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\/\/.*$/, "").trim();
    if (!line || !CONFIG_HEAD.test(line)) continue;
    if (SKIP.test(line)) continue;
    const config = line.match(/^(implementation|api|compile|compileOnly|runtimeOnly|testImplementation|androidTestImplementation)/)?.[1] ?? "";

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
    if (group && name && version) {
      const key = group + ":" + name + ":" + version;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ group, name, version, raw: rawLine.trim(), config, isAar: isAarOf(group) });
      }
    }
  }
  return out;
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
