// @vitest-environment jsdom
// M144：① 文件描述不许兜底「布局文件」 ② 展开状态持久化 ③ 定位当前文件（自动展开祖先 + 高亮）
//           ④ 点击/长按事件挂在 li 上（整行可点）
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot } from "react-dom/client";
import { LazyTreeInner } from "@/components/ProjectPanel";
import { describeFile } from "@/lib/xml/project-browse";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

const tree: Record<string, BrowseEntry[]> = {
  "": [
    { kind: "dir", name: "app", rel: "app" },
    { kind: "file", name: "build.gradle", rel: "build.gradle" },
  ],
  app: [{ kind: "dir", name: "src", rel: "app/src" }],
  "app/src": [{ kind: "dir", name: "main", rel: "app/src/main" }],
  "app/src/main": [
    { kind: "dir", name: "res", rel: "app/src/main/res" },
    { kind: "file", name: "AndroidManifest.xml", rel: "app/src/main/AndroidManifest.xml" },
  ],
  "app/src/main/res": [
    { kind: "dir", name: "layout", rel: "app/src/main/res/layout" },
    { kind: "dir", name: "drawable", rel: "app/src/main/res/drawable" },
  ],
  "app/src/main/res/layout": [{ kind: "file", name: "activity_main.xml", rel: "app/src/main/res/layout/activity_main.xml" }],
  "app/src/main/res/drawable": [{ kind: "file", name: "ic_star.xml", rel: "app/src/main/res/drawable/ic_star.xml" }],
};

const listCalls: string[] = [];

function fakeSource(): ProjectSource {
  return {
    name: "proj",
    async listChildren(rel: string) {
      listCalls.push(rel);
      return tree[rel] ?? [];
    },
    async readText() {
      return null;
    },
  };
}

const mounted: ReturnType<typeof createRoot>[] = [];

function mount(opts: { currentRel?: string | null; storeKey?: string; onOpen?: (e: BrowseEntry) => void } = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  mounted.push(root);
  root.render(
    <LazyTreeInner
      source={fakeSource()}
      rev={0}
      currentFileName=""
      currentRel={opts.currentRel ?? null}
      storeKey={opts.storeKey}
      onOpenEntry={opts.onOpen ?? (() => {})}
      extras={null}
      onOpenDrawable={() => {}}
      onPreviewImage={() => {}}
    />,
  );
  return { host, root };
}

const rowOf = (rel: string) => document.querySelector(`li[data-treerel="${rel}"]`) as HTMLElement | null;

beforeEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = "";
  window.localStorage.clear();
  listCalls.length = 0;
});

describe("M144 文件描述", () => {
  it("res/layout 的 xml 才是「布局文件」", () => {
    expect(describeFile("app/src/main/res/layout/activity_main.xml", "activity_main.xml")).toBe("布局文件");
  });

  it("其它位置的 xml 不再兜底成布局文件", () => {
    expect(describeFile("app/src/main/AndroidManifest.xml", "AndroidManifest.xml")).toBe("应用清单");
    expect(describeFile("app/src/main/res/values/strings.xml", "strings.xml")).toBe("资源值（字符串 / 颜色等）");
    expect(describeFile("app/src/main/res/drawable/ic_star.xml", "ic_star.xml")).toBe("图形 / 矢量资源");
    expect(describeFile("app/src/main/res/menu/main.xml", "main.xml")).toBe("菜单");
    expect(describeFile("app/src/main/res/mipmap-xhdpi/ic_launcher.png", "ic_launcher.png")).toBe("应用图标");
    expect(describeFile("app/src/main/res/drawable/photo.png", "photo.png")).toBe("图片资源");
    expect(describeFile("app/src/main/java/com/x/MainActivity.java", "MainActivity.java")).toBe("Activity 页面");
    expect(describeFile("app/src/main/java/com/x/GoodsAdapter.kt", "GoodsAdapter.kt")).toBe("列表适配器");
    expect(describeFile("app/src/main/java/com/x/DateUtil.java", "DateUtil.java")).toBe("工具类");
    expect(describeFile("app/src/main/java/com/x/UserBean.java", "UserBean.java")).toBe("数据模型");
    expect(describeFile("app/src/main/java/com/x/MainService.java", "MainService.java")).toBe("后台服务");
    expect(describeFile("app/src/test/java/com/x/CalcTest.java", "CalcTest.java")).toBe("测试代码（单元测试）");
    expect(describeFile("app/src/main/java/com/x/Other.java", "Other.java")).toBe("Java 源码");
    expect(describeFile("app/src/main/java/com/x/Ui.kt", "Ui.kt")).toBe("Kotlin 源码");
    expect(describeFile("build.gradle", "build.gradle")).toBe("Gradle 构建配置");
    expect(describeFile("unknown.zzz", "unknown.zzz")).toBe("");
  });
});

describe("M144 展开状态记住", () => {
  it("展开过后重建组件，那几层还是展开的", async () => {
    const first = mount({ storeKey: "proj-a" });
    await flush();
    // 展开 app
    (rowOf("app") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(rowOf("app/src")).not.toBeNull();
    expect(JSON.parse(window.localStorage.getItem("axv.tree.open.proj-a") || "[]")).toContain("app");

    first.root.unmount();
    mounted.pop();
    listCalls.length = 0;

    mount({ storeKey: "proj-a" });
    await flush();
    expect(listCalls).toContain("app");
    expect(rowOf("app/src")).not.toBeNull();
  });

  it("不同项目互不串", async () => {
    mount({ storeKey: "proj-a" });
    await flush();
    (rowOf("app") as HTMLElement).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    const a = JSON.parse(window.localStorage.getItem("axv.tree.open.proj-a") || "[]");
    expect(a.length).toBeGreaterThan(0);
    expect(window.localStorage.getItem("axv.tree.open.proj-b")).toBeNull();
  });
});

describe("M144 定位当前文件", () => {
  it("自动展开祖先层并把当前行高亮", async () => {
    mount({ currentRel: "app/src/main/res/layout/activity_main.xml", storeKey: "proj" });
    await flush();
    for (const rel of ["app", "app/src", "app/src/main", "app/src/main/res", "app/src/main/res/layout"]) {
      expect(listCalls).toContain(rel);
    }
    const row = rowOf("app/src/main/res/layout/activity_main.xml");
    expect(row).not.toBeNull();
    expect(row!.className).toContain("axv-ws-row-on");
    // 定位后展开状态也记住了
    expect(JSON.parse(window.localStorage.getItem("axv.tree.open.proj") || "[]").length).toBeGreaterThan(0);
  });
});

describe("M144 事件在 li 层", () => {
  it("直接点 li（不是内部按钮）也能打开文件", async () => {
    const opened: string[] = [];
    mount({ onOpen: (e) => opened.push(e.rel) });
    await flush();
    rowOf("build.gradle")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(opened).toEqual(["build.gradle"]);
  });

  it("li 自己就是 .axv-ws-row（缩进在 li 上，内层不再有行 div）", async () => {
    mount();
    await flush();
    const li = rowOf("app") as HTMLElement;
    expect(li.classList.contains("axv-ws-row")).toBe(true);
    expect(li.style.paddingLeft).toBe("0px");
    expect(li.querySelector(".axv-ws-row")).toBeNull();
  });
});
