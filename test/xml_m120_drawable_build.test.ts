// M120：drawable 树 → XML 双向（buildDrawable + schema 校验）
import { describe, expect, it } from "vitest";
import { parseDrawable } from "@/lib/xml/drawable-node";
import { buildDrawable } from "@/lib/xml/drawable-build";
import { validateDrawable, childChoices, currentChildCount, NODE_DEFS } from "@/lib/xml/drawable-schema";
import type { DrawableNode } from "@/lib/xml/drawable-node";

const roundTrip = (xml: string) => {
  const a = parseDrawable(xml);
  expect(a, "首次解析不该失败").not.toBeNull();
  const out = buildDrawable(a!);
  const b = parseDrawable(out);
  expect(b, "自己 build 的 XML 必须能被自己解析").not.toBeNull();
  return { a: a!, out, b: b! };
};

describe("M120 buildDrawable：语义往返", () => {
  it("layer-list（内嵌 shape + 引用 item）：数据结构完全一致", () => {
    const xml = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:left="4dp" android:top="2dp">
        <shape android:shape="rectangle">
            <solid android:color="#FFFF0000"/>
            <corners android:radius="8dp"/>
        </shape>
    </item>
    <item android:drawable="@drawable/bg_photo" android:alpha="0.5"/>
</layer-list>`;
    const { a, b } = roundTrip(xml);
    expect(b).toEqual(a);
    expect(b.t).toBe("layer");
    if (b.t === "layer") {
      expect(b.items.length).toBe(2);
      expect(b.items[0].offset).toMatchObject({ l: 4, t: 2 });
      expect(b.items[1].alpha).toBe(0.5);
      expect(b.items[1].node).toEqual({ t: "ref", name: "bg_photo" });
    }
  });

  it("selector：状态属性、顺序、兜底项都保住", () => {
    const xml = `<selector xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:state_pressed="true">
        <shape android:shape="rectangle"><solid android:color="#FF0000FF"/></shape>
    </item>
    <item android:state_enabled="false" android:drawable="@drawable/bg_off"/>
    <item>
        <shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape>
    </item>
</selector>`;
    const { a, b } = roundTrip(xml);
    expect(b).toEqual(a);
    if (b.t === "selector") {
      expect(b.items.length).toBe(3);
      expect(b.items[0].states).toEqual({ state_pressed: "true" });
      expect(b.items[1].states).toEqual({ state_enabled: "false" });
      expect(b.items[1].node).toEqual({ t: "ref", name: "bg_off" });
      expect(b.items[2].states).toEqual({});
    }
  });

  it("ripple：内容 + 遮罩 + 颜色半径都保住", () => {
    const xml = `<ripple xmlns:android="http://schemas.android.com/apk/res/android"
    android:color="#44FFFFFF" android:radius="12dp">
    <item>
        <shape android:shape="oval"><solid android:color="#FF00C853"/></shape>
    </item>
    <item android:id="@android:id/mask">
        <shape android:shape="oval"><solid android:color="#FFFFFFFF"/></shape>
    </item>
</ripple>`;
    const { a, b } = roundTrip(xml);
    expect(b).toEqual(a);
    if (b.t === "ripple") {
      expect(b.color).toBe("#44FFFFFF");
      expect(b.radius).toBe("12dp");
      expect(b.content?.t).toBe("shape");
      expect(b.mask?.t).toBe("shape");
    }
  });

  it("inset 包 selector：内缩值和内层状态都在，且顺序不倒", () => {
    const xml = `<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:insetLeft="8dp" android:insetTop="2dp" android:insetRight="8dp" android:insetBottom="2dp">
    <selector>
        <item android:state_pressed="true" android:drawable="@drawable/pressed"/>
        <item android:drawable="@drawable/normal"/>
    </selector>
</inset>`;
    const { a, b } = roundTrip(xml);
    expect(b).toEqual(a);
    if (b.t === "inset") {
      expect([b.left, b.top, b.right, b.bottom]).toEqual([8, 2, 8, 2]);
      expect(b.node.t).toBe("selector");
    }
  });

  it("shape 的 padding 不再丢（以前解析会吞掉）", () => {
    const xml = `<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#FFEEEEEE"/>
    <padding android:left="16dp" android:top="8dp" android:right="16dp" android:bottom="8dp"/>
    <size android:width="120dp" android:height="48dp"/>
    <stroke android:width="1dp" android:color="#FFCCCCCC"/>
</shape>`;
    const { a, b } = roundTrip(xml);
    expect(b).toEqual(a);
    if (b.t === "shape") {
      expect(b.spec.padding).toEqual({ l: 16, t: 8, r: 16, b: 8 });
      expect(b.spec.size).toEqual({ w: 120, h: 48 });
      expect(b.spec.stroke?.width).toBe(1);
    }
  });

  it("不认识的标签原样保留（vector 子树不丢）", () => {
    const xml = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <vector android:width="24dp" android:height="24dp"
            android:viewportWidth="24" android:viewportHeight="24">
            <path android:fillColor="#FF000000" android:pathData="M0,0 L24,0 L24,24 Z"/>
        </vector>
    </item>
    <item><color android:color="#FF00FF00"/></item>
</layer-list>`;
    const { a, out, b } = roundTrip(xml);
    expect(out).toContain("<vector");
    expect(out).toContain('android:pathData="M0,0 L24,0 L24,24 Z"');
    expect(out).toContain('android:viewportWidth="24"');
    expect(b).toEqual(a);
    if (b.t === "layer") {
      expect(b.items[0].node.t).toBe("unsupported");
      expect((b.items[0].node as { tag: string }).tag).toBe("vector");
    }
  });

  it("根节点只声明一次 xmlns", () => {
    const { out } = roundTrip(`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item><shape><solid android:color="#FF000000"/></shape></item>
</layer-list>`);
    expect(out.match(/xmlns:android/g)?.length).toBe(1);
    expect(out.trimEnd().endsWith("</layer-list>")).toBe(true);
  });

  it("写出来是稳定文本（build → parse → build 一模一样）", () => {
    const xml = `<ripple xmlns:android="http://schemas.android.com/apk/res/android" android:color="#33FFFFFF">
    <item>
        <selector>
            <item android:state_pressed="true"><shape android:shape="oval"><solid android:color="#FF0000FF"/></shape></item>
            <item><shape android:shape="oval"><solid android:color="#FF00FF00"/></shape></item>
        </selector>
    </item>
</ripple>`;
    const once = buildDrawable(parseDrawable(xml)!);
    const twice = buildDrawable(parseDrawable(once)!);
    expect(twice).toBe(once);
  });
});

describe("M120 buildDrawable：输出内容", () => {
  it("引用型 item 写成单行，不带多余子节点", () => {
    const node: DrawableNode = {
      t: "layer",
      items: [
        { key: "a", node: { t: "ref", name: "bg_a" }, offset: { l: 2 } },
        { key: "b", node: { t: "shape", spec: { kind: "rectangle", solid: "#FF112233" } } },
      ],
    };
    const xml = buildDrawable(node);
    expect(xml).toContain('<item android:drawable="@drawable/bg_a" android:left="2dp"/>');
    expect(xml).toContain("<shape android:shape=\"rectangle\">");
  });

  it("selector 的状态属性 true 在前、false 在后", () => {
    const xml = buildDrawable({
      t: "selector",
      items: [
        {
          key: "a",
          states: { state_enabled: "false", state_pressed: "true" },
          node: { t: "color", color: "#FF000000" },
        },
      ],
    });
    const pressedAt = xml.indexOf('android:state_pressed="true"');
    const enabledAt = xml.indexOf('android:state_enabled="false"');
    expect(pressedAt).toBeGreaterThan(-1);
    expect(enabledAt).toBeGreaterThan(pressedAt);
  });

  it("inset 全零时不写多余属性", () => {
    const xml = buildDrawable({
      t: "inset",
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
      node: { t: "color", color: "#FF000000" },
    });
    expect(xml).toContain("<inset xmlns:android");
    expect(xml).not.toContain("insetLeft");
  });

  it("shape 的 ring 参数走原生写法", () => {
    const xml = buildDrawable({ t: "shape", spec: { kind: "ring", solid: "#FF0000FF", ringHole: 0.5 } });
    expect(xml).toContain('android:shape="ring"');
    expect(xml).toContain("innerRadiusRatio");
    expect(xml).not.toContain("<layer-list");
  });
});

describe("M120 schema 校验", () => {
  it("selector 没有兜底项 → 警告；兜底不在最后 → 警告", () => {
    const noDefault = validateDrawable({
      t: "selector",
      items: [{ key: "a", states: { state_pressed: "true" }, node: { t: "color", color: "#FF000000" } }],
    });
    expect(noDefault.some((p) => p.level === "warn" && p.message.includes("兜底"))).toBe(true);

    const wrongOrder = validateDrawable({
      t: "selector",
      items: [
        { key: "a", states: {}, node: { t: "color", color: "#FF000000" } },
        { key: "b", states: { state_pressed: "true" }, node: { t: "color", color: "#FF111111" } },
      ],
    });
    expect(wrongOrder.some((p) => p.message.includes("不在最后"))).toBe(true);
  });

  it("ripple 缺内容 → 错误", () => {
    const problems = validateDrawable({ t: "ripple", color: "#33FFFFFF" });
    expect(problems.some((p) => p.level === "error")).toBe(true);
  });

  it("渐变 + 纯色同时存在 → 错误", () => {
    const problems = validateDrawable({
      t: "shape",
      spec: { kind: "rectangle", solid: "#FF000000", gradient: { type: "linear", start: "#FF000000", end: "#FFFFFFFF" } },
    });
    expect(problems.some((p) => p.level === "error" && p.message.includes("渐变"))).toBe(true);
  });

  it("ref 空名 → 错误；line 没 stroke → 警告", () => {
    expect(validateDrawable({ t: "ref", name: "  " }).some((p) => p.level === "error")).toBe(true);
    expect(validateDrawable({ t: "shape", spec: { kind: "line" } }).some((p) => p.level === "warn")).toBe(true);
  });

  it("正常结构没有 error", () => {
    const problems = validateDrawable({
      t: "ripple",
      color: "#33FFFFFF",
      content: {
        t: "selector",
        items: [
          { key: "p", states: { state_pressed: "true" }, node: { t: "shape", spec: { kind: "rectangle", solid: "#FF0000FF" } } },
          { key: "d", states: {}, node: { t: "shape", spec: { kind: "rectangle", solid: "#FFFFFFFF" } } },
        ],
      },
    });
    expect(problems.filter((p) => p.level === "error")).toEqual([]);
  });
});

describe("M120 schema：能加什么子节点", () => {
  it("layer 可以无限加，ripple 最多两个，inset 只能一个", () => {
    const layer: DrawableNode = { t: "layer", items: [{ key: "a", node: { t: "color", color: "#FF000000" } }] };
    expect(childChoices(layer).length).toBeGreaterThan(0);

    const ripple: DrawableNode = {
      t: "ripple",
      content: { t: "color", color: "#FF000000" },
      mask: { t: "color", color: "#FFFFFFFF" },
    };
    expect(currentChildCount(ripple)).toBe(2);
    expect(childChoices(ripple)).toEqual([]);

    const inset: DrawableNode = { t: "inset", left: 1, top: 1, right: 1, bottom: 1, node: { t: "color", color: "#FF000000" } };
    expect(childChoices(inset)).toEqual([]);
  });

  it("每种节点定义的属性名不重复、枚举都有取值", () => {
    for (const [kind, def] of Object.entries(NODE_DEFS)) {
      const names = def.attrs.map((a) => a.name);
      expect(new Set(names).size, `${kind} 属性重复`).toBe(names.length);
      def.attrs
        .filter((a) => a.type === "enum")
        .forEach((a) => expect(a.values?.length, `${kind}.${a.name} 枚举没给值`).toBeGreaterThan(0));
    }
  });
});
