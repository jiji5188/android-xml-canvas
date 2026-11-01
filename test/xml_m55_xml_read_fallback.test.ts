// M55：APK 端「当前项目」树点 xml 没反应的根因修复
// ① workspace 的 native 映射漏了 it.path → xml 文件条目 target 全空，readText 返回 null
// ② nativeProjectSource.readText 的 rootDir 回退原来只对 java/kt 生效，改为任意扩展名兜底
import { describe, it, expect } from "vitest";
import { nativeProjectSource, type BrowseEntry } from "@/lib/xml/project-browse";

function fakeNative() {
  // 模拟老 APK 的 listProjects 输出：xml 条目只有 path，没有 mainPath/docUri
  const fake = {
    saveFile: () => true,
    readText: (target: string) => (target.includes("activity_main") ? "<LinearLayout/>" : target.includes("strings") ? "<resources/>" : null),
  };
  Object.defineProperty(globalThis, "window", {
    value: { AxvNative: fake },
    configurable: true,
    writable: true,
  });
}

describe("M55 xml 文件 target 缺失时的 readText 回退", () => {
  it("xml 条目即使 target 为空，rootDir 回退也能读出来（模拟 mapping 修复前）", async () => {
    fakeNative();
    const all: BrowseEntry[] = [
      { kind: "dir", name: "MyApp", rel: "MyApp", target: "/sdcard/x/main.xml" },
      { kind: "file", name: "activity_main.xml", rel: "app/src/main/res/layout/activity_main.xml", target: "" },
      { kind: "file", name: "strings.xml", rel: "res/values/strings.xml", target: "" },
    ];
    const src = nativeProjectSource("MyApp", all as never, "/sdcard/AndroidUIIDE/Project/MyApp");
    // 同步 bridge：readText(target=".../activity_main.xml") → "<LinearLayout/>"
    const xml = await src.readText("app/src/main/res/layout/activity_main.xml");
    expect(xml).toBe("<LinearLayout/>");
    const strings = await src.readText("res/values/strings.xml");
    expect(strings).toBe("<resources/>");
  });

  it("tree 行（listDir 带 target）点 java 文件：不在扁平列表也能读（M45b 保留行为）", async () => {
    fakeNative();
    const all: { kind: "file"; name: string; rel: string; layoutCount: number }[] = [];
    const src = nativeProjectSource("MyApp", all, "/sdcard/AndroidUIIDE/Project/MyApp");
    // java 不在 all 里，靠 rootDir 回退（bridge 读不到返回 null 是预期，这里只验证不崩、不抛错）
    const out = await src.readText("app/src/main/java/com/x/Main.java");
    expect(out).toBeNull();
  });
});
