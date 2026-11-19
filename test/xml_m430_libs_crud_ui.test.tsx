// @vitest-environment jsdom
// M430：项目库逐条增删改 —— UI 行为（aiFileIo 双通道，不 mock native）
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LibsPanel } from "@/components/LibsPanel";
import type { AiFileIo, AiFileEntry } from "@/lib/xml/ai-tools";

const ROOT = "/proj";
let ioTexts: Record<string, string> = {};
let ioWrites: string[] = [];

function mockIo(appBuildText: string): AiFileIo {
  ioTexts = { "app/build.gradle": appBuildText };
  ioWrites = [];
  const files: Record<string, AiFileEntry[]> = {};
  return {
    rootLabel: () => "TestProject",
    async list(rel: string) {
      if (files[rel]) return { ok: true, items: files[rel] };
      return { ok: false, error: "no dir" };
    },
    async read(rel: string) {
      if (ioTexts[rel] !== undefined) return { ok: true, text: ioTexts[rel] };
      return { ok: false, error: "no file" };
    },
    async write(rel: string, text: string) {
      ioWrites.push(text);
      ioTexts[rel] = text;
      return { ok: true };
    },
  };
}

const USER_BUILD = `plugins { id 'com.android.application' }
dependencies {
    implementation 'androidx.appcompat:appcompat:1.0.0'
\timplementation ('com.google.android.material:material:1.0.0') {
        exclude group: 'com.android.support', module: 'support-compat'
        exclude group: 'com.android.support', module: 'support-core-ui'
        exclude group: 'com.android.support', module: 'support-fragment'
        exclude group: 'com.android.support', module: 'support-v4'
    }
    implementation 'net.sourceforge.jexcelapi:jxl:2.6.12'
    implementation fileTree(dir: 'libs', include: ['*.jar'])
}`;

const BARE_BUILD = `plugins { id 'com.android.application' }
`;

const tr = (_k: string, f: string, vars?: Record<string, string | number>) =>
  f.replace(/\{(\w+)\}/g, (_m, n: string) => (vars && n in vars ? String(vars[n]) : `{${n}}`));

function mount(build: string) {
  const c = render(<LibsPanel aiFileIo={mockIo(build)} nativeProjectRoot={ROOT} onNote={() => {}} tr={tr} />);
  fireEvent.click(screen.getByText("项目库"));
  return c;
}

afterEach(() => cleanup());

async function waitDep(name: string) {
  await waitFor(() => expect(screen.getByText(name)).toBeTruthy(), { timeout: 5000 });
}

describe("M430 exclude 展开与删除", () => {
  it("material 行带 exclude 4 徽标，点开显示 4 条，× 删一条写回 gradle", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    expect(c.container.textContent).toContain("exclude 4");
    expect(c.container.textContent).not.toContain("support-core-ui");
    fireEvent.click(c.container.querySelector('button[aria-label="展开 / 收起 exclude"]')!);
    await waitFor(() => expect(c.container.textContent).toContain("com.android.support : support-v4"));
    expect((c.container.textContent.match(/com.android.support : /g) || []).length).toBe(4);
    const v4Row = [...c.container.querySelectorAll(".axv-libs-item")].find((el) =>
      el.textContent?.includes("support-v4"),
    )!;
    fireEvent.click(v4Row.querySelector("button")!);
    await waitFor(() => expect(c.container.textContent).not.toContain("support-v4"));
    const written = ioWrites[0];
    expect(written).not.toContain("module: 'support-v4'");
    expect((written.match(/exclude group/g) || []).length).toBe(3);
    expect(written).toContain("com.google.android.material:material:1.0.0");
  });
});

describe("M430 右键菜单", () => {
  it("依赖行右键 → 编辑依赖改版本保留 exclude", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    const matRow = [...c.container.querySelectorAll(".axv-libs-item")].find((el) =>
      el.textContent?.includes("material"),
    )!;
    fireEvent.contextMenu(matRow);
    const editItem = await screen.findByText("编辑依赖");
    expect(screen.getByText("添加 exclude")).toBeTruthy();
    expect(screen.getByText("复制坐标")).toBeTruthy();
    expect(screen.getByText("移除")).toBeTruthy();
    fireEvent.click(editItem);
    await waitFor(() => expect(screen.getByDisplayValue("com.google.android.material")).toBeTruthy());
    const dlg = c.container.querySelector('[role="dialog"]')!;
    const verInput = [...dlg.querySelectorAll("input")].find((i) => (i as HTMLInputElement).value === "1.0.0")!;
    fireEvent.change(verInput, { target: { value: "1.12.0" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(ioWrites.length).toBeGreaterThan(0));
    const written = ioWrites[ioWrites.length - 1];
    expect(written).toContain("com.google.android.material:material:1.12.0");
    expect(written).not.toContain("material:1.0.0");
    expect((written.match(/exclude group/g) || []).length).toBe(4);
  });

  it("添加 exclude → 写入块内（单行依赖自动开块）", async () => {
    const c = mount(USER_BUILD);
    await waitDep("jxl");
    const jxlRow = [...c.container.querySelectorAll(".axv-libs-item")].find((el) =>
      el.textContent?.includes("jxl"),
    )!;
    fireEvent.contextMenu(jxlRow);
    fireEvent.click(await screen.findByText("添加 exclude"));
    await waitFor(() => expect(c.container.querySelector('[role="dialog"]')).toBeTruthy());
    const inputs = c.container.querySelectorAll('[role="dialog"] input');
    fireEvent.change(inputs[0], { target: { value: "com.example" } });
    fireEvent.change(inputs[1], { target: { value: "bad-module" } });
    fireEvent.click(screen.getByText("添加"));
    await waitFor(() => expect(ioWrites.length).toBeGreaterThan(0));
    const written = ioWrites[ioWrites.length - 1];
    expect(written).toContain("exclude group: 'com.example', module: 'bad-module'");
    expect(written).toMatch(/jxl:2\.6\.12'\s*\{/);
  });

  it("fileTree 组头右键 → 移除声明 → gradle 里 fileTree 行没了", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    const ftHead = c.container.querySelector('[title="libs"]')!;
    expect(ftHead).toBeTruthy();
    fireEvent.contextMenu(ftHead);
    fireEvent.click(await screen.findByText("移除这条 fileTree"));
    await waitFor(() => expect(ioWrites.length).toBeGreaterThan(0));
    const written = ioWrites[ioWrites.length - 1];
    expect(written).not.toContain("fileTree");
    expect(written).toContain("material:1.0.0");
  });
});

describe("M430 添加入口", () => {
  it("底部常驻入口；Maven / 本地库目录 两 tab 可切", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    const addDep = [...c.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("加依赖（Maven）"),
    )!;
    expect(addDep).toBeTruthy();
    expect([...c.container.querySelectorAll("button")].some((b) => b.textContent?.includes("新建库目录"))).toBe(true);
    fireEvent.click(addDep);
    await waitFor(() => expect(c.container.querySelector('[role="dialog"]')).toBeTruthy());
    expect(c.container.textContent).toContain("Maven 库");
    fireEvent.click(screen.getByText("本地库目录"));
    await waitFor(() => expect(c.container.querySelector('input[list="axv-ft-dir-list"]')).toBeTruthy());
    fireEvent.click(screen.getByText("Maven 库"));
    await waitFor(() => expect(c.container.querySelector("textarea")).toBeTruthy());
  });

  it("没有 dependencies 块的 build.gradle 也能加 fileTree（自动建块）", async () => {
    const c = mount(BARE_BUILD);
    const btn = [...c.container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("新建库目录"),
    )!;
    fireEvent.click(btn);
    await waitFor(() => expect(c.container.querySelector('input[list="axv-ft-dir-list"]')).toBeTruthy());
    const dirInput = c.container.querySelector('input[list="axv-ft-dir-list"]')!;
    fireEvent.change(dirInput, { target: { value: "native-libs" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(ioWrites.length).toBeGreaterThan(0));
    const written = ioWrites[ioWrites.length - 1];
    expect(written).toContain("dependencies {");
    expect(written).toContain("implementation fileTree(dir: 'native-libs', include: ['*.jar', '*.aar'])");
  });
});
