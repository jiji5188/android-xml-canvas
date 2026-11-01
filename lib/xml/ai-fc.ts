// lib/xml/ai-fc.ts — M73（D1）：原生 function calling（OpenAI tools 协议）
//
// 以前工具调用靠「让模型在正文里手写 {"tool":…,"args":{…}}」，再自己用正则抠出来：
// 模型少写一个引号、多一句解释、把 JSON 包进代码块，就得重问一轮（A4 的修复机制就是为此）。
// 现在改成协议级：请求里带 tools，模型回 tool_calls（结构化），我们执行后按 role:"tool" 回喂。
//
// 兼容策略：不是所有中转都支持 tools（有的直接 400）。所以：
//   1) 默认开启；请求被以「不支持 tool」为由拒绝时，本轮自动退回旧的文本协议
//   2) 老协议（parseToolReply）保留，作为兜底
import type { AiConfig } from "./ai";
import type { AiToolCall, AiToolName } from "./ai-tools";

/** 流式增量里的单个 tool_call（多个调用靠 index 区分） */
export interface FcToolCall {
  id: string;
  name: string;
  /** 原始 JSON 字符串（流式是分片拼起来的，可能不完整） */
  arguments: string;
}

interface Acc {
  id?: string;
  name?: string;
  args: string;
}

const NAME_SET = new Set<string>([
  "list_files",
  "read_file",
  "outline",
  "find_usages",
  "check_java",
  "write_file",
  "apply_patch",
  "search_files",
]);

const str = (desc: string) => ({ type: "string", description: desc });
const int = (desc: string) => ({ type: "integer", description: desc });

/** 给 OpenAI 兼容接口的 tools 定义（与 AI_TOOL_PROMPT 里那套参数一一对应） */
export const AI_TOOL_SPECS = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出项目某个目录下的文件与子目录（一层）。不确定文件在哪时先用它。",
      parameters: {
        type: "object",
        properties: { dir: str("相对项目根的目录，留空表示根目录，如 app/src/main/res/layout") },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文本文件。大文件用 offset/limit 分段读，返回带真实行号。",
      parameters: {
        type: "object",
        properties: {
          path: str("相对项目根的文件路径"),
          offset: int("从第几行开始（1 起），不传就是从头"),
          limit: int("读多少行（最多 400）"),
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "outline",
      description: "只看 Java/Kotlin 文件的类与函数大纲（带行号），比整份读省很多上下文。",
      parameters: {
        type: "object",
        properties: { path: str("相对项目根的 .java/.kt/.kts 路径") },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_usages",
      description: "查某个资源/id 在项目里被哪些文件引用（改名字、改值之前先查）。",
      parameters: {
        type: "object",
        properties: {
          symbol: str("如 @string/app_name、@+id/btn、R.color.brand；也可只给名字"),
          type: str("只给名字时必填：string/color/dimen/id/layout/mipmap…"),
        },
        required: ["symbol"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_java",
      description: "对 .java/.kt/.kts 做本地静态自检（引号/括号、R.id 是否存在、缺 import）。注意：不是编译。",
      parameters: {
        type: "object",
        properties: { path: str("相对项目根的代码文件路径") },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "新建文件（已存在的文件会被拒绝，改已有文件请用 apply_patch）。",
      parameters: {
        type: "object",
        properties: {
          path: str("相对项目根的新文件路径"),
          content: str("完整文件内容"),
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_patch",
      description: "对已有文件做局部替换。old 必须与原文逐字一致且在文件里唯一。",
      parameters: {
        type: "object",
        properties: {
          path: str("相对项目根的文件路径"),
          edits: {
            type: "array",
            description: "要替换的片段（一次最多 20 处）",
            items: {
              type: "object",
              properties: { old: str("原文片段，逐字一致且唯一"), new: str("替换成什么") },
              required: ["old", "new"],
            },
          },
        },
        required: ["path", "edits"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "按关键字在项目文本文件里搜索（跳过 build/.git 等产物目录）。",
      parameters: {
        type: "object",
        properties: {
          query: str("要搜的字符串"),
          dir: str("从哪个目录开始搜，默认项目根"),
        },
        required: ["query"],
      },
    },
  },
] as const;

/** 当前配置是否尝试原生 tools（留了开关，出问题可以让用户关掉） */
export function supportsNativeTools(cfg: AiConfig & { nativeTools?: boolean }): boolean {
  if (cfg.nativeTools === false) return false;
  return true;
}

/**
 * 把一条 SSE payload 合并进累加器。返回是否含有 tool_calls（调用方据此跳过正文处理）。
 * 兼容 delta.tool_calls（流式）与 message.tool_calls（非流式整包）。
 */
export function mergeToolCalls(raw: string, acc: Map<number, Acc>): boolean {
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return false;
  }
  const j = o as {
    choices?: {
      delta?: { tool_calls?: unknown };
      message?: { tool_calls?: unknown };
    }[];
  };
  const c = j?.choices?.[0];
  const list = c?.delta?.tool_calls ?? c?.message?.tool_calls;
  if (!Array.isArray(list) || !list.length) return false;

  for (const item of list as {
    index?: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[]) {
    const i = typeof item.index === "number" ? item.index : 0;
    const cur = acc.get(i) ?? { args: "" };
    if (typeof item.id === "string" && item.id) cur.id = item.id;
    const fn = item.function;
    if (fn) {
      if (typeof fn.name === "string" && fn.name) {
        // M74：有的中转在每个分片都重发完整 name —— 直接拼会变成 read_fileread_file
        const cur0 = cur.name ?? "";
        if (!cur0) cur.name = fn.name;
        else if (fn.name !== cur0) cur.name = fn.name.startsWith(cur0) ? fn.name : cur0 + fn.name;
      }
      if (typeof fn.arguments === "string") cur.args += fn.arguments;
    }
    acc.set(i, cur);
  }
  return true;
}

/** 累加器 → 最终调用列表（按 index 排序，丢掉没有名字的残片） */
export function finishToolCalls(acc: Map<number, Acc>): FcToolCall[] {
  const out: FcToolCall[] = [];
  const keys = [...acc.keys()].sort((a, b) => a - b);
  for (const k of keys) {
    const v = acc.get(k)!;
    const name = (v.name ?? "").trim();
    if (!name) continue;
    out.push({
      id: v.id || `call_${k}`,
      name,
      arguments: v.args.trim() || "{}",
    });
  }
  return out;
}

/** 单个调用 → 内部 AiToolCall；参数 JSON 坏了返回一段人话错误（喂回模型） */
export function toAiToolCall(fc: FcToolCall): { call?: AiToolCall; error?: string } {
  if (!NAME_SET.has(fc.name)) return { error: `未知工具 ${fc.name}` };
  let args: Record<string, unknown> = {};
  const raw = fc.arguments.trim();
  if (raw && raw !== "{}") {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { error: `${fc.name} 的参数不是对象：${raw.slice(0, 120)}` };
      }
      args = parsed as Record<string, unknown>;
    } catch (e) {
      return { error: `${fc.name} 的参数不是合法 JSON（${e instanceof Error ? e.message : "解析失败"}）：${raw.slice(0, 120)}` };
    }
  }
  const call: AiToolCall = { tool: fc.name as AiToolName };
  const s = (k: string): string | undefined => (typeof args[k] === "string" ? (args[k] as string) : undefined);
  const n = (k: string): number | undefined => (typeof args[k] === "number" ? (args[k] as number) : undefined);
  const path = s("path");
  if (path) call.path = path;
  const dir = s("dir");
  if (dir) call.dir = dir;
  const content = s("content");
  if (content !== undefined) call.content = content;
  const query = s("query");
  if (query) call.query = query;
  const symbol = s("symbol");
  if (symbol) call.symbol = symbol;
  const type = s("type");
  if (type) call.type = type;
  const offset = n("offset");
  if (offset !== undefined) call.offset = offset;
  const limit = n("limit");
  if (limit !== undefined) call.limit = limit;
  const edits = args.edits;
  if (Array.isArray(edits)) {
    call.edits = edits
      .map((e) => e as { old?: unknown; new?: unknown })
      .map((e) => ({ old: typeof e.old === "string" ? e.old : "", new: typeof e.new === "string" ? e.new : "" }));
  }
  return { call };
}

/** 工具调用 → 历史消息里的 assistant.tool_calls（回喂给模型时必须原样带上） */
export function toHistoryToolCalls(calls: FcToolCall[]) {
  return calls.map((c) => ({
    id: c.id,
    type: "function" as const,
    function: { name: c.name, arguments: c.arguments || "{}" },
  }));
}

/** 请求里带了 tools 但服务端不认（400/422 常见）→ 本轮退回文本协议 */
export function looksLikeToolsRejected(error?: string): boolean {
  const e = (error || "").toLowerCase();
  if (!e) return false;
  const mentionsTools = /tool|function|plugin/.test(e);
  const rejects = /not support|unsupported|unknown parameter|unrecognized|invalid|400|422|不支持/.test(e);
  return mentionsTools && rejects;
}
