// test/xml_m78_overlay_back_src.test.ts — M78 接入护栏（node 环境，jsdom 里不能用 node:fs）
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("M78 接入护栏", () => {
  it("IconEditor / DrawableEditor 的返回与关闭都走 useOverlayBack", () => {
    // M135：ShapeEditor 退化成 DrawableEditor 的薄封装，不再直接持有 overlay
    // M141：DrawableEditor 的 close 要先过未保存提示，所以经 closeRef 转到 guard
    const icon = read("components/IconEditor.tsx");
    expect(icon).toContain('import { useOverlayBack } from "@/lib/overlay-back";');
    expect(icon).toContain("const close = useOverlayBack(true, onClose);");

    const dw = read("components/DrawableEditor.tsx");
    expect(dw).toContain('import { useOverlayBack } from "@/lib/overlay-back";');
    expect(dw).toContain("useOverlayBack(true, () => closeRef.current())");
    expect(dw).toContain("const close = () => guard.requestClose(onClose)");

    for (const src of [icon, dw]) {
      expect(src).not.toContain('onClick={onClose} aria-label="关闭"');
      expect(src).not.toContain('onClick={onClose} aria-label="返回编辑器"');
    }
  });

  it("hook 必须放在任何 early return 之前（IconEditor 有 if (!model) 早退分支）", () => {
    const src = read("components/IconEditor.tsx");
    const hookAt = src.indexOf("const close = useOverlayBack(true, onClose);");
    const earlyAt = src.indexOf("if (!model) {");
    expect(hookAt).toBeGreaterThan(0);
    expect(earlyAt).toBeGreaterThan(0);
    expect(hookAt).toBeLessThan(earlyAt);
    // 只允许出现一次（曾经插在早退分支之后，属于 hook 条件调用）
    expect(src.split("const close = useOverlayBack(true, onClose);").length - 1).toBe(1);
  });
});
