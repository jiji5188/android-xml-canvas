// @vitest-environment jsdom
// M102：形狀鏡像器多語言（英文界面）—— 回填后的护栏 + 实际渲染验证
import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ShapeEditor } from "@/components/ShapeEditor";
import { setI18nLang, t } from "@/lib/i18n-src";

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;

async function mount() {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    <ShapeEditor
      attrName="background"
      value="@drawable/bg_card"
      existingNames={[]}
      onClose={() => {}}
      onSave={() => {}}
    />,
  );
  await flush();
}

afterEach(() => {
  root?.unmount();
  root = null;
  setI18nLang("zh-Hans");
  document.body.innerHTML = "";
});

describe("M102 ShapeEditor 英文界面", () => {
  it("英文下标题/页签/按钮都出英文，没有残留中文", async () => {
    setI18nLang("en");
    await mount();
    const text = document.body.textContent || "";
    expect(text).toContain("Custom shape");
    expect(text).toContain("Save & apply");
    expect(text).toContain("Cancel");
    expect(text).toContain("Fill");
    // 只在形状 tab 才有的词，切过去再说
    expect(text).not.toMatch(/保存并应用|取消|自定义形状/);
  });

  it("中文环境原样显示", async () => {
    setI18nLang("zh-Hans");
    await mount();
    const text = document.body.textContent || "";
    expect(text).toContain("自定义形状");
    expect(text).toContain("保存并应用");
  });

  it("形状参数页签：圆角/内缩/渐变都有译文", async () => {
    setI18nLang("en");
    const keys = ["圆角", "统一", "四角独立", "左上", "内缩（<inset>）", "填充色", "高级：渐变", "描边色"];
    for (const k of keys) {
      expect(t(k), k).not.toBe(k);
    }
  });
});
