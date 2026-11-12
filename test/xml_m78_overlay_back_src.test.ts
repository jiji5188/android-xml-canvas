// test/xml_m78_overlay_back_src.test.ts — M78 接入护栏（node 环境，jsdom 里不能用 node:fs）
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("M78 接入护栏", () => {
  it("IconCanvasEditor / DrawableEditor 的返回与关闭都走 useOverlayBack", () => {
    // M135：ShapeEditor 退化成 DrawableEditor 的薄封装，不再直接持有 overlay
    // M141：DrawableEditor 的 close 要先过未保存提示，所以经 closeRef 转到 guard
    // 2026-11-12：旧 IconEditor 已删（被 IconCanvasEditor 取代），护栏跟着换到新编辑器
    const icon = read("components/IconCanvasEditor.tsx");
    expect(icon).toContain('import { useOverlayBack } from "@/lib/overlay-back";');
    expect(icon).toContain("useOverlayBack(true, () => closeRef.current())");

    const dw = read("components/DrawableEditor.tsx");
    expect(dw).toContain('import { useOverlayBack } from "@/lib/overlay-back";');
    expect(dw).toContain("useOverlayBack(true, () => closeRef.current())");
    expect(dw).toContain("const close = () => guard.requestClose(onClose)");

    for (const src of [icon, dw]) {
      expect(src).not.toContain('onClick={onClose} aria-label="关闭"');
      expect(src).not.toContain('onClick={onClose} aria-label="返回编辑器"');
    }
  });

  it("useOverlayBack 只调用一次（不重复挂 back 监听）", () => {
    for (const f of ["components/IconCanvasEditor.tsx", "components/DrawableEditor.tsx"]) {
      const src = read(f);
      expect(src.split("useOverlayBack(true, () => closeRef.current())").length - 1).toBe(1);
    }
  });
});
