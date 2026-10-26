// test/xml_m2j_margin.test.ts — M2j：match_parent + margin/padding 不溢出；简写 margin 不被单边覆盖清零
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES, mergeResourceFragment } from "../lib/xml/resources";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

const model = (xml: string) => buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES);

describe("M2j match_parent + margin：用 calc 扣掉，不溢出右侧", () => {
  it("match_parent 宽 + layout_margin=8dp → width calc(100% - 32px)，左右各 16px", () => {
    const m = model(`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A}
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_margin="8dp"
      android:text="hi"/>
</LinearLayout>`);
    const child = m.root.children[0];
    // 8dp × scale2 = 16px；左右各 16px → 共扣 32px
    expect(child.style.marginLeft).toBe("16px");
    expect(child.style.marginRight).toBe("16px");
    expect(child.style.width).toBe("calc(100% - 32px)");
  });

  it("match_parent 宽 + 只有 marginStart=20dp → width calc(100% - 40px)（不写死 100%）", () => {
    const m = model(`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A}
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginStart="20dp"
      android:text="hi"/>
</LinearLayout>`);
    const child = m.root.children[0];
    expect(child.style.marginLeft).toBe("40px");
    expect(child.style.marginRight).toBeUndefined();
    expect(child.style.width).toBe("calc(100% - 40px)");
  });

  it("match_parent 宽 + padding 16dp → width calc(100% - 64px)", () => {
    const m = model(`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A}
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:padding="16dp"
      android:text="hi"/>
</LinearLayout>`);
    const child = m.root.children[0];
    expect(child.style.width).toBe("calc(100% - 64px)");
  });

  it("match_parent 且无 margin/padding → 保持 100%（不无谓 calc）", () => {
    const m = model(`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:text="hi"/>
</LinearLayout>`);
    expect(m.root.children[0].style.width).toBe("100%");
  });

  it("固定 dp 宽 + margin → 宽度不受影响（calcx 只对 match_parent 生效）", () => {
    const m = model(`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A}
      android:layout_width="100dp"
      android:layout_height="wrap_content"
      android:layout_margin="8dp"
      android:text="hi"/>
</LinearLayout>`);
    const child = m.root.children[0];
    expect(child.style.width).toBe("200px");
    expect(child.style.marginLeft).toBe("16px");
  });

  it("match_parent 高 + marginBottom → height 也走 calc", () => {
    const m = model(`<?xml version="1.0" encoding="utf-8"?>
<FrameLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <View ${A}
      android:layout_width="wrap_content"
      android:layout_height="match_parent"
      android:layout_marginBottom="10dp"/>
</FrameLayout>`);
    const child = m.root.children[0];
    expect(child.style.height).toBe("calc(100% - 20px)");
  });
});

describe("M2j 简写 layout_margin 不被单边属性清零（对称性）", () => {
  it("layout_margin=8dp + layout_marginStart=16dp → 左 32px，右/上/下仍 16px（不是 0）", () => {
    const m = model(`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A}
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_margin="8dp"
      android:layout_marginStart="16dp"
      android:text="hi"/>
</LinearLayout>`);
    const child = m.root.children[0];
    expect(child.style.marginLeft).toBe("32px"); // 单边覆盖
    expect(child.style.marginRight).toBe("16px"); // 简写兜底，不能是 0
    expect(child.style.marginTop).toBe("16px");
    expect(child.style.marginBottom).toBe("16px");
  });

  it("layout_margin=8dp + layout_marginEnd=24dp → 右 48px，左 16px", () => {
    const m = model(`<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A}
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_margin="8dp"
      android:layout_marginEnd="24dp"
      android:text="hi"/>
</LinearLayout>`);
    const child = m.root.children[0];
    expect(child.style.marginRight).toBe("48px");
    expect(child.style.marginLeft).toBe("16px");
  });

  it("layout_margin 用 @dimen 引用也能铺四边", () => {
    const frag = `<resources><dimen name="gap">12dp</dimen></resources>`;
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView ${A}
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_margin="@dimen/gap"
      android:text="hi"/>
</LinearLayout>`;
    const m = buildRenderModel(parseLayoutXml(xml).root!, mergeResourceFragment(frag));
    const child = m.root.children[0];
    expect(child.style.marginLeft).toBe("24px");
    expect(child.style.marginRight).toBe("24px");
    expect(child.style.marginTop).toBe("24px");
    expect(child.style.marginBottom).toBe("24px");
  });
});
