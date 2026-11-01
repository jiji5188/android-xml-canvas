// test/xml_m68_find_usages.test.ts — M68（C3）：资源引用「用在哪」
//
// 改 strings.xml 一条文案前，得知道哪些布局/代码会跟着变。find_usages 扫全项目，
// 同时认 XML 的 @string/x 和代码的 R.string.x，返回 文件:行 + 片段。
import { describe, expect, it } from "vitest";
import { findUsages, formatUsages, parseUsageSymbol, usagePatterns } from "@/lib/xml/ai-usages";
import { parseToolReply, runTool, validateToolCall } from "@/lib/xml/ai-tools";
import type { AiFileIo } from "@/lib/xml/ai-tools";

const files: Record<string, string> = {
  "app/src/main/res/layout/activity_main.xml": `<LinearLayout>
    <TextView android:text="@string/app_name" />
    <TextView android:text="@string/app_name_long" />
    <Button android:id="@+id/btn_ok" />
</LinearLayout>
`,
  "app/src/main/res/layout/detail.xml": `<TextView
    android:text="@string/app_name" />
`,
  "app/src/main/java/com/demo/MainActivity.java": `public class MainActivity {
    void bind() {
        setTitle(R.string.app_name);
        findViewById(R.id.btn_ok);
    }
}
`,
  "app/src/main/res/values/strings.xml": `<resources>
    <string name="app_name">示例</string>
</resources>
`,
  "app/build/intermediates/x.xml": `<TextView android:text="@string/app_name" />`,
  "app/src/main/res/drawable/icon.xml": `<vector />`,
};

const dirs: Record<string, string[]> = {};
function indexDirs() {
  for (const rel of Object.keys(files)) {
    const parts = rel.split("/");
    for (let i = 0; i < parts.length - 1; i++) {
      const d = parts.slice(0, i + 1).join("/");
      const child = i + 1 < parts.length - 1 ? `${d}/${parts[i + 1]}` : rel;
      dirs[d] = dirs[d] || [];
      if (!dirs[d].includes(child)) dirs[d].push(child);
    }
  }
  dirs[""] = Array.from(new Set(Object.keys(files).map((r) => r.split("/")[0])));
}
indexDirs();

const io: AiFileIo = {
  rootLabel: () => "/proj",
  async list(rel) {
    const items = dirs[rel];
    if (!items) return { ok: false, error: "没有这个目录" };
    return {
      ok: true,
      items: items.map((rel2) => ({
        kind: files[rel2] !== undefined ? ("file" as const) : ("dir" as const),
        name: rel2.split("/").pop() || rel2,
        rel: rel2,
      })),
    };
  },
  async read(rel) {
    const t = files[rel];
    return t === undefined ? { ok: false, error: "没有这个文件" } : { ok: true, text: t };
  },
  async write() {
    return { ok: true };
  },
};

describe("M68 符号解析", () => {
  it("认 @string/x、@+id/x、R.string.x 三种写法", () => {
    expect(parseUsageSymbol("@string/app_name")).toEqual({ type: "string", name: "app_name" });
    expect(parseUsageSymbol("@+id/btn_ok")).toEqual({ type: "id", name: "btn_ok" });
    expect(parseUsageSymbol("R.color.brand")).toEqual({ type: "color", name: "brand" });
  });

  it("只给名字时必须带 type", () => {
    expect(parseUsageSymbol("app_name")).toBeNull();
    expect(parseUsageSymbol("app_name", "string")).toEqual({ type: "string", name: "app_name" });
  });

  it("页面配置名带点（如 R.id.foo_bar）能取到最后一个名字", () => {
    expect(parseUsageSymbol("R.id.foo.bar")).toEqual({ type: "id", name: "bar" });
  });

  it("正则不把 app_name_long 当成 app_name", () => {
    const [at, r] = usagePatterns({ type: "string", name: "app_name" });
    expect(at.test('android:text="@string/app_name"')).toBe(true);
    expect(at.test('android:text="@string/app_name_long"')).toBe(false);
    expect(r.test("R.string.app_name);")).toBe(true);
    expect(r.test("R.string.app_name_long);")).toBe(false);
  });
});

describe("M68 findUsages 扫描", () => {
  it("XML 与 Java 引用都能找到，且带行号", async () => {
    const res = await findUsages(io, "@string/app_name");
    const rels = res.hits.map((h) => `${h.rel}:${h.line}`);
    expect(rels).toContain("app/src/main/res/layout/activity_main.xml:2");
    expect(rels).toContain("app/src/main/res/layout/detail.xml:2");
    expect(rels).toContain("app/src/main/java/com/demo/MainActivity.java:3");
    expect(res.hits.length).toBe(3);
  });

  it("不把 app_name_long 算成引用", async () => {
    const res = await findUsages(io, "@string/app_name");
    expect(res.hits.some((h) => h.text.includes("app_name_long"))).toBe(false);
  });

  it("跳过 build/ 目录（构建产物不算引用）", async () => {
    const res = await findUsages(io, "app_name", "string");
    expect(res.hits.some((h) => h.rel.includes("/build/"))).toBe(false);
  });

  it("id 同时认 @+id/x 与 R.id.x", async () => {
    const res = await findUsages(io, "R.id.btn_ok");
    const rels = res.hits.map((h) => h.rel);
    expect(rels).toContain("app/src/main/res/layout/activity_main.xml");
    expect(rels).toContain("app/src/main/java/com/demo/MainActivity.java");
  });

  it("没有引用时返回空数组，不报错", async () => {
    const res = await findUsages(io, "@string/not_exists");
    expect(res.hits).toEqual([]);
    expect(res.files).toBeGreaterThan(0);
  });

  it("命中上限会标记 truncated", async () => {
    const res = await findUsages(io, "@string/app_name", undefined, { maxHits: 1 });
    expect(res.hits.length).toBe(1);
    expect(res.truncated).toBe(true);
  });

  it("firstDir 优先扫当前目录", async () => {
    const res = await findUsages(io, "@string/app_name", undefined, {
      firstDir: "app/src/main/res/layout",
      maxFiles: 2,
    });
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits[0].rel).toContain("/layout/");
  });
});

describe("M68 结果文案与工具接入", () => {
  it("有引用时列出位置并提示影响面", async () => {
    const res = await findUsages(io, "@string/app_name");
    const text = formatUsages(res);
    expect(text).toContain("共 3 处引用");
    expect(text).toContain("layout/activity_main.xml:2");
    expect(text).toContain("会影响上面所有位置");
  });

  it("没引用时说明扫了多少文件", async () => {
    const res = await findUsages(io, "@string/none");
    expect(formatUsages(res)).toContain("没有找到 string/none 的引用");
  });

  it("runTool 能跑 find_usages 并返回人话", async () => {
    const out = await runTool({ tool: "find_usages", symbol: "@string/app_name" }, io);
    expect(out).toContain("app_name");
    expect(out).toContain("activity_main.xml:2");
  });

  it("只给名字不带 type 被判非法", () => {
    expect(validateToolCall({ tool: "find_usages", symbol: "app_name" })).toContain("args.type");
    expect(validateToolCall({ tool: "find_usages", symbol: "app_name", type: "string" })).toBeNull();
  });

  it("parseToolReply 能解析 find_usages", () => {
    const r = parseToolReply(
      ['```axv-tool', '{"tool":"find_usages","args":{"symbol":"@string/app_name"}}', "```"].join("\n"),
    );
    expect(r.errors).toEqual([]);
    expect(r.calls[0].tool).toBe("find_usages");
    expect(r.calls[0].symbol).toBe("@string/app_name");
  });
});
