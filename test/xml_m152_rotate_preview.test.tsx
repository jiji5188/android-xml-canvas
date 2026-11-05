// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import React from "react";
import { createRoot } from "react-dom/client";
import { DrawablePreview } from "@/components/DrawablePreview";
import { parseDrawable } from "@/lib/xml/drawable-node";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const xml = `<rotate xmlns:android="http://schemas.android.com/apk/res/android"
    android:fromDegrees="30" android:pivotX="50%" android:pivotY="50%">
  <shape android:shape="rectangle">
    <solid android:color="#FF3355FF"/>
    <size android:width="120dp" android:height="60dp"/>
  </shape>
</rotate>`;

describe("M152 rotate 在 drawable 编辑器预览里", () => {
  it("层 style 上应该带 rotate", async () => {
    const doc = parseDrawable(xml);
    expect(doc).toBeTruthy();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await Promise.resolve();
    root.render(
      React.createElement(DrawablePreview, { doc: doc as never, width: 240, height: 240, scale: 1 }),
    );
    await new Promise((r) => setTimeout(r, 60));
    const layer = host.querySelector('[data-kind="shape"]') as HTMLElement | null;
    console.log("layer style:", layer?.getAttribute("style"));
    expect(layer?.style.transform ?? "").toContain("rotate(30deg)");
  });
});
