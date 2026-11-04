"use client";

// components/drawable/TransformTabs.tsx — 变换 4 tab（M127）
//
// 内缩 / 裁剪 / 缩放 / 旋转：每个 tab = 该种变换的参数，
// 已添加的变换在 tab 上有圆点标记，未添加的显示「添加」按钮。
// 顺序 = 原文嵌套顺序（外→内），tab 上不给移动按钮，
// 增删时按默认顺序「内缩 → 裁剪 → 缩放 → 旋转」插入/删除。

import { useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import type { DrawableNode, Transform, TransformKind } from "@/lib/xml/drawable-node";
import { dpIn, dpOut } from "@/lib/xml/drawable-attrs";

const KINDS: { kind: TransformKind; label: string; icon: string }[] = [
  { kind: "inset", label: "内缩", icon: "crop_free" },
  { kind: "clip", label: "裁剪", icon: "crop" },
  { kind: "scale", label: "缩放", icon: "aspect_ratio" },
  { kind: "rotate", label: "旋转", icon: "rotate_right" },
];

interface Props {
  node: DrawableNode;
  onChange: (next: DrawableNode) => void;
}

export function TransformTabs({ node, onChange }: Props) {
  const chain = (node as { transform?: Transform[] }).transform ?? [];
  const has = (k: TransformKind) => chain.some((t) => t.kind === k);
  const [tab, setTab] = useState<TransformKind>(has("inset") ? "inset" : has("clip") ? "clip" : has("scale") ? "scale" : "rotate");

  const setTransforms = (next: Transform[]) =>
    onChange({ ...node, transform: next.length ? next : undefined } as DrawableNode);

  const add = (k: TransformKind) => {
    if (has(k)) return;
    const params: Record<string, string> =
      k === "inset"
        ? { insetLeft: "0dp", insetTop: "0dp", insetRight: "0dp", insetBottom: "0dp" }
        : k === "clip"
          ? { clipOrientation: "horizontal", gravity: "center" }
          : k === "scale"
            ? { scaleWidth: "100%", scaleHeight: "100%", scaleGravity: "center" }
            : { fromDegrees: "0", toDegrees: "360", pivotX: "50%", pivotY: "50%" };
    // 按默认顺序插入
    const order: TransformKind[] = ["inset", "clip", "scale", "rotate", "animated-rotate"];
    const idx = order.indexOf(k);
    const next = [...chain];
    next.splice(idx, 0, { kind: k, params });
    setTransforms(next);
  };

  const remove = (k: TransformKind) => {
    const next = chain.filter((t) => t.kind !== k);
    setTransforms(next);
  };

  const update = (k: TransformKind, patch: Record<string, string>) => {
    const next = chain.map((t) => (t.kind === k ? { ...t, params: { ...t.params, ...patch } } : t));
    setTransforms(next);
  };

  const active = has(tab) ? chain.find((t) => t.kind === tab) : undefined;
  const setParam = (k: TransformKind, key: string, value: string) =>
    update(k, { [key]: value });

  const pctIn = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? `${n}` : "0";
  };
  const numIn = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? String(n) : "0";
  };

  return (
    <div className="axv-transform-tabs">
      <div className="axv-transform-tab-row">
        {KINDS.map(({ kind, label, icon }) => (
          <button
            key={kind}
            type="button"
            className={"axv-transform-tab" + (tab === kind ? " on" : "") + (has(kind) ? " has" : "")}
            aria-label={tt(label)}
            title={tt(label)}
            onClick={() => setTab(kind)}
          >
            <span className="msr" aria-hidden="true" style={{ fontSize: 15 }}>
              {icon}
            </span>
            <span>{tt(label)}</span>
            {has(kind) ? <span className="axv-transform-dot" /> : null}
          </button>
        ))}
      </div>

      <div className="axv-transform-body">
        {!active ? (
          <button
            type="button"
            className="axv-btn axv-ghost axv-transform-add"
            onClick={() => add(tab)}
          >
            {tt("添加「{name}」", { name: KINDS.find((k) => k.kind === tab)?.label ?? tab })}
          </button>
        ) : (
          <div className="axv-transform-params">
            {tab === "inset" ? (
              <div className="axv-transform-grid">
                {(
                  [
                    ["insetLeft", "左"],
                    ["insetTop", "上"],
                    ["insetRight", "右"],
                    ["insetBottom", "下"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="axv-transform-field">
                    <span>{tt(label)}</span>
                    <input
                      className="axv-attr-input"
                      inputMode="decimal"
                      defaultValue={active.params[key] ?? "0"}
                      onBlur={(e) => setParam(tab, key, e.target.value.trim() || "0dp")}
                      onKeyUp={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      placeholder="4dp"
                    />
                  </label>
                ))}
              </div>
            ) : null}

            {tab === "clip" ? (
              <div className="axv-transform-grid">
                <label className="axv-transform-field">
                  <span>{tt("方向")}</span>
                  <select
                    className="axv-attr-input"
                    value={active.params["clipOrientation"] ?? "horizontal"}
                    onChange={(e) => setParam(tab, "clipOrientation", e.target.value)}
                  >
                    <option value="horizontal">{tt("水平")}</option>
                    <option value="vertical">{tt("垂直")}</option>
                  </select>
                </label>
                <label className="axv-transform-field">
                  <span>{tt("对齐")}</span>
                  <select
                    className="axv-attr-input"
                    value={active.params["gravity"] ?? "center"}
                    onChange={(e) => setParam(tab, "gravity", e.target.value)}
                  >
                    {["center", "top", "bottom", "left", "right"].map((g) => (
                      <option key={g} value={g}>
                        {tt({
                          center: "居中",
                          top: "上",
                          bottom: "下",
                          left: "左",
                          right: "右",
                        }[g] as string)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {tab === "scale" ? (
              <div className="axv-transform-grid">
                {(
                  [
                    ["scaleWidth", "宽"],
                    ["scaleHeight", "高"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="axv-transform-field">
                    <span>{tt(label)}（%）</span>
                    <input
                      className="axv-attr-input"
                      inputMode="decimal"
                      defaultValue={active.params[key] ?? "100%"}
                      onBlur={(e) => {
                        const v = e.target.value.replace(/%/g, "");
                        const n = parseFloat(v);
                        setParam(tab, key, `${Number.isFinite(n) ? n : 100}%`);
                      }}
                      onKeyUp={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      placeholder="50%"
                    />
                  </label>
                ))}
                <label className="axv-transform-field">
                  <span>{tt("基点")}</span>
                  <select
                    className="axv-attr-input"
                    value={active.params["scaleGravity"] ?? "center"}
                    onChange={(e) => setParam(tab, "scaleGravity", e.target.value)}
                  >
                    {["center", "top", "bottom", "left", "right"].map((g) => (
                      <option key={g} value={g}>
                        {tt({
                          center: "居中",
                          top: "上",
                          bottom: "下",
                          left: "左",
                          right: "右",
                        }[g] as string)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}

            {tab === "rotate" ? (
              <div className="axv-transform-grid">
                {(
                  [
                    ["fromDegrees", "起始角"],
                    ["toDegrees", "结束角"],
                    ["pivotX", "轴心 X"],
                    ["pivotY", "轴心 Y"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="axv-transform-field">
                    <span>{tt(label)}</span>
                    <input
                      className="axv-attr-input"
                      inputMode="decimal"
                      defaultValue={active.params[key] ?? "0"}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const n = parseFloat(raw);
                        if (key === "pivotX" || key === "pivotY") {
                          setParam(tab, key, raw.endsWith("%") || raw === "" ? raw || "50%" : `${n || 50}%`);
                        } else {
                          setParam(tab, key, Number.isFinite(n) ? String(n) : "0");
                        }
                      }}
                      onKeyUp={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      placeholder={key === "pivotX" || key === "pivotY" ? "50%" : "0"}
                    />
                  </label>
                ))}
              </div>
            ) : null}

            <button
              type="button"
              className="axv-btn axv-ghost axv-transform-remove"
              onClick={() => remove(tab)}
            >
              {tt("移除「{name}」", { name: KINDS.find((k) => k.kind === tab)?.label ?? tab })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export { KINDS as TRANSFORM_KINDS };
