// test/xml_m2p_relative.test.ts — M2p：RelativeLayout 定位规则
import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A =
  'xmlns:android="http://schemas.android.com/apk/res/android"';

/** 412x892dp 的 RelativeLayout，scale=2 → 824x1784px */
const wrap = (body: string, attrs = "") => `<RelativeLayout ${A} android:layout_width="412dp" android:layout_height="892dp" ${attrs}>
${body}
</RelativeLayout>`;

const model = (xml: string) => buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES, 2);
const kids = (xml: string) => model(xml).root.children;
const kid = (xml: string, i = 0) => kids(xml)[i];

describe("M2p RelativeLayout 基本对齐", () => {
  it("alignParentTop|Start → 0,0（+ margin）", () => {
    const k = kid(
      wrap(
        `<TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
           android:layout_alignParentTop="true" android:layout_alignParentStart="true"
           android:layout_marginStart="16dp" android:layout_marginTop="8dp"/>`,
      ),
    );
    expect(k.style.left).toBe("32px");
    expect(k.style.top).toBe("16px");
    expect(k.style.width).toBe("200px");
    expect(k.style.height).toBe("80px");
    expect(k.style.position).toBe("absolute");
  });

  it("alignParentEnd|Bottom → 贴右下（824-200-0, 1784-80-0）", () => {
    const k = kid(
      wrap(
        `<TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
           android:layout_alignParentEnd="true" android:layout_alignParentBottom="true"/>`,
      ),
    );
    expect(k.style.left).toBe("624px");
    expect(k.style.top).toBe("1704px");
  });

  it("centerInParent → 居中（824-200)/2, (1784-80)/2", () => {
    const k = kid(
      wrap(
        `<TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
           android:layout_centerInParent="true"/>`,
      ),
    );
    expect(k.style.left).toBe("312px");
    expect(k.style.top).toBe("852px");
  });

  it("centerHorizontal + alignParentBottom 混搭", () => {
    const k = kid(
      wrap(
        `<TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
           android:layout_centerHorizontal="true" android:layout_alignParentBottom="true"/>`,
      ),
    );
    expect(k.style.left).toBe("312px");
    expect(k.style.top).toBe("1704px");
  });
});

describe("M2p RelativeLayout 相对兄弟", () => {
  const two = wrap(`
    <TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
        android:layout_alignParentStart="true" android:layout_alignParentTop="true"
        android:layout_marginStart="10dp" android:layout_marginTop="10dp"/>
    <TextView android:id="@+id/b" android:layout_width="80dp" android:layout_height="30dp"
        android:layout_toEndOf="@id/a" android:layout_above="@id/a"
        android:layout_marginStart="6dp"/>
  `);

  it("toEndOf → 左 = 兄弟右 + marginStart（20+200+12=232）", () => {
    const b = kid(two, 1);
    expect(b.style.left).toBe("232px");
  });

  it("above → 下边贴兄弟上边 → top = 兄弟top - 自身高 = 20-60 = -40", () => {
    const b = kid(two, 1);
    expect(b.style.top).toBe("-40px");
  });

  it("below + marginTop → top = 兄弟底 + margin", () => {
    const k = kid(
      wrap(`
      <TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
          android:layout_alignParentTop="true"/>
      <TextView android:id="@+id/b" android:layout_width="80dp" android:layout_height="30dp"
          android:layout_below="@id/a" android:layout_marginTop="12dp"/>
    `),
      1,
    );
    expect(k.style.top).toBe("104px"); // 80 + 24
  });

  it("alignTop 对齐兄弟上边", () => {
    const k = kid(
      wrap(`
      <TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
          android:layout_alignParentTop="true" android:layout_marginTop="20dp"/>
      <TextView android:id="@+id/b" android:layout_width="80dp" android:layout_height="30dp"
          android:layout_toEndOf="@id/a" android:layout_alignTop="@id/a"/>
    `),
      1,
    );
    expect(k.style.top).toBe("40px");
  });

  it("alignEnd 对齐兄弟右边", () => {
    const k = kid(
      wrap(`
      <TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
          android:layout_alignParentStart="true" android:layout_marginStart="20dp"/>
      <TextView android:id="@+id/b" android:layout_width="50dp" android:layout_height="30dp"
          android:layout_alignEnd="@id/a" android:layout_below="@id/a"/>
    `),
      1,
    );
    // a: left=40 w=200 → right=240；b 左 = 240-100=140
    expect(k.style.left).toBe("140px");
  });
});

describe("M2p RelativeLayout 尺寸与边角", () => {
  it("match_parent 宽扣左右 margin", () => {
    const k = kid(
      wrap(
        `<TextView android:id="@+id/a" android:layout_width="match_parent" android:layout_height="40dp"
           android:layout_marginStart="10dp" android:layout_marginEnd="30dp"/>`,
      ),
    );
    expect(k.style.width).toBe("744px"); // 824 - 20 - 60
    expect(k.style.left).toBe("20px");
  });

  it("wrap_content 用 estSize 估（TextView 120x40dp）", () => {
    const k = kid(
      wrap(`<TextView android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content"/>`),
    );
    expect(k.style.width).toBe("240px");
    expect(k.style.height).toBe("80px");
  });

  it("兄弟 id 不存在 → 回落 parent，不崩", () => {
    const k = kid(
      wrap(
        `<TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
           android:layout_below="@id/notexist" android:layout_marginTop="8dp"/>`,
      ),
    );
    expect(k.style.top).toBe("16px");
  });

  it("循环引用 above/below → 断环 + 记 warn", () => {
    const m = model(
      wrap(`
      <TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
          android:layout_below="@id/b"/>
      <TextView android:id="@+id/b" android:layout_width="100dp" android:layout_height="40dp"
          android:layout_below="@id/a"/>
    `),
    );
    expect(m.issues.filter((i) => /循环引用/.test(i.message)).length).toBeGreaterThan(0);
    expect(m.root.children.length).toBe(2);
  });

  it("margin 已折进 left/top，不能再留 CSS margin（否则重复位移）", () => {
    const k = kid(
      wrap(
        `<TextView android:id="@+id/a" android:layout_width="100dp" android:layout_height="40dp"
           android:layout_alignParentStart="true" android:layout_marginStart="16dp"
           android:layout_marginTop="16dp"/>`,
      ),
    );
    expect(k.style.marginLeft).toBeUndefined();
    expect(k.style.marginTop).toBeUndefined();
  });

  it("RL 容器自身尺寸落实成 px（否则子项全 absolute 会塔成 0 高）", () => {
    const m = model(wrap(`<TextView android:id="@+id/a" android:layout_width="10dp" android:layout_height="10dp"/>`));
    expect(m.root.style.width).toBe("824px");
    expect(m.root.style.height).toBe("1784px");
  });

  it("父 padding：子项从 padding 内侧起算，内容区扣掉 padding", () => {
    const k = kid(
      wrap(
        `<TextView android:id="@+id/a" android:layout_width="match_parent" android:layout_height="40dp"
           android:layout_alignParentTop="true" android:layout_alignParentStart="true"/>`,
        'android:padding="16dp"',
      ),
    );
    expect(k.style.left).toBe("32px");
    expect(k.style.top).toBe("32px");
    expect(k.style.width).toBe("760px"); // 824 - 32*2
  });
});
