// test/xml_m136_state_preview.test.tsx — 预览状态模拟（M136）
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { parseDrawable, pickStateItem, type ViewState } from "../lib/xml/drawable-node";
import { collectUsedStates, selectorPicks, DrawablePreview } from "../components/DrawablePreview";

const XML = `<?xml version="1.0" encoding="utf-8"?>
<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_pressed="true">
        <shape><solid android:color="#FF3B82F6"/></shape>
    </item>
    <item android:state_focused="true">
        <shape><solid android:color="#FF10B981"/></shape>
    </item>
    <item android:state_selected="true" android:state_checked="false">
        <shape><solid android:color="#FFF59E0B"/></shape>
    </item>
    <item>
        <shape><solid android:color="#FFDDE3EA"/></shape>
    </item>
</selector>`;

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
};

describe("M136 collectUsedStates", () => {
  it("只收集文档里真正用到的状态位，且按预览开关的固定顺序", () => {
    const doc = parseDrawable(XML)!;
    // 固定顺序是 pressed → focused → hovered → checked → selected …
    expect(collectUsedStates(doc)).toEqual(["pressed", "focused", "checked", "selected"]);
  });

  it("layer-list 没有 selector = 没有任何状态位", () => {
    const doc = parseDrawable(
      `<layer-list><item><shape><solid android:color="#fff"/></shape></item></layer-list>`,
    )!;
    expect(collectUsedStates(doc)).toEqual([]);
  });

  it("嵌套 selector 的状态也要收集到", () => {
    const doc = parseDrawable(
      `<layer-list><item><selector>
        <item android:state_hovered="true"><color android:color="#fff"/></item>
        <item><color android:color="#fff"/></item>
      </selector></item></layer-list>`,
    )!;
    expect(collectUsedStates(doc)).toEqual(["hovered"]);
  });

  it("空文档 / null 不炸", () => {
    expect(collectUsedStates(null)).toEqual([]);
  });
});

describe("M136 selectorPicks", () => {
  const doc = parseDrawable(XML)!;
  const picks = (state: ViewState) => selectorPicks(doc, state);

  it("默认态命中兜底（第 4 项）", () => {
    expect(picks({})).toEqual([{ index: 3, total: 4 }]);
  });

  it("按下命中第 1 项；聚焦命中第 2 项", () => {
    expect(picks({ pressed: true })).toEqual([{ index: 0, total: 4 }]);
    expect(picks({ focused: true })).toEqual([{ index: 1, total: 4 }]);
  });

  it("state_checked=false 要「没勾选」才命中（checked=true 时落到兜底）", () => {
    expect(picks({ selected: true, checked: true })).toEqual([{ index: 3, total: 4 }]);
    expect(picks({ selected: true, checked: false })).toEqual([{ index: 2, total: 4 }]);
  });

  it("没有兜底项且都不命中 → index = -1", () => {
    const noFallback = parseDrawable(
      `<selector>
        <item android:state_pressed="true"><shape><solid android:color="#f00"/></shape></item>
        <item android:state_focused="true"><shape><solid android:color="#0f0"/></shape></item>
      </selector>`,
    )!;
    expect(selectorPicks(noFallback, {})[0]).toEqual({ index: -1, total: 2 });
    const sel = noFallback;
    expect(sel.t === "selector" && pickStateItem(sel.items, {})).toBeNull();
  });

  it("没有 selector 时返回空数组", () => {
    const flat = parseDrawable(`<shape><solid android:color="#fff"/></shape>`)!;
    expect(selectorPicks(flat, {})).toEqual([]);
  });
});

describe("M136 预览状态模拟（UI）", () => {
  it("selector 渲染状态小开关，点开后命中项和画出来的颜色都跟着变", async () => {
    const doc = parseDrawable(XML)!;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<DrawablePreview doc={doc} width={200} height={120} interactive={false} />);
    await flush();

    const chips = () =>
      [...container.querySelectorAll(".axv-dp-chip")].map((c) => c.textContent?.trim());
    const pickText = () => container.querySelector(".axv-dp-pick")?.textContent?.trim() ?? "";
    const layerStyle = () => container.querySelector(".axv-dp-layer")?.getAttribute("style") ?? "";
    const chip = (label: string) =>
      ([...container.querySelectorAll("button.axv-dp-chip")] as HTMLButtonElement[]).find(
        (c) => c.textContent?.trim() === label,
      )!;

    // 默认：四个用到的状态 + 禁用；命中兜底（第 4 项）
    expect(chips()).toEqual(["按下", "聚焦", "勾选", "选中", "禁用"]);
    expect(pickText()).toContain("第 4 项");

    // 点开「聚焦」→ 命中第 2 项，图层变绿
    chip("聚焦").click();
    await flush();
    expect(pickText()).toContain("第 2 项");
    expect(layerStyle()).toContain("16, 185, 129");

    // 再开「选中」：聚焦条件排在前面，仍然命中第 2 项
    chip("选中").click();
    await flush();
    expect(pickText()).toContain("第 2 项");

    // 关掉「聚焦」→ 这次该命中「选中」那条（第 3 项，橙色）
    chip("聚焦").click();
    await flush();
    expect(pickText()).toContain("第 3 项");
    expect(layerStyle()).toContain("245, 158, 11");

    root.unmount();
    container.remove();
  });

  it("没有 selector 的预览保持旧提示条，不画一排空开关", async () => {
    const doc = parseDrawable(
      `<layer-list><item><shape><solid android:color="#fff"/></shape></item></layer-list>`,
    )!;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    root.render(<DrawablePreview doc={doc} width={100} height={80} interactive={false} />);
    await flush();
    expect(container.querySelectorAll(".axv-dp-chip").length).toBe(0);
    expect(container.querySelector(".axv-dp-hint")?.textContent).toContain("点击试效果");
    root.unmount();
    container.remove();
  });
});
