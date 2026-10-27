// M3e：elevation（层级抬升）——阴影 + z 序
import { describe, expect, it } from "vitest";
import { parseLayoutXml, findNode } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const VIEW = { w: 412, h: 892 };
const build = (xml: string) => {
  const { root } = parseLayoutXml(xml);
  return buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, VIEW);
};

describe("M3e elevation 渲染", () => {
  it("elevation=8dp → 有阴影 + z-index 抬升", () => {
    const m = build(
      `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
         android:elevation="8dp" android:text="浮起来" />`,
    );
    expect(m.root.style.boxShadow).toBeTruthy();
    expect(Number(m.root.style.zIndex)).toBeGreaterThan(1);
  });

  it("无 elevation → 没有 z-index、没有阴影", () => {
    const m = build(
      `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="平的" />`,
    );
    expect(m.root.style.zIndex).toBeUndefined();
    expect(m.root.style.boxShadow).toBeUndefined();
  });

  it("elevation=0dp 等同未设置（不抬升、无阴影）", () => {
    const m = build(
      `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
         android:elevation="0dp" android:text="平的" />`,
    );
    expect(m.root.style.zIndex).toBeUndefined();
    expect(m.root.style.boxShadow).toBeUndefined();
  });

  it("elevation 越高 z-index 越大、阴影越散", () => {
    const low = build(
      `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:elevation="2dp" />`,
    );
    const high = build(
      `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:elevation="16dp" />`,
    );
    expect(Number(high.root.style.zIndex)).toBeGreaterThan(Number(low.root.style.zIndex));
    const blur = (s: unknown) => Number(String(s).match(/(\d+)px rgba\(0,0,0,0\.20\)/)?.[1] ?? 0);
    expect(blur(high.root.style.boxShadow)).toBeGreaterThan(blur(low.root.style.boxShadow));
  });

  it("translationZ 与 elevation 相加（Android 的 Z = elevation + translationZ）", () => {
    const a = build(
      `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:elevation="4dp" />`,
    );
    const b = build(
      `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"
         android:elevation="4dp" android:translationZ="8dp" />`,
    );
    expect(Number(b.root.style.zIndex)).toBeGreaterThan(Number(a.root.style.zIndex));
  });

  it("FrameLayout 重叠：写了 elevation 的那个即使排在前面也盖在上面", () => {
    const xml = `<FrameLayout ${A} xmlns:app="http://schemas.android.com/apk/res-auto"
        android:layout_width="match_parent" android:layout_height="match_parent">
        <TextView
            android:id="@+id/lifted"
            android:layout_width="100dp" android:layout_height="100dp"
            android:elevation="8dp" android:text="抬起来" />
        <TextView
            android:id="@+id/flat"
            android:layout_width="100dp" android:layout_height="100dp"
            android:text="平平的" />
      </FrameLayout>`;
    const { root } = parseLayoutXml(xml);
    const m = buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, VIEW);
    const byPath = (p: string) => m.root.children.find((c) => c.path === p);
    const lz = Number(byPath("#0/0")?.style.zIndex ?? 0);
    const fz = Number(byPath("#0/1")?.style.zIndex ?? 0);
    expect(lz).toBeGreaterThan(fz);
    expect(lz).toBeGreaterThan(1);
  });

  it("CardView 默认阴影仍在，给了 elevation 就听 elevation 的", () => {
    const card = build(
      `<androidx.cardview.widget.CardView ${A} xmlns:app="http://schemas.android.com/apk/res-auto"
         android:layout_width="200dp" android:layout_height="120dp" />`,
    );
    expect(String(card.root.style.boxShadow)).toContain("0 2px 8px");
    const lifted = build(
      `<androidx.cardview.widget.CardView ${A} xmlns:app="http://schemas.android.com/apk/res-auto"
         android:layout_width="200dp" android:layout_height="120dp" android:elevation="12dp" />`,
    );
    expect(String(lifted.root.style.boxShadow)).not.toBe("0 2px 8px rgba(0,0,0,0.12)");
    expect(Number(lifted.root.style.zIndex)).toBeGreaterThan(1);
  });
});
