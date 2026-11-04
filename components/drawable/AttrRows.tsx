"use client";

// components/drawable/AttrRows.tsx — schema 驱动的属性行（M121）
//
// 不在这里判断"这是 ripple 所以显示波纹色"：属性显示什么、用什么控件，
// 全由 drawable-schema 的属性表 + drawable-attrs 的读写适配决定。
// 以后加新标签，只要在 schema 里登记 + 补一个适配，这里零改动。

import { useId } from "react";
import { t as tt } from "@/lib/i18n-src";
import { parseColorOr, toAndroidHex } from "@/lib/xml/color-argb";
import type { AttrDef } from "@/lib/xml/drawable-schema";
import type { DrawableNode } from "@/lib/xml/drawable-node";
import { editableAttrs, readAttr, writeAttr } from "@/lib/xml/drawable-attrs";
import { ColorField } from "../ColorField";

export function AttrRows({
  node,
  onChange,
}: {
  node: DrawableNode;
  onChange: (next: DrawableNode) => void;
}) {
  const attrs = editableAttrs(node);
  if (attrs.length === 0) {
    return <div className="axv-shape-hint">{tt("这个节点没有可调参数，往下加点内容吧")}</div>;
  }
  return (
    <div className="axv-attr-rows">
      {attrs.map((def) => (
        <AttrRow
          key={def.name}
          def={def}
          value={readAttr(node, def.name) ?? ""}
          onChange={(v) => onChange(writeAttr(node, def.name, v))}
        />
      ))}
    </div>
  );
}

const ENUM_LABEL: Record<string, string> = {
  rectangle: "矩形",
  oval: "椭圆",
  ring: "环形",
  line: "线条",
  center: "居中",
  center_vertical: "垂直居中",
  center_horizontal: "水平居中",
  top: "上",
  bottom: "下",
  left: "左",
  right: "右",
  fill: "填满",
  horizontal: "水平",
  vertical: "垂直",
};

const enumLabel = (v: string) => (ENUM_LABEL[v] ? tt(ENUM_LABEL[v]) : tt(v));

function AttrRow({
  def,
  value,
  onChange,
}: {
  def: AttrDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();

  if (def.type === "enum" && def.values?.length) {
    return (
      <div className="axv-shape-field">
        <label className="axv-shape-label">{tt(def.label)}</label>
        <div className="axv-shape-seg">
          {def.values.map((v) => (
            <button
              key={v}
              type="button"
              className={"axv-shape-seg-btn" + (value === v ? " is-on" : "")}
              onClick={() => onChange(v)}
            >
              {enumLabel(v)}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (def.type === "boolean") {
    return (
      <div className="axv-shape-field">
        <label className="axv-shape-label" htmlFor={id}>
          {tt(def.label)}
        </label>
        <button
          id={id}
          type="button"
          role="switch"
          aria-checked={value === "true"}
          className={"axv-switch" + (value === "true" ? " is-on" : "")}
          onClick={() => onChange(value === "true" ? "" : "true")}
        >
          <span className="axv-switch-dot" />
        </button>
      </div>
    );
  }

  if (def.type === "color") {
    return (
      <div className="axv-shape-field">
        <label className="axv-shape-label">{tt(def.label)}</label>
        <div className="axv-attr-color">
          <ColorField
            label={tt(def.label)}
            value={value || "#00000000"}
            fallback="#00000000"
            onChange={(css) => onChange(toAndroidHex(parseColorOr(css, "#00000000")))}
            aboveModal
          />
          <input
            className="axv-attr-input"
            value={value}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#AARRGGBB"
          />
        </div>
        {def.note ? <div className="axv-shape-hint">{tt(def.note)}</div> : null}
      </div>
    );
  }

  const suffix = def.type === "dimension" ? "dp" : def.type === "percent" ? "%" : "";
  return (
    <div className="axv-shape-field">
      <label className="axv-shape-label" htmlFor={id}>
        {tt(def.label)}
      </label>
      <div className="axv-attr-num">
        <input
          id={id}
          className="axv-attr-input"
          value={stripUnit(value)}
          spellCheck={false}
          inputMode="decimal"
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onChange("");
              return;
            }
            onChange(suffix === "dp" ? `${raw}dp` : suffix === "%" ? `${raw}%` : raw);
          }}
          placeholder={def.default ? String(def.default) : ""}
        />
        {suffix ? <span className="axv-attr-suffix">{suffix}</span> : null}
      </div>
      {def.note ? <div className="axv-shape-hint">{tt(def.note)}</div> : null}
    </div>
  );
}

function stripUnit(v: string): string {
  return v.replace(/\s*(dp|dip|px|sp|%)$/i, "");
}
