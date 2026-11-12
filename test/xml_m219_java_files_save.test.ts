// test/xml_m219_java_files_save.test.ts — M219：补两个一直没测试的「入口」
// ① loadProjectJavaFiles（M199 运行调试读源码）
// ② save-as.ts（网页版整包保存 + 原生桥判定）
// 都是「读/写」路径，以前没测试兜底，改一个行为没人拦。
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { loadProjectJavaFiles } from "@/lib/xml/java-files";
import { saveBundleWeb, saveAsSupported, hasNativeBundle, pickXmlFile } from "@/lib/xml/save-as";
import type { AiFileIo, AiFileEntry } from "@/lib/xml/ai-tools";

function fakeIo(
  tree: Record<string, AiFileEntry[]>,
  texts: Record<string, string>,
): AiFileIo {
  return {
    rootLabel: () => "test",
    list: vi.fn(async (rel: string) => {
      const items = tree[rel ?? ""] ?? [];
      return items.length ? { ok: true, items } : rel ? { ok: false, error: "no such dir" } : { ok: true, items: [] };
    }),
    read: vi.fn(async (rel: string) => {
      const t = texts[rel];
      return t === undefined ? { ok: false, error: "missing" } : { ok: true, text: t };
    }),
  } as unknown as AiFileIo;
}

describe("loadProjectJavaFiles（M199）", () => {
  it("io 为 null/undefined 时返回空数组（网页没授权目录）", async () => {
    await expect(loadProjectJavaFiles(null)).resolves.toEqual([]);
    await expect(loadProjectJavaFiles(undefined)).resolves.toEqual([]);
  });

  it("只收 .java/.kt/.kts，忽略其他后缀与目录名", async () => {
    const io = fakeIo(
      {
        "": [
          { name: "app", kind: "dir", rel: "app" },
          { name: "readme.md", kind: "file", rel: "readme.md" },
          { name: "gradle", kind: "dir", rel: "gradle" },
        ],
        app: [
          { name: "src", kind: "dir", rel: "app/src" },
          { name: "build.gradle", kind: "file", rel: "app/build.gradle" },
        ],
        "app/src": [
          { name: "Main.java", kind: "file", rel: "app/src/Main.java" },
          { name: "Helper.kt", kind: "file", rel: "app/src/Helper.kt" },
          { name: "notes.txt", kind: "file", rel: "app/src/notes.txt" },
        ],
      },
      {
        "app/src/Main.java": "public class Main {}",
        "app/src/Helper.kt": "fun main() {}",
      },
    );
    const out = await loadProjectJavaFiles(io);
    expect(out.map((f) => f.rel)).toEqual(["app/src/Main.java", "app/src/Helper.kt"]);
    expect(out.map((f) => f.text)).toEqual(["public class Main {}", "fun main() {}"]);
  });

  it("跳过 SKIP_DIRS（build/.git 等）与超 400KB 的大文件", async () => {
    const big = "x".repeat(400 * 1024 + 1);
    const io = fakeIo(
      {
        "": [
          { name: "build", kind: "dir", rel: "build" },
          { name: "src", kind: "dir", rel: "src" },
        ],
        build: [{ name: "Old.java", kind: "file", rel: "build/Old.java" }],
        src: [
          { name: "Big.java", kind: "file", rel: "src/Big.java" },
          { name: "Ok.java", kind: "file", rel: "src/Ok.java" },
        ],
      },
      { "src/Big.java": big, "src/Ok.java": "int x;" },
    );
    const out = await loadProjectJavaFiles(io);
    expect(out.map((f) => f.rel)).toEqual(["src/Ok.java"]);
  });
});

/** 测试里把 save-as 需要的 window/文件 API 摘干净，只看纯逻辑分支 */
function cleanWindow() {
  const w = window as unknown as Record<string, unknown>;
  delete w.AxvNative;
  delete w.webkit;
  vi.unstubAllGlobals();
}

describe("save-as.ts 能力判定", () => {
  it("没有原生桥且浏览器不支持 FSA 时：saveAsSupported=false、hasNativeBundle=false", () => {
    cleanWindow();
    expect(hasNativeBundle()).toBe(false);
    expect(saveAsSupported()).toBe(false);
  });

  it("浏览器支持 showDirectoryPicker 时 saveAsSupported=true", () => {
    cleanWindow();
    (window as unknown as Record<string, unknown>).showDirectoryPicker = () => {};
    expect(saveAsSupported()).toBe(true);
    delete (window as unknown as Record<string, unknown>).showDirectoryPicker;
  });

  it("有 saveBundle 桥时 hasNativeBundle=true（nativeBridge 要求 saveFile 存在，一并给上）", () => {
    (window as unknown as { AxvNative?: unknown }).AxvNative = {
      saveFile: vi.fn(),
      saveBundle: vi.fn(),
    };
    expect(hasNativeBundle()).toBe(true);
  });

  it("pickXmlFile 没有 showOpenFilePicker 时返回 null（不抛）", async () => {
    cleanWindow();
    const original = (window as unknown as Record<string, unknown>).showOpenFilePicker;
    (window as unknown as Record<string, unknown>).showOpenFilePicker = undefined;
    await expect(pickXmlFile()).resolves.toBeNull();
    (window as unknown as Record<string, unknown>).showOpenFilePicker = original;
  });

  it("saveBundleWeb 没有 FSA 选择器时 ok:false（不抛、不 canceled）", async () => {
    cleanWindow();
    const r = await saveBundleWeb([]);
    expect(r.ok).toBe(false);
    expect(r.canceled).toBeUndefined();
  });

  it("saveBundleWeb 选到目录后按 res 相对路径递归建目录写文件", async () => {
    cleanWindow();
    const written: Record<string, string> = {};
    const makeDir = (label: string) => ({
      name: label,
      getDirectoryHandle: async (n: string) => makeDir(n),
      getFileHandle: async (n: string) => ({
        name: n,
        createWritable: async () => ({
          write: async (data: string) => {
            written[label + "/" + n] = data;
          },
          close: async () => {},
        }),
      }),
    });
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () => makeDir("layout");
    // 两文件：一个带目录（layout 层），一个直接放根（但 root 就是 layout 目录本身，
    // 所以第二个文件写进 layout 里 → 验证递归）
    const r = await saveBundleWeb([
      { path: "layout/activity_main.xml", text: "<LinearLayout/>" },
      { path: "drawable/ic.xml", text: "<shape/>" },
    ]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    // 相对 root（= 目录名 "layout" 这一层）的路径：
    //  ① layout/activity_main.xml → parts=[layout, activity_main.xml]：根目录名 layout，子目录 layout，
    //     文件 activity_main.xml → 记录 "layout/activity_main.xml"？
    // 这里 fake 的 label 是目录名，第一层 getDirectoryHandle("layout") 返回 label="layout" 的新目录，
    // 再 getFileHandle 写在它下面 → 路径 "layout/activity_main.xml" ✓
    // ② drawable/ic.xml → getDirectoryHandle("drawable")（label drawable）→ "drawable/ic.xml" ✓
    expect(Object.keys(written).sort()).toEqual(["drawable/ic.xml", "layout/activity_main.xml"]);
    expect(written["layout/activity_main.xml"]).toBe("<LinearLayout/>");
  });
});
