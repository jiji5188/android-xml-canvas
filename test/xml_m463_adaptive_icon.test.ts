// M463：坏 adaptive icon（mipmap-anydpi-v26 引用的 drawable 缺失）剔除，密度 PNG 接管
import { describe, expect, it } from "vitest";
import { dropBrokenAdaptiveIcons } from "@/lib/xml/adaptive-icon-fix";
import type { RenderFile } from "@/lib/xml/native-render";

const files = (): RenderFile[] => [
  // 坏 adaptive：background @drawable/ic_launcher 缺失（项目里只有 ic_launcher_background），
  // foreground @drawable/ic_launcher_foreground 在（drawable-v24）
  { path: "mipmap-anydpi-v26/ic_launcher.xml", text: `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n  <background android:drawable="@drawable/ic_launcher" />\n  <foreground android:drawable="@drawable/ic_launcher_foreground" />\n</adaptive-icon>` },
  { path: "drawable-v24/ic_launcher_foreground.xml", text: `<vector/>` },
  // 密度 PNG（用户真正的图标）
  { path: "mipmap-hdpi/ic_launcher.png", text: "", base64: "AAA" },
  { path: "mipmap-xhdpi/ic_launcher.png", text: "", base64: "BBB" },
  { path: "mipmap-xxhdpi/ic_launcher.png", text: "", base64: "CCC" },
];

describe("M463 dropBrokenAdaptiveIcons", () => {
  it("坏 adaptive（background 缺）+ 密度 PNG 存在 → 剔除 adaptive，保留 PNG", () => {
    const r = dropBrokenAdaptiveIcons(files());
    expect(r.dropped).toContain("mipmap-anydpi-v26/ic_launcher.xml");
    const paths = r.files.map((f) => f.path);
    expect(paths).not.toContain("mipmap-anydpi-v26/ic_launcher.xml");
    expect(paths).toContain("mipmap-hdpi/ic_launcher.png");
    expect(paths).toContain("mipmap-xxhdpi/ic_launcher.png");
    // foreground 的 drawable 保留（别误删）
    expect(paths).toContain("drawable-v24/ic_launcher_foreground.xml");
  });

  it("adaptive 引用的 drawable 都在 → 不剔", () => {
    const fs2 = [
      { path: "mipmap-anydpi-v26/ic_launcher.xml", text: `<adaptive-icon><background android:drawable="@drawable/ic_launcher_background" /><foreground android:drawable="@drawable/ic_launcher_foreground" /></adaptive-icon>` },
      { path: "drawable/ic_launcher_background.xml", text: `<vector/>` },
      { path: "drawable/ic_launcher_foreground.xml", text: `<vector/>` },
      { path: "mipmap-hdpi/ic_launcher.png", text: "", base64: "AAA" },
    ] as RenderFile[];
    const r = dropBrokenAdaptiveIcons(fs2);
    expect(r.dropped).toEqual([]);
    expect(r.files.map((f) => f.path)).toContain("mipmap-anydpi-v26/ic_launcher.xml");
  });

  it("坏 adaptive 但没有同名密度 PNG → 不剔（避免剔了没图标）", () => {
    const fs3 = [
      { path: "mipmap-anydpi-v26/ic_launcher.xml", text: `<adaptive-icon><background android:drawable="@drawable/missing_bg" /></adaptive-icon>` },
    ] as RenderFile[];
    const r = dropBrokenAdaptiveIcons(fs3);
    expect(r.dropped).toEqual([]);
  });

  it("只针对 mipmap-anydpi-v26 的 adaptive icon，普通 drawable xml 不剔", () => {
    const fs4 = [
      { path: "mipmap-anydpi-v26/ic_launcher.xml", text: `<adaptive-icon><background android:drawable="@drawable/nope" /></adaptive-icon>` },
      { path: "mipmap-hdpi/ic_launcher.png", text: "", base64: "AAA" },
      { path: "drawable/some_bg.xml", text: `<shape/>` },
    ] as RenderFile[];
    const r = dropBrokenAdaptiveIcons(fs4);
    expect(r.dropped).toEqual(["mipmap-anydpi-v26/ic_launcher.xml"]);
    expect(r.files.map((f) => f.path)).toContain("drawable/some_bg.xml");
  });

  it("无 base64/text 的 mipmap 不参与（pngBase 只认 base64）", () => {
    const fs5 = [
      { path: "mipmap-anydpi-v26/ic_launcher.xml", text: `<adaptive-icon><background android:drawable="@drawable/nope" /></adaptive-icon>` },
      // 只有 text 形式声明的 mipmap（不真实）不算密度 PNG
    ] as RenderFile[];
    const r = dropBrokenAdaptiveIcons(fs5);
    // 没有密度 PNG → 不剔（保护）
    expect(r.dropped).toEqual([]);
  });
});
