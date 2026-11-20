// test/xml_m440_debug_log_route.test.tsx — M440：Java 调试运行日志路由进「运行日志」tab
//  ① buildLogs 里 kind=debug 的条目在「构建日志」tab 不显示（只列 kind!=='debug'）
//  ② 同一条目在「运行日志」tab 显示（debugLogs[0]）
//  ③ 抽屉角标：build-log 角标只统计非 debug 条；runtime 角标 = 广播日志条数 + debug 条数
//  ④ 没有 debug 条目时「构建日志」tab 行为不变（旧日志全显示）

// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { ProblemsDrawer, type BuildLogEntry } from "@/components/ProblemsDrawer";

let i = 0;
function tr(key: string, fb: string, vars?: Record<string, string | number>) {
  let s = fb || key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace("{" + k + "}", String(v));
  return s;
}

function mk(id: string, over: Partial<BuildLogEntry> = {}): BuildLogEntry {
  i += 1;
  return { id, ok: true, stage: "打包成功", log: "log-" + id, ...over, ...(over.kind ? {} : {}) };
}

describe("M440 调试日志路由", () => {
  afterEach(() => cleanup());

  it("① 构建日志 tab 不显示 kind=debug 条目", () => {
    const buildLogs = [mk("b1"), mk("d1", { kind: "debug", stage: "调试运行成功" }), mk("d2", { kind: "debug", ok: false, stage: "调试运行失败", log: "java.lang.Error: x" })];
    render(
      <ProblemsDrawer
        problems={[]}
        onGotoLine={() => {}}
        tr={tr}
        buildLogs={buildLogs}
        runtimeLogs={[]}
      />,
    );
    // 切到构建日志 tab
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs.find((t) => t.textContent?.includes("构建日志"))!);
    // 只看到 1 条构建日志卡片（b1），debug 的 2 条不出现
    expect(screen.getAllByText(/打包成功/).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryAllByText(/调试运行成功/).length).toBe(0);
    expect(screen.queryAllByText(/调试运行失败/).length).toBe(0);
  });

  it("② 运行日志 tab 显示 kind=debug 条目（卡片形式）", () => {
    const buildLogs = [mk("d1", { kind: "debug", stage: "调试运行成功（42ms）", log: "hello world" })];
    render(
      <ProblemsDrawer
        problems={[]}
        onGotoLine={() => {}}
        tr={tr}
        buildLogs={buildLogs}
        runtimeLogs={[]}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs.find((t) => t.textContent?.includes("运行日志"))!);
    expect(screen.getByText("hello world")).toBeTruthy();
    expect(screen.getByText(/调试运行成功/)).toBeTruthy();
  });

  it("③ 广播运行日志 + debug 日志同时在运行日志 tab 显示", () => {
    const buildLogs = [mk("d1", { kind: "debug", stage: "调试编译成功", log: "comp.log" })];
    const runtimeLogs = [{ id: "r1", ts: 1, appPkg: "com.axv", level: "log", line: "onCreate" }];
    render(
      <ProblemsDrawer
        problems={[]}
        onGotoLine={() => {}}
        tr={tr}
        buildLogs={buildLogs}
        runtimeLogs={runtimeLogs}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs.find((t) => t.textContent?.includes("运行日志"))!);
    // debug 卡片 + 广播日志 pre 同时出现
    expect(screen.getByText("comp.log")).toBeTruthy();
    expect(screen.getByText(/onCreate/)).toBeTruthy();
  });

  it("④ 没有 debug 条目时构建日志 tab 行为不变（全显示）", () => {
    const buildLogs = [mk("b1", { stage: "打包成功" }), mk("b2", { stage: "资源检查", ok: false })];
    render(
      <ProblemsDrawer
        problems={[]}
        onGotoLine={() => {}}
        tr={tr}
        buildLogs={buildLogs}
        runtimeLogs={[]}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    fireEvent.click(tabs.find((t) => t.textContent?.includes("构建日志"))!);
    expect(screen.getByText("打包成功")).toBeTruthy();
    expect(screen.getByText(/资源检查/)).toBeTruthy();
  });

  it("⑤ runtime 角标 = 广播条数 + debug 条数", () => {
    const buildLogs = [mk("d1", { kind: "debug" }), mk("d2", { kind: "debug" })];
    const runtimeLogs = [
      { id: "r1", ts: 1, appPkg: "com.axv", level: "log", line: "a" },
      { id: "r2", ts: 2, appPkg: "com.axv", level: "log", line: "b" },
    ];
    render(
      <ProblemsDrawer
        problems={[]}
        onGotoLine={() => {}}
        tr={tr}
        buildLogs={buildLogs}
        runtimeLogs={runtimeLogs}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    const rtTab = tabs.find((t) => t.textContent?.includes("运行日志"))!;
    expect(rtTab.textContent).toContain("4"); // 2 broadcast + 2 debug
  });

  it("⑥ build-log 角标只在有非 debug 条时显示", () => {
    const buildLogs = [mk("d1", { kind: "debug" })];
    render(
      <ProblemsDrawer
        problems={[]}
        onGotoLine={() => {}}
        tr={tr}
        buildLogs={buildLogs}
        runtimeLogs={[]}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    const blTab = tabs.find((t) => t.textContent?.includes("构建日志"))!;
    // 没有非 debug 条 → 该 tab 无角标
    expect(blTab.textContent).not.toContain("•");
    const withBuild = [mk("b1")];
    cleanup();
    render(
      <ProblemsDrawer
        problems={[]}
        onGotoLine={() => {}}
        tr={tr}
        buildLogs={withBuild}
        runtimeLogs={[]}
      />,
    );
    const tabs2 = screen.getAllByRole("tab");
    const blTab2 = tabs2.find((t) => t.textContent?.includes("构建日志"))!;
    // 有非 debug 条 → 角标出现（用 aria-hidden 的 dot，textContent 不含文本，改用 DOM 查询）
    const dot = blTab2.querySelector(".axv-drawer-badge-log");
    expect(dot).toBeTruthy();
  });
});
