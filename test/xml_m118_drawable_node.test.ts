// M118：drawable 图层树——解析 / 按状态展开 / 点击预览的基础
import { describe, expect, it } from "vitest";
import {
  parseDrawable,
  flattenDrawable,
  pickStateItem,
  matchesState,
  countNodes,
  refName,
  type DrawableNode,
  type StateItem,
} from "../lib/xml/drawable-node";

const NS = `xmlns:android="http://schemas.android.com/apk/res/android"`;

describe("M118 drawable 图层树", () => {
  it("layer-list：N 层全部保留，顺序 = 绘制顺序（0 在最底）", () => {
    const xml = `<layer-list ${NS}>
      <item><shape android:shape="rectangle"><solid android:color="#FF0000FF"/></shape></item>
      <item android:left="2dp" android:top="4dp"><shape android:shape="oval"><solid android:color="#FF00FF00"/></shape></item>
      <item android:alpha="0.5"><shape android:shape="ring"/></item>
    </layer-list>`;
    const doc = parseDrawable(xml)!;
    expect(doc.t).toBe("layer");
    if (doc.t !== "layer") return;
    expect(doc.items.length).toBe(3);
    expect(doc.items[1].offset).toEqual({ l: 2, t: 4, r: undefined, b: undefined });
    expect(doc.items[2].alpha).toBe(0.5);

    const layers = flattenDrawable(doc);
    expect(layers.map((l) => l.kind)).toEqual(["shape", "shape", "shape"]);
    // 第二层的偏移累加进 inset
    expect(layers[1].inset.l).toBe(2);
    expect(layers[1].inset.t).toBe(4);
    // 第三层 alpha 累乘
    expect(layers[2].alpha).toBe(0.5);
  });

  it("selector：三个状态各自一棵独立树，互不相干", () => {
    const xml = `<selector ${NS}>
      <item android:state_enabled="false">
        <shape android:shape="rectangle"><solid android:color="#FF999999"/></shape>
      </item>
      <item android:state_pressed="true">
        <layer-list>
          <item><shape android:shape="rectangle"><solid android:color="#FF0000FF"/></shape></item>
          <item><shape android:shape="oval"><solid android:color="#FFFF0000"/></shape></item>
        </layer-list>
      </item>
      <item>
        <shape android:shape="rectangle"><corners android:radius="8dp"/><solid android:color="#FFFFFFFF"/></shape>
      </item>
    </selector>`;
    const doc = parseDrawable(xml)!;
    if (doc.t !== "selector") throw new Error("应为 selector");
    expect(doc.items.length).toBe(3);
    expect(countNodes(doc)).toBe(1 + 1 + 3 + 1);

    // 默认态：白色 + 8dp 圆角
    const normal = flattenDrawable(doc, { state: {} });
    expect(normal.length).toBe(1);
    expect(normal[0].spec?.solid).toBe("#FFFFFFFF");
    expect(normal[0].spec?.radius).toBe(8);

    // pressed：走 layer-list，两层
    const pressed = flattenDrawable(doc, { state: { pressed: true, enabled: true } });
    expect(pressed.length).toBe(2);
    expect(pressed[0].spec?.solid).toBe("#FF0000FF");
    expect(pressed[1].spec?.kind).toBe("oval");

    // disabled 优先（它在最前，先匹配）
    const disabled = flattenDrawable(doc, { state: { enabled: false } });
    expect(disabled.length).toBe(1);
    expect(disabled[0].spec?.solid).toBe("#FF999999");
  });

  it("selector 匹配规则：第一个「所有 state_* 都相等」的赢；无 state 的是兜底", () => {
    const items: StateItem[] = [
      { key: "a", states: { state_pressed: "true" }, node: { t: "color", color: "#F00" } },
      { key: "b", states: {}, node: { t: "color", color: "#0F0" } },
    ];
    expect(pickStateItem(items, { pressed: true })?.key).toBe("a");
    expect(pickStateItem(items, {})?.key).toBe("b");
    // 显式 false 也要匹配
    expect(matchesState({ state_pressed: "false" }, {})).toBe(true);
    expect(matchesState({ state_pressed: "false" }, { pressed: true })).toBe(false);
    // 多个条件必须同时满足
    // enabled 没传 → 默认 true（View 默认启用），所以 pressed+enabled 同时成立
    expect(
      matchesState({ state_pressed: "true", state_enabled: "true" }, { pressed: true }),
    ).toBe(true);
    expect(
      matchesState({ state_pressed: "true", state_enabled: "true" }, { pressed: true, enabled: false }),
    ).toBe(false);
  });

  it("ripple：content 展开；按下时末尾多一层波纹，松开没有", () => {
    const xml = `<ripple ${NS} android:color="#33FFFFFF">
      <item>
        <shape android:shape="rectangle"><corners android:radius="12dp"/><solid android:color="#FF112233"/></shape>
      </item>
    </ripple>`;
    const doc = parseDrawable(xml)!;
    if (doc.t !== "ripple") throw new Error("应为 ripple");

    const idle = flattenDrawable(doc, { state: {} });
    expect(idle.length).toBe(1);
    expect(idle[0].kind).toBe("shape");

    const pressed = flattenDrawable(doc, { state: { pressed: true } });
    expect(pressed.length).toBe(2);
    expect(pressed[1].kind).toBe("ripple");
    expect(pressed[1].color).toBe("#33FFFFFF");
  });

  it("ripple + mask：mask 不作为绘制层，只记录在树上", () => {
    const xml = `<ripple ${NS} android:color="#33000000">
      <item android:id="@android:id/mask">
        <shape android:shape="oval"><solid android:color="#FFFFFFFF"/></shape>
      </item>
      <item><color android:color="#FFFFFFFF"/></item>
    </ripple>`;
    const doc = parseDrawable(xml)!;
    if (doc.t !== "ripple") throw new Error("应为 ripple");
    expect(doc.mask?.t).toBe("shape");
    expect(doc.content?.t).toBe("color");

    const layers = flattenDrawable(doc, { state: { pressed: true } });
    // 只有 content + 波纹，mask 不出渲染层
    expect(layers.map((l) => l.kind)).toEqual(["color", "ripple"]);
  });

  it("inset：内缩压成变换链，累加到子层", () => {
    const xml = `<inset ${NS} android:insetLeft="4dp" android:insetTop="6dp" android:insetRight="8dp" android:insetBottom="10dp">
      <shape android:shape="oval"><solid android:color="#FF00FFFF"/></shape>
    </inset>`;
    const doc = parseDrawable(xml)!;
    if (doc.t !== "shape") throw new Error("应为 shape 带 inset 变换");
    expect(doc.transform?.[0].kind).toBe("inset");
    const layers = flattenDrawable(doc);
    expect(layers[0].inset).toEqual({ l: 4, t: 6, r: 8, b: 10 });
  });

  it("ref：能解析到就递归展开，解析不到降级成 unsupported 层（不整棵树挂掉）", () => {
    const xml = `<selector ${NS}><item android:drawable="@drawable/bg_card"/></selector>`;
    const doc = parseDrawable(xml)!;
    const noResolver = flattenDrawable(doc);
    expect(noResolver.length).toBe(1);
    expect(noResolver[0].kind).toBe("unsupported");

    const refXml = `<shape ${NS} android:shape="rectangle"><solid android:color="#FF445566"/></shape>`;
    const resolved = flattenDrawable(doc, {
      resolveRef: (n) => (n === "bg_card" ? refXml : null),
    });
    expect(resolved.length).toBe(1);
    expect(resolved[0].kind).toBe("shape");
    expect(resolved[0].spec?.solid).toBe("#FF445566");
  });

  it("refName：只认 @drawable / @mipmap / @color", () => {
    expect(refName("@drawable/bg_card")).toBe("bg_card");
    expect(refName("@mipmap/ic_launcher")).toBe("ic_launcher");
    expect(refName("@color/primary")).toBe("primary");
    expect(refName("#FF0000")).toBeNull();
    expect(refName(undefined)).toBeNull();
  });

  it("原生 ring：解析出 ringHole，不再是双 oval", () => {
    const xml = `<shape ${NS} android:shape="ring" android:innerRadiusRatio="4" android:thicknessRatio="4">
      <solid android:color="#FF123456"/>
    </shape>`;
    const doc = parseDrawable(xml)!;
    if (doc.t !== "shape") throw new Error("应为 shape");
    expect(doc.spec.kind).toBe("ring");
    expect(doc.spec.ringHole).toBeCloseTo(0.5, 2);
  });

  it("不认识的标签降级成 unsupported，不影响外层", () => {
    const xml = `<layer-list ${NS}>
      <item><animated-vector android:drawable="@drawable/x"/></item>
      <item><shape android:shape="oval"/></item>
    </layer-list>`;
    const doc = parseDrawable(xml)!;
    const layers = flattenDrawable(doc);
    expect(layers.map((l) => l.kind)).toEqual(["unsupported", "shape"]);
  });

  it("<color> 文本色值兜底（parser 不保留文本节点）", () => {
    const xml = `<color ${NS}>#FF00FF00</color>`;
    const doc = parseDrawable(xml)!;
    expect(doc.t).toBe("color");
    if (doc.t !== "color") return;
    expect(doc.color).toBe("#FF00FF00");
  });

  it("M133：item 的 width/height/gravity 传给渲染层，shape 里的 <size> 也认", () => {
    const xml = `<layer-list ${NS}>
      <item android:width="120dp" android:height="80dp" android:gravity="center">
        <shape android:shape="rectangle"><solid android:color="#FF112233"/></shape>
      </item>
      <item>
        <shape android:shape="rectangle"><size android:width="40dp" android:height="40dp"/></shape>
      </item>
    </layer-list>`;
    const doc = parseDrawable(xml)!;
    if (doc.t !== "layer") return;
    // 解析出来的 item 尺寸
    expect(doc.items[0].size).toEqual({ w: 120, h: 80 });
    expect(doc.items[0].gravity).toBe("center");

    const layers = flattenDrawable(doc);
    // 第一层：item 显式 width/height 生效
    expect(layers[0].size).toEqual({ w: 120, h: 80 });
    expect(layers[0].gravity).toBe("center");
    // 第二层：item 没写 width/height，退到 shape 的 <size>
    expect(layers[1].size).toEqual({ w: 40, h: 40 });
    expect(layers[1].gravity).toBeUndefined();
  });
});
