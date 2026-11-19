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
  it("依赖行右键 → 菜单含 添加依赖/编辑/添加exclude/复制/移除，编辑改版本保留 exclude", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    const matRow = [...c.container.querySelectorAll(".axv-libs-item")].find((el) =>
      el.textContent?.includes("material"),
    )!;
    fireEvent.contextMenu(matRow);
    expect(await screen.findByText("添加依赖")).toBeTruthy();
    const menu = document.querySelector(".axv-tfm")!;
    expect(menu).toBeTruthy();
    const labels = [...menu.querySelectorAll(".axv-tfm-label")].map((el) => el.textContent);
    expect(labels).toContain("新建库目录"); // M431b：底部按钮删了，菜单必须补上入口
    const editItem = [...menu.querySelectorAll(".axv-tfm-label")].find((el) => el.textContent === "编辑")!;
    expect(editItem).toBeTruthy();
    expect(screen.getByText("添加 exclude")).toBeTruthy();
    expect(screen.getByText("复制")).toBeTruthy();
    expect(screen.getByText("移除")).toBeTruthy();
    expect(screen.queryByText("编辑依赖")).toBeNull();
    expect(screen.queryByText("复制坐标")).toBeNull();
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

  it("菜单里的 添加依赖 → 打开弹窗（Maven/本地库目录 两 tab）", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    const matRow = [...c.container.querySelectorAll(".axv-libs-item")].find((el) =>
      el.textContent?.includes("material"),
    )!;
    fireEvent.contextMenu(matRow);
    fireEvent.click(await screen.findByText("添加依赖"));
    await waitFor(() => expect(c.container.querySelector('[role="dialog"]')).toBeTruthy());
    expect(c.container.textContent).toContain("Maven 库");
    fireEvent.click(screen.getByText("本地库目录"));
    await waitFor(() => expect(c.container.querySelector('input[list="axv-ft-dir-list"]')).toBeTruthy());
  });

  it("exclude 右键 → 编辑 exclude 改 module 写回；弹窗按钮是 保存", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    expect(c.container.textContent).toContain("exclude 4");
    fireEvent.click(c.container.querySelector('button[aria-label="展开 / 收起 exclude"]')!);
    await waitFor(() => expect(c.container.textContent).toContain("com.android.support : support-core-ui"));
    const row = [...c.container.querySelectorAll(".axv-libs-item")].find((el) =>
      el.textContent?.includes("support-core-ui"),
    )!;
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByText("编辑 exclude"));
    await waitFor(() => expect(c.container.querySelector('[role="dialog"]')).toBeTruthy());
    expect(screen.getByDisplayValue("support-core-ui")).toBeTruthy();
    const inputs = c.container.querySelectorAll('[role="dialog"] input');
    fireEvent.change(inputs[1], { target: { value: "support-core-ui-new" } });
    fireEvent.click(screen.getByText("保存"));
    await waitFor(() => expect(ioWrites.length).toBeGreaterThan(0));
    const written = ioWrites[ioWrites.length - 1];
    expect(written).toContain("module: 'support-core-ui-new'");
    expect(written).not.toContain("module: 'support-core-ui'");
    expect(written).toContain("module: 'support-compat'");
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

  it("fileTree 组头右键 → 菜单含 编辑库目录/新建库目录/移除；弹菜单后 click 不折叠", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    const ftHead = c.container.querySelector('[title="libs"]')!;
    expect(ftHead).toBeTruthy();
    fireEvent.contextMenu(ftHead);
    const menu = await screen.findByText("编辑库目录");
    expect(menu).toBeTruthy();
    expect(screen.getByText("新建库目录")).toBeTruthy();
    // M431b：弹菜单后的 click 不应触发折叠（onClickCapture 拦截）
    const chevron = () => ftHead.querySelector(".msr")?.textContent;
    const before = chevron();
    fireEvent.click(ftHead);
    expect(chevron()).toBe(before);
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

describe("M431 入口与布局", () => {
  it("底部常驻入口已删；依赖行菜单有 添加依赖；弹窗两 tab 可切", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    expect([...c.container.querySelectorAll("button")].some((b) => b.textContent?.includes("加依赖（Maven）"))).toBe(false);
    expect([...c.container.querySelectorAll("button")].some((b) => b.textContent?.includes("新建库目录"))).toBe(false);
    const matRow = [...c.container.querySelectorAll(".axv-libs-item")].find((el) =>
      el.textContent?.includes("material"),
    )!;
    fireEvent.contextMenu(matRow);
    fireEvent.click(await screen.findByText("添加依赖"));
    await waitFor(() => expect(c.container.querySelector('[role="dialog"]')).toBeTruthy());
    expect(c.container.textContent).toContain("Maven 库");
    fireEvent.click(screen.getByText("本地库目录"));
    await waitFor(() => expect(c.container.querySelector('input[list="axv-ft-dir-list"]')).toBeTruthy());
    fireEvent.click(screen.getByText("Maven 库"));
    await waitFor(() => expect(c.container.querySelector("textarea")).toBeTruthy());
  });

  it("刷新按钮在一键下载同一行（项目 tab）", async () => {
    const c = mount(USER_BUILD);
    await waitDep("material");
    const bars = [...c.container.children].filter((el) => el.querySelector("button"));
    const bar = bars.find((el) =>
      [...el.querySelectorAll("button")].some((b) => b.textContent?.includes("一键下载")),
    )!;
    expect(bar).toBeTruthy();
    expect([...bar.querySelectorAll("button")].some((b) => b.textContent?.includes("刷新"))).toBe(true);
    expect([...c.container.querySelectorAll("button")].filter((b) => b.textContent?.includes("刷新")).length).toBe(1);
  });

  it("没有 dependencies 块的 build.gradle 也能加 fileTree（空态入口 + 自动建块）", async () => {
    const c = mount(BARE_BUILD);
    const btn = await waitFor(() => {
      const b = [...c.container.querySelectorAll("button")].find((x) => x.textContent?.includes("新建库目录"));
      expect(b).toBeTruthy();
      return b!;
    }, { timeout: 5000 });
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
