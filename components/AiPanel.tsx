"use client";

// components/AiPanel.tsx — M17：左栏「AI 助手」面板
// 现在只做两件事：① 配好模型并连通；② 拿当前 XML 问问题、把回复里的代码块替换回画布。
// 「AI 写代码」的后续能力（局部改写 / diff 预览 / 多轮记忆）都从这个壳里长出来。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AI_LS_KEY,
  AI_PROVIDERS,
  applyProvider,
  extractCodeBlock,
  loadAiConfig,
  normalizeBaseUrl,
  validateConfig,
  type AiConfig,
  type AiMessage,
} from "@/lib/xml/ai";
import { nativeAiAvailable, streamChat } from "@/lib/xml/ai-transport";
import { AI_TOOL_PROMPT, createNativeIo, extractToolCalls, runTool, stripToolBlocks, type AiFileIo } from "@/lib/xml/ai-tools";
import { aiDocContextOf, buildAiSystemPrompt, docPreamble, quickActionsFor } from "@/lib/xml/ai-doc-context";

/** 工具循环最多几轮（防模型无限读文件） */
const MAX_TOOL_ROUNDS = 3;

interface Props {
  /** 当前打开的文档内容（布局 XML / Java 源码 / values 资源…都可能是） */
  xml: string;
  /** 当前文档的相对路径或文件名：AI 靠它判断「这是什么文件」（M64a/A1） */
  docRel?: string | null;
  /** 选中节点路径文字，如 LinearLayout > Button#ok */
  selection?: string | null;
  /** 可用资源摘要（可选） */
  resources?: string | null;
  /** 把整段 XML 写回画布（走撤销栈） */
  onReplaceXml: (xml: string) => void;
  /** 提示条（复用编辑器的 toast） */
  onNote?: (text: string) => void;
  /** 当前项目名（相对工作目录），给「读写查文件」定位根目录 */
  projectName?: string;
  /**
   * M64b（B2）：当前项目的文件通道。由 XmlEditor 用 `ioForProject(activeProject)` 算好传进来，
   * 不再拿「默认工作目录 + 项目名」拼路径（自定义/SAF 目录根本不在那儿）。
   * 显式传 null 表示「这个项目没有可用通道」→ prompt 里不出现工具段。
   */
  fileIo?: AiFileIo | null;
}

interface ChatItem extends AiMessage {
  /** 该条回复里抠出来的代码块（助手消息才有） */
  code?: string | null;
  /** 代码块的语言标记与能否替换画布（按回复当时的文件类型定格） */
  codeTag?: string;
  canReplace?: boolean;
  /** 该条是否还在流式生成中 */
  streaming?: boolean;
}

export default function AiPanel({ xml, docRel, selection, resources, onReplaceXml, onNote, projectName, fileIo }: Props) {
  const [cfg, setCfg] = useState<AiConfig>(() => {
    try {
      return loadAiConfig(window.localStorage.getItem(AI_LS_KEY));
    } catch {
      return loadAiConfig(null);
    }
  });
  const [showKey, setShowKey] = useState(false);
  const [cfgOpen, setCfgOpen] = useState(() => !cfg.apiKey);
  const [input, setInput] = useState("");
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [withXml, setWithXml] = useState(true);
  const [withSelection, setWithSelection] = useState(true);
  const [testing, setTesting] = useState(false);
  // 实际生效的通道：原生直连失败会自动回退 fetch，徐标跟着真实结果走
  const [useNative, setUseNative] = useState(() => nativeAiAvailable());
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  // 配置落盘
  useEffect(() => {
    try {
      window.localStorage.setItem(AI_LS_KEY, JSON.stringify(cfg));
    } catch {
      /* 配额/隐私模式：静默 */
    }
  }, [cfg]);

  const cfgProblem = useMemo(() => validateConfig(cfg), [cfg]);

  const scrollBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollBottom();
  }, [chat.length, scrollBottom]);

  const patch = (p: Partial<AiConfig>) => setCfg((c) => ({ ...c, ...p }));

  // 文件身份：决定上下文标题、代码块语言、输出契约、能否替换画布（M64a/A1）
  const doc = useMemo(() => aiDocContextOf(docRel, docRel ? "" : xml), [docRel, xml]);
  const actions = useMemo(() => quickActionsFor(doc), [doc]);

  const ctxSelection = withSelection ? selection ?? null : null;
  const ctxResources = resources ?? null;

  const send = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q || busy) return;
      const bad = validateConfig(cfg);
      if (bad) {
        setErr(bad);
        setCfgOpen(true);
        return;
      }
      setErr("");
      setBusy(true);
      setChat((c) => [...c, { role: "user", content: q }]);
      setInput("");
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // M64b：优先用项目自己的通道；只有调用方没传（undefined）时才回退到老的原生实现
      const io = fileIo !== undefined ? fileIo : createNativeIo(projectName || undefined);
      const sys = [
        buildAiSystemPrompt(doc),
        io ? `${AI_TOOL_PROMPT}\n项目根目录：${io.rootLabel()}（项目内的相对路径都从这里算）` : "",
      ]
        .filter(Boolean)
        .join("\n\n");

      const history: AiMessage[] = chat.map((m) => ({ role: m.role, content: m.content }));
      const preamble = withXml
        ? docPreamble(doc, xml, { selection: ctxSelection, resources: ctxResources, relPath: docRel })
        : "";
      const userContent = [preamble, q].filter(Boolean).join("\n\n");

      let msgs: AiMessage[] = [
        { role: "system", content: sys },
        ...history,
        { role: "user", content: userContent },
      ];

      const patchLast = (fn: (item: ChatItem) => ChatItem) =>
        setChat((c) => {
          if (!c.length) return c;
          const n = [...c];
          const last = n[n.length - 1];
          if (!last.streaming) return c;
          n[n.length - 1] = fn(last);
          return n;
        });

      try {
        for (let round = 0; ; round++) {
          // M64b（D3）：停止后不再开新轮，也不再发请求
          if (ctrl.signal.aborted) break;
          setChat((c) => [...c, { role: "assistant", content: "", streaming: true }]);
          let acc = "";
          const res = await streamChat(cfg, msgs, {
            signal: ctrl.signal,
            onChunk: (t) => {
              acc += t;
              patchLast((m) => ({ ...m, content: acc }));
            },
          });
          setUseNative(res.via === "native");

          // 用户点了「停止」：静默收尾，不要报「请求超时/中断」吓人
          if (ctrl.signal.aborted) {
            setChat((c) => c.filter((m) => !m.streaming));
            break;
          }

          if (!res.ok) {
            setChat((c) => c.filter((m) => !m.streaming));
            setErr(res.error || "调用失败");
            return;
          }

          const calls = io ? extractToolCalls(res.content) : [];
          const shown = stripToolBlocks(res.content);

          if (!calls.length || round >= MAX_TOOL_ROUNDS || !io) {
            patchLast((m) => ({
              ...m,
              content: shown,
              streaming: false,
              code: extractCodeBlock(shown),
              codeTag: doc.codeTag,
              canReplace: doc.canReplaceCanvas,
            }));
            break;
          }

          // 有工具调用：先把模型这轮的说明落下来，再执行工具
          patchLast((m) => ({ ...m, content: shown, streaming: false }));
          const results: string[] = [];
          for (const call of calls) {
            // 每步都看一次 abort：停止后不再调 bridge，也不再往下拼下一轮消息
            if (ctrl.signal.aborted) break;
            const label =
              call.tool === "write_file"
                ? `写入 ${call.path}`
                : call.tool === "read_file"
                  ? `读取 ${call.path}`
                  : call.tool === "list_files"
                    ? `列出 ${call.dir || "/"}`
                    : `搜索 ${call.query}`;
            setChat((c) => [...c, { role: "assistant", content: `⏳ ${label}…`, streaming: false }]);
            const out = await runTool(call, io);
            if (ctrl.signal.aborted) {
              // 工具已经跑完了但用户中途停了：把这条标记成已中断，不再请求下一轮
              setChat((c) => {
                const n = [...c];
                const last = n[n.length - 1];
                if (last && !last.streaming && last.content.startsWith("⏳")) {
                  n[n.length - 1] = { ...last, content: `⏹ 已停止：${label}` };
                }
                return n;
              });
              break;
            }
            results.push(out);
            setChat((c) => {
              const n = [...c];
              const last = n[n.length - 1];
              if (last && !last.streaming && last.content.startsWith("⏳")) {
                n[n.length - 1] = { ...last, content: `✅ ${label}` };
              }
              return n;
            });
          }
          if (ctrl.signal.aborted) break;
          msgs = [
            ...msgs,
            { role: "assistant", content: res.content },
            { role: "user", content: `工具结果：\n${results.join("\n\n")}` },
          ];
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, cfg, chat, ctxResources, ctxSelection, doc, docRel, fileIo, projectName, withXml, xml],
  );

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    onNote?.("已停止");
  };

  const testConn = useCallback(async () => {
    const bad = validateConfig(cfg);
    if (bad) {
      setErr(bad);
      return;
    }
    setTesting(true);
    setErr("");
    // 测试连接只求一句短回复，但思考型模型（如 glm-5.3-flash）会先话一段 reasoning，
    // token 给太少就只剩 reasoning、正文为空。所以不能用最小值 64，给 1024。
    const res = await streamChat(
      { ...cfg, maxTokens: 1024 },
      [{ role: "user", content: "只回复两个字：可用" }],
      // M33：首包可能慢（思考型模型先打 reasoning）+ 手机网络，30s 太紧
      { timeoutMs: 60_000 },
    );
    setTesting(false);
    if (res.ok) {
      setErr("");
      onNote?.("连接正常：" + res.content.trim().slice(0, 20));
      setChat((c) => [...c, { role: "assistant", content: `连接测试通过，模型回复：${res.content.trim().slice(0, 60)}` }]);
    } else {
      // 带上通道名，方便判断是网络/通道问题还是服务端慢
      const tail = res.channel ? `（通道 ${res.channel}）` : "";
      setErr((res.error || "连接失败") + tail);
    }
  }, [cfg, onNote]);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNote?.("已复制");
    } catch {
      onNote?.("复制失败，请手动选中");
    }
  };

  const providerHint = AI_PROVIDERS.find((p) => p.id === cfg.provider);

  return (
    <div className="axv-ai">
      {/* ===== 模型配置 ===== */}
      <div className="axv-ai-cfg">
        <button className="axv-ai-cfg-head" onClick={() => setCfgOpen((v) => !v)} aria-expanded={cfgOpen}>
          <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
            {cfg.apiKey ? "key" : "key_off"}
          </span>
          <span className="axv-ai-cfg-title">
            {cfg.model || "未配置模型"}
            {cfg.apiKey ? <span className="axv-ai-dot" title="已配置 Key" /> : null}
          </span>
          <span
            className="axv-ai-badge"
            title={
              useNative
                ? "走安卓原生 HTTP，没有跨域限制"
                : "浏览器直连，部分服务商会被跨域拦（原生通道失效时会自动回退到这里）"
            }
          >
            {useNative ? "原生直连" : "浏览器"}
          </span>
          <span className={"msr axv-ai-caret" + (cfgOpen ? " on" : "")} aria-hidden="true">
            expand_more
          </span>
        </button>

        {cfgOpen ? (
          <div className="axv-ai-cfg-body">
            <label className="axv-ai-field">
              <span>服务商</span>
              <select
                value={cfg.provider}
                onChange={(e) => setCfg((c) => applyProvider(c, e.target.value))}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="axv-ai-field">
              <span>接口地址</span>
              <input
                value={cfg.baseUrl}
                onChange={(e) => patch({ baseUrl: e.target.value })}
                onBlur={(e) => patch({ baseUrl: normalizeBaseUrl(e.target.value) })}
                placeholder="https://api.deepseek.com/v1"
                spellCheck={false}
              />
            </label>

            <label className="axv-ai-field">
              <span>模型</span>
              <input
                value={cfg.model}
                onChange={(e) => patch({ model: e.target.value })}
                placeholder="deepseek-chat"
                spellCheck={false}
              />
            </label>

            <label className="axv-ai-field">
              <span>API Key</span>
              <span className="axv-ai-key">
                <input
                  type={showKey ? "text" : "password"}
                  value={cfg.apiKey}
                  onChange={(e) => patch({ apiKey: e.target.value })}
                  placeholder={providerHint?.keyHint ?? "sk-…"}
                  spellCheck={false}
                  autoComplete="off"
                />
                <button className="axv-ai-mini" onClick={() => setShowKey((v) => !v)} title={showKey ? "隐藏" : "显示"}>
                  <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
                    {showKey ? "visibility_off" : "visibility"}
                  </span>
                </button>
              </span>
            </label>

            <label className="axv-ai-field">
              <span>温度</span>
              <input
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={cfg.temperature}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (!raw) return; // 清空时保留原值，避免存进 0/NaN 后再也校验不过
                  patch({ temperature: Number(raw) });
                }}
              />
            </label>
            <label className="axv-ai-field">
              <span>最大 token</span>
              <input
                type="number"
                min={64}
                max={32000}
                step={64}
                value={cfg.maxTokens}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  if (!raw) return; // 同上：空字符串会被 Number() 变成 0，低于下限
                  patch({ maxTokens: Number(raw) });
                }}
              />
            </label>

            <button className="axv-set-btn" disabled={testing || !!cfgProblem} onClick={() => void testConn()}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
                {testing ? "hourglass_top" : "network_check"}
              </span>
              {testing ? "测试中…" : "测试连接"}
            </button>
            <div className="axv-ai-hint">
              Key 只存在这台设备的浏览器里，不经过任何中转。网页版受浏览器跨域限制：DeepSeek / 通义 / 智谱 / Kimi 支持浏览器直连；腾讯 TokenHub 不响应 CORS 预检（OPTIONS 直接 405），需先跑本地代理 `npm run ai-proxy`，再把接口地址填成 `http://127.0.0.1:8787/v1`。思考型模型（如 glm-5.3-flash）会先把 token 花在 reasoning 上，「最大 token」建议 4096 以上，否则正文可能是空的。
            </div>
          </div>
        ) : null}
      </div>

      {/* ===== 对话区 ===== */}
      <div className="axv-ai-list" ref={listRef}>
        {chat.length === 0 ? (
          <div className="axv-ai-empty">
            <span className="msr" aria-hidden="true" style={{ fontSize: 30 }}>
              auto_awesome
            </span>
            <div>{doc.emptyHint}</div>
            <div className="axv-ai-hint">
              {doc.canReplaceCanvas
                ? "回复里的 XML 代码块可以一键替换回画布（走撤销栈，Ctrl+Z 能退）。"
                : "回复里的代码块可以复制；当前不是布局文件，不会往画布写。"}
            </div>
          </div>
        ) : null}

        {chat.map((m, i) => (
          <div key={i} className={"axv-ai-msg " + m.role}>
            <div className="axv-ai-bubble">
              {m.content.replace(/```[a-zA-Z0-9_-]*\s*\n[\s\S]*?```/g, "〔代码见下〕")}
              {m.streaming ? <span className="axv-ai-cursor">▍</span> : null}
            </div>
            {m.code ? (
              <div className="axv-ai-code">
                <div className="axv-ai-code-bar">
                  <span className="axv-ai-code-tag">
                    {m.codeTag ?? doc.codeTag} · {m.code.split("\n").length} 行
                  </span>
                  <button className="axv-ai-mini" title="复制" onClick={() => void copy(m.code!)}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>content_copy</span>
                  </button>
                  {m.canReplace ?? doc.canReplaceCanvas ? (
                    <button
                      className="axv-ai-mini"
                      title="替换画布（可撤销）"
                      onClick={() => {
                        onReplaceXml(m.code!);
                        onNote?.("已替换画布内容，可 Ctrl+Z 撤销");
                      }}
                    >
                      <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>input</span>
                    </button>
                  ) : null}
                </div>
                <pre className="axv-ai-pre">{m.code}</pre>
              </div>
            ) : null}
          </div>
        ))}

        {busy && !chat.some((m) => m.streaming) ? (
          <div className="axv-ai-msg assistant">
            <div className="axv-ai-bubble axv-ai-typing">正在生成…</div>
          </div>
        ) : null}
      </div>

      {err ? (
        <div className="axv-ai-err">
          <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>error</span>
          <span>{err}</span>
        </div>
      ) : null}

      {/* ===== 快捷指令 ===== */}
      <div className="axv-ai-chips">
        {actions.map((a) => (
          <button key={a.id} className="axv-ai-chip" disabled={busy} onClick={() => void send(a.prompt)} title={a.prompt}>
            {a.label}
          </button>
        ))}
      </div>

      {/* ===== 输入 ===== */}
      <div className="axv-ai-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="问点什么，例如：把标题字号放大到 24sp"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="axv-ai-input-bar">
          <label className="axv-ai-check" title={`把${doc.title}一起发给模型`}>
            <input type="checkbox" checked={withXml} onChange={(e) => setWithXml(e.target.checked)} />
            {doc.attachLabel}
          </label>
          {doc.kind === "layout" ? (
            <label className="axv-ai-check" title="把选中控件路径一起发给模型">
              <input type="checkbox" checked={withSelection} onChange={(e) => setWithSelection(e.target.checked)} />
              带选中
            </label>
          ) : null}
          <span className="axv-ai-keys">Ctrl+Enter</span>
          {busy ? (
            <button className="axv-set-btn axv-ai-send" onClick={stop}>
              停止
            </button>
          ) : (
            <button className="axv-set-btn axv-ai-send" disabled={!input.trim()} onClick={() => void send(input)}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>send</span>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
