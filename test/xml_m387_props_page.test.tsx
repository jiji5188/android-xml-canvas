// @vitest-environment jsdom
// M387：项目属性弹窗 → 全屏子页 + Gradle 配置表单
// 1) setAppConfigField 纯逻辑：三种写法替换 + 缺失插入 + 拒绝瞎插
// 2) ProjectPropsDialog 渲染成子页（axv-icon-page + 返回条 + 可编辑 SDK/版本表单）
//    用 RTL（effect 要真跑，renderToStaticMarkup 不触加载）

import { describe, expect, it, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ProjectPropsDialog } from "@/components/ProjectPropsDialog";
import { setAppConfigField } from "@/lib/xml/project-info";
import type { ProjectSource } from "@/lib/xml/project-browse";
import type { WsProject } from "@/lib/xml/workspace";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
// RTL 自动清理需要全局 afterEach（vitest 未开 globals）→ 手动注册，否则多个 render 的 portal 会堆在 document.body
afterEach(() => cleanup());

const GROOVY = `plugins {
    id 'com.android.application'
}

android {
    namespace 'com.example.old'
    compileSdk 34

    defaultConfig {
        applicationId 'com.example.old'
        minSdkVersion 21
        targetSdkVersion 33
        versionCode 1
        versionName "1.0"
    }
}
`;

const KTS = `plugins {
    id("com.android.application")
}

android {
    namespace = "com.example.kts"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.example.kts"
        minSdk = 24
        versionCode = 7
        versionName = "2.3"
    }
}
`;

describe("M387 setAppConfigField", () => {
  it("groovy：compileSdk 34 → 35，不误伤别的行", () => {
    const r = setAppConfigField(GROOVY, "compileSdk", "35");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("compileSdk 35");
    expect(r.text).toContain("targetSdkVersion 33");
  });

  it("kts：compileSdk = 34 → 36", () => {
    const r = setAppConfigField(KTS, "compileSdk", "36");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("compileSdk = 36");
    expect(r.text).toContain("minSdk = 24");
  });

  it("SDK 旧写法：minSdkVersion 21 → 24", () => {
    const r = setAppConfigField(GROOVY, "minSdk", "24");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("minSdkVersion 24");
  });

  it("versionName 引号替换", () => {
    const r = setAppConfigField(GROOVY, "versionName", "2.0");
    expect(r.ok).toBe(true);
    expect(r.text).toContain('versionName "2.0"');
  });

  it("namespace 替换（统一双引号；applicationId 不动）", () => {
    const r = setAppConfigField(GROOVY, "namespace", "com.example.new");
    expect(r.ok).toBe(true);
    expect(r.text).toContain('namespace "com.example.new"');
    expect(r.text).toContain("applicationId 'com.example.old'"); // 只改 namespace，applicationId 保持原样
  });

  it("缺 compileSdk：插到 android { 顶层（合法位置）", () => {
    const t = `android {\n    namespace "x"\n}\n`;
    const r = setAppConfigField(t, "compileSdk", "34");
    expect(r.ok).toBe(true);
    expect(r.text).toBe(`android {\n    compileSdk 34\n    namespace "x"\n}\n`);
  });

  it("kts 缺 compileSdk：= 写法插入", () => {
    const t = `android {\n    namespace = "x"\n}\n`;
    const r = setAppConfigField(t, "compileSdk", "34", true);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("compileSdk = 34");
  });

  it("缺 versionCode：拒绝瞎插（它属于 defaultConfig）", () => {
    const t = `android {\n    namespace "x"\n}\n`;
    const r = setAppConfigField(t, "versionCode", "9");
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("versionCode");
  });

  it("没有 android { 块：报错不硬改", () => {
    const r = setAppConfigField("plugins { }", "minSdk", "24");
    expect(r.ok).toBe(false);
    expect(r.msg).toContain("android");
  });

  it("非法值：SDK/versionCode 非数字 → 拒绝", () => {
    expect(setAppConfigField(GROOVY, "minSdk", "abc").ok).toBe(false);
    expect(setAppConfigField(GROOVY, "versionCode", "x1").ok).toBe(false);
    expect(setAppConfigField(GROOVY, "minSdk", "  ").ok).toBe(false);
  });
});

function fakeItem(): WsProject {
  return { name: "demo", kind: "dir", rel: "demo", layoutCount: 1 };
}

function fakeSource(gradleText: string | null, gradleRel = "app/build.gradle"): ProjectSource {
  const stringsXml = `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">演示</string>\n</resources>\n`;
  return {
    name: "demo",
    listChildren: async (rel: string) => {
      if (rel === "") return [{ kind: "dir" as const, name: "app", rel: "app" }];
      return [];
    },
    readText: async (rel: string) => {
      if (rel === gradleRel) return gradleText;
      if (rel === "app/src/main/res/values/strings.xml") return stringsXml;
      return null;
    },
  };
}

function renderProps(gradleText: string | null) {
  return render(
    <ProjectPropsDialog
      item={fakeItem()}
      source={fakeSource(gradleText)}
      saveRoot={null}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
}

describe("M387 项目属性子页", () => {
  it("渲染成全屏子页（axv-icon-page axv-cv-page）+ 返回条", async () => {
    renderProps(GROOVY);
    // 加载完成后断言（等表单出现）；Overlay portal 到 document.body，不用 render container
    await screen.findByText("compileSdk");
    expect(document.querySelector(".axv-icon-page")).toBeTruthy();
    expect(document.querySelector(".axv-cv-page")).toBeTruthy();
    expect(document.querySelector(".axv-icon-back")).toBeTruthy();
    expect(document.querySelector(".axv-shape-head")).toBeTruthy();
  }, 20000);

  it("Gradle 表单字段带初值（groovy 旧写法也读得出）", async () => {
    renderProps(GROOVY);
    await screen.findByText("compileSdk");
    expect(screen.getByDisplayValue("34")).toBeTruthy(); // compileSdk
    expect(screen.getByDisplayValue("33")).toBeTruthy(); // targetSdk（旧写法 targetSdkVersion）
    expect(screen.getByDisplayValue("21")).toBeTruthy(); // minSdk（旧写法 minSdkVersion）
    expect(screen.getByDisplayValue("1.0")).toBeTruthy(); // versionName
    expect(screen.getByDisplayValue("1")).toBeTruthy(); // versionCode
  }, 20000);

  it("kts 也认", async () => {
    renderProps(KTS);
    await screen.findByText("compileSdk");
    expect(screen.getByDisplayValue("24")).toBeTruthy();
    expect(screen.getByDisplayValue("2.3")).toBeTruthy();
  }, 20000);

  it("没 gradle 文件：不出表单，不崩", async () => {
    renderProps(null);
    // 加载完成后（strings 也缺 → 直接落到表单区）
    await new Promise((r) => setTimeout(r, 80));
    expect(document.querySelector(".axv-icon-page")).toBeTruthy();
    expect(document.querySelector(".axv-prop-form")).toBeNull();
  }, 20000);
});
