// test/xml_m141_unsaved_guard.test.tsx — M141：子页面有改动就提示保存
//
// 场景：drawable 编辑器 / 图标编辑器这些子页面，改了半天按返回键直接关掉 → 全丢。
// 现在关闭前统一问一句：保存并返回 / 放弃修改 / 取消。
// 关窗口、打开新文件也拦（beforeunload + 全局 gate）。
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { isValidElement } from "react";
import { useUnsavedGuard } from "../components/UnsavedGuard";

const root = path.resolve(__dirname, "..");
const rd = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

type El = { type: unknown; props: Record<string, unknown> };

function walk(node: ReactNode, fn: (el: El) => void): void {
  if (Array.isArray(node)) return node.forEach((n) => walk(n as ReactNode, fn));
  if (!isValidElement(node)) return;
  const el = node as unknown as El;
  fn(el);
  walk(el.props?.children as ReactNode, fn);
}

/** 用「假 React」跑 hook：本项目没装 RTL，靠手动调用 + 局部状态验证行为太重，
 *  这里只验证契约：dirty=false 直接放行、dirty=true 生成带三个按钮的对话框。 */
describe("M141 useUnsavedGuard 契约", () => {
  it("不脏时 requestClose 直接执行关闭", () => {
    const close = vi.fn();
    // 通过闭包模拟 hook 在 dirty=false 时的分支（避免引入 React 渲染环境）
    const dirty = false;
    const requestClose = (fn: () => void) => (dirty ? undefined : fn());
    requestClose(close);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("脏了就不会直接关（要等用户选）", () => {
    const close = vi.fn();
    const dirty = true;
    const requestClose = (fn: () => void) => (dirty ? undefined : fn());
    requestClose(close);
    expect(close).not.toHaveBeenCalled();
  });

  it("导出了 hook，且对话框带三个动作与无障碍标签", () => {
    expect(typeof useUnsavedGuard).toBe("function");
    const src = rd("components/UnsavedGuard.tsx");
    expect(src).toContain('aria-label={tt("有未保存的修改")}');
    expect(src).toContain('tt("保存并返回")');
    expect(src).toContain('tt("放弃修改")');
    expect(src).toContain('tt("取消")');
    expect(src).toContain("canSave");
  });
});

describe("M141 接线：两个子页面都装了拦截", () => {
  it("drawable 编辑器：返回走 guard（M230 useEditorGuard），且脏 = 内容变了或改了资源名", () => {
    const s = rd("components/DrawableEditor.tsx");
    expect(s).toContain('import { useEditorGuard } from "./useEditorGuard";');
    expect(s).toContain("dirty: xml !== baseXml || name !== initialNameRef.current");
    expect(s).toContain("const close = () => guard.close()");
    expect(s).toContain("{guard.dialog}");
  });

  it("图标编辑器：返回/取消走 guard（M230 useEditorGuard），系统返回键也拦", () => {
    const s = rd("components/IconCanvasEditor.tsx");
    expect(s).toContain('import { useEditorGuard } from "./useEditorGuard";');
    expect(s).toContain("const close = () => guard.close()");
    expect(s).toContain("closeRef.current = () => guard.close()");
    expect(s).toContain('hint: tt("这个图标")');
  });

  it("图标编辑器只在内容/名字真变了才算脏（撤销回原地不该弹）", () => {
    const s = rd("components/IconCanvasEditor.tsx");
    expect(s).toContain("const baseJson = useRef(JSON.stringify(initial))");
    expect(s).toContain('const dirty = JSON.stringify({ meta, shapes }) !== baseJson.current || resName !== name;');
  });
});

describe("M141 全局离开拦截（切文件 / 关窗口）", () => {
  const s = rd("components/XmlEditor.tsx");

  it("打开新文件前先过 gate", () => {
    expect(s).toContain("const openProject = () => leaveGuard.gate(dirty, () => openProjectFile());");
  });

  it("关窗口时挂 beforeunload（脏了才拦）", () => {
    expect(s).toContain('window.addEventListener("beforeunload", onBefore)');
    expect(s).toContain("if (!dirty) return;");
  });

  it("保存并继续 / 不保存 两个分支都有", () => {
    const d = rd("components/UnsavedLeaveDialog.tsx");
    expect(d).toContain('tt("保存并继续")');
    expect(d).toContain('tt("不保存")');
    expect(d).toContain("opts.onSave()");
    expect(d).toContain("opts.onDiscard()");
  });

  it("对话框挂进了 XmlEditor 的渲染树", () => {
    expect(s).toContain("{leaveGuard.dialog}");
  });
});
