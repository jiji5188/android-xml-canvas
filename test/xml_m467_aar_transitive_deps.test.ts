// M467：aar 资源传递依赖闭包——material 引用 cardview 的 style/CardView / attr/cardElevation，
// 只保留 build.gradle 直接声明的库时 cardview 被排掉 → aapt2 link 失败
//（用户真机：resource style/CardView not found / failed linking references）。
// filterSharedByDeps 现在从已保留的库出发，把 shared 里存在的传递依赖一并保留；
// 关键资源 aar 缺失时进 missingTransitive，让构建日志提示下载。
import { describe, expect, it } from "vitest";
import { AAR_RES_DEPS, RES_CRITICAL_AARS, filterSharedByDeps } from "@/lib/xml/project-libs";
import type { ProjectLib } from "@/lib/xml/project-libs";

const lib = (rel: string): ProjectLib => ({ rel, base64: "x" });

describe("AAR_RES_DEPS 表（M467）", () => {
  it("material 依赖 cardview/appcompat/recyclerview/coordinatorlayout（用户事故的最小集）", () => {
    expect(AAR_RES_DEPS.material).toContain("cardview");
    expect(AAR_RES_DEPS.material).toContain("appcompat");
    expect(AAR_RES_DEPS.material).toContain("recyclerview");
    expect(AAR_RES_DEPS.material).toContain("coordinatorlayout");
  });
  it("cardview 自己无资源依赖（不引入循环膨胀）", () => {
    expect(AAR_RES_DEPS.cardview ?? []).toHaveLength(0);
  });
  it("RES_CRITICAL_AARS 含 cardview（用户事故主角）", () => {
    expect(RES_CRITICAL_AARS.has("cardview")).toBe(true);
    expect(RES_CRITICAL_AARS.has("material")).toBe(true);
  });
});

describe("filterSharedByDeps 资源传递依赖闭包（M467）", () => {
  it("用户事故复现：声明 material+appcompat+percentlayout，shared 有 cardview → cardview 被补进来", () => {
    const shared = [
      lib("shared/percentlayout-1.0.0.aar"),
      lib("shared/appcompat-1.0.0.aar"),
      lib("shared/material-1.0.0.aar"),
      lib("shared/cardview-1.0.0.aar"),
    ];
    const r = filterSharedByDeps(shared, [
      { name: "material", version: "1.0.0" },
      { name: "appcompat", version: "1.0.0" },
      { name: "percentlayout", version: "1.0.0" },
    ]);
    const rels = r.kept.map((k) => k.rel);
    expect(rels).toContain("shared/cardview-1.0.0.aar");
    expect(r.addedTransitive.map((x) => x.name)).toContain("cardview");
    // 保留的库的依赖链上，shared 里不存在的关键库进 missing
    expect(r.missingTransitive).toContain("recyclerview");
    expect(r.missingTransitive).toContain("coordinatorlayout");
  });

  it("shared 没有 cardview → 不报错，但 missingTransitive 提示（等 UI 引导下载）", () => {
    const shared = [lib("shared/material-1.0.0.aar"), lib("shared/appcompat-1.0.0.aar")];
    const r = filterSharedByDeps(shared, [
      { name: "material", version: "1.0.0" },
      { name: "appcompat", version: "1.0.0" },
    ]);
    expect(r.kept.map((k) => k.rel)).toEqual(["shared/material-1.0.0.aar", "shared/appcompat-1.0.0.aar"]);
    expect(r.missingTransitive).toContain("cardview");
    expect(r.addedTransitive).toHaveLength(0);
  });

  it("cardview 已被直接声明 → 不重复收，addedTransitive 不含它", () => {
    const shared = [
      lib("shared/material-1.0.0.aar"),
      lib("shared/cardview-1.0.0.aar"),
    ];
    const r = filterSharedByDeps(shared, [
      { name: "material", version: "1.0.0" },
      { name: "cardview", version: "1.0.0" },
    ]);
    expect(r.kept).toHaveLength(2);
    expect(r.addedTransitive.map((x) => x.name)).not.toContain("cardview");
    expect(r.matched).toHaveLength(2);
  });

  it("无任何声明 → 行为不变（全排除，不做闭包）", () => {
    const shared = [lib("shared/material-1.0.0.aar"), lib("shared/cardview-1.0.0.aar")];
    const r = filterSharedByDeps(shared, []);
    expect(r.kept).toHaveLength(0);
    expect(r.addedTransitive).toHaveLength(0);
    expect(r.missingTransitive).toHaveLength(0);
  });

  it("无 shared 库 → 全空，不崩（声明都找不到 → 不做闭包）", () => {
    const r = filterSharedByDeps([], [{ name: "material", version: "1.0.0" }]);
    expect(r.kept).toHaveLength(0);
    expect(r.addedTransitive).toHaveLength(0);
    expect(r.missingTransitive).toHaveLength(0);
  });

  it("多级闭包：appcompat → fragment 不在 critical，静默跳过（不误报）", () => {
    const shared = [lib("shared/appcompat-1.0.0.aar")];
    const r = filterSharedByDeps(shared, [{ name: "appcompat", version: "1.0.0" }]);
    // appcompat 的依赖里只有 critical 集里的才报 missing；fragment/activity/core 不报
    expect(r.missingTransitive).toHaveLength(0);
    expect(r.addedTransitive).toHaveLength(0);
  });
});
