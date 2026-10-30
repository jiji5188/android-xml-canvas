// M25f：四条保存路径收口（buildSaveFiles / saveBack / saveAs / res.zip）
import { describe, it, expect, vi } from "vitest";
import {
  buildSaveFiles,
  exportResZip,
  nextSaveAction,
  saveAs,
  saveBack,
  type SaveIO,
  type SaveInput,
  type SaveTarget,
} from "@/lib/xml/save-flow";
import { buildShapeXml } from "@/lib/xml/shape-gen";

const LAYOUT = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"',
  '  android:layout_width="match_parent"',
  '  android:layout_height="match_parent"',
  '  android:orientation="vertical">',
  "  <TextView",
  '    android:layout_width="wrap_content"',
  '    android:layout_height="wrap_content"',
  '    android:background="@drawable/bg_card"',
  '    android:text="Hi"/>',
  "</LinearLayout>",
].join("\n");

const input = (over: Partial<SaveInput> = {}): SaveInput => ({
  xml: LAYOUT,
  mode: "modern",
  name: "activity_main.xml",
  generatedDrawables: { bg_card: buildShapeXml({ kind: "rectangle", solid: "#FFFFFF", radius: 8 }) },
  extras: null,
  ...over,
});

function io(over: Partial<SaveIO> = {}) {
  const written: { path: string; text: string }[] = [];
  const handles: unknown[] = [];
  const bundle: { files: unknown[]; name: string }[] = [];
  const impl: SaveIO = {
    writeNative: (path, text) => {
      written.push({ path, text });
      return true;
    },
    writeHandle: async (handle, text) => {
      handles.push(handle);
      written.push({ path: "(handle)", text });
      return true;
    },
    saveBundle: async (files, name) => {
      bundle.push({ files, name });
      return { ok: true, label: "所选文件夹", count: files.length };
    },
    ...over,
  };
  return { impl, written, handles, bundle };
}

describe("buildSaveFiles", () => {
  it("布局放 layout/，生成的 drawable 一起带上", () => {
    const files = buildSaveFiles(input());
    const paths = files.map((f) => f.path);
    expect(paths[0]).toBe("layout/activity_main.xml");
    expect(paths).toContain("drawable/bg_card.xml");
    expect(files[0].text).toContain("<LinearLayout");
  });

  it("compat 模式走兼容导出（去掉 ConstraintLayout 约束）", () => {
    const src =
      '<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:layout_width="match_parent" android:layout_height="match_parent"><TextView android:layout_width="wrap_content" android:layout_height="wrap_content" app:layout_constraintTop_toTopOf="parent"/></androidx.constraintlayout.widget.ConstraintLayout>';
    const modern = buildSaveFiles(input({ xml: src, mode: "modern" }))[0].text;
    const compat = buildSaveFiles(input({ xml: src, mode: "compat" }))[0].text;
    expect(compat).not.toBe(modern);
  });
});

describe("nextSaveAction", () => {
  it("有来源写回，没来源另存", () => {
    expect(nextSaveAction(null)).toBe("as");
    expect(nextSaveAction({ kind: "native", target: "/sdcard/a.xml", name: "a.xml" })).toBe("back");
  });
});

describe("saveBack", () => {
  it("native：主文件写到原路径，依赖资源写到 res 根下", async () => {
    const { impl, written } = io();
    const target: SaveTarget = {
      kind: "native",
      target: "/sdcard/Proj/app/src/main/res/layout/activity_main.xml",
      name: "activity_main.xml",
    };
    const r = await saveBack(input(), target, impl);
    expect(r.ok).toBe(true);
    expect(written[0].path).toBe("/sdcard/Proj/app/src/main/res/layout/activity_main.xml");
    expect(written.map((w) => w.path)).toContain("/sdcard/Proj/app/src/main/res/drawable/bg_card.xml");
    expect(r.depsWritten).toBe(r.depsTotal);
  });

  it("handle：只写主文件，依赖资源交给「另存」", async () => {
    const ioCtx = io();
    const r = await saveBack(input(), { kind: "handle", handle: { name: "h" }, name: "activity_main.xml" }, ioCtx.impl);
    expect(r.ok).toBe(true);
    expect(ioCtx.written).toHaveLength(1);
    expect(r.depsWritten).toBe(0);
    expect(r.depsTotal).toBeGreaterThan(0);
  });

  it("写失败返回 ok=false（调用方回落另存）", async () => {
    const { impl } = io({ writeNative: () => false, writeHandle: async () => false });
    const r = await saveBack(input(), { kind: "native", target: "/x/a.xml", name: "a.xml" }, impl);
    expect(r.ok).toBe(false);
  });
});

describe("saveAs", () => {
  it("整包交给选择器，count 缺省用文件数", async () => {
    const { impl, bundle } = io();
    const r = await saveAs(input(), impl);
    expect(r.ok).toBe(true);
    expect(bundle[0].name).toBe("activity_main.xml");
    expect(r.count).toBe((bundle[0].files as unknown[]).length);
  });

  it("用户取消时保留 canceled", async () => {
    const { impl } = io({ saveBundle: async () => ({ ok: false, canceled: true }) });
    const r = await saveAs(input(), impl);
    expect(r.canceled).toBe(true);
  });
});

describe("exportResZip", () => {
  it("打出来的包里有 layout 和 drawable", async () => {
    const r = exportResZip(input());
    expect(r.count).toBeGreaterThan(1);
    expect(r.bytes.length).toBeGreaterThan(50);
    expect(Array.isArray(r.missing)).toBe(true);
  });

  it("引用没覆盖的 drawable 会出现在 missing 里", () => {
    const r = exportResZip(input({ generatedDrawables: {} }));
    expect(r.missing).toContain("bg_card");
  });
});
