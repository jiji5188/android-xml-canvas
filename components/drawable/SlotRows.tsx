"use client";

// components/drawable/SlotRows.tsx — 「这一层」自己的参数（M134）
//
// 结构树里的每一行其实有两个东西：
//   1. 子节点本身（shape / color / ref / 子容器）→ 参数页 / 形状页管
//   2. 父容器给这个位置挂的属性（layer-list 的偏移/宽高/对齐/不透明度、selector 的状态位）
// 以前第 2 类完全没入口：想改 `android:left="2dp"` 只能手写 XML。
// 这里把它们放成参数页第一块「这一层」，选中哪层就改哪层。

import { t as tt } from "@/lib/i18n-src";
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
const STATES: { key: string; label: string }[] = [
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

function NumBox({
  label,
  value,
  onChange,
  placeholder = "–",
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  placeholder?: string;
}) {
  return (
    <div className="axv-shape-field">
      <label className="axv-shape-label">{tt(label)}</label>
      <div className="axv-attr-num">
        <input
          className="axv-attr-input"
          value={value === undefined ? "" : String(value)}
          inputMode="decimal"
          placeholder={placeholder}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onChange(undefined);
              return;
            }
            const n = parseFloat(raw);
            onChange(Number.isFinite(n) ? n : undefined);
          }}
        />
        <span className="axv-attr-suffix">dp</span>
      </div>
    </div>
  );
}

export function SlotRows({
  parent,
  index,
  slot,
  onChange,
}: {
  parent: DrawableNode;
  index: number;
  slot: SlotValue;
  onChange: (patch: Partial<SlotValue>) => void;
}) {
  if (parent.t === "layer") {
    const off = slot.offset ?? {};
    const size = slot.size ?? {};
    const setOff = (k: "l" | "t" | "r" | "b", v: number | undefined) =>
      onChange({ offset: { ...off, [k]: v } });
    return (
      <div className="axv-slot">
        <div className="axv-set-label">
          {tt("这一层 · 第 {n} 层", { n: String(index + 1) })}
        </div>

        <div className="axv-slot-grid">
          {EDGES.map((e) => (
            <NumBox
              key={e.k}
              label={`${e.label}偏移`}
              value={off[e.k]}
              onChange={(v) => setOff(e.k, v)}
              placeholder="0"
            />
          ))}
        </div>

        <div className="axv-slot-grid">
          <NumBox
            label="宽"
            value={size.w}
            onChange={(v) => onChange({ size: { ...size, w: v } })}
          />
          <NumBox
            label="高"
            value={size.h}
            onChange={(v) => onChange({ size: { ...size, h: v } })}
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

        <div className="axv-shape-field">
          <label className="axv-shape-label">{tt("不透明度")}</label>
          <div className="axv-attr-num">
            <input
              className="axv-attr-input"
              value={slot.alpha === undefined ? "" : String(slot.alpha)}
              inputMode="decimal"
              placeholder="1"
              onChange={(e) => {
                const raw = e.target.value.trim();
                if (!raw) {
                  onChange({ alpha: undefined });
                  return;
                }
                const n = parseFloat(raw);
                if (!Number.isFinite(n)) return;
                onChange({ alpha: Math.min(1, Math.max(0, n)) });
              }}
            />
            <span className="axv-attr-suffix">0–1</span>
          </div>
        </div>

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
      </div>
    );
  }

  if (parent.t === "ripple") {
    return (
      <div className="axv-slot">
        <div className="axv-set-label">
          {index === 1 ? tt("遮罩层") : tt("内容层")}
        </div>
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
