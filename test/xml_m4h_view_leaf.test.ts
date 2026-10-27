// test/xml_m4h_view_leaf.test.ts — 铁律：只有 ViewGroup 能包含子控件，View 本身也不行
// 用户 2026-10-28 要求：添加组件 / 拖拽加入子组件时，所有继承自 View 的控件（含 View 本身）都要拦截
import { describe, it, expect } from "vitest";
import {
  isContainerTag,
  canAcceptChild,
  insertChild,
  isKnownLeafTag,
} from "../lib/xml/insert";
import { lintXml } from "../lib/xml/lint";
import { WIDGETS } from "../components/widget-catalog";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"`;
const NEW_TV = `<TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x" />`;

/** 常见 View 子类（非 ViewGroup）——全部必须判为「非容器」 */
const LEAF_TAGS = [
  "View",
  "TextView",
  "Button",
  "MaterialButton",
  "ImageButton",
  "ImageView",
  "EditText",
  "CheckBox",
  "RadioButton",
  "Switch",
  "SwitchCompat",
  "SeekBar",
  "ProgressBar",
  "RatingBar",
  "Space",
  "ViewStub",
  "Chronometer",
  "TextClock",
];

describe("M4h 所有 View 子类（含 View 本身）都不能当父容器", () => {
  it("isContainerTag：View 及 View 子类全部 false", () => {
    for (const t of LEAF_TAGS) {
      expect(isContainerTag(t), t).toBe(false);
    }
  });

  it("isContainerTag：ViewGroup 子类仍然 true", () => {
    for (const t of ["LinearLayout", "FrameLayout", "ConstraintLayout", "CardView", "ScrollView"]) {
      expect(isContainerTag(t), t).toBe(true);
    }
  });

  it("canAcceptChild(View) → 拒绝并给出原因", () => {
    const r = canAcceptChild("View", 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("不是 ViewGroup");
  });

  it("isKnownLeafTag(View) → true（lint 才能报「不符」而不是「不认识」）", () => {
    expect(isKnownLeafTag("View")).toBe(true);
    expect(isKnownLeafTag("android.view.View")).toBe(true);
  });

  it("insertChild 往 <View> 里插 → 拒绝且不改 XML", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
    <View ${A} android:layout_width="match_parent" android:layout_height="1dp" android:background="#E0E0E0"/>
</LinearLayout>`;
    const r = insertChild(xml, "#0/0", NEW_TV, "文本");
    expect(r.ok).toBe(false);
    expect(r.xml).toBe(xml);
    expect(r.issues[0].message).toContain("不是 ViewGroup");
  });

  it("lint 对「View 里写了子控件」报警告（aapt 会报错）", () => {
    const bad = `<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
    <View ${A} android:layout_width="match_parent" android:layout_height="wrap_content">
        <TextView ${A} android:layout_width="wrap_content" android:layout_height="wrap_content"/>
    </View>
</LinearLayout>`;
    const issues = lintXml(bad);
    const hit = issues.find((i) => i.message.includes("<View>") && i.message.includes("不是 ViewGroup"));
    expect(hit).toBeTruthy();
    expect(hit!.level).toBe("warn");
    // 只报一次，不重复刷屏
    expect(issues.filter((i) => i.message.includes("<View>")).length).toBe(1);
  });

  it("组件面板：模板里带子控件的，根标签必须是真 ViewGroup", () => {
    for (const w of WIDGETS) {
      const src = w.xml.trim();
      const tag = /^<\s*([A-Za-z0-9_.]+)/.exec(src)?.[1] ?? "";
      const selfClosed = /\/>\s*$/.test(src);
      const hasChild = !selfClosed && /<\s*[A-Za-z0-9_.]+/.test(src.slice(src.indexOf(">") + 1));
      if (hasChild) expect(isContainerTag(tag), `${w.label} (${tag})`).toBe(true);
    }
  });
});
