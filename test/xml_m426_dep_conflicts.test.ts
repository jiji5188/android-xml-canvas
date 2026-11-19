// M426：依赖冲突检测 findDepConflicts
import { describe, it, expect } from "vitest";
import { findDepConflicts } from "@/lib/xml/gradle-deps";
import type { GradleDep } from "@/lib/xml/gradle-deps";

const dep = (g: string, n: string, v: string): GradleDep => ({
  group: g,
  name: n,
  version: v,
  raw: `implementation '${g}:${n}:${v}'`,
  config: "implementation",
  isAar: false,
});

describe("M426 findDepConflicts", () => {
  it("无冲突 → 空数组", () => {
    expect(findDepConflicts([dep("a", "b", "1.0"), dep("c", "d", "2.0")])).toEqual([]);
  });

  it("同 group:name 多版本 → version 冲突（coords 全版本）", () => {
    const cs = findDepConflicts([dep("g1", "lib", "1.0"), dep("g1", "lib", "2.0"), dep("g1", "lib", "3.0")]);
    expect(cs).toHaveLength(1);
    expect(cs[0].kind).toBe("version");
    expect(cs[0].artifact).toBe("lib");
    expect(cs[0].coords).toEqual(["g1:lib:1.0", "g1:lib:2.0", "g1:lib:3.0"]);
  });

  it("同 group:name 同版本（重复写了两行）→ 不算冲突（parser 已去重）", () => {
    expect(findDepConflicts([dep("g", "l", "1.0"), dep("g", "l", "1.0")])).toEqual([]);
  });

  it("不同 group 同名 artifact → name 冲突", () => {
    const cs = findDepConflicts([dep("com.a", "widget", "1.0"), dep("com.b", "widget", "2.0")]);
    expect(cs).toHaveLength(1);
    expect(cs[0].kind).toBe("name");
    expect(cs[0].artifact).toBe("widget");
    expect(cs[0].coords).toEqual(["com.a:widget", "com.b:widget"]);
  });

  it("既多版本又跨 group → 两条（version + name 都报）", () => {
    const cs = findDepConflicts([
      dep("com.a", "widget", "1.0"),
      dep("com.a", "widget", "2.0"),
      dep("com.b", "widget", "1.0"),
    ]);
    const kinds = cs.map((c) => c.kind).sort();
    expect(kinds).toEqual(["name", "version"]);
    const versionOne = cs.find((c) => c.kind === "version")!;
    expect(versionOne.coords).toContain("com.a:widget:1.0");
    expect(versionOne.coords).toContain("com.a:widget:2.0");
    expect(versionOne.coords).not.toContain("com.b:widget:1.0");
  });

  it("不同 artifact 名 → 无冲突", () => {
    expect(findDepConflicts([dep("g", "a", "1"), dep("g", "b", "1")])).toEqual([]);
  });
});
