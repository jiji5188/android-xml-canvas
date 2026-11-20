import React, { useState, useEffect, useRef } from "react";
import { runtimeLogText, type RuntimeLogEntry } from "@/lib/xml/runtime-log";

/**
 * M185：通用「底部抽屉 + tab 容器」(ROADMAP L0.5 第22条)
 * - 桌面：默认收起，展开高度 22% 视口；手机：半屏滑出
 * - 通用 tab 容器：Problems / 构建日志（先接 Problems，构建日志随后）
 * - 不挤占画布：absolute 定位在画布区底部，收起时只剩一条 28px 把手
 */

export type DrawerPanel = "problems" | "build-log" | "runtime";

/**
 * M445：从构建日志文本里解析「可定位的错误条目」。
 * native BuildApkHelper.fmtEcjLog 输出形如：
 *   ● MainActivity.java
 *       L42  The import com.foo.Bar cannot be resolved（×2）
 *   ● SecondActivity.java
 *       L7  未声明的变量: x
 * 解析出 { file, line, msg }。没有 L 前缀的旧格式 → line=0（仍可展示，不可跳转）。
 */
export function parseBuildLogLocs(log: string | undefined | null): Array<{ file: string; line: number; msg: string }> {
  if (!log) return [];
  const out: Array<{ file: string; line: number; msg: string }> = [];
  let curFile = "";
  for (const raw of log.split(/\n/)) {
    const l = raw.trim();
    if (!l) continue;
    // ● 文件头
    if (/^●\s+(.+)$/.test(l)) {
      curFile = l.replace(/^●\s+/, "").trim();
      continue;
    }
    // 缺依赖/缺类/缺资源提示段（非定位条目，跳过）——已 trim，不再带前导空格（i18n-ignore：解析模式非文案）
    if (/^缺依赖提示|^缺类提示|^缺资源提示|^ECJ 结果|^需手动|^放进 libs|^（内置|^- |^…|^（/.test(l)) continue; // i18n-ignore
    // L{line}  消息（可能带 （×N））
    const m = l.match(/^L(\d+)\s{1,4}(\S.*)$/);
    if (m && curFile) {
      let msg = m[2].replace(/\s*（×\d+）\s*$/, "");
      out.push({ file: curFile, line: parseInt(m[1], 10), msg });
      continue;
    }
    // 无 L 前缀的错误消息（旧格式 / warning）
    if (curFile && !/^- |^…|^（/.test(l)) {
      out.push({ file: curFile, line: 0, msg: l.replace(/\s*（×\d+）\s*$/, "") });
    }
  }
  // 只保留有定位价值的（错误条目），上限 40
  return out.slice(0, 40);
}

interface DrawerTabDef {
  key: DrawerPanel;
  label: string;
  icon: string;
}

const TABS: DrawerTabDef[] = [
  { key: "problems", label: "问题", icon: "warning_amber" }, // i18n-ignore
  { key: "build-log", label: "构建日志", icon: "terminal" }, // i18n-ignore
  { key: "runtime", label: "运行日志", icon: "bug_report" }, // i18n-ignore
];

/** M188b：一条构建日志（真机渲染等） */
export interface BuildLogEntry {
  id: string;
  ok: boolean;
  /** M297：info = 普通提示（绿色/红色都不合适），不显示「失败」 */
  level?: "ok" | "fail" | "info";
  stage?: string;
  ms?: number;
  log?: string;
  logFile?: string;
  files?: number;
  bytes?: number;
  /** M440：日志类型——build（默认，进「构建日志」tab）/ debug（Java 调试运行，进「运行日志」tab） */
  kind?: "build" | "debug";
}

export interface ProblemsDrawerProps {
  /** 问题列表（空 = 收起时把手不显示红点） */
  problems: { line: number; msg: string }[];
  /** 点击某条问题 → 跳代码行 */
  onGotoLine: (line: number) => void;
  /** M191：构建日志列表（新在前）；没有就不显示小点 */
  buildLogs?: BuildLogEntry[];
  /** M445：点击构建日志里的错误定位（文件:行）→ 打开该文件并跳到行。传了就渲染可点击定位列表 */
  onGotoFileLine?: (rel: string, line: number) => void;
  /** M288：被打出来的 App 通过广播发过来的运行日志 */
  runtimeLogs?: RuntimeLogEntry[];
  /** M288：清空运行日志 */
  onClearRuntimeLog?: () => void;
  /** M193：状态信息（文件名/未保存/问题数/设备/缩放）—— 合并进把手条，不再单独占一行 */
  statusSlot?: React.ReactNode;
  /** M193d：桌面侧栏展开时让出宽度（手机不传） */
  insetLeft?: number;
  insetRight?: number;
  tr: (key: string, fallback: string, vars?: Record<string, string | number>) => string;
  /** M252：外部强制查看（如打包完成后）—— 指定 open + tab，会临时把抽屉打开到对应 tab。
   *  传 `{ open: true, tab: "build-log" }` 时打开构建日志 tab；传 null 表示取消强制。
   *  用户手动切 tab/收起后，本 prop 的强制效果解除（不锁死）。 */
  forceView?: { open: boolean; tab: DrawerPanel } | null;
  /** M256：抽屉展开/收起时回调，父组件可用它调高度（手机端避免遮住代码区） */
  onOpenChange?: (open: boolean) => void;
  /** M438：父层检测到软键盘弹出时传 true → 抽屉自动收起（避免键盘把底部抽屉顶到屏中间挡代码）。
   *  检测在调用方（XmlEditor 顶层 useSoftKeyboard，M438b 一份监听同时服务抽屉 + 悬浮面板），
   *  组件自身不再挂监听。web 环境不传（false/undefined）→ 行为不变。 */
  hideOnKeyboard?: boolean;
}

export function ProblemsDrawer({ problems, onGotoLine, buildLogs, onGotoFileLine, runtimeLogs, onClearRuntimeLog, statusSlot, insetLeft, insetRight, tr, forceView, onOpenChange, hideOnKeyboard }: ProblemsDrawerProps) {
  const [open, setOpenRaw] = useState(false);
  // M256：包装 setter，同步通知父组件（手机端要调代码区高度避免被遮）
  const setOpen = (next: boolean | ((o: boolean) => boolean)) => {
    const v = typeof next === "function" ? next(open) : next;
    setOpenRaw(v);
    onOpenChange?.(v);
  };
  /* M438/M438b：父层检测到软键盘弹出（hideOnKeyboard=true）→ 自动收起抽屉。
   * 只收起、不自动展开 —— 键盘收起后用户手点把手重新打开，不被干扰。 */
  const setOpenKb = useRef(setOpen);
  setOpenKb.current = setOpen;
  const [wasHideKb, setWasHideKb] = useState(false);
  useEffect(() => {
    if (hideOnKeyboard) {
      setWasHideKb(true);
      setOpenKb.current(false);
    } else if (wasHideKb) {
      setWasHideKb(false); // 键盘已收，解除「被强制收起」记录，后续不受影响
    }
  }, [hideOnKeyboard]);
  const [tab, setTab] = useState<DrawerPanel>("problems");
  // M252：外部强制查看（打包完成后自动打开到对应 tab）。用一个 ref 记上一次的
  // forceView，变化时同步 open/tab；用户手动操作后会解除锁定。
  const lastForce = useRef<typeof forceView>(null);
  useEffect(() => {
    if (forceView && forceView !== lastForce.current) {
      if (forceView.open) {
        setOpen(true);
        setTab(forceView.tab);
      }
      lastForce.current = forceView;
    }
  }, [forceView]);

  const n = problems.length;
  const insetStyle =
    insetLeft === undefined && insetRight === undefined
      ? undefined
      : { marginLeft: insetLeft ?? 0, marginRight: insetRight ?? 0, transition: "margin 0.22s" };
  return (
    <div
      className={"axv-drawer" + (open ? " axv-drawer-open" : "")}
      style={insetStyle}
      role="region"
      aria-label={tr("drawer.title", "问题 / 日志抽屉")}
    >
      {/* 把手条（收起态的唯一常驻 UI） */}
      <div
        className="axv-drawer-bar"
        onClick={() => setOpen((o) => !o)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
      >
        <span className="msr axv-drawer-chevron" aria-hidden="true">
          {open ? "expand_less" : "expand_more"}
        </span>
        {statusSlot ? (
          <div className="axv-drawer-status" onClick={(e) => e.stopPropagation()}>
            {statusSlot}
          </div>
        ) : null}
        {buildLogs && buildLogs.some((l) => l.kind !== "debug") ? (
          <span className="axv-drawer-logdot" title={tr("drawer.log.has", "有构建日志")} />
        ) : null}
        {TABS.map((t) => (
          <button
            key={t.key}
            className={"axv-drawer-tab" + (tab === t.key ? " on" : "")}
            onClick={(e) => {
              e.stopPropagation();
              setTab(t.key);
              setOpen(true);
            }}
            role="tab"
            aria-selected={tab === t.key}
          >
            <span className="msr" aria-hidden="true">
              {t.icon}
            </span>
            {tr("drawer.tab." + t.key, t.label)}
            {t.key === "problems" && n > 0 ? <span className="axv-drawer-badge">{n}</span> : null}
            {t.key === "build-log" && buildLogs && buildLogs.some((l) => l.kind !== "debug") ? (
              <span className="axv-drawer-badge axv-drawer-badge-log" aria-hidden="true" />
            ) : null}
            {t.key === "runtime" &&
            ((runtimeLogs && runtimeLogs.length > 0) ||
              (buildLogs && buildLogs.some((l) => l.kind === "debug"))) ? (
              <span className="axv-drawer-badge">
                {
                  (
                    (runtimeLogs?.length || 0) +
                    buildLogs!.filter((l) => l.kind === "debug").length
                  ) >
                  99
                    ? "99+"
                    : (runtimeLogs?.length || 0) +
                      buildLogs!.filter((l) => l.kind === "debug").length
                }
              </span>
            ) : null}
          </button>
        ))}
      </div>
      {open ? (
        <div className="axv-drawer-body">
          {tab === "runtime" ? (
            /* M288：运行日志（生成的 APK 广播过来的生命周期/崩溃/自定义日志）
               M440：Java 调试运行日志（buildLogs 里 kind==='debug'）也并进这个 tab 显示——
               它们本质都是「Java 代码在设备上执行」的输出，放同一个面板 */
            (() => {
              const debugLogs = (buildLogs || []).filter((l) => l.kind === "debug");
              const hasContent = (runtimeLogs && runtimeLogs.length > 0) || debugLogs.length > 0;
              if (!hasContent) {
                return (
                  <div className="axv-drawer-empty">
                    {tr("drawer.runtime.empty", "还没有收到运行日志：在手机上运行你打包出来的 App，日志会自动出现在这里（同一个 App 内发送，无需连接电脑）。")}
                  </div>
                );
              }
              return (
                <div className="axv-drawer-logwrap">
                  {debugLogs.length > 0 ? (
                    <div>
                      <details
                        className={
                          "axv-drawer-logcard" +
                          (debugLogs[0].ok ? "" : " axv-drawer-logcard-err") +
                          " axv-drawer-logcard-latest"
                        }
                        open={!(runtimeLogs && runtimeLogs.length > 0)}
                      >
                        <summary>
                          <span className="axv-drawer-logdot" aria-hidden="true" />
                          {debugLogs[0].stage || tr("drawer.log.debug", "Java 调试运行")}
                          {typeof debugLogs[0].ms === "number" ? " · " + debugLogs[0].ms + "ms" : ""}
                          {debugLogs[0].ok ? "" : " · " + tr("drawer.log.fail", "失败")}
                          <button
                            type="button"
                            className="axv-drawer-logcopy"
                            title={tr("drawer.log.copy", "复制构建日志")}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const txt = debugLogs[0].log || "";
                              void (async () => {
                                try {
                                  await navigator.clipboard.writeText(txt);
                                } catch {
                                  const ta = document.createElement("textarea");
                                  ta.value = txt;
                                  ta.style.position = "fixed";
                                  ta.style.opacity = "0";
                                  document.body.appendChild(ta);
                                  ta.select();
                                  document.execCommand("copy");
                                  ta.remove();
                                }
                              })();
                              const btn = e.currentTarget as HTMLElement;
                              btn.classList.add("axv-drawer-logcopy-ok");
                              btn.textContent = tr("drawer.log.copied", "已复制");
                              window.setTimeout(() => {
                                btn.classList.remove("axv-drawer-logcopy-ok");
                                btn.textContent = tr("drawer.log.copy", "复制");
                              }, 1600);
                            }}
                          >
                            {tr("drawer.log.copy", "复制")}
                          </button>
                        </summary>
                        <pre className="axv-drawer-log">{debugLogs[0].log || tr("drawer.log.none", "本次没有输出日志")}</pre>
                      </details>
                    </div>
                  ) : null}
                  {runtimeLogs && runtimeLogs.length > 0 ? (
                    <div className="axv-drawer-logbar">
                      <span className="axv-drawer-line">
                        {tr("drawer.runtime.count", "{n} 条", { n: runtimeLogs.length })}
                      </span>
                      <button
                        type="button"
                        className="axv-drawer-logcopy"
                        onClick={() => {
                          const txt = runtimeLogText(runtimeLogs);
                          void (async () => {
                            try {
                              await navigator.clipboard.writeText(txt);
                            } catch {
                              const ta = document.createElement("textarea");
                              ta.value = txt;
                              ta.style.position = "fixed";
                              ta.style.opacity = "0";
                              document.body.appendChild(ta);
                              ta.select();
                              document.execCommand("copy");
                              ta.remove();
                            }
                          })();
                        }}
                      >
                        {tr("drawer.log.copy", "复制")}
                      </button>
                      <button type="button" className="axv-drawer-logcopy" onClick={() => onClearRuntimeLog?.()}>
                        {tr("drawer.runtime.clear", "清空")}
                      </button>
                    </div>
                  ) : null}
                  {runtimeLogs && runtimeLogs.length > 0 ? (
                    <pre className="axv-drawer-log">{runtimeLogText(runtimeLogs)}</pre>
                  ) : null}
                </div>
              );
            })()
          ) : tab === "problems" ? (
            n === 0 ? (
              <div className="axv-drawer-empty">{tr("drawer.none", "当前没有检测到问题")}</div>
            ) : (
              <ul className="axv-drawer-list" role="list">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button
                      className="axv-drawer-item"
                      onClick={() => {
                        onGotoLine(p.line);
                        // M187：跳行后收起抽屉，别让 22vh 的抽屉挡住要看的行
                        setOpen(false);
                      }}
                    >
                      <span className="axv-drawer-line">L{p.line}</span>
                      <span className="axv-drawer-msg">{p.msg}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            /* M188b：构建日志；M260：最新一条默认展开（编译/打包输出点开抽屉就能直接看到），旧条目折叠
               M440：buildLogs 按 kind 分片——「构建日志」tab 只列 kind!=='debug'（APK 打包/渲染/资源），
               调试运行日志（kind==='debug'）进「运行日志」tab（跟被打出的 App 的运行日志放一起，它们本来就是一个东西） */
            buildLogs && buildLogs.length > 0 ? (
              <div className="axv-drawer-logwrap">
                {buildLogs.filter((l) => l.kind !== "debug").slice(0, 20).map((l, i) => (
                  <details
                    key={l.id}
                    open={i === 0}
                    className={
                      "axv-drawer-logcard" +
                      (l.ok ? "" : l.level === "info" ? " axv-drawer-logcard-info" : " axv-drawer-logcard-err") +
                      (i === 0 ? " axv-drawer-logcard-latest" : "")
                    }
                  >
                    <summary>
                      <span className="axv-drawer-logdot" aria-hidden="true" />
                      {l.stage || tr("drawer.log.render", "真机渲染")}
                      {typeof l.ms === "number" ? " · " + l.ms + "ms" : ""}
                      {l.ok || l.level === "info" ? "" : " · " + tr("drawer.log.fail", "失败")}
                      <button
                        type="button"
                        className="axv-drawer-logcopy"
                        title={tr("drawer.log.copy", "复制构建日志")}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const txt = l.log || l.logFile || "";
                          void (async () => {
                            try {
                              await navigator.clipboard.writeText(txt);
                            } catch {
                              // 旧 WebView 没有 clipboard API，退化成 textarea 复制
                              const ta = document.createElement("textarea");
                              ta.value = txt;
                              ta.style.position = "fixed";
                              ta.style.opacity = "0";
                              document.body.appendChild(ta);
                              ta.select();
                              document.execCommand("copy");
                              ta.remove();
                            }
                          })();
                          const btn = e.currentTarget as HTMLElement;
                          btn.classList.add("axv-drawer-logcopy-ok");
                          btn.textContent = tr("drawer.log.copied", "已复制");
                          window.setTimeout(() => {
                            btn.classList.remove("axv-drawer-logcopy-ok");
                            btn.textContent = tr("drawer.log.copy", "复制");
                          }, 1600);
                        }}
                      >
                        {tr("drawer.log.copy", "复制")}
                      </button>
                    </summary>
                    {onGotoFileLine ? (() => {
                      const locs = parseBuildLogLocs(l.log);
                      return locs.length > 0 ? (
                        <ul className="axv-drawer-locwrap" aria-label={tr("drawer.log.locs", "错误定位")}>
                          {locs.map((it, k) => (
                            <li key={k}>
                              <button
                                type="button"
                                className="axv-drawer-locrow"
                                onClick={() => onGotoFileLine(it.file, it.line)}
                                title={it.line > 0 ? tr("drawer.log.locrow.hint", "点击打开文件并跳到该行") : ""}
                              >
                                <span className="axv-drawer-locfile">{it.file}</span>
                                <span className="axv-drawer-locline">{it.line > 0 ? "L" + it.line : ""}</span>
                                <span className="axv-drawer-locmsg">{it.msg}</span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null;
                    })() : null}
                    <pre className="axv-drawer-log">{l.log || l.logFile || tr("drawer.log.none", "本次没有输出日志")}</pre>
                  </details>
                ))}
              </div>
            ) : (
              <div className="axv-drawer-empty">{tr("drawer.log.empty", "暂无构建日志。")}</div>
            )
          )}
        </div>
      ) : null}
    </div>
  );
}
