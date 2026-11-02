// @vitest-environment jsdom
// M81：图标编辑器（画布版 IconCanvasEditor）的取色入口
// 沿革：M63h 时代断言的是旧参数式 IconEditor 的 .axv-cf-swatch；M79 换成 ColorPicker 后旧断言失效，
// M81 整页替换成画布版，这里改成断言新面板的「填充色块 → 弹窗取色器」这条链路。
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import IconCanvasEditor from "@/components/IconCanvasEditor";

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
};

describe("M81 画布图标编辑器取色", () => {
  it("填充色块点开是统一颜色选择器（不是原生 input[type=color]）", async () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <IconCanvasEditor name="ic_test" onClose={() => {}} onSave={() => {}} existingNames={[]} />,
    );
    await flush();

    expect(document.querySelector('.axv-cv-swatch input[type="color"]')).toBeNull();
    const sw = document.querySelector(".axv-cv-swatch") as HTMLElement;
    expect(sw).not.toBeNull();
    sw.click();
    await flush();
    expect(document.querySelector(".axv-cp-mask")).not.toBeNull();
    root.unmount();
  });
});
