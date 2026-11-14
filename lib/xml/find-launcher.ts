// lib/xml/find-launcher.ts — M213：从项目 AndroidManifest.xml 里找 launcher Activity（全限定类名）
// 没有清单 / 没有 launcher → 返回 ""（设备端退回 ShellActivity）
// M258：修两个老 bug：
//   1) 以前用 text.indexOf(整段开标签) 定位块，两个同名 <activity> 会全指到第一个 → 块切错；
//      现在按「当前匹配起点」往后扫 </activity> 切块。
//   2) 现代模板常用 <activity-alias>（带 MAIN/LAUNCHER，targetActivity 指向真 Activity）→ 以前完全没认；
//      现在认 alias，把 name 解析成 targetActivity。
import type { AiFileIo } from "./ai-tools";

// 项目常见 manifest 位置（原生项目可能在 app/ 子目录）
const CANDIDATES = [
  "AndroidManifest.xml",
  "app/src/main/AndroidManifest.xml",
  "src/main/AndroidManifest.xml",
];

export interface ProjectManifestInfo {
  /** 项目里找到的 manifest 相对路径；没找到 = "" */
  rel: string;
  /** manifest 全文（BOM/编码已去掉）；没找到 = "" */
  text: string;
  /** 从 manifest 里解析出的包名（package 或 namespace）；解析不到 = "" */
  pkg: string;
  /** MAIN/LAUNCHER 对应的 Activity 全限定名；没有 = "" */
  launcher: string;
}

/**
 * M262：把项目 AndroidManifest.xml 原文读出来给设备端打包用（aapt2 link 会直接用它，
 * 不再让 BuildApkHelper 自己合成一份只含 ShellActivity 的清单）。
 * 同时返回解析出的 launcher，方便调用方判断是否还需要源码兜底。
 */
export async function readProjectManifest(
  io: AiFileIo | null | undefined,
  fallbackPkg = "",
): Promise<ProjectManifestInfo> {
  if (!io) return { rel: "", text: "", pkg: fallbackPkg, launcher: "" };
  let rel = "";
  let text = "";
  for (const cand of CANDIDATES) {
    try {
      const r = await io.read(cand);
      if (r.ok && r.text && /<manifest/i.test(r.text)) {
        rel = cand;
        text = r.text;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!text) return { rel: "", text: "", pkg: fallbackPkg, launcher: "" };
  const pkgM =
    text.match(/(?:android:)?package\s*=\s*["']([^"']+)["']/i) ||
    text.match(/namespace\s*=\s*["']([^"']+)["']/i);
  const pkg = pkgM?.[1] || fallbackPkg || "";
  const launcher = parseManifestLauncher(text, pkg);
  return { rel, text, pkg, launcher };
}
export async function findLauncherActivity(
  io: AiFileIo | null | undefined,
  /** M258：manifest 没写 package（新版 Gradle 用 build.gradle 的 namespace）时，用构建包名兑底拼相对类名 */
  fallbackPkg = "",
): Promise<string> {
  if (!io) return "";
  let text = "";
  for (const cand of CANDIDATES) {
    try {
      const r = await io.read(cand);
      if (r.ok && r.text && /<manifest/i.test(r.text)) {
        text = r.text;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!text) return "";
  const pkgM =
    text.match(/(?:android:)?package\s*=\s*["']([^"']+)["']/i) ||
    text.match(/namespace\s*=\s*["']([^"']+)["']/i);
  const pkg = pkgM?.[1] || fallbackPkg || "";
  return parseManifestLauncher(text, pkg);
}

/** M268：把 manifest 里的 package="..." 强制改成指定值；缺了就插到 <manifest 开标签里。返回 [新文本, 是否改过] */
export function forceManifestPkg(
  text: string,
  pkg: string,
): { text: string; changed: boolean } {
  if (!text || !pkg) return { text, changed: false };
  const hasPkg = /(?:android:)?package\s*=\s*["']([^"']*)["']/i.test(text);
  let out: string;
  if (hasPkg) {
    out = text.replace(
      /((?:android:)?package\s*=\s*)["'][^"']*["']/i,
      `$1"${pkg}"`,
    );
  } else {
    // 插到 <manifest ...> 开标签里（在 > 前）
    out = text.replace(/(<manifest\b[^>]*)(>)/i, (_m, a, b) =>
      a + ` package="${pkg}"` + b,
    );
  }
  return { text: out, changed: out !== text };
}

/** M268：从 Java 源码里统计出最常见的 package 声明（多数决） */
export function dominantJavaPackage(
  sources: { path: string; code: string }[],
): string {
  const counts = new Map<string, number>();
  for (const s of sources) {
    const m = s.code.match(/^\s*package\s+([\w.]+)(?:\s*;)?/m);
    if (!m) continue;
    counts.set(m[1], (counts.get(m[1]) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of counts) {
    if (n > bestN) { best = k; bestN = n; }
  }
  return best;
}

/**
 * M271：推断 R.java 应该生成在哪个包——以「源码实际引用 R 的地方」为准。
 * 比 dominantJavaPackage 更准：改包名只改了一半时，多数 java 还在旧包，
 * 但 R 的引用方（import xxx.R 或同包用 R.layout）会暴露真实期望的包。
 * 优先级：
 *   1) 显式 `import <pkg>.R;` 出现的包（取多数）
 *   2) 没 import 但同包直接用 R.layout 的文件所在 package（取多数）
 *   3) 都拿不到 → ""（调用方回退 dominantJavaPackage / 配置包名）
 */
export function rPackageFromSources(
  sources: { path: string; code: string }[],
): string {
  const importCounts = new Map<string, number>();
  const samePkgCounts = new Map<string, number>();
  for (const s of sources) {
    const pkgM = s.code.match(/^\s*package\s+([\w.]+)(?:\s*;)?/m);
    const filePkg = pkgM ? pkgM[1] : "";
    const importR = s.code.match(/^\s*import\s+([\w.]+)\.R\s*;/m);
    if (importR) {
      importCounts.set(importR[1], (importCounts.get(importR[1]) || 0) + 1);
    } else if (filePkg && /\bR\.(layout|id|drawable|string|menu|navigation|mipmap|raw|anim|animator|color|font|style|array)\b/.test(s.code)) {
      samePkgCounts.set(filePkg, (samePkgCounts.get(filePkg) || 0) + 1);
    }
  }
  const pick = (m: Map<string, number>): string => {
    let best = "", bestN = 0;
    for (const [k, n] of m) if (n > bestN) { best = k; bestN = n; }
    return best;
  };
  return pick(importCounts) || pick(samePkgCounts);
}

/**
 * M272：列出所有引用 R 的包名（多包共存时要用）——包括导入 R 的包、同包直接用 R 的包。
 * 用户项目可能反编译后多包共存（com.momo.ReturnSystem / ReturnSystem2 / ReturnSystem3），
 * 单个 R.java 满足不了，设备端按这个清单给每个包复制一份 R.java。
 */
export function rPackagesFromSources(
  sources: { path: string; code: string }[],
): string[] {
  const set = new Set<string>();
  for (const s of sources) {
    const pkgM = s.code.match(/^\s*package\s+([\w.]+)(?:\s*;)?/m);
    const filePkg = pkgM ? pkgM[1] : "";
    const importRs = s.code.matchAll(/^\s*import\s+([\w.]+)\.R\s*;/gm);
    let found = false;
    for (const m of importRs) {
      set.add(m[1]);
      found = true;
    }
    if (!found && filePkg && /\bR\.(layout|id|drawable|string|menu|navigation|mipmap|raw|anim|animator|color|font|style|array)\b/.test(s.code)) {
      set.add(filePkg);
    }
  }
  return [...set];
}

/** 纯文本版：给定 manifest 原文 + 包名，解析 MAIN/LAUNCHER 的 Activity 全限定名 */
export function parseManifestLauncher(
  text: string,
  pkg: string,
): string {
  if (!text) return "";
  const resolveName = (raw: string): string => {
    if (!raw) return "";
    if (raw.startsWith(".")) {
      if (!pkg) return "";
      return pkg + "." + raw.slice(1);
    }
    return raw;
  };
  const tagRe = /<(activity-alias|activity)\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text))) {
    const kind = m[1];
    const openTag = m[0];
    const startIdx = m.index;
    const selfClosing = /\/\s*>$/.test(openTag.trim());
    const nameM = openTag.match(/android:name\s*=\s*"([^"]+)"/i);
    if (!nameM) continue;
    if (selfClosing) continue;
    const closeRe = new RegExp("</" + kind + "\\s*>", "i");
    closeRe.lastIndex = startIdx + openTag.length;
    const after = text.slice(startIdx + openTag.length);
    const closeM = closeRe.exec(after);
    const blockEnd = closeM ? startIdx + openTag.length + closeM.index + closeM[0].length : text.length;
    const block = text.slice(startIdx, blockEnd);
    const hasMain = /<action\b[^>]*android:name\s*=\s*"android\.intent\.action\.MAIN"/i.test(block);
    const hasLauncher = /<category\b[^>]*android:name\s*=\s*"android\.intent\.category\.LAUNCHER"/i.test(block);
    if (!hasMain || !hasLauncher) continue;
    let name = nameM[1];
    if (kind === "activity-alias") {
      const targetM = openTag.match(/android:targetActivity\s*=\s*"([^"]+)"/i);
      if (targetM) name = targetM[1];
    }
    const resolved = resolveName(name);
    if (resolved) return resolved;
  }
  return "";
}

/**
 * M258 兑底：清单里找不到 MAIN/LAUNCHER 时，从实际 Java/Kotlin 源码里推入口——
 * 找 extends Activity / AppCompatActivity（非 abstract）且带 setContentView 的类。
 * 优先「类名带 Main/Home/Launch」，否则第一个。path 是相对项目根的 .java/.kt 路径。
 * 拿不到包名时，从 path 推（com/myapp/MainActivity.java → com.myapp.MainActivity）。
 */
export function deriveLauncherFromSources(
  sources: { path: string; code: string }[],
  fallbackPkg = "",
): string {
  if (!sources || sources.length === 0) return "";
  const pick: { fqn: string; score: number }[] = [];
  for (const s of sources) {
    if (!/\.(java|kt)$/i.test(s.path)) continue;
    const code = s.code || "";
    // 必须是 Activity 子类
    const isActivity = /extends\s+(?:[\w.]*\.)?(?:AppCompatActivity|Activity|ComponentActivity|FragmentActivity)\b/.test(code);
    if (!isActivity) continue;
    if (/\babstract\s+class\b/.test(code)) continue;
    // 从路径推 FQN：取 src/(main|test)/java|kotlin 之后的部分
    const m = s.path.replace(/\\/g, "/").match(/(?:^|\/)src\/(?:main|test|debug|release)\/(?:java|kotlin)\/(.+)\.(?:java|kt)$/i);
    let fqn = "";
    if (m) {
      fqn = m[1].replace(/\//g, ".");
    } else {
      // 退化：去掉目录，包名用 fallbackPkg
      const base = s.path.replace(/\\/g, "/").split("/").pop()!.replace(/\.(java|kt)$/i, "");
      // 尝试从包声明拿
      const pkgM = code.match(/^\s*package\s+([\w.]+)/m);
      const pkg = pkgM?.[1] || fallbackPkg;
      fqn = pkg ? `${pkg}.${base}` : base;
    }
    if (!fqn) continue;
    let score = 0;
    if (/setContentView\s*\(/.test(code)) score += 2;
    if (/(?:^|\.)(Main|Home|Launch|Entry)/i.test(fqn)) score += 3;
    pick.push({ fqn, score });
  }
  if (pick.length === 0) return "";
  pick.sort((a, b) => b.score - a.score);
  return pick[0].fqn;
}
