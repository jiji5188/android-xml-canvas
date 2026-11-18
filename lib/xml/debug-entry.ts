// lib/xml/debug-entry.ts — M405：debug 运行入口探测 + R.java 生成（设备端 ECJ 用）

import { parseOutline } from "./java-outline";
import type { ResourceTable } from "./types";

/** 从 java 文件源码里抠出顶层 package（没有返回 ""） */
function packageOf(src: string): string {
  const m = src.match(/^[\s]*package\s+([\w.]+)\s*;/m);
  return m ? m[1] : "";
}

/** 一个 java 文件里是否声明了 public static void main(String[]) 或 debug() */
function hasEntry(src: string): boolean {
  return /\bstatic\s+void\s+main\s*\(\s*String\s*[\[)]/.test(src) ||
    /\bstatic\s+void\s+debug\s*\(\s*\)/.test(src);
}

/**
 * 算「候选入口类全限定名」：扫每个 .java，含 main(String[])/debug() 的类算候选。
 * 供设备端自动探测（InMemory dex 里 Class.forName 逐个试）。
 * 最多 32 个（防大项目爆炸）。
 */
export function entryCandidates(javaSources: { path: string; code: string }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of javaSources) {
    if (!/\.java$/i.test(f.path)) continue;
    const src = f.code || "";
    if (!hasEntry(src)) continue;
    const pkg = packageOf(src);
    // 顶层类：outline 里 kind=class 的项（depth 最小的）
    const outline = parseOutline(src, false);
    const classes = outline.filter((o) => o.kind === "class" && o.depth <= 1);
    const names = classes.length ? classes.map((c) => c.name) : null;
    if (names) {
      for (const n of names) {
        const fq = pkg ? pkg + "." + n : n;
        if (!seen.has(fq)) { seen.add(fq); out.push(fq); }
      }
    } else {
      // 没解析出类（可能是片段）：按文件名兜底
      const base = f.path.split("/").pop() || "";
      const n = base.replace(/\.java$/i, "");
      if (n) {
        const fq = pkg ? pkg + "." + n : n;
        if (!seen.has(fq)) { seen.add(fq); out.push(fq); }
      }
    }
    if (out.length >= 32) break;
  }
  return out;
}

/** 从 javaSources 里扫出所有 R.xxx.yyy 引用（type + name），供 R.java 补全占位 */
function scanRRefs(sources: { code: string }[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  const re = /\bR\.(\w+)\.(\w+)/g;
  for (const f of sources) {
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(f.code)) !== null) {
      const t = mm[1], nm = mm[2];
      if (!m.has(t)) m.set(t, new Set());
      m.get(t)!.add(nm);
    }
  }
  return m;
}

/**
 * 从 ResourceTable 生成 R.java 文本（设备端 ECJ 编译 R.id/R.string/R.drawable 等引用用）。
 * 与 aapt2 的 R.java 同构（public static final int），值用 0x01xxxx 递增（编译期只需互不冲突，
 * 运行时是动态 dex 不真正 inflate，值不参与资源查找——仅让编译过 + 逻辑可跑）。
 * @param sources 项目 Java 源码（用来扫 R.xxx 引用，补占位）
 */
export function genRJavaText(table: ResourceTable, pkg: string, sources?: { code: string }[]): string {
  let n = 0x01000000;
  const next = (): number => n++;
  const lines: string[] = [
    "package " + (pkg || "com.axv.app") + ";",
    "",
    "public final class R {",
  ];
  const sec = (title: string, names: string[]): void => {
    if (!names.length) return;
    lines.push("    public static final class " + title + " {");
    for (const nm of names) {
      if (!/^[A-Za-z_$][A-Za-z0-9_]*$/.test(nm)) continue;
      lines.push("        public static final int " + nm + " = " + next() + ";");
    }
    lines.push("    }");
  };
  const namesOf = (rec: Record<string, unknown> | undefined | null): string[] =>
    rec ? Object.keys(rec).filter((k) => /^[A-Za-z_$][A-Za-z0-9_]*$/.test(k)) : [];
  // 代码里实际引用的 R 类型（补占位，防 aapt2 没收全的）
  const refs = sources ? scanRRefs(sources) : new Map<string, Set<string>>();
  const merged = (type: string, fromTable: string[]): string[] => {
    const set = new Set<string>(fromTable);
    const extra = refs.get(type);
    if (extra) for (const e of extra) set.add(e);
    return [...set];
  };
  sec("id", merged("id", [])); // R.id 主要来自代码引用（scanRRefs）+ 资源表里没有 ids
  sec("string", merged("string", namesOf(table.strings)));
  sec("color", merged("color", namesOf(table.colors)));
  sec("dimen", merged("dimen", namesOf(table.dimens)));
  sec("drawable", merged("drawable", [...namesOf(table.drawables), ...(table.vectorNames || [])]));
  sec("style", merged("style", namesOf(table.styles)));
  sec("array", merged("array", namesOf(table.stringArrays)));
  sec("attr", merged("attr", namesOf(table.themeAttrs)));
  sec("layout", merged("layout", [])); // 代码引用的 R.layout.xxx 靠这里补
  // 其他被引用但没专门 sec 的类型（menu/raw/anim 等）
  for (const t of refs.keys()) {
    if (["id", "string", "color", "dimen", "drawable", "style", "array", "attr", "layout"].includes(t)) continue;
    sec(t, [...(refs.get(t) || [])]);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}
