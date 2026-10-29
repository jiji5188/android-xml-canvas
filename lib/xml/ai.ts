// lib/xml/ai.ts — M17：AI 模型调用（OpenAI 兼容协议）
//
// 设计要点（为后面「AI 写代码」留口子）：
// 1. 只依赖 fetch + OpenAI 兼容的 /chat/completions，不绑死某一家：
//    通义/DeepSeek/智谱/Kimi/OpenAI 都能用，改 baseUrl + model 即可。
// 2. 配置存 localStorage（axv.ai.v1）。API Key 只在本机，不上传任何第三方中转。
// 3. 消息构造、回复解析、代码块提取都做成纯函数，方便单测（浏览器里跑不到真网络）。
// 4. 后续做「AI 改布局」时，只要把返回值当 patch 用：当前先用「整段替换 / 插入」两种最小动作。

export type AiRole = "system" | "user" | "assistant";

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiConfig {
  /** 服务商标识（预设用），自定义时为 custom */
  provider: string;
  /** 例如 https://api.deepseek.com/v1 —— 不含结尾斜杠也可 */
  baseUrl: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
}

export const AI_LS_KEY = "axv.ai.v1";

export interface AiProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  /** 去哪儿拿 key 的一句提示 */
  keyHint: string;
}

export const AI_PROVIDERS: AiProviderPreset[] = [
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", keyHint: "platform.deepseek.com" },
  { id: "qwen", name: "通义千问", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", keyHint: "dashscope 控制台" },
  { id: "zhipu", name: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", keyHint: "bigmodel.cn" },
  { id: "moonshot", name: "Kimi", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", keyHint: "platform.moonshot.cn" },
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keyHint: "platform.openai.com" },
  { id: "custom", name: "自定义（OpenAI 兼容）", baseUrl: "", model: "", keyHint: "填兼容 /v1/chat/completions 的地址" },
];

export const DEFAULT_AI_CONFIG: AiConfig = {
  provider: "deepseek",
  baseUrl: "https://api.deepseek.com/v1",
  model: "deepseek-chat",
  apiKey: "",
  temperature: 0.2,
  maxTokens: 2048,
};

/** 系统提示词：让它输出可直接用的 Android 布局 XML，不要解释一大堆 */
export const AI_SYSTEM_PROMPT = [
  "你是一个 Android 布局助手，只输出可直接编译的 Android XML 布局代码。",
  "硬性要求：",
  "1. 只用一个 ```xml 代码块输出完整布局，不要输出解释文字；必要时最多两句说明放在代码块之后。",
  "2. 根节点必须带 xmlns:android；用到 androidx / material 属性时才加 xmlns:app，且属性前缀必须与库匹配。",
  "3. 不要使用自定义 View、动画、第三方库；不要引用不存在的 @drawable / @string / @color。",
  "4. 尺寸用 dp，字号用 sp（android:textSize 用 sp）。",
  "5. 保持我给的控件 id 不变，除非我明确要求改名。",
].join("\n");

/** 预设 → 配置（保留已填的 key） */
export function applyProvider(cfg: AiConfig, providerId: string): AiConfig {
  const p = AI_PROVIDERS.find((x) => x.id === providerId);
  if (!p) return { ...cfg, provider: providerId };
  if (p.id === "custom") return { ...cfg, provider: p.id };
  return { ...cfg, provider: p.id, baseUrl: p.baseUrl, model: p.model };
}

/** 归一化 baseUrl：去掉尾部斜杠，允许用户直接粘贴完整 endpoint */
export function normalizeBaseUrl(raw: string): string {
  let u = (raw || "").trim();
  if (!u) return "";
  u = u.replace(/\/+$/, "");
  u = u.replace(/\/chat\/completions$/i, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

export function endpointOf(baseUrl: string): string {
  const b = normalizeBaseUrl(baseUrl);
  return b ? `${b}/chat/completions` : "";
}

/** 配置是否够用（能发请求） */
export function validateConfig(cfg: AiConfig): string | null {
  if (!normalizeBaseUrl(cfg.baseUrl)) return "请填写接口地址（Base URL）";
  if (!cfg.model.trim()) return "请填写模型名";
  if (!cfg.apiKey.trim()) return "请填写 API Key";
  if (!(cfg.temperature >= 0 && cfg.temperature <= 2)) return "温度需在 0–2 之间";
  if (!(cfg.maxTokens >= 64 && cfg.maxTokens <= 32000)) return "最大 token 需在 64–32000 之间";
  return null;
}

/** 本地读取配置（坏数据回落默认） */
export function loadAiConfig(raw: string | null): AiConfig {
  if (!raw) return { ...DEFAULT_AI_CONFIG };
  try {
    const p = JSON.parse(raw) as Partial<AiConfig>;
    return {
      provider: typeof p.provider === "string" && p.provider ? p.provider : DEFAULT_AI_CONFIG.provider,
      baseUrl: typeof p.baseUrl === "string" ? p.baseUrl : DEFAULT_AI_CONFIG.baseUrl,
      model: typeof p.model === "string" ? p.model : DEFAULT_AI_CONFIG.model,
      apiKey: typeof p.apiKey === "string" ? p.apiKey : "",
      temperature: typeof p.temperature === "number" ? p.temperature : DEFAULT_AI_CONFIG.temperature,
      maxTokens: typeof p.maxTokens === "number" ? p.maxTokens : DEFAULT_AI_CONFIG.maxTokens,
    };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

/** 打码显示 key：sk-abcd…wxyz */
export function maskKey(key: string): string {
  const k = (key || "").trim();
  if (!k) return "";
  if (k.length <= 8) return "•".repeat(k.length);
  return `${k.slice(0, 4)}${"•".repeat(Math.min(8, k.length - 8))}${k.slice(-4)}`;
}

/** 组装请求体 */
export function buildRequestBody(cfg: AiConfig, messages: AiMessage[], stream = false): Record<string, unknown> {
  return {
    model: cfg.model.trim(),
    messages,
    temperature: cfg.temperature,
    max_tokens: cfg.maxTokens,
    stream,
  };
}

/** 从 OpenAI 兼容响应里取正文；结构不符返回空串 */
export function extractContent(json: unknown): string {
  const j = json as { choices?: { message?: { content?: unknown } }[] };
  const c = j?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  // 少数服务商把 content 做成数组（多模态）
  if (Array.isArray(c)) {
    return c
      .map((part) => (typeof part === "string" ? part : typeof (part as { text?: string })?.text === "string" ? (part as { text: string }).text : ""))
      .join("");
  }
  return "";
}

/** 从回复里抠出第一个代码块（xml 优先，其次任意语言） */
export function extractCodeBlock(reply: string): string | null {
  const fenced = [...reply.matchAll(/```([a-zA-Z0-9_-]*)\s*\n([\s\S]*?)```/g)];
  if (fenced.length) {
    const xml = fenced.find((m) => /^(xml|XML)$/.test(m[1] || "")) ?? fenced[0];
    const body = xml[2].trim();
    if (body) return body;
  }
  // 没代码块但整段像 XML（含自闭合）
  const t = reply.trim();
  if (/^<\?xml|^<[A-Za-z][\w.]*[\s/>]/.test(t) && /<\/?[A-Za-z][\w.]*\/>?$/.test(t)) return t;
  return null;
}

/** 人话化错误：CORS / 401 / 超时 / 余额 */
export function humanizeError(err: unknown, status?: number, body?: string): string {
  const raw = (body || "").slice(0, 300);
  if (status === 401 || status === 403) return `Key 无效或没有权限（HTTP ${status}）。检查 API Key 是否复制完整。${raw ? " 详情：" + raw : ""}`;
  if (status === 404) return `接口地址或模型名不对（HTTP 404）。确认 Base URL 结尾是 /v1 这类版本号，模型名拼写正确。${raw ? " 详情：" + raw : ""}`;
  if (status === 429) return "触发限流或余额不足（HTTP 429），稍后再试或换模型。";
  if (status && status >= 500) return `服务端错误（HTTP ${status}），通常跟你的配置无关，稍后再试。`;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return "请求发不出去（网络或跨域被拦）。两种可能：① 该服务商不允许浏览器直连（CORS），换 DeepSeek/通义一般可以；② 地址写错。APK 里同样受 WebView 跨域限制。";
  }
  if (/timeout|aborted/i.test(msg)) return "请求超时，可能是网络慢或模型响应太长，把最大 token 调小再试。";
  return msg || "未知错误";
}

export interface CallAiOptions {
  signal?: AbortSignal;
  /** 超时（ms），默认 60s */
  timeoutMs?: number;
  /** 注入 fetch 便于测试 */
  fetchImpl?: typeof fetch;
}

export interface CallAiResult {
  ok: boolean;
  content: string;
  error?: string;
}

/** 真正发请求（唯一有副作用的函数） */
export async function callAi(cfg: AiConfig, messages: AiMessage[], opts: CallAiOptions = {}): Promise<CallAiResult> {
  const bad = validateConfig(cfg);
  if (bad) return { ok: false, content: "", error: bad };

  const doFetch = opts.fetchImpl ?? fetch;
  const url = endpointOf(cfg.baseUrl);
  const ctrl = new AbortController();
  const timeout = opts.timeoutMs ?? 60_000;
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const onAbort = () => ctrl.abort();
  opts.signal?.addEventListener("abort", onAbort);

  try {
    const res = await doFetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify(buildRequestBody(cfg, messages)),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, content: "", error: humanizeError(null, res.status, text) };
    }
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, content: "", error: "服务端返回的不是 JSON，可能 Base URL 指向了网页而不是 API。" };
    }
    const content = extractContent(json);
    if (!content) return { ok: false, content: "", error: "服务端返回空内容，换个模型或降低 token 上限试试。" };
    return { ok: true, content };
  } catch (e) {
    return { ok: false, content: "", error: humanizeError(e) };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

/* ===================== 上下文与快捷指令 ===================== */

export interface AiContext {
  xml: string;
  /** 选中节点的路径链文字，如 LinearLayout > Button#ok */
  selection?: string | null;
  /** 资源清单（可选） */
  resources?: string | null;
}

/** 把上下文压成提示词；超长时截断，避免一次烧掉几千 token */
export function contextPreamble(ctx: AiContext, maxXmlChars = 12000): string {
  const parts: string[] = [];
  if (ctx.selection) parts.push(`我当前选中的控件路径：${ctx.selection}`);
  const xml = (ctx.xml || "").trim();
  if (xml) {
    const clipped = xml.length > maxXmlChars ? xml.slice(0, maxXmlChars) + "\n<!-- 以下省略 -->" : xml;
    parts.push("当前布局 XML：\n```xml\n" + clipped + "\n```");
  }
  if (ctx.resources) parts.push("可用资源：\n" + ctx.resources);
  return parts.join("\n\n");
}

export type AiQuickAction = "explain" | "optimize" | "fix" | "add";

export interface QuickActionDef {
  id: AiQuickAction;
  label: string;
  /** 送进对话的指令 */
  prompt: string;
  /** 期望回复是整段 XML（用于显示「替换 XML」按钮） */
  wantsXml: boolean;
}

export const AI_QUICK_ACTIONS: QuickActionDef[] = [
  {
    id: "explain",
    label: "解释这个界面",
    prompt: "用不超过 5 条要点说明这个布局的结构、可能存在的外观问题（对齐、间距、文字截断）。不要输出 XML。",
    wantsXml: false,
  },
  {
    id: "optimize",
    label: "改成 ConstraintLayout",
    prompt:
      "把这份布局重写成 ConstraintLayout：根节点 keep 原来的 id，所有控件保持 id 与文案不变，使用 0dp + 约束实现等分/居中，\n     margin 用 8/12/16dp，避免嵌套过深。只输出完整 XML 代码块。",
    wantsXml: true,
  },
  {
    id: "fix",
    label: "修掉告警",
    prompt: "按 Android Lint 常见问题修这份布局：缺 contentDescription、硬编码字符串改用 @string、可点击控件补 minHeight/minWidth、\n     检查嵌套过深的 LinearLayout。只输出完整 XML 代码块。",
    wantsXml: true,
  },
  {
    id: "add",
    label: "加一个控件",
    prompt: "在这个界面底部加一行：一个输入框（id=et_note，hint 写「备注」）+ 一个「保存」按钮，横向居中对齐、间距 12dp，\n     风格与现有控件一致。只输出完整 XML 代码块。",
    wantsXml: true,
  },
];

/** 把一轮对话拼成发给模型的消息数组 */
export function buildMessages(history: AiMessage[], nextUser: string, ctx: AiContext | null): AiMessage[] {
  const msgs: AiMessage[] = [{ role: "system", content: AI_SYSTEM_PROMPT }];
  const first = ctx ? contextPreamble(ctx) : "";
  // 只带最近 8 条，避免上下文无限膨胀
  const recent = history.slice(-8);
  if (first) msgs.push({ role: "user", content: first });
  for (const m of recent) msgs.push({ role: m.role, content: m.content });
  msgs.push({ role: "user", content: nextUser });
  return msgs;
}
