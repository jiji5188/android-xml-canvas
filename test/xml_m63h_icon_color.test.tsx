// @vitest-environment jsdom
// M63h：图标编辑器的取色按钮（原 axv-icon-ed-color）换成自定义 ColorField
import { describe, it, expect } from "vitest";
import { createRoot } from "react-dom/client";
import IconEditor from "@/components/IconEditor";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

describe("M63h 图标编辑器取色器", () => {
  it("不再有原生 input[type=color]，换成 .axv-cf-swatch，点开是 HSV 面板", async () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(
      <IconEditor name="ic_test" onClose={() => {}} onSave={() => {}} existingNames={[]} />,
    );
    await flush();

    expect(document.querySelector('.axv-icon-ed-swatches input[type="color"]')).toBeNull();
    const sw = document.querySelector(".axv-icon-ed-swatches .axv-cf-swatch") as HTMLElement;
    expect(sw).not.toBeNull();
    sw.click();
    await flush();
    expect(document.querySelector(".axv-cf-mask .axv-hsv-panel")).not.toBeNull();
    root.unmount();
  });
});
