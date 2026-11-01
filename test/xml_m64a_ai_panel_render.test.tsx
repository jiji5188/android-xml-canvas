// @vitest-environment jsdom
// test/xml_m64a_ai_panel_render.test.tsx — M64a / A1：AiPanel 真渲染，确认按文件类型换上下文
//
// 纯逻辑在 xml_m64a_ai_doc_context.test.ts 里测过；这里只验「接线」：
// 同一个 AiPanel，传 Java 路径和传布局路径，渲染出来的提示与快捷指令必须不一样。
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import AiPanel from "../components/AiPanel";

const LAYOUT = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent" />`;
const JAVA = `package com.example.app;
public class MainActivity extends BaseActivity {
    @Override protected void onCreate(android.os.Bundle b) { super.onCreate(b); }
}`;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
}

async function mount(docRel: string, xml: string): Promise<HTMLDivElement> {
  window.localStorage?.clear(); // 不留 key → 配置区展开，但不发请求
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <AiPanel
      xml={xml}
      docRel={docRel}
      onReplaceXml={vi.fn()}
      onNote={vi.fn()}
      projectName="Demo"
    />,
  );
  await flush();
  await flush();
  return host;
}

afterEach(() => {
  if (root) root.unmount();
  if (host) host.remove();
  root = null;
  host = null;
});

const chips = (el: HTMLElement): string[] =>
  [...el.querySelectorAll(".axv-ai-chip")].map((n) => (n.textContent || "").trim());

describe("M64a AiPanel 渲染：文件类型决定文案与指令", () => {
  it("Java 文件：空状态说 Java，快捷指令是代码类", async () => {
    const el = await mount("app/src/main/java/com/example/MainActivity.java", JAVA);
    const empty = el.querySelector(".axv-ai-empty")?.textContent || "";
    expect(empty).toContain("Java");
    const labels = chips(el);
    expect(labels).toContain("解释这段代码");
    expect(labels).not.toContain("改成 ConstraintLayout");
    // 非布局不该出现「带选中」
    const checks = [...el.querySelectorAll(".axv-ai-check")].map((n) => (n.textContent || "").trim());
    expect(checks).toContain("带代码");
    expect(checks).not.toContain("带选中");
  });

  it("布局文件：仍是布局那套（带布局 / 带选中 / ConstraintLayout）", async () => {
    const el = await mount("app/src/main/res/layout/activity_main.xml", LAYOUT);
    const labels = chips(el);
    expect(labels).toContain("改成 ConstraintLayout");
    const checks = [...el.querySelectorAll(".axv-ai-check")].map((n) => (n.textContent || "").trim());
    expect(checks).toContain("带布局");
    expect(checks).toContain("带选中");
  });
});
