import { describe, expect, it } from "vitest";
import {
  buildExportReadme,
  collectProjectFiles,
  shouldExportFile,
} from "../lib/xml/project-export";
import { makeZip } from "../lib/xml/zip";
import type { AiFileIo } from "../lib/xml/ai-tools";

/** 内存假文件系统：{ "app/build.gradle": "..." }，目录由路径推导 */
function fakeIo(files: Record<string, string | Uint8Array>): AiFileIo {
  const dirs = new Set<string>([""]);
  for (const p of Object.keys(files)) {
    const segs = p.split("/");
    for (let i = 1; i < segs.length; i++) dirs.add(segs.slice(0, i).join("/"));
  }
  return {
    rootLabel: () => "/fake",
    canWrite: false,
    async list(rel) {
      const prefix = rel ? rel + "/" : "";
      const names = new Map<string, "dir" | "file">();
      for (const d of dirs) {
        if (!d || !d.startsWith(prefix) || d === rel) continue;
        const rest = d.slice(prefix.length);
        if (!rest.includes("/")) names.set(rest, "dir");
      }
      for (const p of Object.keys(files)) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        if (!rest.includes("/")) names.set(rest, "file");
      }
      return {
        ok: true,
        items: [...names.entries()].map(([name, kind]) => ({
          name,
          kind,
          rel: prefix + name,
        })),
      };
    },
    async read(rel) {
      const v = files[rel];
      if (typeof v !== "string") return { ok: false, error: "不是文本" };
      return { ok: true, text: v };
    },
    async readBase64(rel) {      const v = files[rel];
      if (v === undefined) return { ok: false, error: "不存在" };
      const bytes = typeof v === "string" ? new TextEncoder().encode(v) : v;
      let bin = "";
      for (const b of bytes) bin += String.fromCharCode(b);
      return { ok: true, base64: btoa(bin) };
    },
    async write() {
      return { ok: false, error: "只读测试环境" };
    },
  };
}

describe("M190 shouldExportFile", () => {
  it("普通源码与资源都保留", () => {
    expect(shouldExportFile("app/build.gradle")).toBe(true);
    expect(shouldExportFile("app/src/main/res/layout/activity_main.xml")).toBe(true);
  });

  it("构建产物与 VCS 目录整段跳过", () => {
    expect(shouldExportFile("app/build/outputs/apk/release/app-release.apk")).toBe(false);
    expect(shouldExportFile(".git/config")).toBe(false);
    expect(shouldExportFile(".gradle/8.0/fileHashes.bin")).toBe(false);
    expect(shouldExportFile("node_modules/x/index.js")).toBe(false);
    expect(shouldExportFile(".idea/workspace.xml")).toBe(false);
  });

  it("文件名里出现 build 不算目录（app/build.gradle 要保留）", () => {
    expect(shouldExportFile("app/build.gradle")).toBe(true);
  });
});

describe("M190 buildExportReadme", () => {
  it("带包名、别名、keystore 路径", () => {
    const t = buildExportReadme({
      projectName: "MyApp",
      pkg: "com.acme.myapp",
      versionName: "1.2.3",
      storeFile: ".axv/release.keystore",
      alias: "axvrel",
    });
    expect(t).toContain("com.acme.myapp");
    expect(t).toContain("1.2.3");
    expect(t).toContain("keytool -genkeypair");
    expect(t).toContain("-alias axvrel");
    expect(t).toContain("release.keystore");
    expect(t).toContain("gradlew assembleRelease");
  });

  it("缺参数时给占位而不是 undefined", () => {
    const t = buildExportReadme({ projectName: "P" });
    expect(t).not.toContain("undefined");
    expect(t).not.toContain("null");
    expect(t).toContain("-alias release");
  });
});

describe("M190 collectProjectFiles", () => {
  it("递归收集，跳过 build 目录", async () => {
    const io = fakeIo({
      "settings.gradle": "rootProject.name='x'",
      "app/build.gradle": "android {}",
      "app/src/main/res/layout/activity_main.xml": "<LinearLayout/>",
      "app/build/intermediates/junk.txt": "junk",
    });
    const r = await collectProjectFiles(io);
    expect(r.ok).toBe(true);
    const paths = r.entries.map((e) => e.path).sort();
    expect(paths).toEqual([
      "app/build.gradle",
      "app/src/main/res/layout/activity_main.xml",
      "settings.gradle",
    ]);
    expect(r.skipped.join("\n")).toContain("junk.txt");
  });

  it("二进制文件走 bytes 而不是丢成空文本", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const io = fakeIo({ "res/mipmap/ic.png": png });
    const r = await collectProjectFiles(io);
    const e = r.entries.find((x) => x.path === "res/mipmap/ic.png");
    expect(e?.bytes?.length).toBe(png.length);
    expect(Array.from(e?.bytes ?? [])).toEqual(Array.from(png));
  });

  it("空项目 → ok=false 且给原因", async () => {
    const r = await collectProjectFiles(fakeIo({}));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("一个文件都没读到");
  });
});

describe("M190 makeZip 支持二进制条目", () => {
  it("bytes 条目不被当作文本，长度与 CRC 都按字节算", () => {
    const z = makeZip([
      { path: "a.txt", text: "hi" },
      { path: "b.bin", bytes: new Uint8Array([1, 2, 3, 4, 5]) },
    ]);
    // EOCD 在最后 22 字节，条目数=2
    const dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
    const eocd = z.length - 22;
    expect(dv.getUint32(eocd, true)).toBe(0x06054b50);
    expect(dv.getUint16(eocd + 10, true)).toBe(2);
    // 第一个条目文本 2 字节，第二个字节 5 字节 → 能找到 b.bin 的名字
    const txt = new TextDecoder("latin1").decode(z);
    expect(txt).toContain("b.bin");
  });
});
