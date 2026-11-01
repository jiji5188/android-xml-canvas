// lib/xml/ai-doc-context.ts — M64a（A1）：让 AI 知道「当前打开的到底是哪种文件」
//
// 背景（真 bug）：编辑器把任何文档都塞在同一个 xml state 里，AiPanel 以前一律按
// 「当前布局 XML」发出去，system prompt 也硬性要求只输出布局 XML。于是打开
// MainActivity.java 问「这个方法干什么」，模型会回你一段布局代码。
//
// 这里把「文件身份」做成纯函数：
//   resolveAiDocKind()  路径/内容 → 类型
//   aiDocContextOf()    类型 → 标题、代码块语言、输出契约、能否替换画布
//   buildAiSystemPrompt()  base prompt + 该类型的契约
//   quickActionsFor()   按类型给不同的快捷指令（布局的四条对 Java 没意义）
// 全是纯数据，方便单测；AiPanel 只负责把它们拼进消息。

import { detectDocKind, isValuesPath } from "./doc-kind";
import { parseOutline } from "./java-outline";
import { AI_QUICK_ACTIONS, type QuickActionDef } from "./ai";

export type AiDocKind = "layout" | "values" | "manifest" | "java" | "kotlin" | "xml" | "text";

export interface AiDocContext {
  kind: AiDocKind;
  /** 「带布局 / 带代码」复选框的文案 */
  attachLabel: string;
  /** 上下文块的标题，如「当前 Java 源码」 */
  title: string;
  /** 代码块语言标记 */
  fence: string;
  /** 消息里代码块顶部那行标记的显示名（XML / Java / Kotlin / 文本） */
  codeTag: string;
  /** 空状态的第一句话 */
  emptyHint: string;
  /** 输出契约（拼进 system prompt） */
  contract: string[];
  /** 回复里的代码块能否「替换画布」（只有布局可以；Java 塞进画布会把文档写坏） */
  canReplaceCanvas: boolean;
}

/** 只看路径：java / kotlin / values / manifest / 布局 / 其他 xml / 纯文本 */
export function resolveAiDocKind(relOrName?: string | null, content = ""): AiDocKind {
  const p = (relOrName || "").replace(/\\/g, "/");
  const name = p.slice(p.lastIndexOf("/") + 1);
  if (/\.java$/i.test(name)) return "java";
  if (/\.kts?$/i.test(name)) return "kotlin";
  if (name === "AndroidManifest.xml") return "manifest";
  if (/\.(gradle|properties|json|md|txt|pro|cfg|ini|yml|yaml)$/i.test(name)) return "text";
  if (isValuesPath(p)) return "values";
  if (/\.xml$/i.test(name)) {
    return detectDocKind(content, p) === "layout" ? "layout" : "xml";
  }
  if (p) return "text";
  // 没有路径（直接粘进来的内容）：先认 Java/Kotlin，再按根标签判布局/资源
  if (looksLikeJvmSource(content)) return /\bfun\s+\w+\s*\(|\bval\s+\w+|\bvar\s+\w+/.test(content) ? "kotlin" : "java";
  return detectDocKind(content, null) === "layout" ? "layout" : "xml";
}

/** 无路径时的兜底：有 package/import/类声明就当 JVM 源码，别把 Java 当布局发出去 */
function looksLikeJvmSource(content: string): boolean {
  if (!content) return false;
  if (/^\s*package\s+[\w.]+\s*;?\s*$/m.test(content)) return true;
  if (/^\s*import\s+[\w.*]+\s*;?\s*$/m.test(content)) return true;
  return /\b(public|private|protected|internal)\s+(static\s+|final\s+|open\s+|abstract\s+)*(class|interface|enum|object)\b/.test(content);
}

const BASE_RULE = "回答用中文；不要编造项目里不存在的资源、类名或 API；不确定就直说。";

const CONTRACTS: Record<AiDocKind, string[]> = {
  layout: [
    "输出契约（布局 XML）：",
    "1. 改布局时按上面的决策规则：能改文件就用 apply_patch；只有我要整份时才输出完整布局代码块。",
    "2. 根节点必须带 xmlns:android；用到 androidx / material 属性时才加 xmlns:app，属性前缀必须与库匹配。",
    "3. 不要使用自定义 View、动画、第三方库；不要引用不存在的 @drawable / @string / @color。",
    "4. 尺寸用 dp，字号用 sp（android:textSize 用 sp）。",
    "5. 保持我给过的控件 id 不变，除非我明确要求改名。",
  ],
  values: [
    "输出契约（values 资源）：",
    "1. 保持 <resources> 根节点与原有条目结构，只增改我提到的条目。",
    "2. 名字用 snake_case；不要与已有条目重名，也不要删掉我没提的条目。",
    "3. 只引用项目里真实存在的资源；拿不准就留空并说明。",
    "4. 需要给整份文件时才用一个 ```xml 代码块输出；改已有文件优先 apply_patch。",
  ],
  manifest: [
    "输出契约（AndroidManifest.xml）：",
    "1. 只改我明确要求的节点，保留 package、versionCode / versionName、已有权限。",
    "2. 不要新增权限、provider、service，除非我明确要求。",
    "3. 需要给整份文件时才用一个 ```xml 代码块输出；改已有文件优先 apply_patch。",
  ],
  java: [
    "输出契约（Java）：",
    "1. 只给需要改动/新增的方法或类片段，不要整份重贴文件；解释放代码块外，最多三句。",
    "2. 用到新类型时必须同时写出对应的 import 行。",
    "3. 保持现有 package、类名、已有方法签名与命名风格；不要改写成 Kotlin。",
    "4. 引用资源必须用项目里存在的 R.id / R.string / R.layout；不确定就先说不知道。",
    "5. 不要输出 Android XML 布局——这是 Java 文件，不是布局。",
    "6. 你无法编译，回复末尾注明「未编译验证」。",
  ],
  kotlin: [
    "输出契约（Kotlin）：",
    "1. 只给需要改动/新增的函数或类片段，不要整份重贴文件；解释放代码块外，最多三句。",
    "2. 用 Kotlin 惯用写法：不加分号、优先 val、监听器用 lambda、字符串模板代替拼接。",
    "3. 可空性显式处理（?. / ?: / requireNotNull），不要滥用 !!。",
    "4. 保持现有 package、类名与既有函数签名；不要改写成 Java。",
    "5. 不要输出 Android XML 布局——这是 Kotlin 文件，不是布局。",
    "6. 你无法编译，回复末尾注明「未编译验证」。",
  ],
  xml: [
    "输出契约（XML 资源）：",
    "1. 保持原根节点和结构（shape / selector / menu / vector 等），只改我要求的部分。",
    "2. 不要新增我没要求的节点；属性取值必须合法。",
    "3. 用一个 ```xml 代码块输出，代码块外最多两句说明。",
  ],
  text: [
    "输出契约（文本/配置）：",
    "1. 保持原文件格式与缩进，只改我要求的部分，不要改键名。",
    "2. 需要给内容时用一个代码块输出，代码块外最多两句说明。",
  ],
};

const ROLE: Record<AiDocKind, string> = {
  layout: "你是一个 Android 布局助手，熟悉 LinearLayout / FrameLayout / ConstraintLayout 与常用控件属性。",
  values: "你是一个 Android 资源助手，熟悉 res/values 下的 strings / colors / dimens / styles。",
  manifest: "你是一个 Android 构建与清单助手，熟悉 AndroidManifest.xml 的节点语义。",
  java: "你是一个 Android Java 开发助手，熟悉 Activity / Fragment 生命周期、View 绑定与常用 Jetpack 组件。",
  kotlin: "你是一个 Android Kotlin 开发助手，熟悉 Kotlin 惯用法、协程与 Jetpack 组件。",
  xml: "你是一个 Android 资源 XML 助手，熟悉 shape / selector / menu / vector 等资源格式。",
  text: "你是一个 Android 工程配置助手，熟悉 Gradle 与工程目录约定。",
};

const META: Record<AiDocKind, Omit<AiDocContext, "kind" | "contract">> = {
  layout: {
    attachLabel: "带布局",
    title: "当前布局 XML",
    fence: "xml",
    codeTag: "XML",
    emptyHint: "让 AI 看懂当前布局：解释结构、改成 ConstraintLayout、修 lint 告警、加控件。",
    canReplaceCanvas: true,
  },
  values: {
    attachLabel: "带资源",
    title: "当前 values 资源",
    fence: "xml",
    codeTag: "XML",
    emptyHint: "让 AI 看当前资源文件：整理命名、查重复值、补缺失条目。",
    canReplaceCanvas: false,
  },
  manifest: {
    attachLabel: "带清单",
    title: "当前 AndroidManifest.xml",
    fence: "xml",
    codeTag: "XML",
    emptyHint: "让 AI 看清单：解释组件声明、检查权限与 exported 配置。",
    canReplaceCanvas: false,
  },
  java: {
    attachLabel: "带代码",
    title: "当前 Java 源码",
    fence: "java",
    codeTag: "Java",
    emptyHint: "让 AI 看这段 Java：解释逻辑、找潜在问题、补注释、重构方法。",
    canReplaceCanvas: false,
  },
  kotlin: {
    attachLabel: "带代码",
    title: "当前 Kotlin 源码",
    fence: "kotlin",
    codeTag: "Kotlin",
    emptyHint: "让 AI 看这段 Kotlin：解释逻辑、找潜在问题、补注释、重构函数。",
    canReplaceCanvas: false,
  },
  xml: {
    attachLabel: "带文件",
    title: "当前 XML 资源",
    fence: "xml",
    codeTag: "XML",
    emptyHint: "让 AI 看这个资源文件：解释结构、检查格式问题、给改法。",
    canReplaceCanvas: false,
  },
  text: {
    attachLabel: "带文件",
    title: "当前文件内容",
    fence: "text",
    codeTag: "文本",
    emptyHint: "让 AI 看这个文件：解释内容、检查配置问题、给改法。",
    canReplaceCanvas: false,
  },
};

export function aiDocContextOf(relOrName?: string | null, content = ""): AiDocContext {
  const kind = resolveAiDocKind(relOrName, content);
  return { kind, ...META[kind], contract: CONTRACTS[kind] };
}

/** 再判一次：调用方已经知道自己是什么文件时，可以少传内容 */
export function isLayoutDoc(ctx: AiDocContext): boolean {
  return ctx.kind === "layout";
}

/** 本次请求想要什么：auto=自己判断（默认）/ xml=用户明确要整份文件 / edit=直接改文件（M64j/A5） */
export type AiPromptIntent = "auto" | "xml" | "edit";

export interface AiPromptOpts {
  intent?: AiPromptIntent;
  /** 项目能不能写（不能写就别教它 apply_patch） */
  canWrite?: boolean;
}

/** 怎么回答：把「只输出 XML」降级成「只有明确要求才输出整份」——这是 A2 的核心 */
function decisionBlock(ctx: AiDocContext, intent: AiPromptIntent, canWrite: boolean): string[] {
  if (intent === "xml") {
    return [
      "怎么回答（本次我明确要完整文件）：",
      `1. 用 \`\`\`${ctx.fence} 代码块输出**完整**内容，代码块外最多两句说明。`,
      "2. 不要用 axv-tool 改文件，也不要只给片段。",
    ];
  }
  if (intent === "edit") {
    return [
      "怎么回答（本次我要求你直接改文件）：",
      canWrite
        ? "1. 必须用 axv-tool 的 apply_patch 做局部替换：old 必须与文件现有内容逐字一致且唯一；新建文件才用 write_file。"
        : "1. 当前项目没有写权限：不要调用写文件的工具，直接给我片段并说清插在哪一行/哪个节点后面。",
      "2. 不要整份重贴，也不要输出完整代码块（新建文件除外）。",
      "3. 只改我提到的那几处，其他行原样保留；改完用一句话说明改了哪里。",
      "4. 如果我的要求其实不需要改文件（只是问问题），就正常回答并说明不用改。",
    ];
  }
  return [
    "怎么回答（先判断我这句话要什么，别一上来就吐整份文件）：",
    "A. 我只是问、解释、评审、找问题 → 直接在正文里回答；需要举例时才放代码块，且只放相关片段。",
    canWrite
      ? "B. 我要改这个文件 → 用 axv-tool 的 apply_patch 做局部替换（old/new 精确对齐），不要整份重贴，也不要只给我一段让我自己粘。"
      : "B. 我要改这个文件 → 当前项目没有写权限，只能给片段和建议，并提示我需要「打开项目目录」并允许编辑。",
    "C. 只有我明确说「给我完整文件 / 整份 XML / 输出全部」时，才输出完整代码块。",
    "D. 一次回复只做一件事：要么回答，要么改文件，不要既贴全文又贴 patch。",
  ];
}

const BANS = [
  "禁止项：",
  "1. 不要编造项目里不存在的资源、类名、API。引用 @drawable / @string / @color / R.id 之前，先在给我的上下文里确认它存在；不确定就先 search_files 或 read_file，再不确定就直说不知道。",
  "2. 不要改我没提到的控件 id、包名、类名、方法签名；不要顺手删除任何条目。",
  "3. 不要用「以下是代码」「希望能帮到你」这类空话占字数。",
  "4. 不要输出与当前文件类型无关的格式（见上面的输出契约）。",
];

/** system prompt：角色 → 决策规则 → 输出契约 → 禁止项（M64h/A2 拆成四段，去掉自相矛盾） */
export function buildAiSystemPrompt(ctx: AiDocContext, opts: AiPromptOpts = {}): string {
  const intent = opts.intent ?? "auto";
  const canWrite = opts.canWrite !== false;
  return [
    ROLE[ctx.kind],
    BASE_RULE,
    "",
    ...decisionBlock(ctx, intent, canWrite),
    "",
    ...ctx.contract,
    "",
    ...BANS,
  ].join("\n");
}

export interface DocPreambleOptions {
  /** 选中控件路径（只有布局有意义） */
  selection?: string | null;
  /** 资源清单（可选） */
  resources?: string | null;
  /** 内容截断阈值 */
  maxChars?: number;
  /** 文件相对路径（写进上下文块，方便模型引用） */
  relPath?: string | null;
}

/** 当前文档的上下文块：标题 / 语言都按文件类型切换 */
export function docPreamble(ctx: AiDocContext, content: string, opts: DocPreambleOptions = {}): string {
  const max = opts.maxChars ?? 12000;
  const parts: string[] = [];
  if (opts.selection && ctx.kind === "layout") parts.push(`当前选中控件路径：${opts.selection}`);
  if (opts.resources) parts.push(`可用资源：${opts.resources}`);
  const body = (content || "").trim();
  if (body) {
    const clipped = body.length > max ? body.slice(0, max) + `\n…（已截断，原长 ${body.length} 字符）` : body;
    const where = opts.relPath ? `（${opts.relPath}）` : "";
    parts.push(`${ctx.title}${where}：\n\`\`\`${ctx.fence}\n${clipped}\n\`\`\``);
  }
  return parts.join("\n\n");
}

/** M69（A3）：超过这个长度就不整份塞进 prompt，改给结构摘要 */
export const DOC_INLINE_MAX = 20000;

/** 结构摘要用的轻量统计（纯正则，够模型定位） */
function tagHistogram(src: string, limit = 12): string {
  const counts = new Map<string, number>();
  for (const m of src.matchAll(/<([A-Za-z][\w.]*)[\s/>]/g)) {
    const t = m[1];
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t, n]) => t + "×" + n)
    .join("、");
}

function idList(src: string, limit = 24): string {
  const ids: string[] = [];
  for (const m of src.matchAll(/@\+?id\/([A-Za-z_][\w]*)/g)) {
    if (!ids.includes(m[1])) ids.push(m[1]);
    if (ids.length >= limit) break;
  }
  return ids.join("、");
}

function valuesSummary(src: string): string {
  const counts = new Map<string, number>();
  const names: string[] = [];
  for (const m of src.matchAll(/<([a-z]+)\s+name="([\w.]+)"/g)) {
    const tag = m[1];
    counts.set(tag, (counts.get(tag) || 0) + 1);
    if (names.length < 20) names.push(m[2]);
  }
  const head = [...counts.entries()].map(([t, n]) => t + "×" + n).join("、");
  return "条目统计：" + (head || "（没解析出来）") + "；前几个名字：" + names.join("、");
}

function manifestSummary(src: string): string {
  const perms = [...src.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  const comps = [...src.matchAll(/<(activity|service|receiver|provider)[^>]*android:name="([^"]+)"/g)].map(
    (m) => m[1] + ' ' + m[2],
  );
  return [
    perms.length ? "权限：" + perms.join("、") : "权限：无",
    comps.length ? "组件：" + comps.slice(0, 12).join("；") + (comps.length > 12 ? "…" : "") : "组件：无",
  ].join("\n");
}

/**
 * M69（A3）：给 prompt 的文档块。
 * 小于 DOC_INLINE_MAX 时整份给（docPreamble）；超过时只给结构摘要 + 用工具读的指引，
 * 避免每轮把 20K+ 字符重新发一遍（文档随 user 消息走 → 前缀不稳定 → prompt cache 全不命中）。
 */
export function docBrief(
  ctx: AiDocContext,
  content: string,
  opts: DocPreambleOptions = {},
): { text: string; truncated: boolean; chars: number } {
  const max = opts.maxChars ?? DOC_INLINE_MAX;
  const body = (content || "").trim();
  const chars = body.length;
  if (chars <= max) {
    return { text: docPreamble(ctx, body, { ...opts, maxChars: max }), truncated: false, chars };
  }

  const where = opts.relPath ? "（" + opts.relPath + "）" : "";
  const lines: string[] = [];
  if (opts.selection && ctx.kind === "layout") lines.push("当前选中控件路径：" + opts.selection);
  if (opts.resources) lines.push("可用资源：" + opts.resources);
  lines.push(
    ctx.title + where + "：共 " + chars + " 字符 / " + body.split("\n").length +
      " 行，太长没有整份贴出，下面是结构摘要。",
  );

  if (ctx.kind === "layout" || ctx.kind === "xml") {
    const root = /<([A-Za-z][\w.]*)/.exec(body)?.[1] || "?";
    lines.push("根标签：<" + root + ">；控件统计：" + tagHistogram(body));
    const ids = idList(body);
    if (ids) lines.push("用到的 id：" + ids);
    lines.push("要看具体控件时用 read_file {offset,limit} 取那一段；不要凭空猜没看到的属性。");
  } else if (ctx.kind === "java" || ctx.kind === "kotlin") {
    const pkg = /^\s*package\s+([\w.]+)/m.exec(body)?.[1];
    if (pkg) lines.push("package：" + pkg);
    const items = parseOutline(body, ctx.kind === "kotlin").slice(0, 25);
    if (items.length) {
      lines.push("类/方法（行号，定位后再读具体段）：");
      lines.push(items.map((it) => "L" + it.line + " " + "  ".repeat(it.depth) + it.name + (it.sig || "")).join("\n"));
    }
    lines.push("先调 outline 拿行号，再用 read_file {offset,limit} 只读目标方法；禁止整份猜。");
  } else if (ctx.kind === "values") {
    lines.push(valuesSummary(body));
    lines.push("要看具体某条用 find_usages {symbol} 或 read_file {offset,limit}。");
  } else if (ctx.kind === "manifest") {
    lines.push(manifestSummary(body));
  } else {
    lines.push("开头 1200 字符：\n```\n" + body.slice(0, 1200) + "\n```");
  }

  return { text: lines.filter(Boolean).join("\n"), truncated: true, chars };
}

const CODE_ACTIONS: QuickActionDef[] = [
  {
    id: "explain",
    label: "解释这段代码",
    prompt: "用不超过 5 条要点说明这段代码在做什么、依赖哪些外部状态、有哪些隐含前提。只讲逻辑，不要贴整份代码。",
    wantsXml: false,
  },
  {
    id: "optimize",
    label: "找潜在问题",
    prompt:
      "检查这段代码的空指针、生命周期、线程、内存泄漏、异常被吞掉、资源未释放等问题。按严重程度排序，每条给出位置（方法名或行特征）和具体改法。不要贴整份文件。",
    wantsXml: false,
  },
  {
    id: "fix",
    label: "补中文注释",
    prompt: "给关键方法和不直观的逻辑补简洁中文注释（Javadoc 或行内），用 apply_patch 逐处插入，不要改任何逻辑。",
    wantsXml: false,
    intent: "edit",
  },
  {
    id: "add",
    label: "重构这个方法",
    prompt: "把这段代码里最长或最重复的方法拆小、消除重复，保持对外行为不变。用 apply_patch 直接修改文件。",
    wantsXml: false,
    intent: "edit",
  },
];

const FILE_ACTIONS: QuickActionDef[] = [
  {
    id: "explain",
    label: "解释这个文件",
    prompt: "用不超过 5 条要点说明这个文件的用途、结构和关键条目。不要整份重贴。",
    wantsXml: false,
  },
  {
    id: "fix",
    label: "检查格式问题",
    prompt: "检查这个文件的格式/命名/重复项/明显错误，按严重程度列出问题、定位与改法。不要整份重贴。",
    wantsXml: false,
  },
  {
    id: "optimize",
    label: "整理一下",
    prompt: "在不改变语义的前提下整理这个文件：统一命名风格、按用途分组、去掉冗余条目。用 apply_patch 局部调整，不要重贴整份。",
    wantsXml: false,
    intent: "edit",
  },
];

/** 快捷指令按文件类型切换：布局那四条（改 ConstraintLayout / 修 lint）对 Java 没意义 */
export function quickActionsFor(ctx: AiDocContext): QuickActionDef[] {
  if (ctx.kind === "layout") return AI_QUICK_ACTIONS;
  if (ctx.kind === "java" || ctx.kind === "kotlin") return CODE_ACTIONS;
  return FILE_ACTIONS;
}
