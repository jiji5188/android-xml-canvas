"use client";

// components/AiPanel.tsx — M17：左栏「AI 助手」面板
// 现在只做两件事：① 配好模型并连通；② 拿当前 XML 问问题、把回复里的代码块替换回画布。
// 「AI 写代码」的后续能力（局部改写 / diff 预览 / 多轮记忆）都从这个壳里长出来。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AI_LS_KEY,
  AI_PROVIDERS,
  AI_QUICK_ACTIONS,
  AI_SYSTEM_PROMPT,
  applyProvider,
  callAi,
  extractCodeBlock,
  loadAiConfig,
  normalizeBaseUrl,
  validateConfig,
  type AiConfig,
  type AiMessage,
} from "@/lib/xml/ai";

interface Props {
  /** 当前布局 XML（发送时作为上下文） */
  xml: string;
  /** 选中节点路径文字，如 LinearLayout > Button#ok */
  selection?: string | null;
  /** 可用资源摘要（可选） */
  resources?: string | null;
  /** 把整段 XML 写回画布（走撤销栈） */
  onReplaceXml: (xml: string) => void;
  /** 提示条（复用编辑器的 toast） */
  onNote?: (text: string) => void;
}

interface ChatItem extends AiMessage {
  /** 该条回复里抠出来的代码块（助手消息才有） */
  code?: string | null;
}

export default function AiPanel({ xml, selection, resources, onReplaceXml, onNote }: Props) {
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
      const mine: ChatItem = { role: "user", content: q };
      setChat((c) => [...c, mine]);
      setInput("");
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const history: AiMessage[] = chat.map((m) => ({ role: m.role, content: m.content }));
      const preamble = withXml && xml.trim() ? `当前布局 XML：\n\`\`\`xml\n${xml.trim()}\n\`\`\`` : "";
      const selLine = ctxSelection ? `当前选中控件路径：${ctxSelection}` : "";
      const resLine = ctxResources ? `可用资源：${ctxResources}` : "";
      const userContent = [selLine, resLine, preamble, q].filter(Boolean).join("\n\n");

      const res = await callAi(cfg, [
        { role: "system", content: AI_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: userContent },
      ], { signal: ctrl.signal });

      abortRef.current = null;
      setBusy(false);
      if (!res.ok) {
        setErr(res.error || "调用失败");
        return;
      }
      const code = extractCodeBlock(res.content);
      setChat((c) => [...c, { role: "assistant", content: res.content, code }]);
    },
    [busy, cfg, chat, ctxResources, ctxSelection, withXml, xml],
  );

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  };

  const testConn = useCallback(async () => {
    const bad = validateConfig(cfg);
    if (bad) {
      setErr(bad);
      return;
    }
    setTesting(true);
    setErr("");
    const res = await callAi(
      { ...cfg, maxTokens: 32 },
      [{ role: "user", content: "只回复两个字：可用" }],
      { timeoutMs: 30_000 },
    );
    setTesting(false);
    if (res.ok) {
      setErr("");
      onNote?.("连接正常：" + res.content.trim().slice(0, 20));
      setChat((c) => [...c, { role: "assistant", content: `连接测试通过，模型回复：${res.content.trim().slice(0, 60)}` }]);
    } else {
      setErr(res.error || "连接失败");
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

            <div className="axv-ai-row2">
              <label className="axv-ai-field">
                <span>温度</span>
                <input
                  type="number"
                  min={0}
                  max={2}
                  step={0.1}
                  value={cfg.temperature}
                  onChange={(e) => patch({ temperature: Number(e.target.value) })}
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
                  onChange={(e) => patch({ maxTokens: Number(e.target.value) })}
                />
              </label>
            </div>

            <button className="axv-set-btn" disabled={testing || !!cfgProblem} onClick={() => void testConn()}>
              <span className="msr" aria-hidden="true" style={{ fontSize: 18 }}>
                {testing ? "hourglass_top" : "network_check"}
              </span>
              {testing ? "测试中…" : "测试连接"}
            </button>
            <div className="axv-ai-hint">
              Key 只存在这台设备的浏览器里，不经过任何中转。网页版受浏览器跨域限制：DeepSeek / 通义 / 智谱 / Kimi 一般可直连，OpenAI 官方接口可能被拦。
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
            <div>让 AI 看懂当前布局：解释结构、改成 ConstraintLayout、修 lint 告警、加控件。</div>
            <div className="axv-ai-hint">回复里的 XML 代码块可以一键替换回画布（走撤销栈，Ctrl+Z 能退）。</div>
          </div>
        ) : null}

        {chat.map((m, i) => (
          <div key={i} className={"axv-ai-msg " + m.role}>
            <div className="axv-ai-bubble">{m.content.replace(/```[a-zA-Z0-9_-]*\s*\n[\s\S]*?```/g, "〔代码见下〕")}</div>
            {m.code ? (
              <div className="axv-ai-code">
                <div className="axv-ai-code-bar">
                  <span className="axv-ai-code-tag">XML · {m.code.split("\n").length} 行</span>
                  <button className="axv-ai-mini" title="复制" onClick={() => void copy(m.code!)}>
                    <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>content_copy</span>
                  </button>
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
                </div>
                <pre className="axv-ai-pre">{m.code}</pre>
              </div>
            ) : null}
          </div>
        ))}

        {busy ? (
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
        {AI_QUICK_ACTIONS.map((a) => (
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
          <label className="axv-ai-check" title="把当前布局 XML 一起发给模型">
            <input type="checkbox" checked={withXml} onChange={(e) => setWithXml(e.target.checked)} />
            带布局
          </label>
          <label className="axv-ai-check" title="把选中控件路径一起发给模型">
            <input type="checkbox" checked={withSelection} onChange={(e) => setWithSelection(e.target.checked)} />
            带选中
          </label>
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
