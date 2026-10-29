// lib/xml/lint.ts — 轻量结构检查（带行号），给代码视图标错用
// 只做「能不能被 Android 吃下」级别的检查：标签配对、注释/CDATA/声明闭合、非法标签名。
// 不做属性语义校验（那是渲染层 issues 的事）。

import { childRuleOf, isRootOnlyTag, shortTag } from "./child-rules";
import { namespaceIssues } from "./namespace";

export interface LintIssue {
  line: number;
  level: "error" | "warn";
  message: string;
}

function lineAt(src: string, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src.charCodeAt(i) === 10) n++;
  return n;
}

export function lintXml(src: string): LintIssue[] {
  const issues: LintIssue[] = [];
  // M12：命名空间错（android:cornerRadius 这类）→ aapt 编译不过，导出时会被自动改成 app:
  for (const ns of namespaceIssues(src)) {
    issues.push({
      line: ns.line,
      level: "warn",
      message:
        ns.to === "style"
          ? `android:style 不是带命名空间的属性，应写成 style="@style/…"`
          : `${ns.from} 是 androidx/Material 属性，必须写成 ${ns.to}（否则 aapt 报 No resource identifier found）`,
    });
  }
  const stack: { tag: string; line: number; kids: number; reported: Set<string> }[] = [];
  /** 出现过配对错误时，栈里剩下的「未闭合」不可信（错一个就会连锁），不再报 */
  let hadPairError = false;
  let i = 0;

  while (i < src.length) {
    // 注释
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i);
      if (e === -1) {
        issues.push({ line: lineAt(src, i), level: "error", message: "注释未闭合（缺少 -->）" });
        return issues;
      }
      i = e + 3;
      continue;
    }
    // CDATA
    if (src.startsWith("<![CDATA[", i)) {
      const e = src.indexOf("]]>", i);
      if (e === -1) {
        issues.push({ line: lineAt(src, i), level: "error", message: "CDATA 未闭合（缺少 ]]>）" });
        return issues;
      }
      i = e + 3;
      continue;
    }
    // 声明 / 处理指令
    if (src.startsWith("<?", i)) {
      const e = src.indexOf("?>", i);
      if (e === -1) {
        issues.push({ line: lineAt(src, i), level: "error", message: "<?xml ?> 声明未闭合" });
        return issues;
      }
      i = e + 2;
      continue;
    }
    if (src[i] !== "<") {
      i++;
      continue;
    }
    // 扫标签
    let j = i + 1;
    let quote: string | null = null;
    while (j < src.length) {
      const c = src[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === ">") {
        break;
      }
      j++;
    }
    if (j >= src.length) {
      issues.push({ line: lineAt(src, i), level: "error", message: "标签未闭合（缺少 >）" });
      return issues;
    }
    const raw = src.slice(i, j + 1);
    const startLine = lineAt(src, i);
    i = j + 1;

    if (raw.startsWith("</")) {
      const name = raw.slice(2).replace(/[\s>].*$/, "").trim();
      const top = stack.pop();
      if (!top) {
        issues.push({ line: startLine, level: "error", message: `多余的结束标签 </${name}>` });
        hadPairError = true;
      } else if (top.tag !== name) {
        issues.push({
          line: startLine,
          level: "error",
          message: `</${name}> 与第 ${top.line} 行的 <${top.tag}> 不匹配`,
        });
        hadPairError = true;
      }
      continue;
    }

    const body = raw.slice(1);
    const m = /[\s/>]/.exec(body);
    const name = (m ? body.slice(0, m.index) : body).trim();
    if (!name) {
      issues.push({ line: startLine, level: "error", message: "非法标签名" });
      continue;
    }
    // merge 只能当根：出现在任何控件内部都是错的
    if (isRootOnlyTag(name) && stack.length > 0) {
      issues.push({
        line: startLine,
        level: "error",
        message: `<${shortTag(name)}> 只能作为 XML 根节点，不能放在其他控件内部`,
      });
    }
    // M15：按 child-rules.ts 的规则表校验「父标签 × 子控件」——5 类规则全在这里落地
    // （叶子 View / Adapter 容器 / 单 child 容器 / 有上限的多 child 容器 / merge 非根）
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.kids++;
      const rule = childRuleOf(parent.tag);
      const pTag = shortTag(parent.tag);
      const once = (key: string, level: "error" | "warn", message: string) => {
        if (parent.reported.has(key)) return;
        parent.reported.add(key);
        issues.push({ line: parent.line, level, message });
      };
      if (rule?.cat === 5 && rule.max === 0) {
        // fragment / include：内部不能写子控件（只能引用外部文件）
        once("special", "warn", `<${pTag}> ${rule.desc}（发现子控件 <${name}>）`);
      } else if (rule?.kind === "none") {
        // 叶子控件里写子节点 → 真机崩溃 / aapt 报错。文案保持原样（既有测试断言）
        once("leaf", "warn", `<${pTag}> 不是 ViewGroup，不能包含子控件（<${name}>）`);
      } else if (rule?.kind === "adapter") {
        once(
          "adapter",
          "warn",
          `<${pTag}> 的子项由 Adapter 动态加载，XML 里写静态子控件真机会抛 UnsupportedOperationException`,
        );
      } else if (rule?.kind === "single" && parent.kids > 1) {
        once(
          "single",
          "warn",
          `<${pTag}> 只允许 1 个直接子控件，当前已有 ${parent.kids} 个（多余的不会显示）`,
        );
      } else if (rule?.max !== undefined && parent.kids > rule.max) {
        once("max", "warn", `<${pTag}> 最多只允许 ${rule.max} 个直接子控件，当前已有 ${parent.kids} 个`);
      }
    }
    if (/\/>$/.test(raw.trimEnd())) continue; // 自闭合
    stack.push({ tag: name, line: startLine, kids: 0, reported: new Set() });
  }

  if (!hadPairError) {
    for (const s of stack) {
      issues.push({ line: s.line, level: "error", message: `<${s.tag}> 未闭合` });
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}
