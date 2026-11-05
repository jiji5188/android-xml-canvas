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
import { filterNumber } from "@/lib/xml/num-input";
import { ColorField } from "../ColorField";

export function AttrRows({
  node,
  onChange,
  refNames,
}: {
  node: DrawableNode;
  onChange: (next: DrawableNode) => void;
  /** M136：已有 drawable 资源名（给「引用资源」提供可点的候选，不用手打） */
  refNames?: string[];
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
          refNames={refNames}
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
  refNames,
}: {
  def: AttrDef;
  value: string;
  refNames?: string[];
  onChange: (v: string) => void;
}) {
  const id = useId();

  // M136：引用型属性（<item android:drawable="@drawable/x"/>）——以前只能手打资源名，
  // 打错要到导出才被发现。这里给候选列表，点一下即填；输入框仍然保留随时改名。
  if (def.type === "reference") {
    const short = value.replace(/^@(drawable|mipmap|color)\//, "");
    const names = (refNames ?? []).filter(Boolean);
    return (
      <div className="axv-shape-field">
        <label className="axv-shape-label" htmlFor={id}>
          {tt(def.label)}
        </label>
        <div className="axv-attr-num">
          <span className="axv-attr-suffix">@drawable/</span>
          <input
            id={id}
            className="axv-attr-input"
            value={short}
            spellCheck={false}
            placeholder={tt("资源名")}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
        {names.length > 0 ? (
          <div className="axv-ref-picks">
            {names.slice(0, 40).map((n) => (
              <button
                key={n}
                type="button"
                className={"axv-ref-pick" + (n === short ? " is-on" : "")}
                onClick={() => onChange(`@drawable/${n}`)}
                title={`@drawable/${n}`}
              >
                {n}
              </button>
            ))}
          </div>
        ) : null}
        <div className="axv-shape-hint">
          {short
            ? tt("引用已有资源时会写成 <item android:drawable=\"@drawable/名称\"/>，图内容由那个文件决定。")
            : tt("没填资源名 = 空引用，导出会报错；点下面的候选或手打名称。")}
        </div>
      </div>
    );
  }

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
            // M136：过滤非数字字符，且允许删成空（以前删到最后一位会被 value 顶回来）
            const raw = filterNumber(e.target.value, true).trim();
            if (!raw || raw === "-" || raw === ".") {
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
