// @vitest-environment jsdom
// M425：项目库 tab fileTree 二级列表
// 1) 组头渲染（库目录 · dir + 文件数 + include），默认折叠
// 2) 点组头展开 → 该目录文件出现；再点收起
// 3) 标准目录（app/src/main/libs）文件直接列出，不进 fileTree 组
// 4) 顶部不再有「库目录」平铺按钮（改列表内组头 + 新建库目录入口）
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LibsPanel } from "@/components/LibsPanel";
import type { AiFileIo, AiFileEntry } from "@/lib/xml/ai-tools";
import type { GradleDep } from "@/lib/xml/gradle-deps";

const ROOT_BUILD = `buildscript { repositories { google() } }`;
const APP_BUILD = `plugins { id 'com.android.application' }
dependencies {
    implementation 'com.example:cool-lib:1.0.0'
    implementation fileTree(dir: 'libs', include: ['*.aar', '*.jar'])
}`;
/** M426 冲突样例：同名多版本 + 跨 group 同名 */
const APP_BUILD_CONFLICT = `plugins { id 'com.android.application' }
dependencies {
    implementation 'com.example:cool-lib:1.0.0'
    implementation 'com.example:cool-lib:2.0.0'
    implementation 'com.other:cool-lib:1.5.0'
    implementation fileTree(dir: 'libs', include: ['*.aar', '*.jar'])
}`;

function mockIo(appBuildText?: string): AiFileIo {
  const files: Record<string, AiFileEntry[]> = {
    "app/src/main/libs": [{ name: "std-lib.jar", kind: "file", rel: "app/src/main/libs/std-lib.jar" }],
    "app/libs": [{ name: "ft-lib.aar", kind: "file", rel: "app/libs/ft-lib.aar" }],
  };
  const texts: Record<string, string> = {
    "app/build.gradle": appBuildText ?? APP_BUILD,
  };
  return {
    rootLabel: () => "TestProject",
    async list(rel: string) {
      if (files[rel]) return { ok: true, items: files[rel] };
      return { ok: false, error: "no dir" };
    },
    async read(rel: string) {
      if (texts[rel] !== undefined) return { ok: true, text: texts[rel] };
      return { ok: false, error: "no file" };
    },
    async write() {
      return { ok: false, error: "test mock" };
    },
  };
}

const tr = (_k: string, f: string, vars?: Record<string, string | number>) =>
  f.replace(/\{(\w+)\}/g, (_m, n: string) => (vars && n in vars ? String(vars[n]) : `{${n}}`));

function mountLibs() {
  return render(<LibsPanel aiFileIo={mockIo()} onNote={() => {}} tr={tr} />);
}

async function gotoProjectTab() {
  const c = mountLibs();
  // 切到项目库 tab
  fireEvent.click(screen.getByText("项目库"));
  // gradle 扫描 + refresh 都是 async，等 maven 依赖行出现
  await waitFor(() => expect(screen.getByText("cool-lib")).toBeTruthy(), { timeout: 3000 });
  return c;
}

afterEach(() => cleanup());

describe("M425 项目库 fileTree 二级列表", () => {
  it("组头显示 dir + 文件数 + include，默认折叠不显示组内文件", async () => {
    const c = await gotoProjectTab();
    expect(c.container.textContent).toContain("库目录 · libs");
    expect(c.container.textContent).toContain("include: *.aar, *.jar");
    // 组头带文件数（1）
    expect(c.container.textContent).toContain("(1)");
    // 默认折叠：组内文件不出现
    expect(c.container.textContent).not.toContain("ft-lib.aar");
    // 空目录提示也不出现
    expect(c.container.textContent).not.toContain("该目录下暂无库文件");
  });

  it("点组头展开显示该目录文件，再点收起", async () => {
    const c = await gotoProjectTab();
    fireEvent.click(c.container.querySelector('[title="libs"]')!);
    await waitFor(() => expect(c.container.textContent).toContain("ft-lib.aar"));
    // 展开后组内文件带 rel 路径
    expect(c.container.textContent).toContain("app/libs/ft-lib.aar");
    // 再点收起
    fireEvent.click(c.container.querySelector('[title="libs"]')!);
    await waitFor(() => expect(c.container.textContent).not.toContain("ft-lib.aar"));
  });

  it("组头上的「编辑」按钮打开弹窗且不触发折叠切换", async () => {
    const c = await gotoProjectTab();
    const editBtn = c.container.querySelector('button[title="编辑库目录"]')!;
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn);
    // 弹窗标题出现（编辑模式带 dir）
    expect(c.container.textContent).toContain("库目录");
    // 文件仍然折叠（没被切换）
    expect(c.container.textContent).not.toContain("ft-lib.aar");
  });

  it("无冲突时不显示黄条", async () => {
    const c = await gotoProjectTab();
    expect(c.container.textContent).not.toContain("依赖冲突");
  });

  it("M426：同名多版本 + 跨 group 同名 → 黄条列出冲突", async () => {
    const c = mountLibsConf();
    // 切到项目库 tab
    fireEvent.click(c.getByText("项目库"));
    await waitFor(() => expect(c.container.textContent).toContain("cool-lib"), { timeout: 3000 });
    // 黄条出现
    expect(c.container.textContent).toContain("依赖冲突");
    // 版本冲突文案（cool-lib 多版本）
    expect(c.container.textContent).toContain("多版本");
    expect(c.container.textContent).toContain("com.example:cool-lib:1.0.0");
    expect(c.container.textContent).toContain("com.example:cool-lib:2.0.0");
    // 跨 group 同名文案
    expect(c.container.textContent).toContain("同名来自不同 group");
    expect(c.container.textContent).toContain("com.example:cool-lib");
    expect(c.container.textContent).toContain("com.other:cool-lib");
  });
});

function mountLibsConf() {
  return render(<LibsPanel aiFileIo={mockIo(APP_BUILD_CONFLICT)} onNote={() => {}} tr={tr} />);
}

function mountLibsDir(appBuildText?: string, files?: Record<string, AiFileEntry[]>) {
  const io: AiFileIo = {
    rootLabel: () => "TestProject",
    async list(rel: string) {
      if (files && files[rel]) return { ok: true, items: files[rel] };
      if (rel === "app/src/main/libs") return { ok: true, items: [{ name: "std-lib.jar", kind: "file", rel: "app/src/main/libs/std-lib.jar" }] };
      return { ok: false, error: "no dir" };
    },
    async read(rel: string) {
      if (rel === "app/build.gradle") return { ok: true, text: appBuildText ?? APP_BUILD };
      return { ok: false, error: "no file" };
    },
    async write() { return { ok: false, error: "test mock" }; },
  };
  return render(<LibsPanel aiFileIo={io} onNote={() => {}} tr={tr} />);
}

describe("M434 fileTree 指向标准目录时文件归属正确", () => {
  it("fileTree(dir: 'src/main/libs') → 标准目录文件进 fileTree 组，不进标准目录列表", async () => {
    const ftBuild = `plugins { id 'com.android.application' }
dependencies {
    implementation fileTree(dir: 'src/main/libs', include: ['*.jar', '*.aar'])
}`;
    const c = mountLibsDir(ftBuild);
    fireEvent.click(c.getByText("项目库"));
    // 等 fileTree 组头出现（库目录 · src/main/libs）
    await waitFor(() => expect(c.container.textContent).toContain("库目录 · src/main/libs"), { timeout: 3000 });
    // 展开 fileTree 组 → 标准目录的 std-lib.jar 应进该组（归属修正）
    fireEvent.click(c.container.querySelector('[title="src/main/libs"]')!);
    await waitFor(() => expect(c.container.textContent).toContain("std-lib.jar"));
    // 标准目录列表不再单独列它（被 fileTree 认领）
    expect(c.container.textContent).not.toContain("标准目录（app/src/main/libs 等）");
  });
});

describe("M425 标准目录 + 顶部按钮", () => {
  it("标准目录文件直接列出 + 列表底部无新建库目录按钮（M431 改到菜单）+ 顶部无平铺库目录按钮", async () => {
    const c = await gotoProjectTab();
    // 标准目录文件立即可见（不在折叠组里）
    expect(c.container.textContent).toContain("std-lib.jar");
    expect(c.container.textContent).toContain("app/src/main/libs/std-lib.jar");
    expect(c.container.textContent).toContain("标准目录（app/src/main/libs 等）");
    // M431：新建库目录 / 加依赖 的常驻按钮已删，功能改到依赖行右键菜单（空项目时走空态入口）
    expect(c.container.textContent).not.toContain("新建库目录");
    // 顶部 actions 行（搜索框同级）不再有「库目录」按钮 —— 老 UI 是文件夹图标 + 文本「库目录」直接在搜索行
    const searchRow = c.container.querySelector(".axv-libs-actions")!;
    expect(searchRow.textContent).not.toContain("库目录");
  });
});
