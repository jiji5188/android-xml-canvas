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
import { AI_TOOL_PROMPT, createNativeIo, parseToolReply, runTool, stripToolBlocks, type AiFileIo } from "@/lib/xml/ai-tools";
import { createStagingIo, flushStaged, type StagedChange } from "@/lib/xml/ai-staging";
import { compactHunks, diffLines, diffSummary } from "@/lib/xml/ai-diff";
import { aiDocContextOf, buildAiSystemPrompt, docPreamble, quickActionsFor, type AiPromptIntent } from "@/lib/xml/ai-doc-context";
import { aiAllowProtectedGet, aiAllowProtectedSet } from "@/lib/xml/ai-paths";
import { formatToolMemory, memoryEntryFromTool, pushToolMemory, type ToolMemoryEntry } from "@/lib/xml/ai-tool-memory";
import { batchLabel, makeBatch, pushBatch, restoreBatch, type AiHistoryBatch } from "@/lib/xml/ai-history";
import { collectProjectFacts, formatProjectFacts, type ProjectFacts } from "@/lib/xml/ai-facts";

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
  /** M64e（B3）：AI 改动落盘后按文件回调（编辑器刷新当前文档 + 进撤销栈） */
  onApplied?: (p: { rel: string; text: string }) => void;
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

export default function AiPanel({ xml, docRel, selection, resources, onReplaceXml, onNote, projectName, fileIo, onApplied }: Props) {
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
  // M64c（C5）：默认不允许改构建/清单（localStorage 持久化）
  const [allowProtected, setAllowProtected] = useState(() => aiAllowProtectedGet());
  // 实际生效的通道：原生直连失败会自动回退 fetch，徐标跟着真实结果走
  const [useNative, setUseNative] = useState(() => nativeAiAvailable());
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  // M64e（B3）：AI 写操作先暂存，用户点「应用」才落盘
  const [staged, setStaged] = useState<StagedChange[]>([]);
  const [diffOpen, setDiffOpen] = useState<Record<string, boolean>>({});
  const [applying, setApplying] = useState(false);
  // M64g（D4）：最近 20 批 AI 写入，支持整批回滚
  const [history, setHistory] = useState<AiHistoryBatch[]>([]);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const stageHost = useRef<{ base: AiFileIo; host: ReturnType<typeof createStagingIo> } | null>(null);
  /** M64i（A6）：项目事实缓存（按根目录 + 当前文件所在 res 缓存，避免每轮重扫） */
  const factsCache = useRef<{ key: string; facts: ProjectFacts } | null>(null);
  const [factsInfo, setFactsInfo] = useState<ProjectFacts | null>(null);
  /** M64k（A7）：会话内「读过什么」的摘要记忆（换文件就清空，否则旧文件内容会串到新文档里） */
  const toolMemRef = useRef<ToolMemoryEntry[]>([]);

  useEffect(() => {
    toolMemRef.current = [];
  }, [docRel, projectName]);

  const factsFor = useCallback(async (io: AiFileIo | null, rel?: string | null) => {
    if (!io) return null;
    const key = `${io.rootLabel()}|${rel || ""}`;
    if (factsCache.current?.key === key) {
      setFactsInfo(factsCache.current.facts);
      return factsCache.current.facts;
    }
    const facts = await collectProjectFacts(io, rel);
    factsCache.current = { key, facts };
    setFactsInfo(facts);
    return facts;
  }, []);

  const stageFor = useCallback((base: AiFileIo) => {
    if (!stageHost.current || stageHost.current.base !== base) {
      stageHost.current = { base, host: createStagingIo(base, (cs) => setStaged(cs)) };
    }
    return stageHost.current;
  }, []);

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
    async (text: string, intentOrFull: AiPromptIntent | boolean = "auto") => {
      // 兼容老调用：第二个参数传 boolean 时按 xml / auto 处理
      const intent: AiPromptIntent = typeof intentOrFull === "boolean" ? (intentOrFull ? "xml" : "auto") : intentOrFull;
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
      // M64e（B3）：有写能力的通道包一层暂存，写不直接落盘
      const stage = io ? stageFor(io).host : null;
      // M64i（A6）：先把「项目里真实有什么」扫出来（同一个项目缓存一份，不每轮重扫）
      const facts = await factsFor(io, docRel);
      const mem = formatToolMemory(toolMemRef.current);
      const sys = [
        buildAiSystemPrompt(doc, { intent, canWrite: io ? io.canWrite !== false : false }),
        facts ? formatProjectFacts(facts) : "",
        mem,
        io
          ? `${AI_TOOL_PROMPT}\n项目根目录：${io.rootLabel()}（项目内的相对路径都从这里算）` +
            (io.canWrite === false
              ? "\n注意：当前项目没拿到写权限，只能 list_files / read_file / search_files，不要尝试写。"
              : "")
          : "",
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
      /** M64h（A4）：一次回复里只给一次修格式的机会 */
      let repaired = false;

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

          const parsed = io ? parseToolReply(res.content) : { calls: [], errors: [], blocks: 0 };
          const calls = parsed.calls;
          const shown = stripToolBlocks(res.content);

          // M64h（A4）：工具块格式坏了 → 重问一次（把错误原文喂回去），二次失败就降级成普通回答
          if (parsed.errors.length && !repaired) {
            repaired = true;
            setChat((c) => [...c, { role: "assistant", content: `⚠️ 工具调用格式无效（本轮未执行）：${parsed.errors[0]}` }]);
            msgs = [
              ...msgs,
              { role: "assistant", content: res.content },
              {
                role: "user",
                content: `上一条回复里的工具调用不能执行，原因：\n- ${parsed.errors.join("\n- ")}\n\n请重新只输出一行 JSON，格式必须是：{"tool":"工具名","args":{...}}；不要解释、不要注释、不要换行、不要中文引号。如果确实不需要工具，就直接回答我。`,
              },
            ];
            continue;
          }

          if (!calls.length || round >= MAX_TOOL_ROUNDS || !io) {
            const tail = parsed.errors.length ? `\n\n（工具调用格式无效，本轮未改动文件：${parsed.errors[0]}）` : "";
            patchLast((m) => ({
              ...m,
              content: shown + tail,
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
                : call.tool === "apply_patch"
                  ? `修改 ${call.path}`
                  : call.tool === "read_file"
                    ? `读取 ${call.path}`
                    : call.tool === "list_files"
                      ? `列出 ${call.dir || "/"}`
                      : `搜索 ${call.query}`;
            setChat((c) => [...c, { role: "assistant", content: `⏳ ${label}…`, streaming: false }]);
            const out = await runTool(call, stage ?? (io as AiFileIo));
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
            // M64k（A7）：记下来，下一句追问时不必重读
            const target =
              call.tool === "search_files"
                ? call.query || ""
                : call.tool === "list_files"
                  ? call.dir || "/"
                  : call.path || "";
            toolMemRef.current = pushToolMemory(toolMemRef.current, memoryEntryFromTool(call.tool, target, out));
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
    [busy, cfg, chat, ctxResources, ctxSelection, doc, docRel, factsFor, fileIo, projectName, withXml, xml],
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

  // M64e（B3）：放弃暂存 → 什么都不写
  const discardStaged = useCallback(() => {
    stageHost.current?.host.clear();
    setStaged([]);
    setDiffOpen({});
    onNote?.("已放弃 AI 改动");
  }, [onNote]);

  // M64e（B3）：应用暂存 → 先备份原文再落盘；成功的文件回调给编辑器刷新/进撤销栈
  const applyStaged = useCallback(async () => {
    const host = stageHost.current;
    if (!host || !staged.length || applying) return;
    setApplying(true);
    setErr("");
    try {
      const r = await flushStaged(host.base, staged);
      let okCount = 0;
      for (const it of r.results) {
        if (!it.ok) continue;
        okCount++;
        const ch = staged.find((s) => s.rel === it.rel);
        if (ch) onApplied?.({ rel: it.rel, text: ch.after });
      }
      const bad = r.results.filter((x) => !x.ok);
      if (bad.length) {
        setErr(`有 ${bad.length} 个文件没写成：${bad[0].rel} — ${bad[0].error || "未知原因"}`);
        setStaged((cur) => cur.filter((c) => bad.some((b) => b.rel === c.rel)));
      } else {
        host.host.clear();
        setStaged([]);
        setDiffOpen({});
      }
      if (okCount) {
        const hasBackup = r.results.some((x) => x.backup);
        onNote?.(`已落盘 ${okCount} 个文件${hasBackup ? "（原文件备份在 .axv_backup/）" : ""}`);
        setHistory((list) =>
          pushBatch(
            list,
            makeBatch(
              r.results
                .filter((x) => x.ok)
                .map((x) => ({ rel: x.rel, before: staged.find((s) => s.rel === x.rel)?.before ?? null })),
            ),
          ),
        );
      }
    } finally {
      setApplying(false);
    }
  }, [applying, onApplied, onNote, staged]);

  const providerHint = AI_PROVIDERS.find((p) => p.id === cfg.provider);

  // M64g（D4）：回滚一整批（回写 after → before）；成功则从历史里移除
  const rollback = useCallback(
    async (b: AiHistoryBatch) => {
      const io = fileIo;
      if (!io || rollingBack) return;
      setRollingBack(b.id);
      setErr("");
      try {
        const r = await restoreBatch(io, b);
        const bad = r.results.filter((x) => !x.ok);
        for (const it of r.results) {
          if (it.ok) onApplied?.({ rel: it.rel, text: b.items.find((x) => x.rel === it.rel)?.before ?? "" });
        }
        if (bad.length) {
          setErr(`回滚失败 ${bad.length} 个：${bad[0].rel} — ${bad[0].error || "未知原因"}`);
        } else {
          setHistory((list) => list.filter((x) => x.id !== b.id));
          const blanked = r.results.filter((x) => x.blanked).length;
          onNote?.(
            `已回滚 ${r.results.length} 个文件${blanked ? `（${blanked} 个为 AI 新建，已清空内容）` : ""}`,
          );
        }
      } finally {
        setRollingBack(null);
      }
    },
    [fileIo, onApplied, onNote, rollingBack],
  );

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
          {fileIo ? (
            <span
              className="axv-ai-badge axv-ai-cap"
              title={
                (fileIo.canWrite
                  ? "AI 可以读也可以改这个项目的文件"
                  : "AI 只能读这个项目的文件（没拿到写权限）") + "\n根：" + fileIo.rootLabel()
              }
            >
              {fileIo.canWrite ? "读写" : "只读"}
            </span>
          ) : null}
          {factsInfo ? (
            <span
              className="axv-ai-badge axv-ai-facts"
              title={
                `已扫描项目事实：drawable ${factsInfo.drawables.length} / color ${factsInfo.colors.length} / string ${factsInfo.strings.length}` +
                (factsInfo.truncated ? "（达扫描上限，可能不全）" : "") +
                (factsInfo.lib !== "unknown" ? `\n依赖库：${factsInfo.lib}` : "")
              }
            >
              事实 {factsInfo.drawables.length + factsInfo.colors.length + factsInfo.strings.length}
            </span>
          ) : null}
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

            <label className="axv-ai-check" title="默认关闭：AI 不能改 build.gradle / AndroidManifest.xml / build/ / .git/ 等">
              <input
                type="checkbox"
                checked={allowProtected}
                onChange={(e) => {
                  setAllowProtected(e.target.checked);
                  aiAllowProtectedSet(e.target.checked);
                }}
              />
              允许改构建/清单文件
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
          <button
            key={a.id}
            className="axv-ai-chip"
            disabled={busy}
            onClick={() => void send(a.prompt, a.intent ?? (a.wantsXml ? "xml" : "auto"))}
            title={a.prompt}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* ===== M64e（B3）：AI 改动待确认 ===== */}
      {staged.length ? (
        <div className="axv-ai-diffcard">
          <div className="axv-ai-diffcard-head">
            <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>difference</span>
            <b>待应用的改动</b>
            <span className="axv-ai-diffcard-sub">{staged.length} 个文件</span>
            <span className="axv-ai-spacer" />
            <button className="axv-btn axv-ghost" disabled={applying} onClick={discardStaged}>
              放弃
            </button>
            <button className="axv-btn" disabled={applying} onClick={() => void applyStaged()}>
              {applying ? "写入中…" : "全部应用"}
            </button>
          </div>
          {staged.map((c) => {
            const d = diffLines(c.before ?? "", c.after);
            const open = !!diffOpen[c.rel];
            return (
              <div className="axv-ai-diffcard-file" key={c.rel}>
                <button className="axv-ai-diffcard-row" onClick={() => setDiffOpen((m) => ({ ...m, [c.rel]: !m[c.rel] }))}>
                  <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>{open ? "expand_less" : "expand_more"}</span>
                  <span className="axv-ai-diffcard-name">
                    {c.rel}
                    {c.before === null ? <em>（新建）</em> : null}
                  </span>
                  <span className="axv-ai-diffcard-stat">
                    <span className="add">+{d.added}</span>
                    <span className="del">-{d.removed}</span>
                  </span>
                </button>
                {open ? (
                  <pre className="axv-ai-diff">
                    {compactHunks(d.lines, 2)
                      .slice(0, 200)
                      .map((l, i) => (
                        <div key={i} className={`axv-ai-diff-line op-${l.op === " " ? "ctx" : l.op === "+" ? "add" : "del"}`}>
                          <span className="axv-ai-diff-op">{l.op}</span>
                          {l.text}
                        </div>
                      ))}
                    {d.truncated ? <div className="axv-ai-diff-line op-ctx">… 文件较大，仅预览前 200 行</div> : null}
                  </pre>
                ) : null}
              </div>
            );
          })}
          <div className="axv-ai-diffcard-foot">应用前会把原文件备份到 .axv_backup/</div>
        </div>
      ) : null}

      {/* ===== M64g（D4）：AI 改动历史（整批回滚） ===== */}
      {history.length ? (
        <div className="axv-ai-hist">
          <div className="axv-ai-hist-head">
            <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
              history
            </span>
            <b>AI 改动历史</b>
            <span className="axv-ai-diffcard-sub">{history.length} 批（内存，最多 20）</span>
          </div>
          {history.map((b) => (
            <div className="axv-ai-hist-row" key={b.id}>
              <span className="axv-ai-hist-name" title={b.items.map((x) => x.rel).join("\n")}>
                {batchLabel(b)}
              </span>
              <button
                className="axv-btn axv-ghost"
                disabled={rollingBack === b.id}
                onClick={() => void rollback(b)}
                title="把这些文件写回 AI 修改前的内容"
              >
                {rollingBack === b.id ? "回滚中…" : "回滚"}
              </button>
            </div>
          ))}
        </div>
      ) : null}

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
