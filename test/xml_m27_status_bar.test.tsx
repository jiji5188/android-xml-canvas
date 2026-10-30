// test/xml_m27_status_bar.test.tsx — 底部状态条契约测试
// 做法同 m25h：函数组件直接调用 + 遍历元素树断言，不依赖 jsdom / RTL。

import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { StatusBar, type StatusBarProps } from "../components/StatusBar";

type El = { type: unknown; props: Record<string, any> };

/** 递归收集元素（含嵌套 children） */
function collect(n: ReactNode, out: El[] = []): El[] {
  if (n == null || typeof n === "boolean") return out;
  if (Array.isArray(n)) {
    for (const c of n) collect(c as ReactNode, out);
    return out;
  }
  if (typeof n === "object" && "props" in (n as object)) {
    const el = n as El;
    out.push(el);
    collect(el.props?.children as ReactNode, out);
  }
  return out;
}

/** 元素内的全部文本（字符串叶子拼接，数组也拍平） */
function textOf(n: ReactNode): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  if (typeof n === "object" && "props" in (n as object)) return textOf((n as El).props?.children as ReactNode);
  return "";
}

const base: StatusBarProps = {
  fileName: "activity_main.xml",
  source: "~/android/app/src/main/res/layout",
  deviceLabel: "Pixel 5",
  deviceSize: "393×851",
  scale: 1,
  dirty: false,
  issueCount: 0,
};

function render(over: Partial<StatusBarProps> = {}) {
  const p = { ...base, ...over };
  const tree = StatusBar(p) as unknown as El;
  const all = collect(tree as unknown as ReactNode);
  const full = textOf(tree as unknown as ReactNode);
  const buttons = all.filter((e) => e.type === "button");
  return { p, all, full, buttons };
}

describe("StatusBar", () => {
  it("显示文件名、来源、设备、尺寸、缩放、无问题", () => {
    const { full, all } = render();
    for (const s of ["activity_main.xml", base.source, "Pixel 5", "393×851", "100%", "无问题"]) {      expect(full).toContain(s);
    }
    const dot = all.find((e) => String(e.props.className).includes("axv-sb-dot"))!;
    expect(String(dot.props.className)).not.toContain("on");
    expect(all[0].props["data-dirty"]).toBe("0");
  });

  it("未保存 → data-dirty=1 且圆点点亮", () => {
    const { all } = render({ dirty: true });
    expect(all[0].props["data-dirty"]).toBe("1");
    const dot = all.find((e) => String(e.props.className).includes("axv-sb-dot"))!;
    expect(String(dot.props.className)).toContain("on");
  });

  it("有问题 → 显示数量，点击回调", () => {
    const onIssues = vi.fn();
    const { full, buttons } = render({ issueCount: 3, onIssues });
    expect(full).toContain("3 个问题");
    const btn = buttons.find((b) => String(b.props.className).includes("axv-sb-issue"))!;
    btn.props.onClick();
    expect(onIssues).toHaveBeenCalledTimes(1);
  });

  it("缩放四舍五入显示，点击回 100%", () => {
    const onResetZoom = vi.fn();
    const { full, buttons } = render({ scale: 0.75, onResetZoom });
    expect(full).toContain("75%");
    buttons.find((b) => String(b.props.className).includes("axv-sb-zoom"))!.props.onClick();
    expect(onResetZoom).toHaveBeenCalled();
  });

  it("移动端隐藏来源、设备、保存时间", () => {
    const { full } = render({ isMobile: true, savedHint: "已保存 14:32" });
    expect(full).toContain("activity_main.xml");
    expect(full).not.toContain("Pixel 5");
    expect(full).not.toContain(base.source);
    expect(full).not.toContain("已保存 14:32");
  });

  it("桌面端显示保存时间", () => {
    const { full } = render({ savedHint: "已保存 14:32" });
    expect(full).toContain("已保存 14:32");
  });

  it("设备名已含尺寸时不重复显示尺寸", () => {
    const { full } = render({ deviceLabel: "通用手机 · 412×892", deviceSize: "412×892" });
    // 只出现一次
    expect(full.split("412×892").length - 1).toBe(1);
  });
});
