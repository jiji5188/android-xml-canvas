import { describe, it, expect } from "vitest";
import { dedupeSameNameRes, fixIncludeLayoutNs, relocateAdaptiveIcons } from "../lib/xml/native-render";
import { buildResourcePreviewFiles } from "../lib/xml/res-preview";

const ADAPTIVE = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@drawable/ic_launcher_background" />
  <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>`;

describe("M170 发设备前资源清洗", () => {
  it("同名同目录只留一个，xml 优先（同名 .png 会让 link 报 duplicate value）", () => {
    const files = [
      { path: "drawable/ic_launcher.png", text: "", base64: "AAA" },
      { path: "drawable/ic_launcher.xml", text: "<shape/>" },
      { path: "drawable-anydpi-v26/ic_launcher.xml", text: "<adaptive-icon/>" },
      { path: "drawable/ic_down.xml", text: "<shape/>" },
    ];
    const out = dedupeSameNameRes(files);
    expect(out.filter((f) => f.path.startsWith("drawable/ic_launcher")).length).toBe(1);
    expect(out.some((f) => f.path === "drawable/ic_launcher.xml")).toBe(true);
    // 限定符目录算不同资源，必须保留
    expect(out.some((f) => f.path === "drawable-anydpi-v26/ic_launcher.xml")).toBe(true);
    expect(out.some((f) => f.path === "drawable/ic_down.xml")).toBe(true);
  });

  it("只有 png 时保留 png", () => {
    const out = dedupeSameNameRes([{ path: "drawable/a.png", text: "", base64: "AAA" }]);
    expect(out.map((f) => f.path)).toEqual(["drawable/a.png"]);
  });

  it("values / layout 同名不同扩展也去重，非资源目录不动", () => {
    const files = [
      { path: "values/colors.xml", text: "<resources/>" },
      { path: "layout/main.xml", text: "<x/>" },
      { path: "layout/other.xml", text: "<x/>" },
      { path: "assets/a.txt", text: "a" },
      { path: "assets/a.json", text: "{}" },
    ];
    expect(dedupeSameNameRes(files).length).toBe(5);
  });

  it("fixIncludeLayoutNs 幂等", () => {
    const src = '<include layout="@layout/x" />';
    expect(fixIncludeLayoutNs(fixIncludeLayoutNs(src))).toBe(fixIncludeLayoutNs(src));
  });

  it("adaptive-icon 不能落在 drawable/：搬到 mipmap-anydpi-v26", () => {
    const out = relocateAdaptiveIcons([
      { path: "drawable/ic_launcher.xml", text: ADAPTIVE },
      { path: "drawable/bg_card.xml", text: "<shape/>" },
    ]);
    expect(out.some((f) => f.path === "mipmap-anydpi-v26/ic_launcher.xml")).toBe(true);
    expect(out.some((f) => f.path === "drawable/ic_launcher.xml")).toBe(false);
    expect(out.some((f) => f.path === "drawable/bg_card.xml")).toBe(true);
  });

  it("搬家时目标已存在就丢掉重复的那份", () => {
    const out = relocateAdaptiveIcons([
      { path: "drawable/ic_launcher.xml", text: ADAPTIVE },
      { path: "mipmap-anydpi-v26/ic_launcher.xml", text: ADAPTIVE },
    ]);
    expect(out.filter((f) => f.path.endsWith("ic_launcher.xml")).length).toBe(1);
    expect(out[0].path).toBe("mipmap-anydpi-v26/ic_launcher.xml");
  });

  it("已经带 -v26 的不动", () => {
    const files = [{ path: "mipmap-anydpi-v26/ic_launcher.xml", text: ADAPTIVE }];
    expect(relocateAdaptiveIcons(files)).toEqual(files);
  });

  it("资源预览：项目里的 adaptive-icon 落到 mipmap-anydpi-v26，不落到 drawable", () => {
    const p = buildResourcePreviewFiles("bg_layer_new", "<layer-list/>", "drawable", {
      ic_launcher: ADAPTIVE,
      ic_down: "<shape/>",
    });
    const paths = p.files.map((f) => f.path);
    expect(paths).toContain("mipmap-anydpi-v26/ic_launcher.xml");
    expect(paths).toContain("drawable/ic_down.xml");
    expect(paths).not.toContain("drawable/ic_launcher.xml");
  });
});
