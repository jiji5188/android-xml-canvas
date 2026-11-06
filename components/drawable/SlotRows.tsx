"use client";

// components/drawable/SlotRows.tsx — 「这一层」自己的参数（M134 / M136 重做输入框）
//
// 结构树里的每一行其实有两个东西：
//   1. 子节点本身（shape / color / ref / 子容器）→ 参数页 / 形状页管
//   2. 父容器给这个位置挂的属性（layer-list 的偏移/宽高/对齐/不透明度、selector 的状态位）
// 以前第 2 类完全没入口：想改 `android:left="2dp"` 只能手写 XML。
// 这里把它们放成参数页第一块「这一层」，选中哪层就改哪层。
//
// M136 改动：
//   - 数字框改成「草稿」受控：允许把最后一位删成空（以前空就回写 undefined，光标被抢、删不掉）
//   - 输入过滤：只留数字/小数点/负号，其余字符直接忽略（不再出现 "1a" 这种脏值）
//   - 判空兜底：偏移空 = 0（用户要求），宽高空 = 不设（否则 0 会把这一层压没），alpha 空 = 1
//   - 不透明度换成滑块 + 小数输入（原来只有整数输入框，0.5 打不进去）
//   - 对齐方式：没设宽/高时给明确提示（Android 里 item 填满父级，gravity 看不出变化）

import { useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import { filterNumber, parseNumberField } from "@/lib/xml/num-input";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import type { SlotValue } from "@/lib/xml/drawable-edit";

const GRAVITY: { v: string; label: string }[] = [
  { v: "", label: "不设（填满）" },
  { v: "center", label: "居中" },
  { v: "center_horizontal", label: "水平居中" },
  { v: "center_vertical", label: "垂直居中" },
  { v: "right", label: "靠右" },
  { v: "bottom", label: "靠下" },
  { v: "bottom|right", label: "右下" },
];

/** selector 的状态位：常用的排在前面 */
export const STATES: { key: string; label: string }[] = [
  { key: "state_pressed", label: "按下" },
  { key: "state_enabled", label: "启用" },
  { key: "state_focused", label: "聚焦" },
  { key: "state_hovered", label: "悬停" },
  { key: "state_checked", label: "勾选" },
  { key: "state_selected", label: "选中" },
  { key: "state_activated", label: "激活" },
  { key: "state_window_focused", label: "窗口聚焦" },
];

const EDGES: { k: "l" | "t" | "r" | "b"; label: string }[] = [
  { k: "l", label: "左" },
  { k: "t", label: "上" },
  { k: "r", label: "右" },
  { k: "b", label: "下" },
];

/** 只保留数字 / 小数点 / 负号；连续的点也只留第一个（实现在 lib/xml/num-input，有单测） */

function NumBox({
  label,
  value,
  onChange,
  placeholder = "–",
  unit = "dp",
  /** 清空时回写什么：偏移 0 / 宽高 undefined（不设） */
  emptyValue,
  allowNegative = true,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
  unit?: string;
  emptyValue: number | undefined;
  allowNegative?: boolean;
}) {
  /** draft 非 null 时优先显示它：让「删到空」这个中间态能留住，不被 value 立刻顶回去 */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (value === undefined ? "" : String(value));
  return (
    <div className="axv-shape-field">
      <label className="axv-shape-label">{tt(label)}</label>
      <div className="axv-attr-num">
        <input
          className="axv-attr-input"
          value={shown}
          inputMode="decimal"
          placeholder={placeholder}
          onChange={(e) => {
            const raw = filterNumber(e.target.value, allowNegative);
            setDraft(raw);
            onChange(parseNumberField(raw, emptyValue, { allowNegative }));
          }}
          onBlur={() => {
            // 失焦时收回草稿，让显示回归真实值（比如 "1." → "1"）
            setDraft(null);
          }}
        />
        <span className="axv-attr-suffix">{unit}</span>
      </div>
    </div>
  );
}

/** 不透明度：滑块（整百分比）+ 小数输入框，两个方向同步 */
function AlphaField({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (v: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cur = value === undefined ? 1 : value;
  const pct = Math.round(cur * 100);
  const shown = draft ?? String(Number(cur.toFixed(2)));
  return (
    <div className="axv-shape-field">
      <label className="axv-shape-label">{tt("不透明度")}</label>
      <div className="axv-attr-slider">
        <input
          type="range"
          className="axv-dp-range"
          min={0}
          max={100}
          step={1}
          value={pct}
          aria-label={tt("不透明度")}
          onChange={(e) => {
            setDraft(null);
            onChange(Number(e.target.value) / 100);
          }}
        />
        <div className="axv-attr-num axv-attr-num-sm">
          <input
            className="axv-attr-input"
            value={shown}
            inputMode="decimal"
            placeholder="1"
            onChange={(e) => {
              const raw = filterNumber(e.target.value, false);
              setDraft(raw);
              onChange(parseNumberField(raw, undefined, { allowNegative: false, min: 0, max: 1 }));
            }}
            onBlur={() => setDraft(null)}
          />
          <span className="axv-attr-suffix">0–1</span>
        </div>
      </div>
    </div>
  );
}

/**
 * M157：item 的 android:drawable —— 引用外部资源（@drawable/x、@color/x、#RRGGBB）。
 * layer-list 的每一层、selector 的每个状态都能这么写，比内联 <shape> 省重复代码。
 * 以前只能手写 XML，参数 tab 里没入口。
 */
function itemRefOf(node: DrawableNode): string {
  if (node.t === "ref") return `@drawable/${node.name}`;
  if (node.t === "color") return node.color;
  return "";
}

function RefField({ node, onChange }: { node: DrawableNode; onChange: (n: DrawableNode) => void }) {
  const cur = itemRefOf(node);
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const shown = draft ?? cur;

  const commit = () => {
    if (draft === null) return;
    const raw = draft.trim();
    setDraft(null);
    if (!raw || raw === cur) {
      setErr("");
      return;
    }
    // 不带 @ 的当 drawable 名（手机上手敲 @drawable/ 太麻烦）
    const v = raw.startsWith("@") || raw.startsWith("#") ? raw : `@drawable/${raw}`;
    const m = /^@(drawable|mipmap|color)\/([A-Za-z0-9_.]+)$/.exec(v);
    if (m) {
      onChange(
        m[1] === "color"
          ? { t: "color", color: v }
          : { t: "ref", name: m[2].replace(/\.xml$/i, "") },
      );
      setErr("");
      return;
    }
    if (/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v)) {
      onChange({ t: "color", color: v });
      setErr("");
      return;
    }
    setErr(tt("只能填 @drawable/名字、@color/名字、@mipmap/名字 或 #RRGGBB"));
  };

  return (
    <div className="axv-shape-field">
      <label className="axv-shape-label">{tt("引用资源")}</label>
      <input
        className="axv-attr-input"
        value={shown}
        spellCheck={false}
        placeholder="@drawable/bg_card"
        onChange={(e) => {
          setDraft(e.target.value);
          setErr("");
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
      />
      {err ? <div className="axv-shape-warn">{err}</div> : null}
      <div className="axv-shape-hint">
        {cur
          ? tt("这一项现在是引用，它会取代内联内容")
          : tt("填了就改写这一项的内联内容（可用 @drawable/、@color/、@mipmap/ 或颜色值）")}
      </div>
    </div>
  );
}

export function SlotRows({
  parent,
  index,
  slot,
  onChange,
  onNodeChange,
}: {
  parent: DrawableNode;
  index: number;
  slot: SlotValue;
  onChange: (patch: Partial<SlotValue>) => void;
  /** M157：把这一项换成引用/颜色（或恢复默认形状） */
  onNodeChange?: (next: DrawableNode) => void;
}) {
  // 这一项自己的节点（引用输入框要看它现在是 ref / color / 内联内容）
  const child: DrawableNode | null =
    parent.t === "layer" || parent.t === "selector"
      ? (parent.items[index]?.node ?? null)
      : parent.t === "ripple"
        ? (index === 1 ? (parent.mask ?? null) : (parent.content ?? null))
        : null;
  if (parent.t === "layer") {
    const off = slot.offset ?? {};
    const size = slot.size ?? {};
    const setOff = (k: "l" | "t" | "r" | "b", v: number | undefined) =>
      onChange({ offset: { ...off, [k]: v } });
    const sized = size.w !== undefined || size.h !== undefined;
    return (
      <div className="axv-slot">
        <div className="axv-set-label">
          {tt("这一层 · 第 {n} 层", { n: String(index + 1) })}
        </div>

        {onNodeChange && child ? <RefField node={child} onChange={onNodeChange} /> : null}

        <div className="axv-slot-grid">
          {EDGES.map((e) => (
            <NumBox
              key={e.k}
              label={`${e.label}偏移`}
              value={off[e.k]}
              onChange={(v) => setOff(e.k, v)}
              placeholder="0"
              emptyValue={0}
            />
          ))}
        </div>

        <div className="axv-slot-grid">
          <NumBox
            label="宽"
            value={size.w}
            onChange={(v) => onChange({ size: { ...size, w: v } })}
            emptyValue={undefined}
          />
          <NumBox
            label="高"
            value={size.h}
            onChange={(v) => onChange({ size: { ...size, h: v } })}
            emptyValue={undefined}
          />
        </div>

        <div className="axv-shape-field">
          <label className="axv-shape-label">{tt("对齐")}</label>
          <select
            className="axv-attr-input"
            value={slot.gravity ?? ""}
            onChange={(e) => onChange({ gravity: e.target.value || undefined })}
          >
            {GRAVITY.map((g) => (
              <option key={g.v} value={g.v}>
                {tt(g.label)}
              </option>
            ))}
          </select>
        </div>
        {slot.gravity && !sized ? (
          <div className="axv-shape-hint">{tt("先设宽或高，对齐才看得出来（不设尺寸时这一层填满父级）")}</div>
        ) : null}

        <AlphaField value={slot.alpha} onChange={(v) => onChange({ alpha: v })} />

        <div className="axv-shape-hint">
          {tt("偏移量不会缩小这一层自己的绘制范围；要留边请内缩上层或给下层加宽高。")}
        </div>
      </div>
    );
  }

  if (parent.t === "selector") {
    const states = slot.states ?? {};
    const setState = (key: string, v: string | undefined) => {
      const next: Record<string, string | undefined> = { ...states, [key]: v };
      onChange({ states: next });
    };
    return (
      <div className="axv-slot">
        <div className="axv-set-label">{tt("这个状态生效的条件")}</div>
        {onNodeChange && child ? <RefField node={child} onChange={onNodeChange} /> : null}
        {STATES.map((s) => {
          const cur = states[s.key];
          const val = cur === "true" ? "on" : cur === "false" ? "off" : "any";
          return (
            <div key={s.key} className="axv-slot-state">
              <span className="axv-shape-label">{tt(s.label)}</span>
              <div className="axv-shape-seg">
                {(["any", "on", "off"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={"axv-shape-seg-btn" + (val === v ? " is-on" : "")}
                    onClick={() =>
                      setState(s.key, v === "any" ? undefined : v === "on" ? "true" : "false")
                    }
                  >
                    {v === "any" ? tt("不设") : v === "on" ? tt("是") : tt("否")}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
        <div className="axv-shape-hint">
          {Object.keys(states).length === 0
            ? tt("所有条件都不设 = 兜底状态（其它状态都没命中时用它）")
            : tt("按顺序取第一个所有条件都成立的状态；条件越少越容易被命中。")}
        </div>
        <div className="axv-shape-hint">
          {tt("去预览下方切换这些状态，看这个条件命中时画的是哪一支。")}
        </div>
      </div>
    );
  }

  if (parent.t === "ripple") {
    return (
      <div className="axv-slot">
        <div className="axv-set-label">
          {index === 1 ? tt("遮罩层") : tt("内容层")}
        </div>
        {onNodeChange && child ? <RefField node={child} onChange={onNodeChange} /> : null}
        <div className="axv-shape-hint">
          {index === 1
            ? tt("遮罩只决定波纹被裁成什么形状，自己不绘制。")
            : tt("波纹的内容层，按下时在它上面叠一层颜色。")}
        </div>
      </div>
    );
  }

  return null;
}
