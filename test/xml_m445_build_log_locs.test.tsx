import { describe, expect, it } from "vitest";
import { parseBuildLogLocs } from "@/components/ProblemsDrawer";

// M445：构建日志错误定位解析
const LOG = [
  "ECJ 结果：2 个错误，涉及 2 个文件（同类消息已合并）",
  "● MainActivity.java",
  "    L42  The import com.foo.Bar cannot be resolved（×2）",
  "    L7  未声明的变量: x",
  "● SecondActivity.java",
  "    L15  The method onCreate(Bundle) is undefined",
  "缺依赖提示：以下第三方包不在编译 classpath —— com.foo",
  "  需手动下载放进项目 libs/ 目录的包：",
  "    - com.foo  →  搜「com.foo」的官方 jar，放到 libs/",
].join("\n");

describe("M445 parseBuildLogLocs", () => {
  it("解析 ●文件 + L行 消息", () => {
    const locs = parseBuildLogLocs(LOG);
    expect(locs).toHaveLength(3);
    expect(locs[0]).toEqual({ file: "MainActivity.java", line: 42, msg: "The import com.foo.Bar cannot be resolved" });
    expect(locs[1]).toEqual({ file: "MainActivity.java", line: 7, msg: "未声明的变量: x" });
    expect(locs[2]).toEqual({ file: "SecondActivity.java", line: 15, msg: "The method onCreate(Bundle) is undefined" });
  });

  it("缺依赖/需手动段不进定位列表", () => {
    const locs = parseBuildLogLocs(LOG);
    expect(locs.some((l) => l.file === "com.foo")).toBe(false);
    expect(locs.some((l) => /缺依赖|需手动/.test(l.msg))).toBe(false);
  });

  it("空日志 → 空", () => {
    expect(parseBuildLogLocs("")).toEqual([]);
    expect(parseBuildLogLocs(undefined)).toEqual([]);
  });

  it("无 L 前缀的旧格式 → line=0（仍可展示）", () => {
    const old = "● A.java\n    错误消息没有行号";
    const locs = parseBuildLogLocs(old);
    expect(locs[0]).toEqual({ file: "A.java", line: 0, msg: "错误消息没有行号" });
  });
});
