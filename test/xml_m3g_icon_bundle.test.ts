// test/xml_m3g_icon_bundle.test.ts — M3g 导出 res 包：zip 结构 / 图标矢量 / 缺失检测
import { describe, it, expect } from "vitest";
import { makeZip, crc32 } from "../lib/xml/zip";
import { buildResBundle, referencedDrawables, missingDrawables } from "../lib/xml/bundle";
import { vectorToSvg, vectorToDataUrl, parseVectorXml } from "../lib/xml/vector-svg";

const VEC = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <path
        android:fillColor="#1D1B20"
        android:pathData="M11 5 L5 5 Z"/>
</vector>`;

describe("M3g zip 打包", () => {
  it("crc32 与已知值一致", () => {
    // "hello" 的 CRC32 = 0x3610a686
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
  });

  it("makeZip 产出合法头尾（PK\\x03\\x04 … EOCD）", () => {
    const bytes = makeZip([{ path: "drawable/ic_x.xml", text: VEC }]);
    // 本地文件头签名
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // EOCD 签名在末尾 22 字节处
    const eocd = bytes.length - 22;
    expect([bytes[eocd], bytes[eocd + 1], bytes[eocd + 2], bytes[eocd + 3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("空列表也是合法 zip（只有 EOCD）", () => {
    const bytes = makeZip([]);
    expect(bytes.length).toBe(22);
    expect(bytes[0]).toBe(0x50);
  });

  it("文件名与内容都进包（可被解压工具读出）", () => {
    const bytes = makeZip([{ path: "layout/activity_main.xml", text: "<x/>" }]);
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain("layout/activity_main.xml");
    expect(text).toContain("<x/>");
  });
});

describe("M3g res 包组装", () => {
  it("包含 layout/ + 图标 drawable/", () => {
    const entries = buildResBundle({
      layoutXml: '<?xml version="1.0"?>\n<LinearLayout android:src="@drawable/ic_search"/>',
      generatedDrawables: { ic_search: VEC },
    });
    const paths = entries.map((e) => e.path);
    expect(paths).toContain("layout/activity_main.xml");
    expect(paths).toContain("drawable/ic_search.xml");
    // layout 排最前（方便人看）
    expect(paths[0]).toBe("layout/activity_main.xml");
  });

  it("上传的 shape xml 也一并带走", () => {
    const entries = buildResBundle({
      layoutXml: "<x/>",
      extras: {
        drawables: {},
        vectorNames: [],
        drawableXml: { bg_card: "<shape><solid android:color=\"#FFF\"/></shape>" },
        valuesXml: "",
        styles: {},
        sourceFiles: [],
        counts: { images: 0, vectors: 0, values: 0, styles: 0, shapes: 1 },
      },
    });
    expect(entries.map((e) => e.path)).toContain("drawable/bg_card.xml");
  });

  it("values 片段包成 values/res_values.xml", () => {
    const entries = buildResBundle({
      layoutXml: "<x/>",
      extras: {
        drawables: {},
        vectorNames: [],
        drawableXml: {},
        valuesXml: '<color name="brand">#123456</color>',
        styles: {},
        sourceFiles: [],
        counts: { images: 0, vectors: 0, values: 1, styles: 0, shapes: 0 },
      },
    });
    const v = entries.find((e) => e.path === "values/res_values.xml");
    expect(v).toBeTruthy();
    expect(v!.text).toContain("<resources>");
    expect(v!.text).toContain('name="brand"');
  });

  it("同路径不重复打包", () => {
    const entries = buildResBundle({
      layoutXml: "<x/>",
      generatedDrawables: { ic_a: VEC, ic_a2: VEC },
    });
    const paths = entries.map((e) => e.path);
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("M3g 缺失图标检测", () => {
  it("找出布局引用但包里没有的 drawable", () => {
    const layout = `<ImageView android:src="@drawable/ic_search"/>
      <ImageView android:src="@mipmap/ic_launcher"/>`;
    expect(referencedDrawables(layout)).toEqual(["ic_launcher", "ic_search"]);

    const entries = buildResBundle({ layoutXml: layout, generatedDrawables: { ic_search: VEC } });
    const missing = missingDrawables(layout, entries);
    expect(missing).toEqual(["ic_launcher"]);
  });

  it("全部覆盖时缺失为空", () => {
    const layout = `<ImageView android:src="@drawable/ic_search"/>`;
    const entries = buildResBundle({ layoutXml: layout, generatedDrawables: { ic_search: VEC } });
    expect(missingDrawables(layout, entries)).toEqual([]);
  });
});

describe("M3g vector → SVG 预览", () => {
  it("能解析 viewport 与 path", () => {
    const spec = parseVectorXml(VEC);
    expect(spec).not.toBeNull();
    expect(spec!.vw).toBe(24);
    expect(spec!.paths).toHaveLength(1);
    expect(spec!.paths[0].fill).toBe("#1D1B20");
  });

  it("非 vector 返回 null", () => {
    expect(parseVectorXml("<shape/>")).toBeNull();
  });

  it("生成 SVG 含 viewBox 与 path", () => {
    const svg = vectorToSvg(VEC);
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('fill="#1D1B20"');
  });

  it("data URL 可直接给 CSS 用", () => {
    const url = vectorToDataUrl(VEC);
    expect(url?.startsWith("data:image/svg+xml")).toBe(true);
  });
});
