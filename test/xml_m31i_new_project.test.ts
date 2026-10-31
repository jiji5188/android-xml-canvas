// test/xml_m31i_new_project.test.ts — M31i：新建项目 = 完整 Android 工程骨架
import { describe, expect, it, vi } from "vitest";
import { androidSkeleton, createAndroidProject, packageOf, safeProjectName } from "@/lib/xml/new-project";
import type { NewProjectIO } from "@/lib/xml/new-project";

describe("safeProjectName / packageOf", () => {
  it("清掉非法字符、不以数字开头", () => {
    expect(safeProjectName("My App")).toBe("My_App");
    expect(safeProjectName("  ")).toBe("MyApp");
    expect(safeProjectName("123abc")).toBe("App123abc");
    expect(safeProjectName("回退系统")).toBe("MyApp"); // 全中文 → 兜底
  });

  it("包名 com.example.<小写>", () => {
    expect(packageOf("MyApp")).toBe("com.example.myapp");
    expect(packageOf("Demo_App")).toBe("com.example.demoapp");
  });
});

describe("androidSkeleton 结构", () => {
  const files = androidSkeleton("Demo");
  const rels = files.map((f) => f.rel);

  it("含 gradle 工程文件", () => {
    expect(rels).toContain("settings.gradle");
    expect(rels).toContain("build.gradle");
    expect(rels).toContain("gradle.properties");
    expect(rels).toContain("app/build.gradle");
    expect(rels).toContain("app/proguard-rules.pro");
  });

  it("含 app/src/main 下的清单/代码/资源", () => {
    expect(rels).toContain("app/src/main/AndroidManifest.xml");
    expect(rels).toContain("app/src/main/java/com/example/demo/MainActivity.java");
    expect(rels).toContain("app/src/main/res/layout/activity_main.xml");
    expect(rels).toContain("app/src/main/res/values/strings.xml");
    expect(rels).toContain("app/src/main/res/values/themes.xml");
    expect(rels).toContain("app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml");
  });

  it("所有路径都以 app/ 开头或为根级 gradle", () => {
    for (const r of rels) {
      expect(r.startsWith("app/") || !r.includes("/")).toBe(true);
    }
  });

  it("清单里的 theme / 包名 / app_name 对得上", () => {
    const manifest = files.find((f) => f.rel === "app/src/main/AndroidManifest.xml")!.text;
    expect(manifest).toContain('android:theme="@style/Theme.Demo"');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    const theme = files.find((f) => f.rel === "app/src/main/res/values/themes.xml")!.text;
    expect(theme).toContain('name="Theme.Demo"');
    const strings = files.find((f) => f.rel === "app/src/main/res/values/strings.xml")!.text;
    expect(strings).toContain('<string name="app_name">Demo</string>');
    const activity = files.find((f) => f.rel.endsWith("MainActivity.java"))!.text;
    expect(activity).toContain("package com.example.demo;");
    expect(activity).toContain("R.layout.activity_main");
  });

  it("不生成自适应图标时可以只留 png", () => {
    const noAdaptive = androidSkeleton("Demo", { adaptiveIcon: false }).map((f) => f.rel);
    expect(noAdaptive).not.toContain("app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml");
    expect(noAdaptive).toContain("app/src/main/res/layout/activity_main.xml");
  });
});

describe("createAndroidProject", () => {
  it("把每个文件都交给 IO 写，并统计成功/失败", async () => {
    const writes: string[] = [];
    const io: NewProjectIO = {
      async writeText(rel) {
        writes.push(rel);
        return !rel.endsWith("proguard-rules.pro"); // 故意让一个失败
      },
    };
    const res = await createAndroidProject(io, "Demo");
    expect(writes.length).toBe(androidSkeleton("Demo").length);
    expect(res.ok).toBe(false);
    expect(res.failed).toEqual(["app/proguard-rules.pro"]);
    expect(res.written).toBe(writes.length - 1);
  });

  it("有自定义图标时额外写 mipmap-xxxhdpi 两张 png", async () => {
    const bins: string[] = [];
    const io: NewProjectIO = {
      async writeText() {
        return true;
      },
      async writeBinary(rel) {
        bins.push(rel);
        return true;
      },
    };
    const res = await createAndroidProject(io, "Demo", { iconBase64: "AAA", iconMime: "image/png" });
    expect(bins).toEqual([
      "app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
      "app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png",
    ]);
    expect(res.ok).toBe(true);
  });

  it("IO 抛异常不会中断整体创建", async () => {
    const io: NewProjectIO = {
      async writeText() {
        throw new Error("boom");
      },
    };
    const res = await createAndroidProject(io, "Demo");
    expect(res.written).toBe(0);
    expect(res.failed.length).toBe(androidSkeleton("Demo").length);
  });
});
