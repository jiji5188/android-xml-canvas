// test/xml_m78_overlay_back_src.test.ts — M78 接入护栏（node 环境，jsdom 里不能用 node:fs）
//
// M230 起：返回键/未保存守卫统一由 components/useEditorGuard.tsx（内部调 useOverlayBack +
// useUnsavedGuard）接管；真机预览统一由 components/useRealPreview.ts 接管。
// 这两个编辑器不再直接 import useOverlayBack / hasRealRender，而是调统一 hook。

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (f: string) => readFileSync(resolve(process.cwd(), f), "utf8");

describe("M78 接入护栏（M230 统一接入层）", () => {
  it("IconCanvasEditor / DrawableEditor 的返回与关闭都走 useEditorGuard（内部接 useOverlayBack）", () => {
    const icon = read("components/IconCanvasEditor.tsx");
    expect(icon).toContain('import { useEditorGuard } from "./useEditorGuard";');
    expect(icon).toContain("useEditorGuard({");
    // 不能再直接 import 旧的两条（M230 已收敛进 hook）
    expect(icon).not.toContain('import { useOverlayBack } from "@/lib/overlay-back";');
    expect(icon).not.toContain('import { useUnsavedGuard } from "./UnsavedGuard";');

    const dw = read("components/DrawableEditor.tsx");
    expect(dw).toContain('import { useEditorGuard } from "./useEditorGuard";');
    expect(dw).toContain("useEditorGuard({");
    expect(dw).not.toContain('import { useOverlayBack } from "@/lib/overlay-back";');
    expect(dw).not.toContain('import { useUnsavedGuard } from "./UnsavedGuard";');

    for (const src of [icon, dw]) {
      expect(src).not.toContain('onClick={onClose} aria-label="关闭"');
      expect(src).not.toContain('onClick={onClose} aria-label="返回编辑器"');
    }
  });

  it("useEditorGuard 内部：useOverlayBack 只调用一次（不重复挂 back 监听）", () => {
    const hook = read("components/useEditorGuard.tsx");
    expect(hook).toContain('import { useOverlayBack } from "@/lib/overlay-back";');
    expect(hook).toContain('import { useUnsavedGuard } from "./UnsavedGuard";');
    expect(hook.split("useOverlayBack(true, () => closeRef.current())").length - 1).toBe(1);
  });

  it("真机预览统一走 useRealPreview（收集嵌套引用 + aapt2 编译）", () => {
    const hook = read("components/useRealPreview.ts");
    expect(hook).toContain('collectProjectRes');
    expect(hook).toContain('renderReal');
    expect(hook).toContain('buildResourcePreviewFiles');

    const icon = read("components/IconCanvasEditor.tsx");
    const dw = read("components/DrawableEditor.tsx");
    for (const src of [icon, dw]) {
      expect(src).toContain('import { useRealPreview } from "./useRealPreview";');
      // 不再直接 import native-render / res-preview（M230 收敛进 hook）
      expect(src).not.toContain('import { hasRealRender, renderReal } from "@/lib/xml/native-render";');
      expect(src).not.toContain('buildResourcePreviewFiles');
    }
  });
});
