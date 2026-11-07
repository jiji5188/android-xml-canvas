// lib/xml/project-info.ts — M181：项目属性（包名 / 依赖）的纯文本读写
//
// 设计：gradle 文件是「用户数据」，不做 AST 解析，只认 Android 工程里最常见的
// 三种写法，改动都定位到具体行、外科手术式替换，保留原有内容：
//   · Groovy:  android { namespace 'x' / namespace "x" / applicationId "x" }
//   · KTS:     android { namespace = "x"; applicationId = "x" }
//   · 依赖：三种 DSL 混合解析
//       implementation("x")        KTS
//       implementation "x"         Groovy 空格
//       implementation('x')        Groovy 括号
// 解析失败返回 null / 空数组，UI 层提示「没找到」，不猜。

/** 提取 namespace / applicationId（两者分开：AGP 7 后 namespace 在 gradle，
 *  applicationId 决定包名，改包名两个都要动）。没找到对应项就 null。
 *  Groovy 里 key 前面是缩进空格，所以匹配时允许前面是空白/行首，
 *  但 key 前面不能再粘着字母数字（避免 `my_namespace` 之类误命中）。 */
export function parseGradlePackage(text: string): { namespace: string | null; applicationId: string | null } {
  return { namespace: readKey(text, "namespace"), applicationId: readKey(text, "applicationId") };
}

/** 读 `key "值"` / `key = "值"`。允许行内出现（`android { applicationId "x" }`），
 *  但 key 前面不能粘着 word char（避免 `my_namespace` 误命中） */
function readKey(text: string, key: string): string | null {
  const m = new RegExp(`(?<![\\w])${key}[ \\t]*=?[ \\t]*["']([^"']+)["']`).exec(text);
  return m ? m[1] : null;
}

/** 改包名：applicationId + namespace 一起换成新值（保持原有写法风格）。
 *  两个都找不到时报「没找到」，绝不新建 —— 建不出合法工程结构的话不如让用户看原文件。 */
export function setGradlePackage(text: string, pkg: string): { ok: boolean; text: string; msg?: string } {
  const cur = parseGradlePackage(text);
  if (!cur.namespace && !cur.applicationId) {
    return { ok: false, text, msg: "build.gradle 里没找到 namespace / applicationId" };
  }
  let next = text;
  for (const key of ["applicationId", "namespace"] as const) {
    const val = key === "applicationId" ? cur.applicationId : cur.namespace;
    if (!val) continue;
    next = next.replace(
      new RegExp(`((?<![\\w])${key}[ \\t]*=?[ \\t]*)(["'])[^"']+\\2`),
      `$1"${pkg}"`,
    );
  }
  if (next === text) return { ok: false, text, msg: "没改到任何一行（内容可能已被手动改过）" };
  return { ok: true, text: next };
}

/** 列出 dependencies { } 里所有依赖坐标（implementation / api / compileOnly / ...） */
export function listGradleDeps(text: string): string[] {
  const m = /(^|\n)dependencies\s*\{([\s\S]*?)\n\}/.exec(text);
  if (!m) return [];
  const out = new Set<string>();
  for (const line of m[2].split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("//")) continue;
    // 括号式：implementation("...") / implementation('...')
    const p = /^\s*(\w+)\(\s*["']([^"']+)["']\s*(,\s*(\w+))?\s*\)\s*(\/\/.*)?$/.exec(t);
    if (p) {
      out.add(p[2]);
      continue;
    }
    // 空格式：implementation "..."  /  implementation("...") 不带冒号的普通行
    const s = /^\s*(\w+)\s+["']([^"']+)["']\s*(\/\/.*)?$/.exec(t) ?? /^\s*(\w+)\(\s*["']([^"']+)["']\s*\)\s*(\/\/.*)?$/.exec(t);
    if (s) out.add(s[2]);
  }
  return [...out];
}

/** 往 dependencies { } 追加一条。没有 dependencies 块就报错（不猜工程结构）。 */
export function addGradleDep(text: string, coord: string): { ok: boolean; text: string; msg?: string } {
  const c = coord.trim();
  if (!/^[\w\.\-]+\s*:\s*[\w\.\-]+(\s*:\s*[\w\.\-*]+)?$/.test(c)) {
    return { ok: false, text, msg: "坐标格式不对（group:artifact[:version]）" };
  }
  const m = /(^|\n)dependencies\s*\{/.exec(text);
  if (!m) return { ok: false, text, msg: "没找到 dependencies 块" };
  const braceIdx = m.index + m[0].length - 1;
  const style = /dependencies\s*\{\s*\r?\n\s*implementation\(/.test(text) ? "paren" : "space";
  const line = style === "paren" ? `    implementation("${c}")` : `    implementation "${c}"`;
  return { ok: true, text: text.slice(0, braceIdx + 1) + "\n" + line + text.slice(braceIdx + 1) };
}

/** 删掉某条依赖（只删坐标完全匹配的那行，保留块内其它内容） */
export function removeGradleDep(text: string, coord: string): { ok: boolean; text: string; msg?: string } {
  const esc = coord.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*(\\w+)(\\(|\\s+)\\s*["']${esc}["']\\s*(\\))?\\s*(//.*)?$`, "m");
  if (!re.test(text)) return { ok: false, text, msg: "没找到这条依赖" };
  return { ok: true, text: text.replace(re, "") };
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
