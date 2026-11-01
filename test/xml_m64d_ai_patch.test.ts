// test/xml_m64d_ai_patch.test.ts — M64d（B6）：apply_patch 局部替换 + write_file 只新建
//
// 为什么：write_file 整份覆盖，模型只要漏抄一段就把几百行文档吃掉；
// 工具结果里也没有 diff，用户看不出改了什么。
// 现在：改已有文件必须走 apply_patch（old 必须唯一匹配），write_file 只允许新建。
import { describe, expect, it } from "vitest";
import { extractToolCalls, runTool, type AiFileIo } from "@/lib/xml/ai-tools";

function memIo(files: Record<string, string>): AiFileIo & { files: Record<string, string> } {
  return {
    files,
    rootLabel: () => "/proj",
    canWrite: true,
    list: async () => ({ ok: true, items: [] }),
    read: async (rel) => (files[rel] !== undefined ? { ok: true, text: files[rel] } : { ok: false, error: "不存在" }),
    write: async (rel, text) => {
      files[rel] = text;
      return { ok: true };
    },
  };
}

const LAYOUT = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
    <TextView android:id="@+id/title" />
</LinearLayout>
`;

describe("M64d apply_patch", () => {
  it("单处替换成功，写入的是改后全文", async () => {
    const io = memIo({ "res/layout/a.xml": LAYOUT });
    const out = await runTool(
      {
        tool: "apply_patch",
        path: "res/layout/a.xml",
        edits: [{ old: `<TextView android:id="@+id/title" />`, new: `<TextView android:id="@+id/title" android:text="Hi" />` }],
      },
      io,
    );
    expect(out).toContain("已修改");
    expect(io.files["res/layout/a.xml"]).toContain('android:text="Hi"');
    expect(io.files["res/layout/a.xml"]).toContain("<LinearLayout");
  });

  it("多处替换按顺序生效", async () => {
    const io = memIo({ "res/values/strings.xml": "<resources>\n  <string name=\"a\">A</string>\n  <string name=\"b\">B</string>\n</resources>\n" });
    const out = await runTool(
      {
        tool: "apply_patch",
        path: "res/values/strings.xml",
        edits: [
          { old: ">A<", new: ">AAA<" },
          { old: ">B<", new: ">BBB<" },
        ],
      },
      io,
    );
    expect(out).toContain("2 处");
    expect(io.files["res/values/strings.xml"]).toContain("AAA");
    expect(io.files["res/values/strings.xml"]).toContain("BBB");
  });

  it("old 在文件里找不到 → 拒绝并提示先 read_file", async () => {
    const io = memIo({ "res/layout/a.xml": LAYOUT });
    const out = await runTool({ tool: "apply_patch", path: "res/layout/a.xml", edits: [{ old: "不存在的片段", new: "x" }] }, io);
    expect(out).toContain("没找到");
    expect(io.files["res/layout/a.xml"]).toBe(LAYOUT);
  });

  it("old 不唯一 → 拒绝，不猜第一个", async () => {
    const io = memIo({ "res/values/strings.xml": "<a/>\n<a/>\n" });
    const out = await runTool({ tool: "apply_patch", path: "res/values/strings.xml", edits: [{ old: "<a/>", new: "<b/>" }] }, io);
    expect(out).toContain("不唯一");
    expect(io.files["res/values/strings.xml"]).toBe("<a/>\n<a/>\n");
  });

  it("文件不存在 → 提示改用 write_file", async () => {
    const io = memIo({});
    const out = await runTool({ tool: "apply_patch", path: "res/layout/new.xml", edits: [{ old: "a", new: "b" }] }, io);
    expect(out).toContain("write_file");
  });

  it("edits 为空 / 超过 20 处 → 拒绝", async () => {
    const io = memIo({ "a.xml": "x" });
    expect(await runTool({ tool: "apply_patch", path: "a.xml", edits: [] }, io)).toContain("edits 为空");
    const many = Array.from({ length: 21 }, (_, i) => ({ old: `o${i}`, new: `n${i}` }));
    expect(await runTool({ tool: "apply_patch", path: "a.xml", edits: many }, io)).toContain("最多 20 处");
  });

  it("保护区文件即使 apply_patch 也拒", async () => {
    const io = memIo({ "app/build.gradle": "android { }" });
    const out = await runTool({ tool: "apply_patch", path: "app/build.gradle", edits: [{ old: "android { }", new: "" }] }, io);
    expect(out).toContain("保护区");
    expect(io.files["app/build.gradle"]).toBe("android { }");
  });

  it("越界路径拒绝", async () => {
    const io = memIo({});
    const out = await runTool({ tool: "apply_patch", path: "../../etc/passwd", edits: [{ old: "a", new: "b" }] }, io);
    expect(out).toContain("路径非法");
  });
});

describe("M64d write_file 只允许新建", () => {
  it("文件已存在 → 拒绝并指向 apply_patch，磁盘不动", async () => {
    const io = memIo({ "res/layout/a.xml": LAYOUT });
    const out = await runTool({ tool: "write_file", path: "res/layout/a.xml", content: "<New/>" }, io);
    expect(out).toContain("已存在");
    expect(out).toContain("apply_patch");
    expect(io.files["res/layout/a.xml"]).toBe(LAYOUT);
  });

  it("新文件正常写入", async () => {
    const io = memIo({});
    const out = await runTool({ tool: "write_file", path: "res/values/colors.xml", content: "<resources/>" }, io);
    expect(out).toContain("已写入");
    expect(io.files["res/values/colors.xml"]).toBe("<resources/>");
  });
});

describe("M64d extractToolCalls 解析 apply_patch", () => {
  it("解析出 edits 数组，过滤非法项", () => {
    const reply = [
      "我来改一下：",
      "```axv-tool",
      '{"tool":"apply_patch","path":"res/layout/a.xml","edits":[{"old":"a","new":"b"},{"old":"c"}]}',
      "```",
    ].join("\n");
    const calls = extractToolCalls(reply);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool).toBe("apply_patch");
    expect(calls[0].edits).toEqual([{ old: "a", new: "b" }]);
  });

  it("没有 edits 或格式不对 → edits undefined（runTool 会报缺参数）", () => {
    const calls = extractToolCalls('```axv-tool\n{"tool":"apply_patch","path":"a.xml","edits":"x"}\n```');
    expect(calls[0].edits).toBeUndefined();
  });
});
