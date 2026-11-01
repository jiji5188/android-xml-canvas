// test/xml_m72_text_style.test.ts — M72（C7）：AI 落盘对齐原文件的换行 / BOM
//
// 手动保存写的是编辑器原文（CRLF 就还是 CRLF），AI 的 apply_patch 拼出来的
// 新文本却是 JS 的 "\n"、还会丢 BOM → 同一次修改在 git 里整片变红。
import { describe, expect, it, beforeEach } from "vitest";
import { BOM, detectEol, detectTextStyle, normalizeEol, prepareWriteText, styleNote, stripBom } from "@/lib/xml/text-style";
import { ioFromRootPath } from "@/lib/xml/ai-fs";
import { runTool } from "@/lib/xml/ai-tools";

describe("M72 换行识别", () => {
  it("全 CRLF 的文件认得出来", () => {
    expect(detectEol("a\r\nb\r\nc\r\n")).toBe("\r\n");
    expect(detectEol("a\nb\nc\n")).toBe("\n");
  });

  it("空文件默认 LF", () => {
    expect(detectEol("")).toBe("\n");
  });

  it("混入少量 LF 的 CRLF 文件仍按 CRLF", () => {
    expect(detectEol("a\r\nb\r\nc\nd\r\n")).toBe("\r\n");
  });

  it("BOM 能识别并剥掉", () => {
    expect(detectTextStyle(BOM + "x").bom).toBe(true);
    expect(detectTextStyle("x").bom).toBe(false);
    expect(stripBom(BOM + "x")).toBe("x");
    expect(stripBom("x")).toBe("x");
  });

  it("normalizeEol 不会产生 \\r\\r\\n", () => {
    expect(normalizeEol("a\r\nb", "\r\n")).toBe("a\r\nb");
    expect(normalizeEol("a\nb", "\r\n")).toBe("a\r\nb");
    expect(normalizeEol("a\r\nb", "\n")).toBe("a\nb");
    expect(normalizeEol("a\rb", "\n")).toBe("a\nb");
  });
});

describe("M72 prepareWriteText", () => {
  it("CRLF 原文件 → 写入也是 CRLF", () => {
    const prev = "line1\r\nline2\r\n";
    const r = prepareWriteText("line1\nline2\nline3\n", prev);
    expect(r.text).toBe("line1\r\nline2\r\nline3\r\n");
    expect(r.converted).toBe(true);
    expect(styleNote(r.style, r.converted)).toContain("CRLF");
  });

  it("LF 原文件 → 模型带进来的 CRLF 会被压回 LF", () => {
    const r = prepareWriteText("a\r\nb\r\n", "a\nb\n");
    expect(r.text).toBe("a\nb\n");
  });

  it("原文件有 BOM → 新文本保留 BOM；没有 → 去掉模型带来的 BOM", () => {
    const withBom = prepareWriteText("next", BOM + "prev");
    expect(withBom.text.startsWith(BOM)).toBe(true);
    const noBom = prepareWriteText(BOM + "next", "prev");
    expect(noBom.text.startsWith(BOM)).toBe(false);
  });

  it("新建文件（prev=null）不动内容，也不加 BOM", () => {
    const r = prepareWriteText("a\nb\n", null);
    expect(r.text).toBe("a\nb\n");
    expect(r.style).toBeNull();
    expect(r.converted).toBe(false);
    expect(styleNote(r.style, r.converted)).toBe("");
  });

  it("风格本来就一致时 converted=false（不弹多余的提示）", () => {
    const r = prepareWriteText("a\r\nb\r\n", "x\r\ny\r\n");
    expect(r.converted).toBe(false);
    expect(styleNote(r.style, r.converted)).toBe("");
  });
});

describe("M72 原生写盘（APK）走同一套风格", () => {
  let stored: Record<string, string>;
  let writes: { path: string; text: string }[];

  beforeEach(() => {
    stored = {
      "/proj/app/src/main/res/layout/a.xml": `<LinearLayout>\r\n    <TextView />\r\n</LinearLayout>\r\n`,
      "/proj/app/src/main/java/com/demo/A.java": BOM + `package com.demo;\r\nclass A {}\r\n`,
    };
    writes = [];
    (globalThis as unknown as { window: unknown }).window = {
      AxvNative: {
        saveFile: () => "ok",
        getWorkspace: () => "proj",
        pickWorkspace: () => {},
        readText: (p: string) => stored[p] ?? null,
        writeText: (p: string, b64: string) => {
          const text = Buffer.from(b64, "base64").toString("utf8");
          stored[p] = text;
          writes.push({ path: p, text });
          return "ok:/x";
        },
      },
    };
  });

  it("apply_patch 改 CRLF 的 xml，写出去仍是 CRLF（整份不被重写）", async () => {
    const io = ioFromRootPath("/proj")!;
    const out = await runTool(
      {
        tool: "apply_patch",
        path: "app/src/main/res/layout/a.xml",
        edits: [{ old: "<TextView />", new: '<TextView android:id="@+id/tv" />\n    <Button />' }],
      },
      io,
    );
    expect(out).toContain("已修改");
    expect(out).toContain("CRLF");
    const after = stored["/proj/app/src/main/res/layout/a.xml"];
    expect(after).toContain('@+id/tv');
    expect(after).toContain("<Button />");
    expect(after.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("改带 BOM 的 Java 文件，BOM 还在", async () => {
    const io = ioFromRootPath("/proj")!;
    await runTool(
      {
        tool: "apply_patch",
        path: "app/src/main/java/com/demo/A.java",
        edits: [{ old: "class A {}", new: "class A { void f() {} }" }],
      },
      io,
    );
    const after = stored["/proj/app/src/main/java/com/demo/A.java"];
    expect(after.startsWith(BOM)).toBe(true);
    expect(after).toContain("void f()");
  });

  it("新建文件不擅自加 BOM、不改换行", async () => {
    const io = ioFromRootPath("/proj")!;
    const out = await runTool(
      { tool: "write_file", path: "app/src/main/res/layout/b.xml", content: "<x />\n" },
      io,
    );
    expect(out).toContain("已写入");
    expect(stored["/proj/app/src/main/res/layout/b.xml"]).toBe("<x />\n");
    expect(writes.length).toBe(1);
  });
});
