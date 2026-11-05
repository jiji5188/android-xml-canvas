import { describe, expect, it } from "vitest";
import { parseShapeDrawable } from "@/lib/xml/shape";
import { buildRenderModel } from "@/lib/xml/css";
import { parseLayoutXml } from "@/lib/xml/parser";

const rc = (raw: string) => (raw.startsWith("#") ? raw : "#FF00AA00");

describe("M152 drawable 变换包装（画布背景）", () => {
  it("rotate 包 shape → xform.rotate + pivot", () => {
    const s = parseShapeDrawable(
      `<rotate xmlns:android="http://schemas.android.com/apk/res/android" android:fromDegrees="45" android:pivotX="25%" android:pivotY="75%">
         <shape android:shape="rectangle"><solid android:color="#FF3355FF"/></shape>
       </rotate>`,
      rc,
    );
    expect(s?.xform?.rotate).toBe(45);
    expect(s?.xform?.pivotX).toBe("25%");
    expect(s?.xform?.pivotY).toBe("75%");
  });

  it("scale 包 shape → 百分比拆成数字", () => {
    const s = parseShapeDrawable(
      `<scale xmlns:android="http://schemas.android.com/apk/res/android" android:scaleWidth="40%" android:scaleHeight="60%" android:scaleGravity="center">
         <shape android:shape="oval"><solid android:color="#FFFF0000"/></shape>
       </scale>`,
      rc,
    );
    expect(s?.xform?.scaleW).toBe(40);
    expect(s?.xform?.scaleH).toBe(60);
    expect(s?.oval).toBe(true);
  });

  it("clip 只下沉不裁（level=10000 语义）", () => {
    const s = parseShapeDrawable(
      `<clip xmlns:android="http://schemas.android.com/apk/res/android" android:clipOrientation="horizontal" android:gravity="left">
         <shape android:shape="rectangle"><solid android:color="#FF112233"/></shape>
       </clip>`,
      rc,
    );
    expect(s?.solid).toBe("#FF112233");
    expect(s?.xform).toBeUndefined();
  });

  it("selector 里的 rotate 能被选中（inline 白名单已补）", () => {
    const s = parseShapeDrawable(
      `<selector xmlns:android="http://schemas.android.com/apk/res/android">
         <item><rotate android:fromDegrees="30"><shape android:shape="rectangle"><solid android:color="#FFABCDEF"/></shape></rotate></item>
       </selector>`,
      rc,
    );
    expect(s?.xform?.rotate).toBe(30);
  });

  it("背景带 rotate → 生成独立 bgLayer，节点自身不吃背景", () => {
    const xml = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
          android:layout_width="200dp" android:layout_height="100dp"
          android:background="@drawable/bg_rot"/>`;
    const tree = parseLayoutXml(xml);
    expect(tree?.root).toBeTruthy();
    if (!tree?.root) throw new Error("解析失败");
    const m = buildRenderModel(tree.root, {
      drawableXml: {
        bg_rot: `<rotate xmlns:android="http://schemas.android.com/apk/res/android" android:fromDegrees="30">
            <shape android:shape="rectangle"><solid android:color="#FF3355FF"/><corners android:radius="8dp"/></shape>
          </rotate>`,
      },
    } as never);
    const n = m.root;
    console.log("bgLayer:", JSON.stringify(n.bgLayer), "styleBg:", n.style.backgroundColor);
    expect(n.bgLayer?.transform).toBe("rotate(30deg)");
    expect(n.bgLayer?.transformOrigin).toBe("50% 50%");
    expect(n.style.backgroundColor ?? "").toBe("");
  });
});
