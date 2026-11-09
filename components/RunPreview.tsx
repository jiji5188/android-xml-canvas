"use client";

// components/RunPreview.tsx — M4a 运行调试（Think M3E Preview，适配 XML 布局）
// 全屏手机外壳 + 交互点击 + 布局跳转 + 返回栈 + logcat 风格事件日志。
//
// 跳转约定（写进布局 XML 即可）：
//   android:onClick="openSettings"   → 找 res/layout/settings.xml（也认 activity_settings / settings.xml）
//   android:onClick="finish" / "back" / "close" → 返回上一页
//   android:onClick="toast:hello"    → 只打日志，不跳转
// 找不到目标布局时在日志里报 W 级并列出可用布局。

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { parseLayoutXml, findNode } from "@/lib/xml/parser";
import { buildRenderModel } from "@/lib/xml/css";
import { readableOn } from "@/lib/xml/theme";
import { DEFAULT_RENDER_THEME, type RenderTheme } from "@/lib/xml/theme";
import type { ResourceTable } from "@/lib/xml/types";
import { XmlCanvas } from "./XmlCanvas";
import { decorateRunScreen } from "./run-decorate";
import { eventText, idToPath, runRoleOf, targetLabel } from "@/lib/xml/run-sim";
import {
  applyEffects,
  createSimState,
  parseJavaSim,
  pickJavaSim,
  type SimEffect,
  type SimModel,
  type SimReceiver,
  type SimState,
} from "@/lib/xml/java-sim";

const SCALE = 2; // 1dp = 2px（与编辑器一致）

/** 画布在运行态只渲染一次：包一层 memo，日志/Toast 引起的重渲染不会重写 DOM，
 *  否则用户刚输入的文字会被 React 的旧文本节点覆盖回去。 */
const StaticCanvas = memo(XmlCanvas);

export interface RunDevice {
  label: string;
  w: number;
  h: number;
  radius?: number;
}

interface Props {
  /** 首页 XML（当前编辑器内容，含未保存改动） */
  entryXml: string;
  /** 首页名字，仅用于日志 */
  entryName: string;
  /** 其它可跳转的布局：名字（不含 .xml） → XML 全文 */
  layouts: Record<string, string>;
  resources: ResourceTable;
  device: RunDevice;
  onClose: () => void;
  /** M199：项目里的 Java/Kotlin 源码（可选）。给了就跑「轻量逻辑仿真」 */
  javaFiles?: { rel: string; text: string }[];
}

type LogLevel = "I" | "W" | "E" | "D";
interface LogLine {
  id: number;
  t: string;
  level: LogLevel;
  msg: string;
}

interface Screen {
  name: string;
  xml: string;
}

const BACK_WORDS = new Set(["finish", "back", "close", "closeActivity", "onBackPressed"]);

function now(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 归一化布局名：去目录、去 .xml、小写 */
function normName(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^.*\//, "")
    .replace(/\.xml$/i, "")
    .toLowerCase();
}

export function RunPreview({ entryXml, entryName, layouts, resources, device, onClose, javaFiles }: Props) {
  const [rotated, setRotated] = useState(false);
  const [stack, setStack] = useState<Screen[]>([{ name: entryName, xml: entryXml }]);
  const [dir, setDir] = useState<"fwd" | "back">("fwd");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [showLog, setShowLog] = useState(true);
  const [fit, setFit] = useState(1);
  const logRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const seq = useRef(0);
  /** Android 风格 Toast：{ id, text } */
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  /** 本屏可交互控件数（装饰层统计） */
  const [interactive, setInteractive] = useState(0);
  const toastTimer = useRef<number | null>(null);
  /** 启动日志只打一次（React 严格模式下 effect 会跑两遍） */
  const bootedRef = useRef(false);

  const dev = rotated ? { ...device, w: device.h, h: device.w } : device;
  const cur = stack[stack.length - 1];

  const log = useCallback((level: LogLevel, msg: string) => {
    const line: LogLine = { id: ++seq.current, t: now(), level, msg };
    setLogs((ls) => [...ls.slice(-299), line]);
  }, []);

  const showToast = useCallback((text: string) => {
    if (!text) return;
    setToast({ id: Date.now(), text });
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  // 启动日志
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    log("I", tt("启动 {name}.xml · {w}×{h}dp · 可跳转布局 {n} 个", { name: entryName, w: dev.w, h: dev.h, n: Object.keys(layouts).length }));
    if (Object.keys(layouts).length === 0) {
      log("W", tt("没有其它布局可跳转：先在左侧「资源」上传 res/ 目录"));
    }
    log("D", tt("交互已开启：按钮有涟漪、输入框可直接打字、下拉可展开、列表项可点选、开关/勾选/进度条可操作"));
    // 只在挂载时打一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 自适应：整块手机缩放到窗口内
  useEffect(() => {
    const calc = () => {
      const chromeH = Math.round(24 * SCALE) + Math.round(48 * SCALE);
      const chromeW = 4;
      // M149：还要减掉 stage 自己的 padding（上下/左右各 16），否则算出的手机总高比容器大 → 溢出滚动
      const availH = window.innerHeight - 56 - 32;
      const availW = window.innerWidth - (window.innerWidth > 1000 && showLog ? 380 : 24) - 32;
      const contentH = dev.h * SCALE + chromeH + chromeW;
      const contentW = dev.w * SCALE + chromeW;
      setFit(Math.min(availH / contentH, availW / contentW, 1));
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [dev.w, dev.h, showLog]);

  // 卸载时清掉 Toast 定时器，避免 setState on unmounted
  useEffect(
    () => () => {
      if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  // 日志自动滚到底
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const parsed = useMemo(() => {
    const r = parseLayoutXml(cur.xml);
    return r;
  }, [cur.xml]);

  const model = useMemo(() => {
    if (!parsed.root) return null;
    // M16d：运行预览跟编辑器用同一个渲染主题（默认 AppCompat）
    let rt: RenderTheme = DEFAULT_RENDER_THEME;
    try {
      const v = window.localStorage.getItem("axv.renderTheme");
      if (v === "material3" || v === "appcompat") rt = v;
    } catch {
      /* ignore */
    }
    return buildRenderModel(parsed.root, resources, SCALE, layouts, { w: dev.w, h: dev.h }, undefined, rt);
  }, [parsed.root, resources, layouts, dev.w, dev.h]);

  const findLayout = useCallback(
    (raw: string): Screen | null => {
      const want = normName(raw);
      const keys = Object.keys(layouts);
      // 1) 精确 2) 去掉 activity_/fragment_ 前缀 3) 包含匹配
      const exact = keys.find((k) => normName(k) === want);
      const stripped = keys.find((k) => normName(k).replace(/^(activity|fragment|layout)_/, "") === want);
      const fuzzy = keys.find((k) => normName(k).includes(want) || want.includes(normName(k)));
      const hit = exact ?? stripped ?? fuzzy;
      if (!hit) return null;
      return { name: hit, xml: layouts[hit] };
    },
    [layouts],
  );

  // M199：挑一个跟当前布局最相关的 Activity，做「轻量逻辑仿真」（不编译、不执行真 Java）
  const sim = useMemo(() => {
    if (!javaFiles?.length) return null;
    return pickJavaSim(javaFiles, entryName, layouts);
  }, [javaFiles, entryName, layouts]);

  // M200：按布局名索引所有 Activity，换屏后能读对应那一个
  const simByLayout = useMemo(() => {
    const map = new Map<string, SimModel>();
    if (!javaFiles?.length) return map;
    for (const f of javaFiles) {
      const m = parseJavaSim(f);
      if (!m) continue;
      const key = m.layoutName;
      if (key && !map.has(key)) map.set(key, m);
    }
    return map;
  }, [javaFiles]);

  const curSim = simByLayout.get(cur.name) ?? (cur.name === entryName ? sim : null);
  /** M200：每屏一份运行时变量状态（进屏时重建，跟 Activity 重建一致） */
  const simStates = useRef(new Map<string, SimState>());
  const curSimRef = useRef<SimModel | null>(null);
  const curNameRef = useRef<string>("");
  curSimRef.current = curSim;
  curNameRef.current = cur.name;
  const simBootedKey = useRef<string | null>(null);

  /** 把 Java 仿真的效果应用到运行中的 DOM；识别不到控件只记日志，不改页面 */
  const applySim = useCallback(
    (effects: SimEffect[]) => {
      const model = curSimRef.current;
      if (!model) return;
      const screenName = curNameRef.current;
      let state = simStates.current.get(screenName);
      if (!state) {
        state = createSimState(model);
        simStates.current.set(screenName, state);
      }
      const screenEl = bodyRef.current?.querySelector<HTMLElement>(".axv-run-screen") ?? null;
      const byPath = (viewId: string): HTMLElement | null => {
        const path = idToPath(parsed.root, viewId);
        if (!path || !screenEl) return null;
        return screenEl.querySelector<HTMLElement>(`[data-path="${path}"]`);
      };
      const rx: SimReceiver = {
        setText(viewId, text) {
          const el = byPath(viewId);
          if (!el) {
            log("W", tt("Java 逻辑：找不到控件 #{id}", { id: viewId }));
            return;
          }
          // 只换「纯文本的 span」，避免拆掉复合 drawable / 图标
          const spans = Array.from(el.querySelectorAll("span")).filter((s) => s.children.length === 0);
          if (spans.length) spans[spans.length - 1].textContent = text;
          else el.textContent = text;
          log("D", `Java: ${viewId}.setText("${text}")`);
        },
        setVisibility(viewId, v) {
          const el = byPath(viewId);
          if (!el) {
            log("W", tt("Java 逻辑：找不到控件 #{id}", { id: viewId }));
            return;
          }
          el.style.display = v === "gone" ? "none" : "";
          el.style.visibility = v === "invisible" ? "hidden" : "";
          log("D", `Java: ${viewId}.setVisibility(${v.toUpperCase()})`);
        },
        setEnabled(viewId, v) {
          const el = byPath(viewId);
          if (!el) {
            log("W", tt("Java 逻辑：找不到控件 #{id}", { id: viewId }));
            return;
          }
          el.style.opacity = v ? "" : "0.5";
          el.style.pointerEvents = v ? "" : "none";
          log("D", `Java: ${viewId}.setEnabled(${v})`);
        },
        toast(text) {
          showToast(text);
          log("I", `Toast: ${text}`);
        },
        log(level, tag, msg) {
          log(level.toUpperCase() as "D" | "I" | "W" | "E", `${tag}: ${msg}`);
        },
        // M200：让 if (x.getVisibility() == View.GONE) 能读到真实 DOM 状态
        getVisibility(viewId) {
          const el = byPath(viewId);
          if (!el) return null;
          if (el.style.display === "none") return "gone";
          if (el.style.visibility === "hidden") return "invisible";
          return "visible";
        },
        navigate(target, source) {
          const hit = findLayout(target);
          if (!hit) {
            log("W", tt("startActivity({cls})：找不到布局「{target}」", { cls: source, target }));
            return;
          }
          log("I", tt("startActivity({cls}) → {name}.xml", { cls: source, name: hit.name }));
          setDir("fwd");
          setStack((s) => [...s, hit]);
        },
      };
      applyEffects(model, effects, rx, state);
    },
    [parsed.root, log, showToast, findLayout],
  );

  const back = useCallback(() => {
    setStack((s) => {
      if (s.length <= 1) {
        log("D", tt("已在首页，「返回」不再出栈"));
        return s;
      }
      const prev = s[s.length - 2];
      log("I", tt("← 返回 {name}.xml（栈深 {n}）", { name: prev.name, n: s.length - 1 }));
      setDir("back");
      return s.slice(0, -1);
    });
  }, [log]);

  const tap = useCallback(
    (path: string) => {
      const node = parsed.root ? findNode(parsed.root, path) : null;
      if (!node) return;
      // M20j：只有「真正可操作」的控件才响应点击。
      // 容器/纯展示文本（LinearLayout、View、ImageView、普通 TextView…）点了不做事，也不打日志；
      // 输入框只靠聚焦 + 输入（由 decorateInput 接管），不走点击逻辑。
      const clickRole = runRoleOf(node.tag);
      if (clickRole === "none" || clickRole === "input") return;
      const label = targetLabel(node.tag, node.attrs["id"]);
      const action = String(node.attrs["onClick"] ?? "").trim();

      // M199：代码里写的 setOnClickListener 优先（跟安卓真实行为一致）
      const rawId = String(node.attrs["id"] ?? "");
      const viewId = rawId.replace(/^@\+?id\//, "").trim();
      const model = curSimRef.current;
      const simHandler = model && viewId ? model.handlers.find((h) => h.viewId === viewId) : undefined;
      if (simHandler) {
        log("I", eventText("click", label, tt("Java 逻辑 {n} 条", { n: simHandler.effects.length })));
        applySim(simHandler.effects);
        return;
      }

      if (!action) {
        log("D", eventText("click", label, tt("无 onClick")));
        return;
      }
      if (BACK_WORDS.has(action)) {
        log("I", eventText("click", label, tt("onClick=\"{action}\" → 返回", { action })));
        back();
        return;
      }
      if (action.startsWith("toast:")) {
        const msg = action.slice(6).trim() || tt("(空)");
        log("I", eventText("click", label, `toast: ${msg}`));
        showToast(msg);
        return;
      }
      const target = findLayout(action);
      if (!target) {
        log("W", eventText("click", label, tt("找不到布局 \"{action}\"（可用：{list}）", { action, list: Object.keys(layouts).join(", ") || tt("无") })));
        return;
      }
      log("I", eventText("click", label, `onClick="${action}" → ${target.name}.xml`));
      setDir("fwd");
      setStack((s) => [...s, target]);
    },
    [parsed.root, findLayout, log, back, showToast, applySim],
  );

  // M18：换屏后给 DOM 加交互（输入/勾选/拖动/下拉/列表行/涟漪）
  // 只依赖屏幕标识：日志变化不会重跑（否则用户输入会被反复重新装饰）
  const screenKey = cur.name + "|" + dir + "|" + stack.length;
  useEffect(() => {
    const host = bodyRef.current;
    if (!host) return;
    const screen = host.querySelector<HTMLElement>(".axv-run-screen");
    if (!screen) return;
    // 等 React 把这一屏的 DOM 落完再装饰
    let cleanup: (() => void) | null = null;
    const t = window.setTimeout(() => {
      const r = decorateRunScreen(screen, parsed.root, { log, tap, toast: showToast }, resources);
      cleanup = r.cleanup;
      setInteractive(r.interactive);
      if (r.interactive > 0) log("D", tt("本屏可交互控件 {n} 个", { n: r.interactive }));
      // M199：onCreate 里的直接语句只跑一次（进首页时）
      // M199/M200：onCreate 里的直接语句每进一屏跑一次（变量状态跟 Activity 一起重建）
      const model = curSimRef.current;
      if (model && simBootedKey.current !== cur.name) {
        simBootedKey.current = cur.name;
        simStates.current.set(cur.name, createSimState(model));
        if (model.startup.length) {
          log("I", tt("Java 仿真：执行 onCreate 的 {n} 条语句", { n: model.startup.length }));
          applySim(model.startup);
        }
        if (model.skipped.length) {
          log("W", tt("Java 仿真：{n} 条语句暂不支持（已跳过）", { n: model.skipped.length }));
        }
      }
    }, 0);
    return () => {
      window.clearTimeout(t);
      cleanup?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenKey]);

  // 键盘：Esc = 返回；栈空了再关
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (stack.length > 1) back();
        else onClose();
      } else if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setRotated((r) => !r);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length, back, onClose]);

  const DPX = SCALE;
  const STATUS_BAR_H = Math.round(24 * DPX);
  const NAV_BAR_H = Math.round(48 * DPX);
  const theme = readableOn(String(model?.root?.style?.backgroundColor ?? model?.root?.style?.background ?? ""));
  const phoneBg = theme.bg;
  const phoneFg = theme.fg;
  const widthPx = Math.round(dev.w * SCALE);
  const heightPx = Math.round(dev.h * SCALE);
  const BORDER = 2;
  const outerW = widthPx + BORDER * 2;
  const outerH = heightPx + BORDER * 2;

  return (
    <div className="axv-run-backdrop">
      <div className="axv-run-top">
        <span className="axv-run-title">
          <span className="msr" aria-hidden="true">
            play_arrow
          </span>
          {tt("运行")} · {cur.name}.xml
          <span className="axv-run-dev">{dev.label}</span>
        </span>
        <span className="axv-run-stack">
          {stack.map((s, i) => (
            <span key={s.name + i} className={"axv-run-crumb" + (i === stack.length - 1 ? " is-on" : "")}>
              {s.name}
            </span>
          ))}
        </span>
        <span className="axv-run-actions">
          <button className="axv-run-btn" onClick={() => setRotated((r) => !r)} title={tt("横竖屏切换（Ctrl+R）")}>
            <span className="msr" aria-hidden="true">
              screen_rotation
            </span>
          </button>
          <button
            className="axv-run-btn"
            onClick={() => setShowLog((v) => !v)}
            title={showLog ? tt("隐藏日志") : tt("显示日志")}
          >
            <span className="msr" aria-hidden="true">
              terminal
            </span>
          </button>
          <button className="axv-run-btn" onClick={onClose} title={tt("退出运行（Esc）")}>
            <span className="msr" aria-hidden="true">
              close
            </span>
          </button>
        </span>
      </div>

      <div className={"axv-run-main" + (showLog ? " with-log" : "")}>
        <div className="axv-run-stage">
          <div style={{ width: outerW * fit, height: outerH * fit, flex: "0 0 auto" }}>
            <div
              className="axv-phone axv-run-phone"
              style={{
                width: outerW,
                height: outerH,
                boxSizing: "border-box",
                background: phoneBg,
                color: phoneFg,
                transform: fit < 1 ? `scale(${fit})` : undefined,
                transformOrigin: "top left",
                borderRadius: device.radius ? Math.round(device.radius * DPX) : undefined,
              }}
            >
              <div className="axv-statusbar" style={{ height: STATUS_BAR_H }}>
                <span className="axv-sb-time">9:41</span>
                <div className="axv-sb-camera" aria-hidden="true" />
                <span className="axv-sb-icons">
                  <span className="msr" aria-hidden="true">
                    signal_cellular_alt
                  </span>
                  <span className="msr" aria-hidden="true">
                    wifi
                  </span>
                  <span className="msr" aria-hidden="true">
                    battery_full
                  </span>
                </span>
              </div>

              <div className="axv-phone-body axv-run-body" ref={bodyRef}>
                {parsed.root && model ? (
                  <div key={cur.name + dir} className={"axv-run-screen " + (dir === "fwd" ? "in-fwd" : "in-back")}>
                    <StaticCanvas node={model.root} selectedPath={null} onSelect={tap} scale={SCALE} />
                  </div>
                ) : (
                  <div className="axv-run-error">{tt("XML 解析失败，无法运行")}</div>
                )}
                {toast ? (
                  <div key={toast.id} className="axv-run-toast" role="status">
                    {toast.text}
                  </div>
                ) : null}
              </div>

              <div className="axv-navbar" style={{ height: NAV_BAR_H }}>
                <button className="axv-nav-btn" title={tt("返回")} onClick={back}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M13.5 4.5 L14.5 4.5 L14.5 4.75 L14.75 4.75 L14.75 5 L15 5 L15 5.75 L14.75 5.75 L14.75 6.25 L14.5 6.25 L14.5 6.5 L14.25 6.5 L14.25 6.75 L14 6.75 L14 7 L13.75 7 L13.75 7.25 L13.5 7.25 L13.5 7.5 L13.25 7.5 L13.25 7.75 L13 7.75 L13 8 L12.75 8 L12.75 8.25 L12.5 8.25 L12.5 8.5 L12.25 8.5 L12.25 8.75 L12 8.75 L12 9 L11.75 9 L11.75 9.25 L11.5 9.25 L11.5 9.5 L11.25 9.5 L11.25 9.75 L11 9.75 L11 10.25 L11.25 10.25 L11.25 10.5 L11.5 10.5 L11.5 10.75 L11.75 10.75 L11.75 11 L12 11 L12 11.25 L12.25 11.25 L12.25 11.5 L12.5 11.5 L12.5 11.75 L12.75 11.75 L12.75 12 L13 12 L13 12.25 L13.25 12.25 L13.25 12.5 L13.5 12.5 L13.5 12.75 L13.75 12.75 L13.75 13 L14 13 L14 13.25 L14.25 13.25 L14.25 13.5 L14.5 13.5 L14.5 13.75 L14.75 13.75 L14.75 14.25 L15 14.25 L15 15 L14.75 15 L14.75 15.25 L14.5 15.25 L14.5 15.5 L13.5 15.5 L13.5 15.25 L13.25 15.25 L13.25 15 L13 15 L13 14.75 L12.75 14.75 L12.75 14.5 L12.5 14.5 L12.5 14.25 L12.25 14.25 L12.25 14 L12 14 L12 13.75 L11.75 13.75 L11.75 13.5 L11.5 13.5 L11.5 13.25 L11.25 13.25 L11.25 13 L11 13 L11 12.75 L10.75 12.75 L10.75 12.5 L10.5 12.5 L10.5 12.25 L10.25 12.25 L10.25 12 L10 12 L10 11.75 L9.75 11.75 L9.75 11.5 L9.5 11.5 L9.5 11.25 L9.25 11.25 L9.25 11 L9 11 L9 10.75 L8.75 10.75 L8.75 10.5 L8.5 10.5 L8.5 9.5 L8.75 9.5 L8.75 9.25 L9 9.25 L9 9 L9.25 9 L9.25 8.75 L9.5 8.75 L9.5 8.5 L9.75 8.5 L9.75 8.25 L10 8.25 L10 8 L10.25 8 L10.25 7.75 L10.5 7.75 L10.5 7.5 L10.75 7.5 L10.75 7.25 L11 7.25 L11 7 L11.25 7 L11.25 6.75 L11.5 6.75 L11.5 6.5 L11.75 6.5 L11.75 6.25 L12 6.25 L12 6 L12.25 6 L12.25 5.75 L12.5 5.75 L12.5 5.5 L12.75 5.5 L12.75 5.25 L13 5.25 L13 5 L13.25 5 L13.25 4.75 L13.5 4.75 Z" fill="currentColor"></path>
                  </svg>
                </button>
                <button className="axv-nav-btn" title={tt("主页（回首页）")} onClick={() => { setDir("back"); setStack((s) => s.slice(0, 1)); log("I", tt("⌂ 回首页")); }}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
                <button className="axv-nav-btn" title={tt("多任务（切换上一屏）")} onClick={back}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        </div>

        {showLog ? (
          <aside className="axv-run-log">
            <div className="axv-run-log-head">
              <span className="axv-run-log-title">
                logcat
                {interactive > 0 ? <em className="axv-run-log-badge">{tt("{n} 个可交互", { n: interactive })}</em> : null}
              </span>
              <span className="axv-run-log-tools">
                <button
                  className="axv-run-log-clear"
                  title={tt("复制全部日志")}
                  onClick={() => {
                    const text = logs.map((l) => `${l.t} ${l.level} ${l.msg}`).join("\n");
                    void navigator.clipboard.writeText(text).then(
                      () => log("D", tt("已复制 {n} 条日志", { n: logs.length })),
                      () => log("W", tt("复制失败：浏览器拒绝了剪贴板权限")),
                    );
                  }}
                >
                  {tt("复制")}
                </button>
                <button className="axv-run-log-clear" onClick={() => setLogs([])}>
                  {tt("清空")}
                </button>
              </span>
            </div>
            <div className="axv-run-log-body" ref={logRef}>
              {logs.length === 0 ? (
                <div className="axv-run-log-empty">{tt("（点击界面上的控件试试）")}</div>
              ) : (
                logs.map((l) => (
                  <div key={l.id} className={"axv-run-line lv-" + l.level}>
                    <span className="t">{l.t}</span>
                    <span className="lv">{l.level}</span>
                    <span className="m">{l.msg}</span>
                  </div>
                ))
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
