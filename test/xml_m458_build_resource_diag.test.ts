// M458：打包资源/图标透明化
//  1) readProjectManifest：嵌套目录项目（manifest 在 PROJ/app/src/main/ 下）以前固定三条候选全漏 → 现在从 openRel 推导 res 兄弟目录 / main 目录命中
//  2) collectProjectRes 结果带 resRel/dirsCount，res 定位失败时带 warn（不再静默）
//  3) iconFilesForRefs：manifest 图标引用 → 包内实际进包的路径
import { describe, expect, it } from "vitest";
import { readProjectManifest } from "@/lib/xml/find-launcher";
import { collectProjectRes } from "@/lib/xml/res-collect";
import { iconFilesForRefs, manifestIconRefs } from "@/lib/xml/icon-fallback";
import { clearResIndex } from "@/lib/xml/res-index";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import type { RenderFile } from "@/lib/xml/native-render";

const MANIFEST =
  '<?xml version="1.0" encoding="utf-8"?><manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.x.y">\n' +
  '  <application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"></application>\n' +
  "</manifest>";

/** 磁盘 mock：按文件表提供 read/list */
function mockIo(
  files: Record<string, string>,
  listDirs: Record<string, { name: string; kind: string }[]>,
): AiFileIo {
  return {
    rootLabel: () => "mock-m458",
    canWrite: true,
    list: async (rel: string) => {
      const key = rel.replace(/\/+$/, "");
      const items = listDirs[key] ?? listDirs[rel];
      if (!items) return { ok: false, items: undefined, error: "not found" };
      return { ok: true, items: items as never, error: undefined };
    },
    read: async (rel: string) => {
      const t = files[rel];
      return t ? { ok: true, text: t } : { ok: false };
    },
    readBase64: async () => ({ ok: false }),
    write: async () => ({ ok: false }),
  } as unknown as AiFileIo;
}

describe("M458 readProjectManifest 动态候选", () => {
  it("嵌套项目：manifest 在 PROJ/app/src/main/ 下，openRel 是 java 文件 → 命中", async () => {
    const io = mockIo(
      { "PROJ/app/src/main/AndroidManifest.xml": MANIFEST },
      {},
    );
    // 旧行为（不传 docRel）：固定三条候选全不命中
    const legacy = await readProjectManifest(io, "pkg");
    expect(legacy.text).toBe("");
    // 新行为：从 openRel（java 路径）推导 main 目录候选
    const fixed = await readProjectManifest(io, "pkg", "PROJ/app/src/main/java/com/x/A.java");
    expect(fixed.text).toBe(MANIFEST);
    expect(fixed.rel).toBe("PROJ/app/src/main/AndroidManifest.xml");
  });

  it("openRel 是 res 下文件 → res 兄弟目录命中", async () => {
    const io = mockIo(
      { "PROJ/app/src/main/AndroidManifest.xml": MANIFEST },
      {},
    );
    const r = await readProjectManifest(io, "pkg", "PROJ/app/src/main/res/layout/a.xml");
    expect(r.text).toBe(MANIFEST);
  });

  it("标准项目：openRel 任意 → 固定候选仍命中（不回归）", async () => {
    const io = mockIo({ "app/src/main/AndroidManifest.xml": MANIFEST }, {});
    const r = await readProjectManifest(io, "pkg", "app/src/main/java/com/x/A.java");
    expect(r.text).toBe(MANIFEST);
    expect(r.rel).toBe("app/src/main/AndroidManifest.xml");
  });
});

describe("M458 collectProjectRes 诊断字段", () => {
  it("res 定位成功 → resRel/dirsCount 返回", async () => {
    clearResIndex();
    const io = mockIo(
      {
        "app/src/main/res/values/strings.xml":
          '<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">X</string></resources>',
      },
      {
        "app/src/main/res": [{ name: "values", kind: "dir" }],
        "app/src/main/res/values": [{ name: "strings.xml", kind: "file" }],
      },
    );
    const r = await collectProjectRes(
      io,
      "app/src/main/res/layout/a.xml",
      [
        {
          path: "layout/a.xml",
          text: '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:text="@string/app_name"/></LinearLayout>',
        },
      ],
      160,
    );
    expect(r.resRel).toBe("app/src/main/res");
    expect(r.dirsCount).toBe(1);
    expect(r.warn).toBeUndefined();
    expect(r.files.some((f) => f.path === "values/strings.xml")).toBe(true);
  });

  it("res 定位失败 → resRel 空 + warn（不再静默）", async () => {
    clearResIndex();
    const io = mockIo({}, {});
    const r = await collectProjectRes(
      io,
      "app/src/main/res/layout/a.xml",
      [{ path: "layout/a.xml", text: "<FrameLayout xmlns:android='http://schemas.android.com/apk/res/android'/>" }],
      160,
    );
    expect(r.resRel).toBe("");
    expect(r.warn).toBeTruthy();
    expect(r.files.length).toBe(1);
  });
});

describe("M458 iconFilesForRefs / manifestIconRefs", () => {
  it("mipmap 引用命中限定符目录 + PNG 命中", () => {
    const refs = manifestIconRefs(
      '<application android:icon="@mipmap/ic_launcher" android:roundIcon="@mipmap/ic_launcher_round"/>',
    );
    expect(refs).toEqual([
      { type: "mipmap", name: "ic_launcher" },
      { type: "mipmap", name: "ic_launcher_round" },
    ]);
    const files: RenderFile[] = [
      { path: "mipmap-anydpi-v26/ic_launcher.xml", text: "<adaptive-icon/>" },
      { path: "mipmap-hdpi/ic_launcher_round.png", text: "", base64: "aGk=" },
      { path: "layout/a.xml", text: "x" },
    ];
    expect(iconFilesForRefs(files, refs)).toEqual([
      "mipmap-anydpi-v26/ic_launcher.xml",
      "mipmap-hdpi/ic_launcher_round.png",
    ]);
  });

  it("无引用 → 空", () => {
    expect(manifestIconRefs("<application/>")).toEqual([]);
    expect(iconFilesForRefs([] as RenderFile[], [])).toEqual([]);
  });
});
