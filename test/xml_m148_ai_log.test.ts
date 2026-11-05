// test/xml_m148_ai_log.test.ts — M148：AI 调试日志的纯函数
//
// 需求：中间过程（工具调用/模型原始输出/报错）放进独立小框，聊天框只留最终回答。
// 这里测日志本身的边界：截断、容量、导出、8 秒工具超时、幻觉（对话数组）拦截。
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ROUNDS,
  LOG_MAX_ENTRIES,
  clipLog,
  formatLogs,
  loadMaxRounds,
  looksLikeTranscript,
  pushLogEntry,
  runWithTimeout,
  TOOL_TIMEOUT_MS,
  type LogEntry,
} from "../lib/xml/ai-log";

const entry = (id: number, text = "x"): LogEntry => ({ id, at: 1_700_000_000_000 + id, kind: "info", text });

describe("M148 日志裁剪与容量", () => {
  it("短文本原样保留", () => {
    expect(clipLog("hello")).toBe("hello");
  });

  it("超长文本截断并注明总长度", () => {
    const s = "a".repeat(50);
    const out = clipLog(s, 10);
    expect(out.startsWith("a".repeat(10))).toBe(true);
    expect(out).toContain("50");
  });

  it("超出容量丢最旧的，保留最新 N 条", () => {
    let list: LogEntry[] = [];
    for (let i = 0; i < LOG_MAX_ENTRIES + 5; i++) list = pushLogEntry(list, entry(i));
    expect(list).toHaveLength(LOG_MAX_ENTRIES);
    expect(list[0].id).toBe(5);
  });

  it("formatLogs 导出成可读文本（带时间与类型）", () => {
    const txt = formatLogs([entry(1, "第一行"), entry(2, "第二行")]);
    expect(txt).toContain("info");
    expect(txt).toContain("第一行");
    expect(txt).toContain("第二行");
    // 两条之间空行分隔
    expect(txt.split("\n\n").length).toBe(2);
  });
});

describe("M148 工具超时（8 秒）", () => {
  it("默认 8 秒", () => {
    expect(TOOL_TIMEOUT_MS).toBe(8000);
  });

  it("按时返回取结果", async () => {
    const r = await runWithTimeout(Promise.resolve("ok"), 50);
    expect(r).toEqual({ ok: true, value: "ok" });
  });

  it("超时不抛异常，返回 timedOut 让流程继续", async () => {
    const never = new Promise<string>(() => {
      /* 永不 resolve */
    });
    const r = await runWithTimeout(never, 10);
    expect(r).toEqual({ ok: false, timedOut: true });
  });
});

describe("M148 幻觉拦截：模型把对话数组当正文", () => {
  it("识别对话数组", () => {
    expect(looksLikeTranscript('[{"role":"user","content":"你好"},{"role":"assistant","content":"在"}]')).toBe(true);
  });

  it("识别对话模板标记", () => {
    expect(looksLikeTranscript("<|im_start|>user 你好<|im_end|>")).toBe(true);
  });

  it("识别 Human/Assistant 转录", () => {
    expect(looksLikeTranscript("Human: 你好\nAssistant: 在的")).toBe(true);
  });

  it("正常回答不误判", () => {
    expect(looksLikeTranscript("把字号调到 24sp，改完是这样的：\n<TextView android:textSize=\"24sp\"/>")).toBe(false);
  });

  it("正常 JSON（含 role 字段但不是对话数组）不误判", () => {
    expect(looksLikeTranscript('{"role":"button","name":"ok"}')).toBe(false);
  });
});

describe("M148 工具轮数上限", () => {
  it("没存过 → 默认 10（不被 Number(null)=0 带偏）", () => {
    expect(loadMaxRounds(null)).toBe(DEFAULT_MAX_ROUNDS);
    expect(loadMaxRounds("")).toBe(DEFAULT_MAX_ROUNDS);
    expect(loadMaxRounds("   ")).toBe(DEFAULT_MAX_ROUNDS);
  });

  it("坏的存值 → 默认", () => {
    expect(loadMaxRounds("abc")).toBe(DEFAULT_MAX_ROUNDS);
  });

  it("正常值与边界", () => {
    expect(loadMaxRounds("3")).toBe(3);
    expect(loadMaxRounds("0")).toBe(1);
    expect(loadMaxRounds("999")).toBe(50);
    expect(loadMaxRounds("7.6")).toBe(8);
  });
});
