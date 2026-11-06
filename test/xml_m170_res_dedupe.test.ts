import { describe, it, expect } from "vitest";
import { dedupeSameNameRes, fixIncludeLayoutNs } from "../lib/xml/native-render";

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
});
