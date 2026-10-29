// components/run-decorate.ts — M18：运行预览的交互装饰层（只在浏览器里跑，不参与单测）
//
// XmlCanvas 只负责「长得像」。这个模块在渲染完成后做 DOM 增强，让预览能真的操作：
//   按钮 → 涟漪 + 按下反馈
//   输入框 → contentEditable 可打字（hint 当 placeholder）
//   勾选/开关/单选 → 点一下切换图形（复用 globals.css 的 --axv-ctl-* 变量）
//   进度条 → 拖动改进度（复用 --axv-progress / --axv-seek-pct）
//   下拉 → 弹出候选菜单，选中后回填文字
//   列表/网格 → 无子项时注入演示行，行可点选高亮
//
// 关键点：这一层只改 DOM，不回写 React state（除了日志），
// 配合 RunPreview 里 memo 过的画布，重渲染不会把用户输入冲掉。

import { CTL_CHECK_IMG } from "@/lib/xml/css";
import type { XmlNode, ResourceTable } from "@/lib/xml/types";
import { findNode } from "@/lib/xml/parser";
import {
  eventText,
  previewInput,
  runRoleOf,
  sampleRows,
  seekRatio,
  seekValue,
  resolveSpinner,
  spinnerOptions,
  targetLabel,
  vibeMs,
  vibrate,
  type RunRole,
} from "@/lib/xml/run-sim";

const DP = (v: number) => Math.round(v * 2); // 运行预览固定 1dp = 2px

export interface DecorateHooks {
  /** 打一条日志 */
  log: (level: "I" | "W" | "D" | "E", msg: string) => void;
  /** 落一个动作（复用 onClick 语义：跳转/返回/toast） */
  tap: (path: string) => void;
  /** 应用内 Toast（Android 那种小黑条） */
  toast: (text: string) => void;
}

interface Ctx {
  root: HTMLElement;
  parsedRoot: XmlNode | null;
  /** M19：资源表（@array/xxx 下拉候选） */
  table: ResourceTable | null;
  hooks: DecorateHooks;
  /** 收集清理函数，切屏时统一撤掉 */
  cleanups: (() => void)[];
  /** 防重入：同一元素只装饰一次 */
  seen: WeakSet<Element>;
}

function on<K extends keyof HTMLElementEventMap>(
  el: HTMLElement,
  type: K,
  fn: (e: HTMLElementEventMap[K]) => void,
  opts?: AddEventListenerOptions,
) {
  el.addEventListener(type, fn as EventListener, opts);
  return () => el.removeEventListener(type, fn as EventListener, opts);
}

/** 取节点的原始属性（用于 hint / checked / entries / progress） */
function attrsOf(ctx: Ctx, path: string | undefined): Record<string, unknown> {
  if (!path || !ctx.parsedRoot) return {};
  const n = findNode(ctx.parsedRoot, path);
  return (n?.attrs ?? {}) as Record<string, unknown>;
}

/** 元素背景亮不亮 → 决定涟漪用黑还是白 */
function rippleColor(el: HTMLElement): string {
  const bg = window.getComputedStyle(el).backgroundColor;
  const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return "rgba(0,0,0,0.18)";
  const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum < 140 ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.18)";
}

/* ===================== 涟漪 ===================== */

function attachRipple(ctx: Ctx, el: HTMLElement, label?: string) {
  let longFired = false;
  let timer: number | null = null;
  const clearTimer = () => {
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };
  // 长按 550ms 记一条；之后的 click 被吞掉（与 Android 长按行为一致）
  const offDownLong = on(el, "pointerdown", () => {
    if (!label) return;
    clearTimer();
    timer = window.setTimeout(() => {
      longFired = true;
      vibrate(vibeMs("button", "long"), "long");
      ctx.hooks.log("I", eventText("long", label, "onLongClick"));
    }, 550);
  });
  const offUpLong = on(el, "pointerup", clearTimer);
  const offLeaveLong = on(el, "pointerleave", clearTimer);
  const offClickLong = on(
    el,
    "click",
    (e) => {
      if (!longFired) return;
      longFired = false;
      e.stopPropagation();
      e.preventDefault();
    },
    { capture: true },
  );

  const off = on(el, "pointerdown", (e) => {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    const rect = el.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height) * 2;
    const span = document.createElement("span");
    span.className = "axv-run-ripple";
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${e.clientX - rect.left - size / 2}px`;
    span.style.top = `${e.clientY - rect.top - size / 2}px`;
    span.style.background = rippleColor(el);
    el.appendChild(span);
    const kill = () => span.remove();
    span.addEventListener("animationend", kill);
    window.setTimeout(kill, 700);

    el.classList.add("axv-run-pressed");
    window.setTimeout(() => el.classList.remove("axv-run-pressed"), 140);
  });
  ctx.cleanups.push(off, offDownLong, offUpLong, offLeaveLong, offClickLong, clearTimer);
}

/* ===================== 输入框 ===================== */

/** 浏览器是否支持 contenteditable="plaintext-only"（Firefox 不支持） */
function supportsPlainTextOnly(): boolean {
  try {
    const d = document.createElement("div");
    d.setAttribute("contenteditable", "plaintext-only");
    return d.contentEditable === "plaintext-only";
  } catch {
    return false;
  }
}

/** 在光标处插入纯文本（execCommand 仍是最省事的跨浏览器做法） */
function insertPlainText(text: string) {
  if (!text) return;
  try {
    if (document.execCommand("insertText", false, text)) return;
  } catch {
    /* 有的浏览器在非编辑态会抛错，走下面的兜底 */
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  range.insertNode(document.createTextNode(text));
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

function decorateInput(ctx: Ctx, el: HTMLElement, path: string, label: string) {
  const a = attrsOf(ctx, path);
  const hint = String(a["hint"] ?? "");
  const text = String(a["text"] ?? "");
  // css.ts 把 hint 当正文画了；输入态要清掉，改用 CSS 占位符，否则一打字就重复
  if (hint && (!text || el.textContent === hint)) {
    el.textContent = "";
    el.dataset.runHint = hint;
    el.classList.add("axv-run-input-empty");
  }

  el.classList.add("axv-run-input");
  // plaintext-only 只有 Chromium/Safari 认；Firefox 拿到会完全不让人输入 → 探测后回退 true
  el.setAttribute("contenteditable", supportsPlainTextOnly() ? "plaintext-only" : "true");
  el.spellcheck = false;
  el.setAttribute("role", "textbox");
  const single = Boolean(a["singleLine"]);
  if (single) {
    el.dataset.single = "1";
  }

  let typing: number | null = null;
  const flushLog = () => {
    typing = null;
    const v = (el.textContent ?? "").trim();
    ctx.hooks.log("D", eventText("input", label, `"${previewInput(v)}"`));
  };

  const offInput = on(el, "input", () => {
    el.classList.toggle("axv-run-input-empty", (el.textContent ?? "").length === 0);
    el.dataset.runValue = el.textContent ?? "";
    if (typing !== null) window.clearTimeout(typing);
    // 每敲一个字都刷日志会闪；停手 600ms 再记一条
    typing = window.setTimeout(flushLog, 600);
  });
  const offFocus = on(el, "focus", () => {
    ctx.hooks.log("D", eventText("focus", label));
    el.classList.add("axv-run-focused");
  });
  const offBlur = on(el, "blur", () => {
    if (typing !== null) {
      window.clearTimeout(typing);
      flushLog();
    }
    ctx.hooks.log("D", eventText("blur", label, `"${previewInput((el.textContent ?? "").trim())}"`));
    el.classList.remove("axv-run-focused");
  });
  // 单行输入框回车不换行（Android 里就是 actionNext/Done）
  const offKey = on(el, "keydown", (e) => {
    if (!single) return;
    if (e.key === "Enter") {
      e.preventDefault();
      flushLog();
    }
  });
  // 粘贴一律去格式：富文本粘进来会把画布结构写坏
  const offPaste = on(el, "paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData?.getData("text/plain") ?? "").replace(/\r/g, "");
    const value = single ? text.replace(/\n+/g, " ") : text;
    insertPlainText(value);
  });

  // 输入框的点击不要冒泡去触发 onClick / 选中逻辑
  const offClick = on(el, "click", (e) => e.stopPropagation());

  ctx.cleanups.push(offInput, offFocus, offBlur, offClick, offKey, offPaste, () => {
    if (typing !== null) window.clearTimeout(typing);
  });
}

/* ===================== 勾选 / 开关 / 单选 ===================== */

function ctlVars(role: RunRole, on: boolean, tint: string) {
  if (role === "switch") {
    return {
      "--axv-ctl-bg": on ? tint : "#E0D9E3",
      "--axv-ctl-thumb-x": on ? `${DP(20)}px` : `${DP(2)}px`,
    } as Record<string, string>;
  }
  return {
    "--axv-ctl-bg": role === "radio" ? "#FFFFFF" : on ? tint : "#FFFFFF",
    "--axv-ctl-ring": on ? tint : "#79747E",
    "--axv-ctl-img": on ? (role === "radio" ? "radial-gradient(circle, #6750A4 0 42%, transparent 45%)" : CTL_CHECK_IMG) : "none",
  } as Record<string, string>;
}

function applyCtl(el: HTMLElement, role: RunRole, on: boolean, tint: string) {
  const vars = ctlVars(role, on, tint);
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  el.dataset.runChecked = on ? "1" : "0";
  el.setAttribute("aria-checked", on ? "true" : "false");
}

function decorateCtl(ctx: Ctx, el: HTMLElement, path: string, role: RunRole, label: string) {
  const a = attrsOf(ctx, path);
  const tint = String(a["buttonTint"] ?? a["thumbTint"] ?? "#6750A4");
  let checked = Boolean(a["checked"]);
  applyCtl(el, role, checked, tint);

  const off = on(el, "click", (e) => {
    e.stopPropagation();
    if (role === "radio") {
      // 同组单选：把兄弟 RadioButton 全关掉
      const parent = el.parentElement;
      if (parent) {
        parent.querySelectorAll<HTMLElement>('[data-tag$="RadioButton"], [data-tag$="MaterialRadioButton"]').forEach((sib) => {
          if (sib !== el) applyCtl(sib, "radio", false, tint);
        });
      }
      checked = true;
    } else {
      checked = !checked;
    }
    applyCtl(el, role, checked, tint);
    vibrate(vibeMs(role, "toggle"), "toggle");
    const verb = role === "switch" ? (checked ? "打开" : "关闭") : checked ? "选中" : "取消选中";
    ctx.hooks.log("I", eventText("check", label, verb));
  });
  ctx.cleanups.push(off);
}

/* ===================== SeekBar ===================== */

function decorateSeek(ctx: Ctx, el: HTMLElement, path: string, label: string) {
  const a = attrsOf(ctx, path);
  const max = Number(a["max"] ?? 100);
  const min = 0;
  let val = Number(a["progress"] ?? 0);

  const paint = (ratio: number) => {
    el.style.setProperty("--axv-progress", String(ratio));
    el.style.setProperty("--axv-seek-pct", `${(ratio * 100).toFixed(2)}%`);
  };

  // 按下/拖动已经把事件吃掉了，但浏览器松手后还会补一个 click，
  // 不清掉就会在日志里多一条「点击 SeekBar#xx · 无 onClick」
  const offClick = on(el, "click", (e) => e.stopPropagation());
  ctx.cleanups.push(offClick);

  const off = on(el, "pointerdown", (e) => {
    e.stopPropagation();
    const rect = el.getBoundingClientRect();
    const set = (cx: number) => {
      const r = seekRatio(cx, rect.left, rect.width);
      val = seekValue(r, max, min);
      paint(r);
    };
    set(e.clientX);
    const move = (ev: PointerEvent) => set(ev.clientX);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      ctx.hooks.log("I", eventText("seek", label, `progress=${val}/${max}`));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
  ctx.cleanups.push(off);
}

/* ===================== Spinner ===================== */

function decorateSpinner(ctx: Ctx, el: HTMLElement, path: string, label: string) {
  const a = attrsOf(ctx, path);
  // M19：@array/xxx 走资源表，解析不出再用占位候选（而不是假装解析成功）
  const real = resolveSpinner(a["entries"], ctx.table);
  const options = real ?? spinnerOptions(a["entries"]);
  let current = String(a["text"] ?? options[0] ?? "");

  const off = on(el, "click", (e) => {
    e.stopPropagation();
    ctx.root.querySelector(".axv-run-popup")?.remove();

    // ⚠ 两个坑：① 手机外壳有 transform: scale(fit)，getBoundingClientRect 是【视觉坐标】；
    //   ② 内容可能在外层 .axv-run-body 里滚过。位置一律「相对 root 换算」，翻不翻转看【可视区剩余空间】。
    const rect = el.getBoundingClientRect();
    const rootRect = ctx.root.getBoundingClientRect();
    const k = ctx.root.offsetWidth > 0 ? rootRect.width / ctx.root.offsetWidth : 1;
    const toLayout = (n: number) => (k > 0 ? n / k : n);
    const vp = (ctx.root.parentElement ?? ctx.root).getBoundingClientRect();
    const menuH = Math.min(264, options.length * 54 + 16);

    const left = toLayout(rect.left - rootRect.left);
    const below = toLayout(rect.bottom - rootRect.top) + 2;
    const above = toLayout(rect.top - rootRect.top) - menuH - 2;
    // 下方剩余视觉空间放不下、且上方放得下 → 往上翻
    const flipUp = vp.bottom - rect.bottom - 4 < menuH * k && rect.top - vp.top > menuH * k;

    const menu = document.createElement("div");
    menu.className = "axv-run-popup";
    menu.setAttribute("role", "listbox");
    menu.style.left = `${Math.max(0, Math.min(left, ctx.root.offsetWidth - 40))}px`;
    menu.style.top = `${Math.max(4, flipUp ? above : below)}px`;
    menu.style.minWidth = `${Math.max(toLayout(rect.width), DP(120))}px`;
    menu.style.maxHeight = `${menuH}px`;

    options.forEach((opt) => {
      const item = document.createElement("div");
      item.className = "axv-run-popup-item" + (opt === current ? " on" : "");
      item.textContent = opt;
      item.setAttribute("role", "option");
      item.addEventListener("click", (ev) => {
        ev.stopPropagation();
        current = opt;
        // 只替换文字节点，别把 ::after 的下拉箭头（伪元素）写坏
        el.childNodes.forEach((n) => {
          if (n.nodeType === Node.TEXT_NODE) n.textContent = "";
        });
        el.insertBefore(document.createTextNode(opt), el.firstChild);
        el.dataset.runValue = opt;
        menu.remove();
        ctx.hooks.log("I", eventText("select", label, `"${opt}"`));
        ctx.hooks.toast(`已选择：${opt}`);
      });
      menu.appendChild(item);
    });

    ctx.root.appendChild(menu);

    const closer = (ev: MouseEvent) => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove();
        window.removeEventListener("pointerdown", closer, true);
      }
    };
    window.setTimeout(() => window.addEventListener("pointerdown", closer, true), 0);
    ctx.cleanups.push(() => window.removeEventListener("pointerdown", closer, true));
    ctx.hooks.log("D", eventText("click", label, `展开 ${options.length} 个候选`));
  });
  ctx.cleanups.push(off);
}

/* ===================== 列表 / 网格 ===================== */

function decorateList(ctx: Ctx, el: HTMLElement, role: RunRole, label: string) {
  type Row = { title: string; sub?: string };
  const rows: Row[] = [];

  if (el.childElementCount === 0) {
    // XML 里没写行（正常，列表数据是 Adapter 给的）→ 注入演示数据
    el.innerHTML = "";
    el.classList.add(role === "grid" ? "axv-run-grid" : "axv-run-list");
    // ⚠ 必须写 inline：XML 里的 display 是行内样式，CSS 类压不过它（不然每行被 flex 挤成一小列）
    if (role === "grid") {
      el.style.display = "grid";
      el.style.gridTemplateColumns = "1fr 1fr";
      el.style.gap = `${DP(8)}px`;
      el.style.padding = `${DP(8)}px`;
      el.style.alignContent = "start";
    } else {
      el.style.display = "block";
      el.style.padding = "0";
    }
    el.style.overflowY = "auto";
    el.style.overflowX = "hidden";
    const items = sampleRows(role === "grid" ? 4 : 8);
    items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "axv-run-row";
      row.dataset.runIndex = String(i);
      const t = document.createElement("div");
      t.className = "axv-run-row-title";
      t.textContent = role === "grid" ? `格子 ${i + 1}` : it.title;
      row.appendChild(t);
      if (role !== "grid" && it.sub) {
        const s = document.createElement("div");
        s.className = "axv-run-row-sub";
        s.textContent = it.sub;
        row.appendChild(s);
      }
      el.appendChild(row);
      rows.push({ title: role === "grid" ? `格子 ${i + 1}` : it.title });
    });
    ctx.cleanups.push(() => {
      /* 切屏时整棵 DOM 会被 React 换掉，无需手动清理 */
    });
  } else {
    // 静态写了子项：就当每行可点
    Array.from(el.children).forEach((c, i) => {
      if (c instanceof HTMLElement) {
        c.classList.add("axv-run-row-static");
        c.dataset.runIndex = String(i);
        rows.push({ title: (c.textContent ?? "").trim().slice(0, 20) });
      }
    });
  }

  const off = on(el, "click", (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>("[data-run-index]");
    if (!target || !el.contains(target)) return;
    e.stopPropagation();
    el.querySelectorAll(".axv-run-row.on, .axv-run-row-static.on").forEach((r) => r.classList.remove("on"));
    target.classList.add("on");
    vibrate(vibeMs(role, "select"), "toggle");
    const idx = Number(target.dataset.runIndex ?? 0);
    const text = rows[idx]?.title ?? (target.textContent ?? "").trim().slice(0, 20);
    ctx.hooks.log("I", eventText("click", label, `onItemClick position=${idx} item="${text}"`));
  });
  ctx.cleanups.push(off);
}

/* ===================== 主入口 ===================== */

export interface DecorateResult {
  /** 撤掉所有监听（切屏时调用） */
  cleanup: () => void;
  /** 这一屏里真正能操作的控件数（输入/勾选/下拉/列表/进度/按钮） */
  interactive: number;
}

export function decorateRunScreen(
  root: HTMLElement,
  parsedRoot: XmlNode | null,
  hooks: DecorateHooks,
  table: ResourceTable | null = null,
): DecorateResult {
  const ctx: Ctx = { root, parsedRoot, table, hooks, cleanups: [], seen: new WeakSet() };
  let interactive = 0;
  // 文档顺序：父容器先装饰（列表注入），子节点随后各自装饰
  const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-tag]"));

  for (const el of nodes) {
    if (ctx.seen.has(el)) continue;
    ctx.seen.add(el);
    const tag = el.dataset.tag ?? "";
    const role = runRoleOf(tag);
    const path = el.dataset.path ?? "";
    const label = targetLabel(tag, attrsOf(ctx, path)["id"]);
    el.removeAttribute("title"); // 编辑器的 tooltip 在运行态很碍事
    if (role !== "none") interactive += 1;

    if (role === "input") {
      decorateInput(ctx, el, path, label);
      continue;
    }
    if (role === "check" || role === "switch" || role === "radio") {
      decorateCtl(ctx, el, path, role, label);
      continue;
    }
    if (role === "seek") {
      decorateSeek(ctx, el, path, label);
      continue;
    }
    if (role === "spinner") {
      decorateSpinner(ctx, el, path, label);
      continue;
    }
    if (role === "list" || role === "grid") {
      decorateList(ctx, el, role, label);
      continue;
    }
    if (role === "button") {
      attachRipple(ctx, el, label);
      continue;
    }
  }

  return {
    interactive,
    cleanup: () => {
      for (const c of ctx.cleanups) c();
      root.querySelector(".axv-run-popup")?.remove();
    },
  };
}

