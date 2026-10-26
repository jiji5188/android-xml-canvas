// test/xml_m2d_frame.test.ts — M2d：FrameLayout/LinearLayout 子项 match_parent / 自由几何手柄
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import { writebackAttrs } from "../lib/xml/writeback";

const SCALE = 2;

function model(xml: string) {
  const { root } = parseLayoutXml(xml);
  if (!root) throw new Error("parse fail");
  return buildRenderModel(root, DEFAULT_RESOURCES, SCALE);
}

describe("M2d FrameLayout match_parent / wrap_content 生效", () => {
  it("FrameLayout 根 + 子项 match_parent 宽高 → 子项 absolute + 明确 100% 尺寸", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <View
      android:id="@+id/v1"
      android:layout_width="match_parent"
      android:layout_height="match_parent" />
</FrameLayout>`;
    const { root: m } = model(xml);
    const v = m.children[0];
    expect(v.style.position).toBe("absolute");
    expect(v.style.left).toBe("0px");
    expect(v.style.top).toBe("0px");
    expect(v.style.width).toBe("100%");
    expect(v.style.height).toBe("100%");
  });

  it("FrameLayout 根 + 子项 wrap_content → 子项 absolute + auto 尺寸（内容撑开）", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView
      android:id="@+id/tv"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="hi" />
</FrameLayout>`;
    const { root: m } = model(xml);
    const tv = m.children[0];
    expect(tv.style.position).toBe("absolute");
    expect(tv.style.width).toBe("auto");
    expect(tv.style.height).toBe("auto");
  });
});

describe("M2d LinearLayout 子项 match_parent 生效", () => {
  it("vertical LinearLayout + 子项 width=match_parent → 子项 width 100%（cross 轴吃满）", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">
  <View
      android:id="@+id/a"
      android:layout_width="match_parent"
      android:layout_height="wrap_content" />
  <View
      android:id="@+id/b"
      android:layout_width="match_parent"
      android:layout_height="wrap_content" />
</LinearLayout>`;
    const { root: m } = model(xml);
    for (const c of m.children) {
      expect(c.style.width).toBe("100%");
    }
  });

  it("horizontal LinearLayout + 子项 height=match_parent → 子项 height 100%（cross 轴吃满）", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="horizontal">
  <View
      android:id="@+id/x"
      android:layout_width="wrap_content"
      android:layout_height="match_parent" />
</LinearLayout>`;
    const { root: m } = model(xml);
    expect(m.children[0].style.height).toBe("100%");
  });

  it("weight=1 + 0dp → flexBasis 0 + flexGrow 1（主轴吃剩余空间）", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <View
      android:id="@+id/c"
      android:layout_width="0dp"
      android:layout_height="wrap_content"
      android:layout_weight="1" />
</LinearLayout>`;
    const { root: m } = model(xml);
    const c = m.children[0];
    expect(c.style.flexGrow).toBe(1);
    expect(c.style.flexBasis).toBe("0px");
  });
});

describe("M2d 自由几何写回（画布拖动 → XML）", () => {
  it("拖动 FrameLayout 子项 → 写回 layout_marginStart/Top + layout_width/height（dp）", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <View
      android:id="@+id/v1"
      android:layout_width="100dp"
      android:layout_height="80dp" />
</FrameLayout>`;
    const { root } = parseLayoutXml(xml);
    if (!root) throw new Error("parse fail");
    const childPath = root.children[0].path;
    const set = {
      layout_width: "240dp",
      layout_height: "160dp",
      layout_marginStart: "20dp",
      layout_marginTop: "10dp",
    };
    const r = writebackAttrs(xml, childPath, set, []);
    expect(r.changed).toBe(true);
    expect(r.xml).toContain("layout_width=\"240dp\"");
    expect(r.xml).toContain("layout_height=\"160dp\"");
    expect(r.xml).toContain("layout_marginStart=\"20dp\"");
    expect(r.xml).toContain("layout_marginTop=\"10dp\"");
  });
});
