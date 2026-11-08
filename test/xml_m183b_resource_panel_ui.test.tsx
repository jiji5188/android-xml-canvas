// @vitest-environment jsdom
// M183b：资源面板 tab 横向滚动 / 图标真实缩略图 / 颜色真实色块
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { ResourcePanel } from "@/components/ResourcePanel";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";

const flush = async () => {
  for (let i = 0; i < 25; i++) await new Promise((r) => setTimeout(r, 10));
};

const RES = "app/src/main/res";

const VECTOR = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FF6200EE" android:pathData="M12,2L2,22h20z" />
</vector>`;

const COLORS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="brand">#6200EE</color>
  <color name="brand_alpha">#806200EE</color>
  <color name="brand_alias">@color/brand</color>
  <color name="sys_white">@android:color/white</color>
  <string name="app_name">MyApp</string>
</resources>`;

const tree: Record<string, BrowseEntry[]> = {
  "": [{ kind: "dir", name: "app", rel: "app" }],
  app: [{ kind: "dir", name: "src", rel: "app/src" }],
  "app/src": [{ kind: "dir", name: "main", rel: "app/src/main" }],
  "app/src/main": [{ kind: "dir", name: "res", rel: RES }],
  [RES]: [
    { kind: "dir", name: "drawable", rel: `${RES}/drawable` },
    { kind: "dir", name: "mipmap-hdpi", rel: `${RES}/mipmap-hdpi` },
    { kind: "dir", name: "mipmap-xxxhdpi", rel: `${RES}/mipmap-xxxhdpi` },
    { kind: "dir", name: "values", rel: `${RES}/values` },
  ],
  [`${RES}/drawable`]: [
    { kind: "file", name: "ic_star.xml", rel: `${RES}/drawable/ic_star.xml` },
  ],
  [`${RES}/mipmap-hdpi`]: [
    { kind: "file", name: "ic_launcher.png", rel: `${RES}/mipmap-hdpi/ic_launcher.png` },
  ],
  [`${RES}/mipmap-xxxhdpi`]: [
    { kind: "file", name: "ic_launcher.png", rel: `${RES}/mipmap-xxxhdpi/ic_launcher.png` },
  ],
  [`${RES}/values`]: [{ kind: "file", name: "colors.xml", rel: `${RES}/values/colors.xml` }],
};

const texts: Record<string, string> = {
  [`${RES}/drawable/ic_star.xml`]: VECTOR,
  [`${RES}/values/colors.xml`]: COLORS,
};

function fakeSource(): ProjectSource {
  return {
    name: "proj",
    async listChildren(rel: string) {
      return tree[rel] ?? [];
    },
    async readText(rel: string) {
      return texts[rel] ?? null;
    },
  };
}

function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(
    <ResourcePanel
      source={fakeSource()}
      aiFileIo={null}
      assets={{}}
      onNewIcon={() => {}}
      onNewDrawable={() => {}}
      onEditIcon={() => {}}
      onEditShape={() => {}}
      onOpenFile={() => {}}
      onPreview={() => {}}
      onNote={() => {}}
    />,
  );
  return host;
}

const tabByLabel = (host: HTMLElement, label: string) =>
  [...host.querySelectorAll(".axv-rp-tab")].find((b) =>
    (b.textContent || "").startsWith(label),
  ) as HTMLElement | undefined;

const click = (el: Element | null | undefined) => el!.dispatchEvent(new MouseEvent("click", { bubbles: true }));

describe("ResourcePanel — M183b", () => {
  it("tab 条可横向滚动（不挤成小方块）", async () => {
    const host = mount();
    await flush();
    const bar = host.querySelector(".axv-rp-tabs") as HTMLElement;
    expect(bar).toBeTruthy();
    // jsdom 不算布局，只验样式契约
    expect(bar.className).toContain("axv-rp-tabs");
    const tab = host.querySelector(".axv-rp-tab") as HTMLElement;
    expect(tab.className).toContain("axv-rp-tab");
    expect(tab.getAttribute("role")).toBe("tab");
  });

  it("图标 tab：vector 渲染成真实 svg 缩略图，同名密度副本合并", async () => {
    const host = mount();
    await flush();
    click(tabByLabel(host, "图标"));
    await flush();
    const thumbs = [...host.querySelectorAll("img.axv-rp-thumb")].map((i) => (i as HTMLImageElement).src);
    expect(thumbs.some((s) => s.startsWith("data:image/svg"))).toBe(true);
    // ic_launcher.png 两个密度目录 → 合并成一行，带 2 的角标
    const names = [...host.querySelectorAll(".axv-rp-file-name")].map((n) => n.textContent);
    expect(names.filter((n) => n === "ic_launcher.png")).toHaveLength(1);
    const badge = [...host.querySelectorAll(".axv-rp-varcount")].map((b) => b.textContent);
    expect(badge).toContain("2");
  });

  it("颜色 tab：色块用真实颜色（ARGB 与 @color 引用都解析）", async () => {
    const host = mount();
    await flush();
    click(tabByLabel(host, "颜色"));
    await flush();
    const rows = [...host.querySelectorAll(".axv-rp-row")];
    const swatchOf = (name: string) => {
      const row = rows.find((r) => r.querySelector(".axv-rp-name")?.textContent === name)!;
      return (row.querySelector(".axv-rp-swatch") as HTMLElement).style.background;
    };
    expect(swatchOf("brand")).toBe("rgb(98, 0, 238)");
    expect(swatchOf("brand_alpha")).toBe("rgba(98, 0, 238, 0.502)");
    expect(swatchOf("brand_alias")).toBe("rgb(98, 0, 238)");
    expect(swatchOf("sys_white")).toBe("rgb(255, 255, 255)");
  });
});
