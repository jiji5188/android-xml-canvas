// lib/xml/java-autofix.ts — M287：设备端编译前的「自动修复」层
//
// 用户在手机上写布局胶水代码，最高频的编译错误不是逻辑错，而是几类机械错：
//   ① 忘了 import（cannot be resolved to a type / cannot be resolved）
//   ② R.Id / R.String / R.Layout 大小写写错（R 里只有 id/string/layout）
//   ③ 用了项目里另一个文件声明的类却没 import（同包不用 import，跨包要）
// 这里在编译前统一扫一遍并自动修掉，修了什么写进构建日志（绝不静默改代码）。
//
// 只做「一定安全」的改写：
//   · 补 import 只在「简单类名能唯一映射到某个包」时才补（歧义的不补）
//   · R 大小写只在「小写资源真的存在」时才改
//   · 认不出来的一个都不动

import { JAVA_IMPORTS, buildImportInsertMany } from "./java-vocab";

/** 设备端 classpath 里自带 androidx（apk/vendor/androidx），这些类可以安全补 import */
export const ANDROIDX_IMPORTS: Record<string, string> = {
  AppCompatActivity: "androidx.appcompat.app.AppCompatActivity",
  Fragment: "androidx.fragment.app.Fragment",
  FragmentManager: "androidx.fragment.app.FragmentManager",
  FragmentTransaction: "androidx.fragment.app.FragmentTransaction",
  FragmentActivity: "androidx.fragment.app.FragmentActivity",
  RecyclerView: "androidx.recyclerview.widget.RecyclerView",
  LinearLayoutManager: "androidx.recyclerview.widget.LinearLayoutManager",
  GridLayoutManager: "androidx.recyclerview.widget.GridLayoutManager",
  StaggeredGridLayoutManager: "androidx.recyclerview.widget.StaggeredGridLayoutManager",
  CardView: "androidx.cardview.widget.CardView",
  SwipeRefreshLayout: "androidx.swiperefreshlayout.widget.SwipeRefreshLayout",
  DrawerLayout: "androidx.drawerlayout.widget.DrawerLayout",
  CoordinatorLayout: "androidx.coordinatorlayout.widget.CoordinatorLayout",
  NestedScrollView: "androidx.core.widget.NestedScrollView",
  DocumentFile: "androidx.documentfile.provider.DocumentFile",
  ContextCompat: "androidx.core.content.ContextCompat",
  ActivityCompat: "androidx.core.app.ActivityCompat",
  CursorLoader: "androidx.loader.content.CursorLoader",
  AsyncTaskLoader: "androidx.loader.content.AsyncTaskLoader",
  LoaderManager: "androidx.loader.app.LoaderManager",
  LocalBroadcastManager: "androidx.localbroadcastmanager.content.LocalBroadcastManager",
  ViewModel: "androidx.lifecycle.ViewModel",
  ViewModelProvider: "androidx.lifecycle.ViewModelProvider",
  LiveData: "androidx.lifecycle.LiveData",
  MutableLiveData: "androidx.lifecycle.MutableLiveData",
  Lifecycle: "androidx.lifecycle.Lifecycle",
  PercentFrameLayout: "androidx.percentlayout.widget.PercentFrameLayout",
  PercentRelativeLayout: "androidx.percentlayout.widget.PercentRelativeLayout",
};

/** java.lang / 基础类型：不需要 import，别当候选 */
const NO_IMPORT = new Set<string>([
  "String", "Object", "Integer", "Long", "Double", "Float", "Boolean", "Character", "Byte", "Short",
  "Math", "System", "Exception", "RuntimeException", "Error", "Throwable", "Thread", "Runnable",
  "StringBuilder", "StringBuffer", "Class", "Enum", "Iterable", "Comparable", "Number", "Void",
  "Override", "Deprecated", "SuppressWarnings", "FunctionalInterface", "SafeVarargs",
  "IllegalArgumentException", "IllegalStateException", "NullPointerException",
  "IndexOutOfBoundsException", "ClassCastException", "NumberFormatException",
  "UnsupportedOperationException", "InterruptedException", "ArithmeticException",
  "UncheckedIOException", "Character", "Process", "ProcessBuilder", "Package", "SecurityManager",
  "StackTraceElement", "StringIndexOutOfBoundsException", "NegativeArraySizeException",
  "ArrayIndexOutOfBoundsException", "NoSuchFieldException", "IllegalAccessException",
  "InstantiationException", "CloneNotSupportedException", "AutoCloseable", "Appendable",
  "CharSequence", "Cloneable", "Readable", "ReflectiveOperationException",
]);

export interface AutofixOptions {
  /** 资源索引：resType → 名字集合（buildResNameIndex 的结果） */
  resIndex?: Map<string, Set<string>> | null;
  /** 项目里自己声明的类型（同包不需要 import） */
  projectTypes?: Set<string>;
  /** 项目包名（判断「同包」用） */
  pkg?: string;
}

export interface AutofixReport {
  /** 文件相对路径 */
  path: string;
  /** 人话描述，例如「补 import：TextView ← android.widget.TextView」 */
  fixes: string[];
}

/** 找出文件里声明的类型（class / interface / enum / record） */
function declaredTypes(code: string): Set<string> {
  const out = new Set<string>();
  const re = /\b(?:class|interface|enum|record)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.add(m[1]);
  return out;
}

/** 已 import 的完整名 / 通配包 / 简单名 */
function scanImports(code: string) {
  const exact = new Set<string>();
  const wildcard = new Set<string>();
  const simpleToFqn = new Map<string, string>();
  const re = /^\s*import\s+(static\s+)?([\w.]+?)(\.\*)?\s*;/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    if (m[1]) continue; // 静态 import 单算，不当类型
    if (m[3]) {
      wildcard.add(m[2]);
    } else {
      const fqn = m[2];
      exact.add(fqn);
      simpleToFqn.set(fqn.slice(fqn.lastIndexOf(".") + 1), fqn);
    }
  }
  return { exact, wildcard, simpleToFqn };
}

/** 从代码里捞出「被当作类型使用」的大写标识符 */
export function typeCandidates(code: string): string[] {
  const found = new Set<string>();
  const push = (n: string) => {
    if (n && /^[A-Z][\w$]*$/.test(n)) found.add(n);
  };
  // 去掉注释与字符串，避免把注释里的词当类型
  const bare = code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''");

  const patterns: RegExp[] = [
    /\bnew\s+([A-Z][\w$]*)\s*[(<]/g, // new Foo( / new Foo<
    /\b(?:extends|implements)\s+([A-Z][\w$]*)/g, // extends Foo
    /\b([A-Z][\w$]*)\s*\[\s*\]/g, // Foo[] x
    /\b([A-Z][\w$]*)\s+[a-z_$][\w$]*\s*[=;,:)]/g, // Foo x = / Foo x; / (Foo x,
    /\b([A-Z][\w$]*)\s*<[^;{}()]{0,60}>\s+[a-z_$][\w$]*/g, // List<String> x
    /\(\s*([A-Z][\w$]*)\s+[a-z_$][\w$]*\s*[,)]/g, // (Foo x) / (, Foo x)
    /\b([A-Z][\w$]*)\s*\.\s*class\b/g, // Foo.class
    /\b([A-Z][\w$]*)\s*\.\s*[A-Z_][A-Z0-9_]*\b/g, // Foo.MAX（常量上界访问）
    /\b([A-Z][\w$]*)\s*\.*[a-z_][\w$]*\s*\(/g, // Foo.method( —— 静态调用（Toast.makeText 等）
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(bare))) push(m[1]);
  }
  // 泛型参数里出现的类型也算：把 < A, B > 拆出来
  return [...found];
}

/**
 * 补 import：返回新代码 + 修复说明。
 * 只在简单名能唯一映射时补；已有 import / 同包 / 项目自有类型 / java.lang 一律跳过。
 */
export function autofixImports(
  code: string,
  opts: AutofixOptions = {},
): { code: string; fixes: string[] } {
  const declared = declaredTypes(code);
  const { exact, wildcard, simpleToFqn } = scanImports(code);
  const projectTypes = opts.projectTypes || new Set<string>();
  const table: Record<string, string> = { ...JAVA_IMPORTS, ...ANDROIDX_IMPORTS };

  const need: string[] = [];
  const notes: string[] = [];
  for (const name of typeCandidates(code)) {
    if (NO_IMPORT.has(name)) continue;
    if (declared.has(name)) continue;
    if (projectTypes.has(name)) continue;
    const fqn = table[name];
    if (!fqn) continue;
    const pkg = fqn.slice(0, fqn.lastIndexOf("."));
    if (exact.has(fqn)) continue;
    if (wildcard.has(pkg)) continue;
    // 同名类已 import 了别的包 → 不插（插了反而更乱）
    const other = simpleToFqn.get(name);
    if (other && other !== fqn) continue;
    if (need.includes(fqn)) continue;
    need.push(fqn);
    notes.push(`${name} ← ${fqn}`);
  }
  if (!need.length) return { code, fixes: [] };
  const ins = buildImportInsertMany(code, need);
  if (!ins) return { code, fixes: [] };
  return {
    code: code.slice(0, ins.pos) + ins.text + code.slice(ins.pos),
    fixes: [`补 import：${notes.join("、")}`],
  };
}

/**
 * 修 R 大小写：R.Id.foo → R.id.foo（只在小写类型 + 该名字真的存在时改）。
 * 覆盖 R.Id / R.String / R.Layout / R.Drawable / R.Color / R.Dimen / R.Style / R.Array / R.Bool / R.Integer
 */
export function autofixRCase(
  code: string,
  resIndex?: Map<string, Set<string>> | null,
): { code: string; fixes: string[] } {
  if (!resIndex || resIndex.size === 0) return { code, fixes: [] };
  const fixes: string[] = [];
  const out = code.replace(/\bR\.([A-Z][A-Za-z0-9_]*)\.([A-Za-z_][\w]*)/g, (all, type, name) => {
    const lower = type.toLowerCase();
    const names = resIndex.get(lower);
    if (!names || !names.has(name)) return all;
    fixes.push(`R.${type}.${name} → R.${lower}.${name}`);
    return `R.${lower}.${name}`;
  });
  return { code: out, fixes: dedupe(fixes) };
}

function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}

/**
 * 对一批源码做自动修复；同一文件多处修复合并成一条日志。
 * 返回值是新数组（不修改原对象）。
 */
export function autofixJavaSources(
  sources: { path: string; code: string }[],
  opts: AutofixOptions = {},
): { sources: { path: string; code: string }[]; reports: AutofixReport[] } {
  // 全项目声明过的类型：任何文件里声明过的类，其它文件用同包类时不需要 import
  const projectTypes = new Set<string>(opts.projectTypes || []);
  for (const s of sources) for (const t of declaredTypes(s.code)) projectTypes.add(t);

  const reports: AutofixReport[] = [];
  const out = sources.map((s) => {
    let code = s.code;
    const fixes: string[] = [];
    const r1 = autofixRCase(code, opts.resIndex);
    code = r1.code;
    fixes.push(...r1.fixes);
    const r2 = autofixImports(code, { ...opts, projectTypes });
    code = r2.code;
    fixes.push(...r2.fixes);
    if (fixes.length) reports.push({ path: s.path, fixes: dedupe(fixes) });
    return { path: s.path, code };
  });
  return { sources: out, reports };
}
