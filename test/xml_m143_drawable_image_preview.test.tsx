// M143：预览层把 @drawable/png 这类引用真画成 <img>
// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { parseDrawable } from "@/lib/xml/drawable-node";
import { DrawablePreview } from "@/components/DrawablePreview";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    root.unmount();
    await flush();
  }
  host?.remove();
  root = null;
  host = null;
});

async function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(el);
  await flush();
  return host;
}

const IMG = "data:image/png;base64,iVBORw0KGgo=";

describe("M143 图片引用预览", () => {
  it("item android:drawable=@drawable/logo 且能拿到 dataURL 时渲染 <img>", async () => {
    const doc = parseDrawable(`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/logo"/>
</layer-list>`)!;
    const h = await mount(
      <DrawablePreview doc={doc} interactive={false} showStateBar={false} backdrop="none" resolveImage={() => IMG} />,
    );
    const img = h.querySelector<HTMLImageElement>('img[data-kind="image"]');
    expect(img).not.toBeNull();
    expect(img!.getAttribute("src")).toBe(IMG);
    expect(h.querySelector(".axv-dp-unknown")).toBeNull();
  });

  it("读不到资源时退回虚线占位（明确说「预览不了」，不假装空白）", async () => {
    const doc = parseDrawable(`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/missing"/>
</layer-list>`)!;
    const h = await mount(<DrawablePreview doc={doc} interactive={false} showStateBar={false} backdrop="none" />);
    expect(h.querySelector('img[data-kind="image"]')).toBeNull();
    expect(h.querySelector(".axv-dp-unknown")).not.toBeNull();
  });

  it("同名既有 xml 又是图片时，xml 展开优先（形状画得出来就不当图贴）", async () => {
    const doc = parseDrawable(`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/box"/>
</layer-list>`)!;
    const h = await mount(
      <DrawablePreview
        doc={doc}
        interactive={false}
        showStateBar={false}
        backdrop="none"
        resolveRef={() =>
          `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><solid android:color="#FF0088FF"/></shape>`
        }
        resolveImage={() => IMG}
      />,
    );
    expect(h.querySelector('img[data-kind="image"]')).toBeNull();
    expect(h.querySelector('[data-kind="shape"]')).not.toBeNull();
  });
});
