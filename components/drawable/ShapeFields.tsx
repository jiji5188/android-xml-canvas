"use client";

// components/drawable/ShapeFields.tsx — 单个 <shape> 叶子的完整参数面板（M122）
//
// 为什么单独一个组件：结构树里选中形状后要给完整的能力（填充/渐变/圆角/描边/尺寸/内边距），
// 但 DrawableEditor 只负责树与保存，不应该把形状字段写死在页面里。
// 这里只改 ShapeSpec，不改 XML —— 预览与保存都走同一个树。

import type { ShapeSpec } from "@/lib/xml/shape-gen";
import { ColorField } from "@/components/ColorField";
import { parseColorOr, toAndroidHex } from "@/lib/xml/color-argb";
import { t as tt } from "@/lib/i18n-src";

type Spec = ShapeSpec;
type Up = (next: Spec) => void;

const KIND_LABEL: Record<string, string> = {
  rectangle: "矩形",
  oval: "椭圆",
  ring: "环形",
  line: "线条",
};

const GRAD_LABEL: Record<string, string> = {
  linear: "线性",
  radial: "径向",
  sweep: "扫描",
};

/** 数字输入：空串 = 未设置（不写进 XML） */
function NumField({
  label,
  value,
  onChange,
  suffix = "dp",
  placeholder,
  min = 0,
  step = 1,
}: {
  label: string;
  value: number | undefined;
  onChange: (v: number | undefined) => void;
  suffix?: string;
  placeholder?: string;
  min?: number;
  step?: number;
}) {
  return (
    <div className="axv-shape-field">
      <label className="axv-shape-label">{tt(label)}</label>
      <div className="axv-attr-num">
        <input
          className="axv-attr-input"
          value={value === undefined ? "" : String(value)}
          inputMode="decimal"
          placeholder={placeholder ?? "–"}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (!raw) {
              onChange(undefined);
              return;
            }
            const n = parseFloat(raw);
            onChange(Number.isFinite(n) ? Math.max(min, n) : undefined);
          }}
        />
        <span className="axv-attr-suffix">{suffix}</span>
      </div>
      <span hidden>{step}</span>
    </div>
  );
}

/** 颜色 + 手写十六进制，两栏一起给（取色器选完能把值写回输入框） */
function ColorRow({
  label,
  value,
  onChange,
  fallback = "#00000000",
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  fallback?: string;
}) {
  return (
    <div className="axv-shape-field">
      <label className="axv-shape-label">{tt(label)}</label>
      <div className="axv-attr-color">
        <ColorField
          label={tt(label)}
          value={value || fallback}
          fallback={fallback}
          onChange={(css) => onChange(toAndroidHex(parseColorOr(css, fallback)))}
          aboveModal
        />
        <input
          className="axv-attr-input"
          value={value ?? ""}
          spellCheck={false}
          placeholder="#AARRGGBB"
          onChange={(e) => onChange(e.target.value.trim() || undefined)}
        />
      </div>
    </div>
  );
}

export function ShapeFields({ spec, onChange }: { spec: Spec; onChange: Up }) {
  const grad = spec.gradient;
  const stroke = spec.stroke;
  const corners = spec.corners;
  const pad = spec.padding ?? {};
  const setPad = (k: "l" | "t" | "r" | "b", v: number | undefined) => {
    const next = { ...pad, [k]: v };
    const empty = !next.l && !next.t && !next.r && !next.b;
    onChange({ ...spec, padding: empty ? undefined : next });
  };

  return (
    <div className="axv-dw-quick">
      <div className="axv-set-label">{tt("形状")}</div>

      {spec.kind !== "line" ? (
        <>
          <div className="axv-shape-field">
            <label className="axv-shape-label">{tt("填充")}</label>
            <div className="axv-shape-seg">
              {[
                { v: false, label: "纯色" },
                { v: true, label: "渐变" },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  className={"axv-shape-seg-btn" + ((!!grad === o.v) ? " is-on" : "")}
                  onClick={() =>
                    onChange(
                      o.v
                        ? {
                            ...spec,
                            gradient: grad ?? {
                              type: "linear",
                              start: spec.solid ?? "#FF888888",
                              end: "#FF222222",
                              angle: 90,
                            },
                          }
                        : { ...spec, gradient: undefined, solid: spec.solid ?? grad?.start ?? "#FF3B82F6" },
                    )
                  }
                >
                  {tt(o.label)}
                </button>
              ))}
            </div>
          </div>

          {grad ? (
            <>
              <div className="axv-shape-field">
                <label className="axv-shape-label">{tt("渐变方向")}</label>
                <div className="axv-shape-seg">
                  {(["linear", "radial", "sweep"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={"axv-shape-seg-btn" + (grad.type === t ? " is-on" : "")}
                      onClick={() => onChange({ ...spec, gradient: { ...grad, type: t } })}
                    >
                      {tt(GRAD_LABEL[t])}
                    </button>
                  ))}
                </div>
              </div>
              <ColorRow
                label="起始色"
                value={grad.start}
                onChange={(v) => v && onChange({ ...spec, gradient: { ...grad, start: v } })}
              />
              <ColorRow
                label="结束色"
                value={grad.end}
                onChange={(v) => v && onChange({ ...spec, gradient: { ...grad, end: v } })}
              />
              {grad.type === "radial" ? (
                <ColorRow
                  label="中心色"
                  value={grad.center}
                  onChange={(v) => onChange({ ...spec, gradient: { ...grad, center: v } })}
                />
              ) : null}
              {grad.type === "linear" ? (
                <NumField
                  label="角度"
                  suffix="°"
                  value={grad.angle}
                  placeholder="90"
                  onChange={(v) => onChange({ ...spec, gradient: { ...grad, angle: v } })}
                />
              ) : null}
            </>
          ) : (
            <ColorRow
              label="填充色"
              value={spec.solid}
              onChange={(v) => onChange({ ...spec, solid: v })}
              fallback="#FF3B82F6"
            />
          )}
        </>
      ) : null}

      {spec.kind === "ring" ? (
        <NumField
          label="环宽比例"
          suffix="%"
          value={spec.ringHole === undefined ? undefined : Math.round(spec.ringHole * 100)}
          placeholder="40"
          onChange={(v) => onChange({ ...spec, ringHole: v === undefined ? undefined : Math.min(0.95, v / 100) })}
        />
      ) : null}

      {spec.kind === "rectangle" ? (
        <>
          <div className="axv-shape-field">
            <label className="axv-shape-label">{tt("圆角")}</label>
            <div className="axv-shape-seg">
              {[
                { v: false, label: "统一" },
                { v: true, label: "四角独立" },
              ].map((o) => (
                <button
                  key={String(o.v)}
                  type="button"
                  className={"axv-shape-seg-btn" + ((!!corners === o.v) ? " is-on" : "")}
                  onClick={() => {
                    if (o.v) {
                      const r = spec.radius ?? 0;
                      onChange({ ...spec, radius: undefined, corners: { tl: r, tr: r, br: r, bl: r } });
                    } else {
                      const r = corners?.tl ?? spec.radius ?? 0;
                      onChange({ ...spec, corners: undefined, radius: r });
                    }
                  }}
                >
                  {tt(o.label)}
                </button>
              ))}
            </div>
          </div>
          {corners ? (
            <div className="axv-dw-grid2">
              <NumField
                label="左上"
                value={corners.tl}
                onChange={(v) => onChange({ ...spec, corners: { ...corners, tl: v ?? 0 } })}
              />
              <NumField
                label="右上"
                value={corners.tr}
                onChange={(v) => onChange({ ...spec, corners: { ...corners, tr: v ?? 0 } })}
              />
              <NumField
                label="右下"
                value={corners.br}
                onChange={(v) => onChange({ ...spec, corners: { ...corners, br: v ?? 0 } })}
              />
              <NumField
                label="左下"
                value={corners.bl}
                onChange={(v) => onChange({ ...spec, corners: { ...corners, bl: v ?? 0 } })}
              />
            </div>
          ) : (
            <NumField
              label="圆角"
              value={spec.radius}
              placeholder="0"
              onChange={(v) => onChange({ ...spec, radius: v ?? 0 })}
            />
          )}
        </>
      ) : null}

      {/* 描边：line 形状必须有，其它可选 */}
      <div className="axv-shape-field">
        <label className="axv-shape-label">{tt("描边")}</label>
        <div className="axv-shape-seg">
          {[
            { v: false, label: "无" },
            { v: true, label: "有" },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              className={"axv-shape-seg-btn" + ((!!stroke === o.v) ? " is-on" : "")}
              onClick={() =>
                onChange(
                  o.v
                    ? { ...spec, stroke: stroke ?? { width: 1, color: "#FFDDDDDD" } }
                    : { ...spec, stroke: undefined },
                )
              }
            >
              {tt(o.label)}
            </button>
          ))}
        </div>
      </div>
      {stroke ? (
        <>
          <NumField
            label="描边宽度"
            value={stroke.width}
            placeholder="1"
            onChange={(v) => onChange({ ...spec, stroke: { ...stroke, width: v ?? 1 } })}
          />
          <ColorRow
            label="描边色"
            value={stroke.color}
            onChange={(v) => onChange({ ...spec, stroke: { ...stroke, color: v ?? "#FFDDDDDD" } })}
            fallback="#FFDDDDDD"
          />
          <div className="axv-dw-grid2">
            <NumField
              label="虚线宽"
              value={stroke.dashWidth}
              onChange={(v) => onChange({ ...spec, stroke: { ...stroke, dashWidth: v } })}
            />
            <NumField
              label="虚线间隔"
              value={stroke.dashGap}
              onChange={(v) => onChange({ ...spec, stroke: { ...stroke, dashGap: v } })}
            />
          </div>
        </>
      ) : null}

      <div className="axv-set-label">{tt("尺寸与留白")}</div>
      <div className="axv-dw-grid2">
        <NumField
          label="宽"
          value={spec.size?.w}
          onChange={(v) => onChange({ ...spec, size: v || spec.size?.h ? { w: v, h: spec.size?.h } : undefined })}
        />
        <NumField
          label="高"
          value={spec.size?.h}
          onChange={(v) => onChange({ ...spec, size: v || spec.size?.w ? { w: spec.size?.w, h: v } : undefined })}
        />
      </div>
      <div className="axv-dw-grid2">
        <NumField label="内边距左" value={pad.l} onChange={(v) => setPad("l", v)} />
        <NumField label="内边距上" value={pad.t} onChange={(v) => setPad("t", v)} />
        <NumField label="内边距右" value={pad.r} onChange={(v) => setPad("r", v)} />
        <NumField label="内边距下" value={pad.b} onChange={(v) => setPad("b", v)} />
      </div>

      <div className="axv-dw-hint">
        {tt("当前形状：{kind}。想换成别的形状，回到「结构」页改形状类型。", {
          kind: tt(KIND_LABEL[spec.kind] ?? spec.kind),
        })}
      </div>
    </div>
  );
}
