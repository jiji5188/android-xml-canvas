// @vitest-environment jsdom
// M89i：maxLines / ellipsize 的裁剪要真的画出来。
// 背景：原来把 display:-webkit-box 写在 .axv-text 容器上 —— ① 它本身是 inline-flex，
// 这样写会把 gravity 映射来的 justify-content/align-items 一起废掉；② text-overflow 对
// 匿名 flex 子项无效，表现是文字被硬切半个字、没有省略号。现在裁剪规则落到内层文字元素。
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import { XmlCanvas } from "@/components/XmlCanvas";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
};

async function mount(xml: string) {
  const root = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never, 2).root;
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  createRoot(host).render(<XmlCanvas node={root} selectedPath={null} onSelect={() => {}} scale={2} />);
  await flush();
  return host;
}

describe("M89i TextView 省略号落在内层文字元素", () => {
  it("单行 maxLines=1 + ellipsize=end：内层 span 带 clamp，容器不再 display:-webkit-box", async () => {
    const host = await mount(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <TextView ${A} android:layout_width="120dp" android:layout_height="wrap_content" android:text="很长很长很长的一段标题" android:maxLines="1" android:ellipsize="end" />
    </LinearLayout>`);
    const tv = host.querySelector(".axv-text") as HTMLElement;
    expect(tv).toBeTruthy();
    // 容器保留自身的 flex 布局（否则 gravity 对齐失效）
    expect((tv.style.display || "").includes("-webkit-box")).toBe(false);
    const span = tv.querySelector("span") as HTMLElement;
    expect(span).toBeTruthy();
    expect(span.style.display).toBe("-webkit-box");
    expect(span.style.webkitLineClamp).toBe("1");
    expect(String(span.style.overflow)).toBe("hidden");
  });

  it("多行 maxLines=2：内层 span 拿到 2 行 clamp", async () => {
    const host = await mount(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <TextView ${A} android:layout_width="120dp" android:layout_height="wrap_content" android:text="很长很长很长的一段标题再长一点" android:maxLines="2" android:ellipsize="end" />
    </LinearLayout>`);
    const span = host.querySelector(".axv-text span") as HTMLElement;
    expect(span.style.webkitLineClamp).toBe("2");
  });

  it("没有 maxLines/ellipsize 时不加任何裁剪样式（不影响正常文本）", async () => {
    const host = await mount(`<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="普通文字" />
    </LinearLayout>`);
    const span = host.querySelector(".axv-text span") as HTMLElement;
    expect(span.getAttribute("style")).toBeNull();
  });
});
