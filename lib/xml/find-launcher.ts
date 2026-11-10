// lib/xml/find-launcher.ts — M213：从项目 AndroidManifest.xml 里找 launcher Activity（全限定类名）
// 没有清单 / 没有 launcher → 返回 ""（设备端退回 ShellActivity）
import type { AiFileIo } from "./ai-tools";

// 项目常见 manifest 位置（原生项目可能在 app/ 子目录）
const CANDIDATES = [
  "AndroidManifest.xml",
  "app/src/main/AndroidManifest.xml",
  "src/main/AndroidManifest.xml",
];

export async function findLauncherActivity(io: AiFileIo | null | undefined): Promise<string> {
  if (!io) return "";
  let text = "";
  for (const rel of CANDIDATES) {
    try {
      const r = await io.read(rel);
      if (r.ok && r.text && /<manifest/i.test(r.text)) {
        text = r.text;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!text) return "";
  const pkgM = text.match(/(?:android:)?package\s*=\s*["']([^"']+)["']/i) || text.match(/namespace\s*=\s*["']([^"']+)["']/i);
  const pkg = pkgM?.[1] || "";
  const actMatches = text.match(/<activity\b[^>]*>/g) || [];
  for (const act of actMatches) {
    const nameM = act.match(/android:name\s*=\s*"([^"]+)"/i);
    if (!nameM) continue;
    // 自闭合 <activity ... /> 不可能带子 intent-filter，直接跳过
    const selfClosing = /\/\s*>$/.test(act.trim());
    if (selfClosing) continue;
    const idx = text.indexOf(act);
    const end = text.indexOf("</activity>", idx);
    const block = end > 0 ? text.slice(idx, end + 11) : act;
    if (!/android:name\s*=\s*"android\.intent\.action\.MAIN"/i.test(block)) continue;
    if (!/android:name\s*=\s*"android\.intent\.category\.LAUNCHER"/i.test(block)) continue;
    let name = nameM[1];
    if (name.startsWith(".")) name = (pkg ? pkg + "." : "") + name.slice(1);
    return name || "";
  }
  return "";
}
