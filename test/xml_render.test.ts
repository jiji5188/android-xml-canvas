import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { mergeResourceFragment, DEFAULT_RESOURCES } from "../lib/xml/resources";

const sample = (name: string) =>
  fs.readFileSync(path.join(__dirname, "samples", name), "utf8");

const model = (xml: string, frag = "") =>
  buildRenderModel(
    parseLayoutXml(xml).root!,
    frag ? mergeResourceFragment(frag) : DEFAULT_RESOURCES,
  );

describe("M1a 渲染引擎（XML → CSS 树）", () => {
  it("样例1 竖 linear：flex-direction/weight/gone 正确", () => {
    const m = model(sample("list_vertical.xml"));
    const root = m.root;
    expect(root.tag).toBe("LinearLayout");
    expect(root.style.display).toBe("flex");
    expect(root.style.flexDirection).toBe("column");
    expect(root.style.paddingTop).toBe("32px"); // 16dp @2x
    expect(root.style.paddingRight).toBe("32px");

    const tvTitle = root.children[0];
    expect(tvTitle.tag).toBe("TextView");
    expect(tvTitle.style.fontSize).toBe("36px");
    expect(tvTitle.text).toBe("My App");

    const tvItem2 = root.children[3];
    expect(tvItem2.style.display).toBe("none");

    const btn = root.children[4];
    expect(btn.tag).toBe("Button");
    expect(btn.style.backgroundColor).toBe("#757575");
    expect(btn.text).toBe("确定");
    expect(btn.style.marginTop).toBe("48px");
  });

  it("样例2 横 linear + weight：flexGrow/flexBasis/match_parent", () => {
    const m = model(sample("toolbar_horizontal.xml"));
    const root = m.root;
    expect(root.style.flexDirection).toBe("row");
    expect(root.style.height).toBe("112px");

    const title = root.children[0];
    expect(title.style.flexGrow).toBe(1);
    expect(title.style.flexBasis).toBe("0px");
    expect(title.style.width).toBe("0px");
    expect(title.style.height).toBe("100%");

    const btn = root.children[1];
    expect(btn.style.width).toBe("auto");
    expect(btn.style.marginRight).toBe("32px");
    // M4q：Button 现在补 Android 默认内边距（16dp @2x = 32px），与真机观感一致
    expect(btn.style.paddingLeft).toBe("32px");
    expect(btn.style.minHeight).toBe("96px");
  });

  it("样例3 FrameLayout：子项绝对定位 + layout_gravity=bottom|end", () => {
    const m = model(sample("floating_frame.xml"));
    const root = m.root;
    expect(root.style.position).toBe("relative");
    expect(root.style.display).toBe("flex");

    const fab = root.children[1];
    expect(fab.style.position).toBe("absolute");
    // M11z：absolute 下 alignSelf 无效，改成真的靠右下
    expect(fab.style.right).toBe("0px");
    expect(fab.style.bottom).toBe("0px");
    expect(fab.style.width).toBe("96px");
    expect(fab.style.marginTop).toBe("48px");

    const scroll = root.children[0];
    expect(scroll.style.overflowY).toBe("auto");
  });

  it("资源覆盖：用户 fragment 的 @dimen 生效", () => {
    const frag = `<resources><dimen name="margin_small">10dp</dimen><color name="primary">#FF0000</color></resources>`;
    const xml = sample("list_vertical.xml").replace(
      'android:layout_marginTop="8dp"',
      'android:layout_marginTop="@dimen/margin_small"',
    );
    const m = model(xml, frag);
    const line = m.root.children[1];
    expect(line.style.marginTop).toBe("20px");
    const btn = m.root.children[4];
    expect(btn.style.backgroundColor).toBe("#FF0000");
  });

  it("issues：未定义 @string 给 warn 不阻断", () => {
    const xml = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="match_parent">
      <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="@string/not_defined_anywhere" /></LinearLayout>`;
    const m = model(xml);
    expect(m.root.children[0].text).toBe("@string/not_defined_anywhere");
    expect(m.issues.some((i) => i.level === "warn" && i.message.includes("not_defined_anywhere"))).toBe(true);
  });
});
