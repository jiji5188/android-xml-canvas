// @vitest-environment jsdom
/**
 * M154：真机渲染桥（lib/xml/native-render.ts）
 * 这里只测 JS 侧协议：有没有能力、payload 形状、回调怎么回来。
 * 真正的 aapt2 编译在设备上，靠手动实测。
 */
import { afterEach, describe, expect, it } from "vitest";
import { hasRealRender, renderReal } from "@/lib/xml/native-render";

/** 项目里 window.AxvNative 是被全局声明成完整桥的，测试只需要一个残缺替身 */
type FakeWin = {
  AxvNative?: unknown;
  __axvRender?: (id: string, json: string) => void;
};
const w = window as unknown as FakeWin;

afterEach(() => {
  delete w.AxvNative;
  delete w.__axvRender;
});

const files = [
  { path: "layout/activity_main.xml", text: "<LinearLayout/>" },
  { path: "values/res_values.xml", text: "<resources/>" },
];

describe("native-render", () => {
  it("网页版没有桥：hasRealRender=false，renderReal 直接给失败原因", async () => {
    expect(hasRealRender()).toBe(false);
    const r = await renderReal("activity_main", files);
    expect(r.ok).toBe(false);
    expect(r.log).toContain("不支持真机渲染");
  });

  it("payload 带 pkg/layout/files，回调按 id 对号入座", async () => {
    let sent: { id: string; body: { pkg: string; layout: string; files: unknown[] } } | null = null;
    w.AxvNative = {
      renderReal: (id: string, payload: string) => {
        sent = { id, body: JSON.parse(payload) as { pkg: string; layout: string; files: unknown[] } };
      },
    };
    expect(hasRealRender()).toBe(true);

    const p = renderReal("activity_main.xml", files);
    await Promise.resolve();
    expect(sent).not.toBeNull();
    expect(sent!.body.pkg).toBe("com.axv.render");
    expect(sent!.body.layout).toBe("activity_main");
    expect(sent!.body.files).toHaveLength(2);

    // 原生编译完回传
    w.__axvRender!(sent!.id, JSON.stringify({ ok: true, files: 2, bytes: 4096, ms: 900 }));
    const r = await p;
    expect(r.ok).toBe(true);
    expect(r.bytes).toBe(4096);
    expect(r.ms).toBe(900);
  });

  it("文件清单里没有目标布局：早退，不打扰原生", async () => {
    let called = 0;
    w.AxvNative = { renderReal: () => { called += 1; } };
    const r = await renderReal("other", files);
    expect(r.ok).toBe(false);
    expect(r.log).toContain("layout/other.xml");
    expect(called).toBe(0);
  });

  it("坏的返回 JSON 不抛异常，转成失败结果", async () => {
    let id = "";
    w.AxvNative = { renderReal: (i: string) => { id = i; } };
    const p = renderReal("activity_main", files);
    await Promise.resolve();
    w.__axvRender!(id, "{not json");
    const r = await p;
    expect(r.ok).toBe(false);
    expect(r.log).toContain("JSON");
  });
});
