// lib/xml/include.ts — M2q：<include> 就地展开
//
// Android 里 <include android:layout="@layout/xxx"/> 等价于把 xxx.xml 的根节点
// 原样嵌进当前布局（include 标签上的布局属性会覆盖被引用根节点的）。
// 这里在解析阶段就把展开做完：渲染求解器（CL/RL/LinearLayout）看到的是一棵
// 完整树，约束/规则/排布对展开后的节点一视同仁。
//
// 关键约定：
// - 展开只发生在「渲染模型树」上。主 XML 文本里的 <include/> 仍然是一个叶子
//   节点（图层树/回写都基于原文，展开进来的节点只读，见 XmlNode.includeFile）。
// - 查找表 layouts 的键 = 文件基名（"header.xml"），与 resdir 的
//   ResourceExtras.layouts 口径一致；@layout/header → 查 "header.xml"。
// - 递归展开 + 断环：同一引用链里再次出现同一个文件 → warn 并停止。
//   两个兄弟 include 同一个文件不冲突（环只按引用链判）。

import { parseLayoutXml } from "./parser";
import type { XmlNode, XmlIssue } from "./types";

/** 剥掉 @layout/ 前缀（支持 @layout-land/ 等限定符变体）→ 资源名 */
function layoutName(raw: string): string {
  let s = raw.trim();
  if (s.startsWith("@")) s = s.slice(1);
  const slash = s.lastIndexOf("/");
  if (slash >= 0) s = s.slice(slash + 1);
  // @layout/header → header；裸 "header" 也照收
  return s.replace(/\.xml$/i, "");
}

/**
 * 就地展开 root（及其子树）里所有可解析的 <include>。
 * @param layouts @layout 名 → 完整 XML 文本（resdir 上传或引用布局管理）
 * @param issues  收集 warn/循环引用
 */
export function expandIncludes(
  root: XmlNode,
  layouts: Record<string, string> | undefined,
  issues: XmlIssue[],
  chain: Set<string> = new Set(),
): void {
  for (let i = 0; i < root.children.length; i++) {
    const child = root.children[i];
    if (child.tag !== "include") {
      expandIncludes(child, layouts, issues, chain);
      continue;
    }
    const rawRef = child.attrs["layout"];
    if (!rawRef || !layouts) {
      if (rawRef) {
        issues.push({
          level: "warn",
          nodePath: child.path,
          message: `include 引用的 ${rawRef} 无法解析（尚未上传 res/layout/ 或引用布局管理里没有这个文件）`,
        });
      }
      continue;
    }
    const name = layoutName(rawRef);
    const key = `${name}.xml`;
    const text = layouts[key];
    if (text === undefined) {
      issues.push({
        level: "warn",
        nodePath: child.path,
        message: `include 引用的 @layout/${name} 未找到（需上传 res/layout/${key} 或在引用布局管理里添加）`,
      });
      continue;
    }
    if (chain.has(key)) {
      issues.push({
        level: "warn",
        nodePath: child.path,
        message: `include 循环引用（${[...chain, key].join(" → ")}），已展开 ${key} 处截断`,
      });
      continue;
    }
    const parsed = parseLayoutXml(text);
    if (!parsed.root) {
      issues.push({
        level: "warn",
        nodePath: child.path,
        message: `@layout/${name} 解析失败，include 保持占位`,
      });
      continue;
    }
    const incRoot = parsed.root;
    // Android 语义：include 标签上的属性覆盖被引用根节点的同名属性
    //（layout_width/height、margin、visibility、id…）
    for (const [k, v] of Object.entries(child.attrs)) {
      if (k === "layout") continue; // 引用本身不参与覆盖
      incRoot.attrs[k] = v;
    }
    incRoot.includeFile = key;
    chain.add(key);
    expandIncludes(incRoot, layouts, issues, chain);
    chain.delete(key);
    // 子树继承 includeFile（嵌套 include 展开后已打了更近的标记，
    // 这里 ?? 只填还没被标记的普通节点）
    const tagAll = (n: XmlNode): void => {
      n.includeFile = n.includeFile ?? key;
      n.children.forEach(tagAll);
    };
    tagAll(incRoot);
    // 用展开后的根节点替换 <include/> 占位；嵌套 include 在上面的递归里已展开
    root.children[i] = incRoot;
  }
}

/** 展开后节点路径全部失效 → 按新结构重排（#0 / #0/0 / #0/1 …） */
export function repath(root: XmlNode): void {
  const walk = (n: XmlNode, path: string): void => {
    n.path = path;
    n.children.forEach((c, idx) => walk(c, `${path}/${idx}`));
  };
  walk(root, "#0");
}
