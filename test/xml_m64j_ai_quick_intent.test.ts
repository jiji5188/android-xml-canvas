// test/xml_m64j_ai_quick_intent.test.ts — M64j（A5）：快捷指令分「整份重写」和「局部改」
//
// 真 bug：布局那四条快捷指令全是「只输出完整 XML」导向，点「修掉告警」或「加一个控件」
// 也让模型重写整份文件——300 个控件的布局会被截断，控件莫名消失。
// 现在：动文件的两条改成 intent=edit（走 apply_patch），只有「改成 ConstraintLayout」
// 这种真需要整体重排的才 intent=xml。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AI_QUICK_ACTIONS } from "@/lib/xml/ai";
import { aiDocContextOf, buildAiSystemPrompt, quickActionsFor } from "@/lib/xml/ai-doc-context";

const LAYOUT = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView android:id="@+id/tv" android:layout_width="wrap_content" android:layout_height="wrap_content" />
</LinearLayout>`;

const intentOf = (def: { id: string; intent?: string; wantsXml: boolean }, id: string) => {
  const a = def as unknown as { id: string; intent?: string; wantsXml: boolean };
  return a.intent ?? (a.wantsXml ? "xml" : "auto");
};

describe("M64j A5：布局快捷指令的意图", () => {
  const byId = (id: string) => AI_QUICK_ACTIONS.find((a) => a.id === id)!;

  it("「修掉告警」「加一个控件」走 edit，不要求整份重写", () => {
    expect(intentOf(byId("fix") as never, "fix")).toBe("edit");
    expect(intentOf(byId("add") as never, "add")).toBe("edit");
    // 指令里也必须明说走 patch
    expect(byId("fix").prompt).toContain("apply_patch");
    expect(byId("fix").prompt).not.toContain("只输出完整 XML");
    expect(byId("add").prompt).toContain("apply_patch");
    expect(byId("add").prompt).not.toContain("只输出完整 XML");
  });

  it("「改成 ConstraintLayout」仍然要整份（这个动作本来就是整体重排）", () => {
    expect(intentOf(byId("optimize") as never, "optimize")).toBe("xml");
    expect(byId("optimize").prompt).toContain("只输出完整 XML");
  });

  it("「解释这个界面」保持 auto", () => {
    expect(intentOf(byId("explain") as never, "explain")).toBe("auto");
  });

  it("Java/Kotlin 的改代码快捷指令也走 edit", () => {
    const acts = quickActionsFor(aiDocContextOf("app/src/main/java/A.java", "class A {}"));
    const edit = acts.filter((a) => (a.intent ?? (a.wantsXml ? "xml" : "auto")) === "edit").map((a) => a.id);
    expect(edit.length).toBeGreaterThanOrEqual(2);
    // 评审类（找潜在问题）不该去改文件
    const review = acts.find((a) => a.id === "optimize")!;
    expect(review.intent ?? "auto").toBe("auto");
  });
});

describe("M64j A5：intent=edit 的 prompt", () => {
  it("明确要求 apply_patch、禁止整份重贴", () => {
    const ctx = aiDocContextOf("app/src/main/res/layout/a.xml", LAYOUT);
    const sys = buildAiSystemPrompt(ctx, { intent: "edit", canWrite: true });
    expect(sys).toContain("直接改文件");
    expect(sys).toContain("apply_patch");
    expect(sys).toContain("不要整份重贴");
    // 不能残留「输出完整内容」那种指令
    expect(sys).not.toContain("输出**完整**内容");
  });

  it("没有写权限时不教它调写文件工具", () => {
    const ctx = aiDocContextOf("app/src/main/res/layout/a.xml", LAYOUT);
    const sys = buildAiSystemPrompt(ctx, { intent: "edit", canWrite: false });
    expect(sys).toContain("没有写权限");
    expect(sys).not.toContain("必须用 axv-tool 的 apply_patch");
  });

  it("intent=auto 仍是「先判断我要什么」，intent=xml 才要整份", () => {
    const ctx = aiDocContextOf("app/src/main/res/layout/a.xml", LAYOUT);
    expect(buildAiSystemPrompt(ctx, { intent: "auto" })).toContain("先判断我这句话要什么");
    expect(buildAiSystemPrompt(ctx, { intent: "xml" })).toContain("明确要完整文件");
  });
});

describe("M64j A5：AiPanel 把 intent 传下去", () => {
  it("快捷指令用 a.intent（回退 wantsXml），不再只传 boolean", () => {
    const src = readFileSync(resolve(process.cwd(), "components/AiPanel.tsx"), "utf8");
    expect(src).toContain('send(a.prompt, a.intent ?? (a.wantsXml ? "xml" : "auto"))');
    expect(src).toContain('typeof intentOrFull === "boolean"');
  });
});
