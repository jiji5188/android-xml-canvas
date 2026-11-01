// M46d：新建弹窗里「位置」radio 的路径缩写（避免长包名把弹窗撑破）
import { describe, it, expect } from "vitest";
import { shortPath } from "@/components/TreeFileMenu";

describe("M46d shortPath：只留尾部路径", () => {
  it("用户例：同层只留最后一级", () => {
    expect(shortPath("app/src/main/java/com/returngoods/app")).toBe(".../app/");
  });

  it("用户例：目录内能放下两级就放两级", () => {
    expect(shortPath("app/src/main/java/com/returngoods/app/scanner")).toBe(".../app/scanner/");
  });

  it("短路径不加省略号", () => {
    expect(shortPath("res/layout")).toBe("res/layout/");
    expect(shortPath("res")).toBe("res/");
  });

  it("项目根（空串）返回空，调用方自己补「项目根」", () => {
    expect(shortPath("")).toBe("");
    expect(shortPath("/")).toBe("");
  });

  it("忽略尾部斜杠与重复斜杠", () => {
    expect(shortPath("/a/b/")).toBe("a/b/");
    expect(shortPath("res//drawable")).toBe("res/drawable/");
  });

  it("极长单级目录也至少留一级", () => {
    expect(shortPath("com/verylongpackagename")).toBe(".../verylongpackagename/");
  });
});
