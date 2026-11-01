// test/xml_m64c_ai_paths.test.ts — M64c（B4 + C5）：路径规范化、越界、保护区、大小上限
//
// B4：safeRel 只看 ".."，不规范化、没有「最终路径在根内」的前缀校验；
//     也没有扩展名白名单和大小上限。
// C5：AI 能直接写 build.gradle / AndroidManifest.xml，一次就能把工程写崩。
import { describe, expect, it } from "vitest";
import {
  AI_MAX_WRITE_BYTES,
  checkAiPath,
  isProtectedRel,
  isUnder,
  normalizeAiRel,
} from "@/lib/xml/ai-paths";
import { runTool, safeRel, type AiFileIo } from "@/lib/xml/ai-tools";

const ESCAPES = [
  "/etc/passwd",
  "C:/Windows/System32/drivers/etc/hosts",
  "C:\\Windows\\win.ini",
  "\\\\server\\share\\x.xml",
  "../secret.xml",
  "..\\..\\secret.xml",
  "a/../../b.xml",
  "sub/../../x.xml",
  "a/b/../../../c.xml",
  "content://com.other.app/file.xml",
  "file:///sdcard/x.xml",
  "~/x.xml",
];

function fakeIo(files: Record<string, string> = {}): AiFileIo & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    rootLabel: () => "/proj",
    list: async () => ({ ok: true, items: [] }),
    read: async (rel) => (files[rel] !== undefined ? { ok: true, text: files[rel] } : { ok: false, error: "读不到" }),
    write: async (rel, text) => {
      writes.push(rel + ":" + text.length);
      return { ok: true };
    },
  };
}

describe("M64c normalizeAiRel：规范化", () => {
  it("去掉 ./ 和重复斜杠、折叠 a/../b", () => {
    expect(normalizeAiRel("./app/x.xml")).toBe("app/x.xml");
    expect(normalizeAiRel("app//src///Main.java")).toBe("app/src/Main.java");
    expect(normalizeAiRel("app/src/../res/a.xml")).toBe("app/res/a.xml");
    expect(normalizeAiRel("a/../b/c.xml")).toBe("b/c.xml");
    expect(normalizeAiRel("res/")).toBe("res");
  });

  it("越界与花式路径一律 null", () => {
    for (const p of ESCAPES) {
      expect(normalizeAiRel(p), p).toBeNull();
    }
  });

  it("空字符串 = 项目根（list 用）", () => {
    expect(normalizeAiRel("")).toBe("");
    expect(normalizeAiRel(undefined)).toBe("");
  });

  it("safeRel 与新实现同口径（老 API 不破）", () => {
    expect(safeRel("./app/x.xml")).toBe("app/x.xml");
    expect(safeRel("/etc/passwd")).toBeNull();
    expect(safeRel("a/../../b")).toBeNull();
  });
});

describe("M64c checkAiPath：读写闸门", () => {
  it("12 条越界路径全部被拒，且报人话错误", () => {
    for (const p of ESCAPES) {
      const r = checkAiPath(p, { mode: "read" });
      expect(r.ok, p).toBe(false);
      if (!r.ok) expect(r.error).toContain("路径非法");
    }
  });

  it("写必须指定文件（空路径拒绝）", () => {
    const r = checkAiPath("", { mode: "write" });
    expect(r.ok).toBe(false);
  });

  it("扩展名白名单：png 之类不让写，xml/java 放行", () => {
    expect(checkAiPath("res/drawable/a.png", { mode: "write", allowProtected: true }).ok).toBe(false);
    expect(checkAiPath("res/layout/a.xml", { mode: "write", allowProtected: true }).ok).toBe(true);
    expect(checkAiPath("app/src/main/java/A.java", { mode: "write", allowProtected: true }).ok).toBe(true);
    expect(checkAiPath("res/values/strings.xml", { mode: "write", allowProtected: true }).ok).toBe(true);
  });

  it("isProtectedRel：构建/清单/产物目录命中", () => {
    for (const p of [
      "build.gradle",
      "build.gradle.kts",
      "settings.gradle",
      "gradle.properties",
      "app/src/main/AndroidManifest.xml",
      "app/build/intermediates/x.xml",
      "build/x.xml",
      ".git/config",
      ".gradle/x",
      "node_modules/a/b.js",
      "proguard-rules.pro",
      "local.properties",
    ]) {
      expect(isProtectedRel(p), p).toBe(true);
    }
    for (const p of ["app/src/main/res/layout/a.xml", "app/src/main/java/A.java", "res/values/strings.xml"]) {
      expect(isProtectedRel(p), p).toBe(false);
    }
  });

  it("保护区：默认拒绝写，但允许读；打开开关后可以写", () => {
    const w = checkAiPath("build.gradle", { mode: "write", allowProtected: false });
    expect(w.ok).toBe(false);
    if (!w.ok) expect(w.error).toContain("保护区");

    // 读不受保护区影响（只想看看 gradle 配置是合理的）
    expect(checkAiPath("build.gradle", { mode: "read", allowProtected: false }).ok).toBe(true);

    // 用户明确打开开关
    expect(checkAiPath("build.gradle", { mode: "write", allowProtected: true }).ok).toBe(true);
  });

  it("开关走 localStorage（axv.ai.allowProtected）", async () => {
    const map = new Map<string, string>();
    (globalThis as { window?: unknown }).window = {
      localStorage: {
        getItem: (k: string) => map.get(k) ?? null,
        setItem: (k: string, v: string) => void map.set(k, v),
      },
    };
    const { aiAllowProtectedGet, aiAllowProtectedSet } = await import("@/lib/xml/ai-paths");
    expect(aiAllowProtectedGet()).toBe(false);
    expect(checkAiPath("build.gradle", { mode: "write" }).ok).toBe(false);
    aiAllowProtectedSet(true);
    expect(aiAllowProtectedGet()).toBe(true);
    expect(checkAiPath("build.gradle", { mode: "write" }).ok).toBe(true);
    aiAllowProtectedSet(false);
    delete (globalThis as { window?: unknown }).window;
  });
});

describe("M64c isUnder：最终路径前缀校验", () => {
  it("根内放行、根外拒绝", () => {
    expect(isUnder("/proj", "/proj/res/a.xml")).toBe(true);
    expect(isUnder("/proj/", "/proj/res/a.xml")).toBe(true);
    expect(isUnder("/proj", "/proj")).toBe(true);
    expect(isUnder("/proj", "/proj-evil/a.xml")).toBe(false);
    expect(isUnder("/proj", "/proj/../etc/passwd")).toBe(false);
    expect(isUnder("", "/proj/a.xml")).toBe(false);
  });
});

describe("M64c runTool：闸门真的接上了", () => {
  it("write_file 写 build.gradle 被拒，且 io 一次没被调用", async () => {
    const io = fakeIo();
    const out = await runTool({ tool: "write_file", path: "app/build.gradle", content: "x" }, io);
    expect(out).toContain("保护区");
    expect(io.writes).toEqual([]);
  });

  it("write_file 超大内容被拒", async () => {
    const io = fakeIo();
    const big = "x".repeat(AI_MAX_WRITE_BYTES + 10);
    const out = await runTool({ tool: "write_file", path: "res/values/strings.xml", content: big }, io);
    expect(out).toContain("内容太大");
    expect(io.writes).toEqual([]);
  });

  it("read_file 越界被拒（不碰 io）", async () => {
    const io = fakeIo();
    let reads = 0;
    const spy: AiFileIo = { ...io, read: async (rel) => (reads++, io.read(rel)) };
    const out = await runTool({ tool: "read_file", path: "../../etc/passwd" }, spy);
    expect(out).toContain("路径非法");
    expect(reads).toBe(0);
  });

  it("list_files 空路径仍可列项目根", async () => {
    const io = fakeIo();
    const out = await runTool({ tool: "list_files" }, io);
    expect(out).toContain("是空的");
  });

  it("正常写 xml 放行", async () => {
    const io = fakeIo();
    const out = await runTool({ tool: "write_file", path: "res/values/strings.xml", content: "<resources/>" }, io);
    expect(out).toContain("已写入");
    expect(io.writes).toEqual(["res/values/strings.xml:12"]);
  });
});
