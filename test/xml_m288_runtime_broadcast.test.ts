import { describe, it, expect, beforeEach } from "vitest";
import {
  pushRuntimeLog,
  runtimeLogEntries,
  clearRuntimeLog,
  subscribeRuntimeLog,
  runtimeLogText,
} from "../lib/xml/runtime-log";
import { axvRuntimeSources } from "../lib/xml/axv-runtime";

beforeEach(() => {
  clearRuntimeLog();
});

describe("runtime-log 缓冲 M288", () => {
  it("追加并按时间顺序保存", () => {
    pushRuntimeLog({ appPkg: "a.b", line: "onCreate", level: "lifecycle", ts: 1000 });
    pushRuntimeLog({ appPkg: "a.b", line: "点击按钮", level: "log", ts: 2000 });
    const e = runtimeLogEntries();
    expect(e.length).toBe(2);
    expect(e[0].line).toBe("onCreate");
    expect(e[1].line).toBe("点击按钮");
  });

  it("同一条连续重复（1 秒内）折叠成 ×N", () => {
    pushRuntimeLog({ appPkg: "a.b", line: "onResume", ts: 1000 });
    pushRuntimeLog({ appPkg: "a.b", line: "onResume", ts: 1200 });
    pushRuntimeLog({ appPkg: "a.b", line: "onResume", ts: 1400 });
    const e = runtimeLogEntries();
    expect(e.length).toBe(1);
    expect(e[0].line).toBe("onResume · ×3");
  });

  it("超过 1 秒不折叠", () => {
    pushRuntimeLog({ appPkg: "a.b", line: "x", ts: 1000 });
    pushRuntimeLog({ appPkg: "a.b", line: "x", ts: 5000 });
    expect(runtimeLogEntries().length).toBe(2);
  });

  it("非法输入忽略", () => {
    expect(pushRuntimeLog(null)).toBe(false);
    expect(pushRuntimeLog({ line: "" })).toBe(false);
    expect(pushRuntimeLog({} as { line: string })).toBe(false);
    expect(runtimeLogEntries().length).toBe(0);
  });

  it("超过 500 条丢最旧", () => {
    for (let i = 0; i < 520; i++) pushRuntimeLog({ line: `l${i}`, ts: i * 5000 });
    const e = runtimeLogEntries();
    expect(e.length).toBe(500);
    expect(e[e.length - 1].line).toBe("l519");
  });

  it("订阅收到变化，取消后不再收", () => {
    let got = 0;
    const un = subscribeRuntimeLog(() => {
      got++;
    });
    pushRuntimeLog({ line: "a" });
    expect(got).toBeGreaterThanOrEqual(1);
    const before = got;
    un();
    pushRuntimeLog({ line: "b" });
    expect(got).toBe(before);
  });

  it("复制文本带时间/等级/包名", () => {
    pushRuntimeLog({ appPkg: "com.demo", line: "崩溃了", level: "crash", ts: Date.now() });
    const txt = runtimeLogText(runtimeLogEntries());
    expect(txt).toContain("E/[com.demo] 崩溃了");
  });
});

describe("生成源码含广播 M288", () => {
  it("AxvRuntimeLog.log 会 sendBroadcast 给编辑器", () => {
    const src = axvRuntimeSources("com.demo").map((s) => s.code).join("\n");
    expect(src).toContain("com.jiji.axv.RUNTIME_LOG");
    expect(src).toContain("setPackage(AXV_EDITOR_PKG)");
    expect(src).toContain("sendBroadcast");
    expect(src).toContain('putExtra("appPkg"');
    expect(src).not.toContain("import androidx");
  });
});
