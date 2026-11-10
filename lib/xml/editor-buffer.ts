// lib/xml/editor-buffer.ts — M217
// 打包/真机渲染前，把「编辑器里正在编辑、但还没点保存」的内容合并进文件清单。
//
// 之前的问题：doBuildApk 里 Java 源码是 loadProjectJavaFiles(io) 从磁盘读的，
// 用户在编辑器里改了 MainActivity.java 没保存 → 打出来的还是旧代码，
// 现象是「我明明改了，装上却没变化」，很难自己发现。
//
// 这里只做纯数据合并，不碰 IO，方便单测。

export interface SrcEntry {
  path: string;
  code: string;
}

export interface XmlEntry {
  path: string;
  text: string;
}

/** 路径比较：忽略分隔符方向、开头的 ./，允许一边是另一边的后缀（项目根 vs 绝对路径） */
export function samePath(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (s: string) => s.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+/g, "/").toLowerCase();
  const x = norm(a || "");
  const y = norm(b || "");
  if (!x || !y) return false;
  return x === y || x.endsWith("/" + y) || y.endsWith("/" + x);
}

/**
 * 用编辑器当前内容覆盖（或补齐）源码清单里对应的那一条。
 * @param rel  当前打开文件的相对路径（.java/.kt/.kts 才处理）
 * @param code 编辑器里的正文
 */
export function withCurrentSource<T extends SrcEntry>(
  sources: T[],
  rel: string | null | undefined,
  code: string,
): T[] {
  if (!rel || !/\.(java|kt|kts)$/i.test(rel)) return sources;
  const i = sources.findIndex((s) => samePath(s.path, rel));
  if (i >= 0) {
    if (sources[i].code === code) return sources;
    const next = sources.slice();
    next[i] = { ...next[i], code };
    return next;
  }
  // 磁盘上还没这个文件（新建未保存）→ 直接补进去，让编译能带上
  return [...sources, { path: rel.replace(/\\/g, "/"), code } as T];
}

/**
 * 用编辑器当前内容覆盖资源清单里对应的那一条（strings.xml / colors.xml 这类，
 * 或 layout 走磁盘兜底的场景）。找不到同名条目就原样返回 —— 不凭空新建资源文件。
 */
export function withCurrentXml<T extends XmlEntry>(
  files: T[],
  rel: string | null | undefined,
  text: string,
): T[] {
  if (!rel || !/\.xml$/i.test(rel)) return files;
  const i = files.findIndex((f) => samePath(f.path, rel));
  if (i < 0) return files;
  if (files[i].text === text) return files;
  const next = files.slice();
  next[i] = { ...next[i], text };
  return next;
}
