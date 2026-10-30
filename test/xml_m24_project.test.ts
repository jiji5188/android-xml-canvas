import { describe, it, expect } from "vitest";
import { buildProjectTree, mainLayoutEntry, type ProjectNode } from "@/lib/xml/project";
import type { WsProject } from "@/lib/xml/workspace";

const f = (rel: string): WsProject => ({
  name: rel.split("/").pop() as string,
  kind: "file",
  rel,
  layoutCount: 1,
});
const d = (rel: string, n: number): WsProject => ({
  name: rel.split("/").pop() as string,
  kind: "dir",
  rel,
  layoutCount: n,
});

const names = (nodes: ProjectNode[], out: string[] = []): string[] => {
  for (const n of nodes) {
    out.push((n.kind === "dir" ? "D:" : "F:") + n.rel);
    names(n.children, out);
  }
  return out;
};

describe("M24 项目结构树", () => {
  it("把扁平的 rel 列表还原成树（目录在前、字母序）", () => {
    const tree = buildProjectTree([
      f("layout/activity_main.xml"),
      f("layout/activity_detail.xml"),
      f("values/strings.xml"),
      d("layout", 2),
      d("values", 1),
    ]);
    expect(names(tree)).toEqual([
      "D:layout",
      "F:layout/activity_detail.xml",
      "F:layout/activity_main.xml",
      "D:values",
      "F:values/strings.xml",
    ]);
  });

  it("父目录没被列出来时自动补上（安卓工程 app/src/main/res 这种深层）", () => {
    const tree = buildProjectTree([f("app/src/main/res/layout/activity_main.xml")]);
    expect(names(tree)).toEqual([
      "D:app",
      "D:app/src",
      "D:app/src/main",
      "D:app/src/main/res",
      "D:app/src/main/res/layout",
      "F:app/src/main/res/layout/activity_main.xml",
    ]);
  });

  it("空列表 → 空树", () => {
    expect(buildProjectTree([])).toEqual([]);
  });

  it("主布局优先 activity_main / main / 含 main", () => {
    expect(mainLayoutEntry([f("layout/zzz.xml"), f("layout/activity_main.xml")])?.rel).toBe(
      "layout/activity_main.xml",
    );
    expect(mainLayoutEntry([f("a/b.xml"), f("a/main.xml")])?.rel).toBe("a/main.xml");
    expect(mainLayoutEntry([f("a/login.xml"), f("a/main_screen.xml")])?.rel).toBe("a/main_screen.xml");
    expect(mainLayoutEntry([f("a/b.xml"), f("a/c.xml")])?.rel).toBe("a/b.xml");
  });

  it("只有目录时挑第一个带布局且可读的目录", () => {
    const dir = { ...d("layout", 2), target: "content://x" };
    expect(mainLayoutEntry([d("empty", 0), dir])?.rel).toBe("layout");
    expect(mainLayoutEntry([d("layout", 2)])).toBeNull();
  });
});
