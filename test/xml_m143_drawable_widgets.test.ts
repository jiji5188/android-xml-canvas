// M143：drawable 预设（含控件样式）+ @drawable 图片引用预览
import { describe, expect, it } from "vitest";
import { DRAWABLE_PRESETS, presetById } from "@/lib/xml/drawable-presets";
import { parseDrawable, flattenDrawable } from "@/lib/xml/drawable-node";
import { buildDrawable } from "@/lib/xml/drawable-build";

describe("M143 drawable 预设", () => {
  it("每条预设都能被解析器吃进来（否则用户点了就等于损坏文档）", () => {
    for (const p of DRAWABLE_PRESETS) {
      const tree = parseDrawable(p.xml);
      expect(tree, p.id).not.toBeNull();
    }
  });

  it("解析后重新写出，语义不丢（根标签与状态位都在）", () => {
    for (const p of DRAWABLE_PRESETS) {
      const tree = parseDrawable(p.xml)!;
      const out = buildDrawable(tree);
      const again = parseDrawable(out);
      expect(again, p.id).not.toBeNull();
      expect(buildDrawable(again!), p.id).toBe(out);
    }
  });

  it("控件样式都被标了 group=widget，且覆盖滑块/进度/输入框/复选/单选/开关/列表项", () => {
    const ids = DRAWABLE_PRESETS.filter((p) => p.group === "widget").map((p) => p.id);
    for (const id of [
      "seekbar-track",
      "seekbar-thumb",
      "progress-bar",
      "input-field",
      "checkbox",
      "radio",
      "switch-track",
      "list-item",
    ]) {
      expect(ids, id).toContain(id);
    }
    // 基础样式不受影响
    expect(presetById("card")?.group ?? "base").toBe("base");
  });

  it("输入框预设能切出「聚焦态」，复选框能手切「勾选态」", () => {
    const input = parseDrawable(presetById("input-field")!.xml)!;
    const focused = flattenDrawable(input, { state: { focused: true } });
    const normal = flattenDrawable(input, { state: { focused: false } });
    expect(focused.length).toBe(1);
    expect(focused[0].spec?.stroke?.width).toBe(2);
    expect(normal[0].spec?.stroke?.width).toBe(1);

    const cb = parseDrawable(presetById("checkbox")!.xml)!;
    const on = flattenDrawable(cb, { state: { checked: true } });
    const off = flattenDrawable(cb, { state: { checked: false } });
    expect(on[0].spec?.solid).toContain("3B82F6");
    expect(off[0].spec?.solid).toContain("FFFFFF");
  });

  it("滑块轨道是两层（轨道 + 进度），厚度来自 <size>", () => {
    const track = parseDrawable(presetById("seekbar-track")!.xml)!;
    const layers = flattenDrawable(track, {});
    expect(layers.length).toBe(2);
    expect(layers[0].kind).toBe("shape");
    expect(layers[0].size?.h).toBe(4);
    expect(layers[1].spec?.solid).toContain("3B82F6");
  });
});

describe("M143 @drawable 引用解析", () => {
  const doc = parseDrawable(`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape>
    </item>
    <item android:drawable="@drawable/logo"/>
    <item android:drawable="@drawable/inner"/>
</layer-list>`)!;

  it("图片资源（png/svg）→ 生成 image 层，带 dataUrl", () => {
    const layers = flattenDrawable(doc, {
      resolveImage: (n) => (n === "logo" ? "data:image/png;base64,AAAA" : null),
    });
    const img = layers.find((l) => l.kind === "image");
    expect(img?.dataUrl).toBe("data:image/png;base64,AAAA");
    expect(img?.path).toContain("@drawable/logo");
  });

  it("XML 资源优先于图片（同名时按 drawable 文件展开，而不是当图片贴上去）", () => {
    const layers = flattenDrawable(doc, {
      resolveRef: (n) =>
        n === "inner"
          ? `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#FF112233"/></shape>`
          : null,
      resolveImage: (n) => (n === "inner" ? "data:image/png;base64,BBBB" : null),
    });
    const fromXml = layers.filter((l) => l.kind === "shape" && l.spec?.solid?.includes("112233"));
    expect(fromXml.length).toBe(1);
    expect(layers.some((l) => l.kind === "image")).toBe(false);
  });

  it("两种都读不到 → unsupported 占位（不崩、不静默消失）", () => {
    const layers = flattenDrawable(doc, {});
    expect(layers.filter((l) => l.kind === "unsupported").length).toBe(2);
  });

  it("图片层也吃 item 的宽高与对齐", () => {
    const sized = parseDrawable(`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:width="24dp" android:height="24dp" android:gravity="center" android:drawable="@drawable/logo"/>
</layer-list>`)!;
    const layers = flattenDrawable(sized, { resolveImage: () => "data:image/png;base64,CCCC" });
    expect(layers[0].size).toEqual({ w: 24, h: 24 });
    expect(layers[0].gravity).toBe("center");
  });
});
