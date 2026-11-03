import { describe, expect, it } from "vitest";
import { buildRenderModel } from "@/lib/xml/css";
import { parseLayoutXml } from "@/lib/xml/parser";
import { DEFAULT_RESOURCES } from "@/lib/xml/resources";
import { parseShapeDrawable } from "@/lib/xml/shape";
import { parseShapeSpec, specToCss } from "@/lib/xml/shape-gen";

/**
 * M91c：预览框 / 资源列表里的「直角矩形」被额外加了圆角
 *
 * 两个来源：
 * 1. `.axv-view` 是「空 View 占位」样式（rgba 底 + 虚线边 + 2px 圆角），
 *    带 android:background 的 View 也吃这套 → 静默多了 2px 圆角 + 虚线边
 * 2. 资源列表缩略图 `.axv-assets-swatch` 写死 `border-radius: 6px`，
 *    而 specToCss 对直角矩形不输出 borderRadius → 一律显 6px 圆角
 */

function build(bg: string, tag = "View") {
  const xml = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="match_parent"
      android:orientation="vertical">
      <${tag}
          android:layout_width="120dp"
          android:layout_height="48dp"${bg ? ` android:background="${bg}"` : ""} />
    </LinearLayout>`;
  const res = {
    ...(DEFAULT_RESOURCES as unknown as Record<string, unknown>),
    drawableXml: {
      bg_sharp: `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#FF3366" /></shape>`,
      bg_round: `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#FF3366" /><corners android:radius="12dp" /></shape>`,
    },
  };
  const m = buildRenderModel(parseLayoutXml(xml).root!, res as never);
  return m.root.children[0];
}

describe("M91c 预览：直角形状不能被补圆角", () => {
  it("解析器：没有 <corners> 就没有 radiusDp / cornersDp", () => {
    const s = parseShapeDrawable(
      `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#FF3366" /></shape>`,
      (b) => b,
    );
    expect(s).toBeTruthy();
    expect(s!.radiusDp).toBeUndefined();
    expect(s!.cornersDp).toBeUndefined();
  });

  it("View + 直角 drawable → borderRadius 0px 且去掉占位虚线边", () => {
    const n = build("@drawable/bg_sharp", "View");
    expect(String(n.style.borderRadius)).toBe("0px");
    expect(String(n.style.border ?? "none")).toBe("none");
    expect(n.style.backgroundColor).toBeTruthy();
  });

  it("View + 12dp 圆角 drawable → 仍然 24px（scale2 下 12dp）", () => {
    const n = build("@drawable/bg_round", "View");
    expect(String(n.style.borderRadius)).toBe("24px");
  });

  it("View + 纯色背景 → 也按直角处理（Android 背景色就是直角矩形）", () => {
    const n = build("#FF3366", "View");
    expect(String(n.style.borderRadius)).toBe("0px");
  });

  it("没有背景的空 View 仍保留占位样式（不能被误清）", () => {
    const n = build("", "View");
    expect(n.style.borderRadius).toBeUndefined();
  });

  it("Button + 直角 drawable → 不落到 20px/4px 默认胶囊圆角", () => {
    const n = build("@drawable/bg_sharp", "Button");
    const r = String(n.style.borderRadius ?? "");
    expect(r).not.toMatch(/20px|4px/);
  });

  it("资源列表缩略图：直角矩形的 specToCss 不输出 borderRadius（靠 CSS 不再硬给圆角）", () => {
    const spec = parseShapeSpec(
      `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#FF3366" /></shape>`,
    );
    expect(spec).toBeTruthy();
    expect(specToCss(spec!).borderRadius).toBeUndefined();
  });
});
