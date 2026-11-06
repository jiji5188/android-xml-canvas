// M163c：drawable 编辑器「参数面板」里 item 的「对齐」必须是可输入下拉
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { SlotRows } from "@/components/drawable/SlotRows";
import type { DrawableNode } from "@/lib/xml/drawable-node";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

const parent = (): DrawableNode =>
  ({
    key: "p",
    t: "layer",
    items: [{ key: "k", alpha: 1, node: { key: "c", t: "color", color: "#FF0000" } as never }],
  } as never);

describe("M163c item 对齐可输入", () => {
  it("渲染为 input + datalist，且预设里有组合值", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    r.render(
      <SlotRows
        parent={parent()}
        index={0}
        slot={{ gravity: "center" } as never}
        onChange={() => {}}
      />,
    );
    await flush();
    const inputs = host.querySelectorAll("input[list]");
    expect(inputs.length).toBeGreaterThan(0);
    const listId = inputs[0].getAttribute("list")!;
    const options = [...host.querySelectorAll(`datalist#${listId} option`)].map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toContain("center_vertical|left");
    expect(options).toContain("top|center_horizontal");
    expect(options).toContain("bottom|center_horizontal");
    expect(options).toContain("center_vertical|right");
    host.remove();
  });

  it("改值直接回写 android:gravity", async () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const r = createRoot(host);
    r.render(
      <SlotRows parent={parent()} index={0} slot={{} as never} onChange={onChange} />,
    );
    await flush();
    const box = [...host.querySelectorAll("input[list]")]
      .find((i) => i.getAttribute("list")!.includes("gravity")) as HTMLInputElement;
    expect(box).toBeTruthy();
    // 用 React 认可的 native setter + input 事件（跟用户真实输入同一条路）
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(box, "center_vertical|left");
    box.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(onChange).toHaveBeenCalledWith({ gravity: "center_vertical|left" });
    host.remove();
  });
});
