import { describe, it, expect } from "vitest";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;

/** M11s：gravity 的横向/纵向分量必须按 orientation 映射到主轴/交叉轴 */
function ll(gravity: string, orientation: "vertical" | "horizontal") {
  const xml = `<LinearLayout ${A}
      android:layout_width="match_parent" android:layout_height="match_parent"
      android:orientation="${orientation}"
      ${gravity ? `android:gravity="${gravity}"` : ""}>
      <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" />
    </LinearLayout>`;
  return buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root;
}

describe("M11s LinearLayout gravity 按 orientation 正确映射", () => {
  it("vertical：center → 主轴 center + 交叉轴 center", () => {
    const r = ll("center", "vertical");
    expect(r.style.justifyContent).toBe("center");
    expect(r.style.alignItems).toBe("center");
  });

  it("vertical：center_vertical|end → 主轴 center + 交叉轴 flex-end", () => {
    const r = ll("center_vertical|end", "vertical");
    expect(r.style.justifyContent).toBe("center");
    expect(r.style.alignItems).toBe("flex-end");
  });

  it("vertical：top|left → 主轴 flex-start + 交叉轴 flex-start", () => {
    const r = ll("top|left", "vertical");
    expect(r.style.justifyContent).toBe("flex-start");
    expect(r.style.alignItems).toBe("flex-start");
  });

  it("vertical：fill_horizontal → 交叉轴 stretch", () => {
    const r = ll("fill_horizontal", "vertical");
    expect(r.style.alignItems).toBe("stretch");
  });

  it("horizontal：center_vertical 只做纵向居中（不能再当主轴居中）", () => {
    const r = ll("center_vertical", "horizontal");
    expect(r.style.justifyContent).toBe("flex-start");
    expect(r.style.alignItems).toBe("center");
  });

  it("horizontal：center_horizontal → 主轴 center，交叉轴不写", () => {
    const r = ll("center_horizontal", "horizontal");
    expect(r.style.justifyContent).toBe("center");
    expect(r.style.alignItems).toBe("stretch");
  });

  it("horizontal：bottom|right → 主轴 flex-end + 交叉轴 flex-end", () => {
    const r = ll("bottom|right", "horizontal");
    expect(r.style.justifyContent).toBe("flex-end");
    expect(r.style.alignItems).toBe("flex-end");
  });

  it("horizontal：center → 两轴都居中", () => {
    const r = ll("center", "horizontal");
    expect(r.style.justifyContent).toBe("center");
    expect(r.style.alignItems).toBe("center");
  });

  it("TableRow 的 gravity 走横向布局语义", () => {
    const xml = `<TableRow ${A} android:layout_width="match_parent" android:layout_height="48dp"
        android:gravity="center_vertical">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" />
      </TableRow>`;
    const r = buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES as never).root;
    expect(r.style.flexDirection).toBe("row");
    expect(r.style.justifyContent).toBe("flex-start");
    expect(r.style.alignItems).toBe("center");
  });
});
