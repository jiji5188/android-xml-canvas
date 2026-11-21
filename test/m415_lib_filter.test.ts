// M415：共享库按项目依赖过滤（编译器按 build.gradle 声明收库，不再全量塞入）
import { describe, it, expect } from "vitest";
import { filterSharedByDeps, libArtifactInfo, cmpLibVer } from "@/lib/xml/project-libs";
import type { ProjectLib } from "@/lib/xml/project-libs";

const lib = (rel: string): ProjectLib => ({ rel, base64: "x" });
const shared = [
  lib("shared/material-1.12.0.aar"),
  lib("shared/material-1.0.0.aar"),
  lib("shared/appcompat-1.7.0.aar"),
  lib("shared/appcompat-1.0.0.aar"),
  lib("shared/cardview-1.0.0.aar"),
  lib("shared/gson-2.10.jar"),
];

describe("libArtifactInfo / cmpLibVer (M415)", () => {
  it("解析基名+版本", () => {
    expect(libArtifactInfo("material-1.12.0.aar")).toEqual({ base: "material", ver: [1, 12, 0], verStr: "1.12.0" });
    expect(libArtifactInfo("core-ktx-1.9.0.jar")).toEqual({ base: "core-ktx", ver: [1, 9, 0], verStr: "1.9.0" });
    expect(libArtifactInfo("mylib.aar")).toEqual({ base: "mylib", ver: null, verStr: "" });
  });
  it("逐位比较：1.9 < 1.12", () => {
    expect(cmpLibVer([1, 9, 0], [1, 12, 0])).toBeLessThan(0);
    expect(cmpLibVer([1, 12, 0], [1, 9, 0])).toBeGreaterThan(0);
    expect(cmpLibVer(null, [0, 1])).toBeLessThan(0);
  });
});

describe("filterSharedByDeps (M415)", () => {
  it("声明 material:1.12.0 + appcompat:1.7.0 → 收这两个版本 + 资源传递依赖（M467）", () => {
    const r = filterSharedByDeps(shared, [
      { name: "material", version: "1.12.0" },
      { name: "appcompat", version: "1.7.0" },
    ]);
    // M467：cardview 是 material 的资源传递依赖，shared 里存在就一并保留
    const rels = r.kept.map((k) => k.rel);
    expect(rels).toContain("shared/material-1.12.0.aar");
    expect(rels).toContain("shared/appcompat-1.7.0.aar");
    expect(rels).toContain("shared/cardview-1.0.0.aar");
    expect(r.addedTransitive.map((x) => x.name)).toContain("cardview");
    expect(r.excluded.sort()).toEqual(["appcompat-1.0.0", "gson-2.10", "material-1.0.0"]);
    expect(r.matched).toHaveLength(2);
  });

  it("声明版本不在可用集里 → 取最高版（+ 资源传递依赖）", () => {
    const r = filterSharedByDeps(shared, [{ name: "material", version: "9.9.9" }]);
    const rels = r.kept.map((k) => k.rel);
    expect(rels).toContain("shared/material-1.12.0.aar");
    // M467：material 的资源传递依赖（shared 里存在的）也一并保留
    expect(rels).toContain("shared/appcompat-1.7.0.aar");
    expect(rels).toContain("shared/cardview-1.0.0.aar");
    expect(r.missingTransitive.length).toBeGreaterThan(0); // recyclerview 等不在 shared → 提示
  });

  it("声明版本为空（变量没解开）→ 取最高版", () => {
    const r = filterSharedByDeps(shared, [{ name: "appcompat", version: "" }]);
    expect(r.kept.map((k) => k.rel)).toEqual(["shared/appcompat-1.7.0.aar"]);
  });

  it("声明了共享库里没有的 artifact → 不影响其它组", () => {
    const r = filterSharedByDeps(shared, [
      { name: "material", version: "1.12.0" },
      { name: "constraintlayout", version: "2.1.4" },
    ]);
    const rels = r.kept.map((k) => k.rel);
    expect(rels).toContain("shared/material-1.12.0.aar");
    // M467：material 的传递依赖照补
    expect(rels).toContain("shared/cardview-1.0.0.aar");
    expect(r.matched.filter((m) => m.declared.startsWith("constraintlayout"))).toHaveLength(0);
  });

  it("同一基名声明多次 → 直接声明只收一个文件（传递依赖另计）", () => {
    const r = filterSharedByDeps(shared, [
      { name: "material", version: "1.12.0" },
      { name: "material", version: "1.0.0" },
    ]);
    expect(r.kept.filter((k) => k.rel.includes("material"))).toHaveLength(1);
    expect(r.kept[0].rel).toBe("shared/material-1.12.0.aar");
    expect(r.matched).toHaveLength(1);
  });
});
