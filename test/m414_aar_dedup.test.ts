// M414：aar 多版本去重（同名 artifact 保留最高版，避免 aapt2 link 资源冲突）
import { describe, it, expect } from "vitest";
import { dedupAarVersions } from "@/lib/xml/project-libs";
import type { ProjectLib } from "@/lib/xml/project-libs";

const lib = (rel: string): ProjectLib => ({ rel, base64: "x" });

describe("dedupAarVersions (M414)", () => {
  it("同名不同版 aar 只留最高版，顺序乱也认", () => {
    const { kept, dropped } = dedupAarVersions([
      lib("shared/material-1.0.0.aar"),
      lib("shared/material-1.12.0.aar"),
      lib("shared/appcompat-1.7.0.aar"),
      lib("shared/appcompat-1.0.0.aar"),
    ]);
    expect(kept.map((k) => k.rel)).toEqual([
      "shared/material-1.12.0.aar",
      "shared/appcompat-1.7.0.aar",
    ]);
    expect(dropped.map((d) => d.name).sort()).toEqual(["appcompat-1.0.0.aar", "material-1.0.0.aar"]);
  });

  it("jar 不参与去重（包级去重在 M283 处理）", () => {
    const { kept, dropped } = dedupAarVersions([
      lib("libs/guava-20.0.jar"),
      lib("libs/guava-30.0.jar"),
    ]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it("无版本段 aar 按同名去重（先到先得）", () => {
    const { kept, dropped } = dedupAarVersions([
      lib("shared/mylib.aar"),
      lib("app/src/main/libs/mylib.aar"),
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0].rel).toBe("shared/mylib.aar");
    expect(dropped).toHaveLength(1);
  });

  it("同版本保留先出现（共享库优先于项目库）", () => {
    const { kept, dropped } = dedupAarVersions([
      lib("shared/cardview-1.0.0.aar"),
      lib("app/src/main/libs/cardview-1.0.0.aar"),
    ]);
    expect(kept.map((k) => k.rel)).toEqual(["shared/cardview-1.0.0.aar"]);
    expect(dropped).toHaveLength(1);
  });

  it("多段版本按位比（1.9 < 1.12）", () => {
    const { kept } = dedupAarVersions([
      lib("shared/x-1.9.0.aar"),
      lib("shared/x-1.12.0.aar"),
      lib("shared/x-1.2.0.aar"),
    ]);
    expect(kept.map((k) => k.rel)).toEqual(["shared/x-1.12.0.aar"]);
  });
});
