// test/xml_transforms.test.ts — 变换属性 / 组合图标 / ViewStub / 前景
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { resolveNodeAttrs, resolveColor } from "../lib/xml/resolve";
import type { ResourceTable } from "../lib/xml/types";

function res(extra?: Partial<ResourceTable>): ResourceTable {
  return {
    strings: {},
    dimens: {},
    colors: {},
    drawables: {},
    vectorNames: [],
    styles: {},
    ...extra,
  };
}

function build(xml: string, r = res()) {
  const { root } = parseLayoutXml(xml);
  return buildRenderModel(root!, r, 2);
}

describe("变换属性（rotation / scale / alpha / translation）", () => {
  it("rotation + alpha 转成 CSS transform / opacity", () => {
    const model = build(
      `<LinearLayout><TextView android:layout_width="100dp" android:layout_height="50dp"
         android:text="a" android:rotation="15" android:alpha="0.5"
         android:translationX="10dp" android:translationY="20dp" /></LinearLayout>`,
    );
    const n = model.root.children[0];
    expect(n.style.transform).toContain("translate(20px, 40px)");
    expect(n.style.transform).toContain("rotate(15deg)");
    expect(n.style.opacity).toBe(0.5);
  });

  it("scaleX/scaleY", () => {
    const model = build(
      `<LinearLayout><TextView android:layout_width="100dp" android:layout_height="50dp"
         android:text="a" android:scaleX="1.5" android:scaleY="0.8" /></LinearLayout>`,
    );
    const n = model.root.children[0];
    expect(n.style.transform).toContain("scale(1.5, 0.8)");
  });

  it("无变换时不产生 transform 属性", () => {
    const model = build(
      `<LinearLayout><TextView android:layout_width="100dp" android:layout_height="50dp" android:text="a" /></LinearLayout>`,
    );
    expect(model.root.children[0].style.transform).toBeUndefined();
  });
});

describe("组合图标（drawableLeft 等）", () => {
  it("有上传图片时，compound.start 带 dataURL", () => {
    const r = res({
      drawables: { ic_smile: "data:image/png;base64,AAAA" },
    });
    const { root } = parseLayoutXml(
      `<LinearLayout><TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
         android:text="hi" android:drawableStart="@drawable/ic_smile" android:drawablePadding="8dp" /></LinearLayout>`,
    );
    const model = buildRenderModel(root!, r, 2);
    const n = model.root.children[0];
    expect(n.compound?.start).toBe("data:image/png;base64,AAAA");
    expect(n.compound?.gap).toBe(16); // 8dp * 2
  });

  it("未上传图片时，compound.start 保留 @drawable 引用（渲染层画占位框）", () => {
    const { root } = parseLayoutXml(
      `<LinearLayout><TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
         android:text="hi" android:drawableLeft="@drawable/ic_x" /></LinearLayout>`,
    );
    const model = buildRenderModel(root!, res(), 2);
    const n = model.root.children[0];
    expect(n.compound?.start).toBe("missing:drawable/ic_x");
  });

  it("drawableTop + drawableBottom 都带", () => {
    const r = res({
      drawables: { up: "data:image/png;base64,U", down: "data:image/png;base64,D" },
    });
    const { root } = parseLayoutXml(
      `<LinearLayout><TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
         android:text="x"
         android:drawableTop="@drawable/up" android:drawableBottom="@drawable/down" /></LinearLayout>`,
    );
    const model = buildRenderModel(root!, r, 2);
    const n = model.root.children[0];
    expect(n.compound?.top).toBe("data:image/png;base64,U");
    expect(n.compound?.bottom).toBe("data:image/png;base64,D");
  });

  it("没有组合图标时 compound 为 undefined", () => {
    const model = build(
      `<LinearLayout><TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="a" /></LinearLayout>`,
    );
    expect(model.root.children[0].compound).toBeUndefined();
  });
});

describe("ViewStub", () => {
  it("渲染为虚线占位框，类名 axv-viewstub，文本含 layout 名", () => {
    const model = build(
      `<FrameLayout><ViewStub android:id="@+id/stub"
         android:layout_width="wrap_content" android:layout_height="wrap_content"
         android:layout="@layout/loading_view" /></FrameLayout>`,
    );
    const n = model.root.children[0];
    expect(n.className).toBe("axv-viewstub");
    expect(n.style.minHeight).toBe("112px"); // 56dp*2
    expect(n.text).toBe("⚡ ViewStub → @layout/loading_view");
  });
});

describe("foreground 前景覆盖层", () => {
  it("dataURL 前景写成 backgroundImage", () => {
    const r = res({
      drawables: { overlay: "data:image/png;base64,O" },
    });
    const { root } = parseLayoutXml(
      `<LinearLayout><CardView android:layout_width="100dp" android:layout_height="100dp"
         android:foreground="@drawable/overlay" /></LinearLayout>`,
    );
    const model = buildRenderModel(root!, r, 2);
    const n = model.root.children[0];
    expect(n.style.backgroundImage).toBe("url(data:image/png;base64,O)");
  });

  it("未上传时 foreground 保留原引用（不写 backgroundImage）", () => {
    const { root } = parseLayoutXml(
      `<LinearLayout><View android:layout_width="100dp" android:layout_height="100dp"
         android:foreground="@drawable/overlay" /></LinearLayout>`,
    );
    const model = buildRenderModel(root!, res(), 2);
    expect(model.root.children[0].style.backgroundImage).toBeUndefined();
  });
});

describe("backgroundTint / tint", () => {
  it("backgroundTint 解析成颜色", () => {
    const { root } = parseLayoutXml(
      `<LinearLayout><Button android:layout_width="100dp" android:layout_height="50dp"
         android:text="ok" android:backgroundTint="#FF00FF" /></LinearLayout>`,
    );
    const { attrs } = resolveNodeAttrs(root!.children[0]!, res());
    expect(attrs["backgroundTint"]).toBe("#FF00FF");
  });
});
