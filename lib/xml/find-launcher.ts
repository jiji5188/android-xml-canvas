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
