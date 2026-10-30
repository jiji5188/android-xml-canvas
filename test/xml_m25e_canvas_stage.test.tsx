// test/xml_m25e_canvas_stage.test.tsx — 画布舞台（M25e 从 XmlEditor 抽出）契约测试
// 同 m25c/m25d：直接调组件函数拿元素树，不用 jsdom/RTL。
import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import { createRef } from "react";
import { CanvasStage, type CanvasStageProps } from "../components/CanvasStage";

type El = { type: unknown; props: Record<string, unknown> };

function collect(node: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) collect(n as ReactNode, out);
    return out;
  }
  if (!isValidElement(node)) return out;
  const el = node as unknown as El;
  out.push(el);
  const kids = (el.props as { children?: ReactNode }).children;
  if (kids !== undefined) collect(kids, out);
  return out;
}

const cls = (el: El): string => String((el.props as { className?: string }).className ?? "");

function props(over: Partial<CanvasStageProps> = {}): CanvasStageProps {
  return {
    active: true,
    leftOpen: false,
    rightOpen: false,
    stageRef: createRef<HTMLDivElement>(),
    phoneRef: createRef<HTMLDivElement>(),
    tr: (_k, f) => f,
    gotoLine: vi.fn(),
    zoomHud: null,
    outerW: 360,
    outerH: 720,
    fitRatio: 1,
    DPX: 2,
    radius: 28,
    phoneBg: "#fff",
    phoneFg: "#000",
    showSystemBars: true,
    STATUS_BAR_H: 48,
    NAV_BAR_H: 96,
    dropHint: null,
    onDropHint: vi.fn(),
    onDrop: vi.fn(),
    model: null,
    parsedXml: "<LinearLayout/>",
    issues: [],
    showIssues: true,
    parseErr: false,
    parseReason: "",
    lintErrCount: 0,
    exportNote: "",
    selectedPath: null,
    onSelectPath: vi.fn(),
    onDropWidget: vi.fn(),
    onConstraintDraw: vi.fn(),
    onGeometryChange: vi.fn(),
    isPathLocked: () => false,
    ...over,
  };
}

describe("CanvasStage", () => {
  it("不在预览 tab 时整块不渲染", () => {
    expect(CanvasStage(props({ active: false }))).toBeNull();
  });

  it("两侧面板都收起时舞台不加 padding", () => {
    const els = collect(CanvasStage(props()));
    const stage = els.find((e) => cls(e) === "axv-stage");
    expect(stage).toBeTruthy();
  });

  it("面板展开时加 pad-l / pad-r", () => {
    const els = collect(CanvasStage(props({ leftOpen: true, rightOpen: true })));
    const stage = els.find((e) => cls(e).includes("axv-stage")) as El;
    expect(cls(stage)).toContain("pad-l");
    expect(cls(stage)).toContain("pad-r");
  });

  it("解析失败时显示失败卡片，且不渲染手机外壳", () => {
    const els = collect(CanvasStage(props({ parseErr: true, parseReason: "标签没闭合" })));
    expect(els.some((e) => cls(e).includes("axv-parse-fail"))).toBe(true);
    expect(els.some((e) => cls(e).includes("axv-phone"))).toBe(false);
  });

  it("有结构问题但能渲染时显示黄色告警条", () => {
    const els = collect(CanvasStage(props({ lintErrCount: 3 })));
    expect(els.some((e) => cls(e).includes("axv-struct-warn"))).toBe(true);
  });

  it("缩放中显示百分比气泡", () => {
    const els = collect(CanvasStage(props({ zoomHud: 1.25 })));
    const hud = els.find((e) => cls(e).includes("axv-zoom-hud")) as El;
    expect(hud).toBeTruthy();
    expect(JSON.stringify(hud.props.children)).toContain("125");
  });

  it("拖到手机上时外壳高亮", () => {
    const model = { root: { tag: "LinearLayout", path: "root", children: [] } } as never;
    const els = collect(CanvasStage(props({ dropHint: "drop", model })));
    const phone = els.find((e) => cls(e).includes("axv-phone")) as El;
    expect(phone).toBeTruthy();
    expect(cls(phone)).toContain("axv-drop-target");
  });
});
