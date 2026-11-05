import { describe, expect, it } from "vitest";
import { parseLayoutXml } from "@/lib/xml/parser";
import { parseShapeElement, specToCss } from "@/lib/xml/shape-gen";

/**
 * M150：shape="line" 的回归。
 * 事故：layer-list 里放 shape=line + stroke(10dp)，预览画成了四边框（镂空方框）。
 * 根因：specToCss 只有 `background = undefined`，早先算出的 css.border 还在。
 */
describe("M150 shape=line 预览", () => {
  const xml = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:alpha="0.07">
    <shape android:shape="line">
      <solid android:color="#FFEEEEEE"/>
      <stroke android:width="10dp" android:color="#FFDDDDDD"/>
    </shape>
  </item>
</layer-list>`;

  const shape = (() => {
    const root = parseLayoutXml(xml).root!;
    const item = root.children.find((c) => c.tag === "item")!;
    return item.children.find((c) => c.tag === "shape")!;
  })();

  it("解析出 kind=line 且带 stroke", () => {
    const spec = parseShapeElement(shape);
    expect(spec.kind).toBe("line");
    expect(spec.stroke?.width).toBe(10);
  });

  it("不出四边框，改成一条水平线", () => {
    const css = specToCss(parseShapeElement(shape));
    expect(css.border).toBeUndefined();
    expect(css.borderRadius).toBeUndefined();
    expect(css.background).toContain("linear-gradient");
    expect(css.background).toContain("100% 10px");
    expect(css.background).toContain("no-repeat");
  });

  it("没 stroke 的 line 什么都不画（Android 也是空的，solid 对 line 无效）", () => {
    const noStroke = parseLayoutXml(`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
  <item android:height="20dp">
    <shape android:shape="line"><solid android:color="#FFEEEEEE"/></shape>
  </item>
</layer-list>`).root!.children[0].children[0];
    const css = specToCss(parseShapeElement(noStroke));
    expect(css.background).toBeUndefined();
    expect(css.border).toBeUndefined();
  });

  it("虚线走 repeating-linear-gradient", () => {
    const dashed = shape;
    const spec = parseShapeElement(dashed);
    const css = specToCss({ ...spec, stroke: { ...spec.stroke!, dashWidth: 4, dashGap: 4 } });
    expect(css.background).toContain("repeating-linear-gradient");
  });
});
