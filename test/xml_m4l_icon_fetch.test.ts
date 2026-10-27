// test/xml_m4l_icon_fetch.test.ts — 图标字体走 URL 加载（浏览器路径）必须真 await
// 事故：loadIconFont 写成 (await fetch(src)).arrayBuffer() —— arrayBuffer() 返回的是 Promise，
// 没 await 就喂给 opentype.parse → new DataView(Promise) 长度 0 →
// RangeError: Offset is outside the bounds of the DataView → 弹窗显示「图标字体解析失败」
// Node 测试以前全传 ArrayBuffer，所以没覆盖到这条路径。
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadIconFont, isIconFontLoaded, getIconVector, iconNames } from "../lib/xml/icon-vectors";

afterEach(() => {
  vi.unstubAllGlobals();
});

function realFontArrayBuffer(): ArrayBuffer {
  const buf = fs.readFileSync(path.join(process.cwd(), "public", "material-symbols-rounded.ttf"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe("M4l loadIconFont 支持 URL 加载（response.arrayBuffer 必须 await）", () => {
  it("fetch 拿到 ArrayBuffer 后能解析出字形索引", async () => {
    const ab = realFontArrayBuffer();
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(String(url));
      return { arrayBuffer: async () => ab };
    });

    await loadIconFont("/material-symbols-rounded.ttf");

    expect(calls).toEqual(["/material-symbols-rounded.ttf"]);
    expect(isIconFontLoaded()).toBe(true);
    expect(iconNames().length).toBeGreaterThan(100);
  });

  it("加载完成后能生成 search 图标的 vector xml", () => {
    const xml = getIconVector("search");
    expect(xml).toBeTruthy();
    expect(String(xml)).toContain("<vector");
    expect(String(xml)).toContain("android:pathData=");
  });

  it("不存在的图标名返回 null（不抛错）", () => {
    expect(getIconVector("这个图标不存在")).toBeNull();
  });
});
