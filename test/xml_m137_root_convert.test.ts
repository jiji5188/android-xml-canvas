// test/xml_m137_root_convert.test.ts — 根标签互转（M137）
import { describe, expect, it } from "vitest";
import { parseDrawable } from "../lib/xml/drawable-node";
import { buildDrawable } from "../lib/xml/drawable-build";
import { rootInfo, ROOT_TAGS, canConvertRoot } from "../lib/xml/drawable-root";
import { convertRoot, rootTagOfNode } from "../lib/xml/drawable-root-convert";

const NS = `xmlns:android="http://schemas.android.com/apk/res/android"`;

const LAYER2 = `<?xml version="1.0" encoding="utf-8"?>
<layer-list ${NS}>
    <item>
        <shape android:shape="rectangle"><solid android:color="#FFDDE3EA"/></shape>
    </item>
    <item android:left="8dp" android:top="8dp" android:alpha="0.5">
        <shape android:shape="rectangle">
            <solid android:color="#FF3B82F6"/>
            <corners android:radius="12dp"/>
        </shape>
    </item>
</layer-list>`;

const SELECTOR = `<selector ${NS}>
    <item android:state_pressed="true"><shape><solid android:color="#FF3B82F6"/></shape></item>
    <item><shape><solid android:color="#FFDDE3EA"/></shape></item>
</selector>`;

const RIPPLE = `<ripple ${NS} android:color="#33FFFFFF">
    <item><shape><solid android:color="#FFDDE3EA"/></shape></item>
    <item android:id="@android:id/mask"><shape><solid android:color="#FFFFFFFF"/></shape></item>
</ripple>`;

const INSET = `<inset ${NS} android:insetLeft="4dp" android:insetRight="4dp">
    <shape><solid android:color="#FFDDE3EA"/></shape>
</inset>`;

describe("M137 根标签识别", () => {
  it("四个组合类都识别成 tree 路由，且能互转", () => {
    for (const tag of ROOT_TAGS) {
      const xml =
        tag === "layer-list" ? LAYER2 : tag === "selector" ? SELECTOR : tag === "ripple" ? RIPPLE : INSET;
      expect(rootInfo(xml).tag).toBe(tag);
      expect(rootInfo(xml).route).toBe("tree");
    }
    expect(canConvertRoot("selector", "layer-list")).toBe(true);
    expect(canConvertRoot("selector", "selector")).toBe(false);
    expect(canConvertRoot("vector", "selector")).toBe(false);
  });

  it("解析出来的根节点能反查出自己的标签（inset 看 transform 链）", () => {
    expect(rootTagOfNode(parseDrawable(LAYER2)!)).toBe("layer-list");
    expect(rootTagOfNode(parseDrawable(SELECTOR)!)).toBe("selector");
    expect(rootTagOfNode(parseDrawable(RIPPLE)!)).toBe("ripple");
    expect(rootTagOfNode(parseDrawable(INSET)!)).toBe("inset");
    expect(rootTagOfNode(parseDrawable(`<shape><solid android:color="#fff"/></shape>`)!)).toBeNull();
  });
});

describe("M137 互转：layer-list 出发", () => {
  const doc = parseDrawable(LAYER2)!;

  it("→ selector：每层一个状态项，都成了兜底项所以只提醒", () => {
    const res = convertRoot(doc, "selector");
    const sel = res.next;
    expect(sel.t).toBe("selector");
    if (sel.t !== "selector") return;
    expect(sel.items).toHaveLength(2);
    expect(sel.items.every((i) => Object.keys(i.states).length === 0)).toBe(true);
    expect(res.lost.join()).toContain("没有状态区分");
    // 生成的 XML 能正常写出来，根标签换了
    expect(buildDrawable(sel)).toContain("<selector");
  });

  it("→ ripple：两层 = 内容 + 遮罩，并明确告知第二层变遮罩", () => {
    const res = convertRoot(doc, "ripple");
    const rip = res.next;
    expect(rip.t).toBe("ripple");
    if (rip.t !== "ripple") return;
    expect(rip.content?.t).toBe("shape");
    expect(rip.mask?.t).toBe("shape");
    expect(res.lost.join()).toContain("遮罩");
    const xml = buildDrawable(rip);
    expect(xml).toContain("<ripple");
    expect(xml).toContain("@android:id/mask");
  });

  it("→ inset：整体包一层，内缩距离重置为 0 要说出来", () => {
    const res = convertRoot(doc, "inset");
    expect(rootTagOfNode(res.next)).toBe("inset");
    expect(res.lost.join()).toContain("内缩距离");
    // 两层不能被压成一层：里面应该还是一个 layer-list
    const xml = buildDrawable(res.next);
    expect(xml).toContain("<inset");
    expect(xml).toContain("<layer-list");
    // 两层内容都在（inset 外壳不额外写 item）
    expect((xml.match(/<item/g) ?? []).length).toBe(2);
  });

  it("三层 → ripple 时整体并进内容层（不丢东西）", () => {
    const three = parseDrawable(`<layer-list>
      <item><shape><solid android:color="#111"/></shape></item>
      <item><shape><solid android:color="#222"/></shape></item>
      <item><shape><solid android:color="#333"/></shape></item>
    </layer-list>`)!;
    const res = convertRoot(three, "ripple");
    expect(res.lost.join()).toContain("所有层整体并进内容层");
    const xml = buildDrawable(res.next);
    expect(xml).toContain("<layer-list");
    expect(xml).toContain("#111");
    expect(xml).toContain("#333");
  });
});

describe("M137 互转：selector / ripple / inset 出发", () => {
  it("selector → layer-list：状态条件丢失要明说，层数不变", () => {
    const res = convertRoot(parseDrawable(SELECTOR)!, "layer-list");
    const layer = res.next;
    expect(layer.t).toBe("layer");
    if (layer.t !== "layer") return;
    expect(layer.items).toHaveLength(2);
    expect(res.lost.join()).toContain("状态条件");
    expect(buildDrawable(layer)).not.toContain("state_pressed");
  });

  it("ripple → layer-list：内容 + 遮罩变成两层，波纹色要明说丢了", () => {
    const res = convertRoot(parseDrawable(RIPPLE)!, "layer-list");
    const layer = res.next;
    expect(layer.t).toBe("layer");
    if (layer.t !== "layer") return;
    expect(layer.items).toHaveLength(2);
    expect(res.lost.join()).toContain("波纹色");
    expect(res.lost.join()).toContain("遮罩项");
  });

  it("inset → selector：内缩距离被剥掉并提醒", () => {
    const res = convertRoot(parseDrawable(INSET)!, "selector");
    expect(res.next.t).toBe("selector");
    expect(res.lost.join()).toContain("内缩距离");
    expect(buildDrawable(res.next)).not.toContain("insetLeft");
  });

  it("同标签转换 = 原样返回（不报 lost）", () => {
    const doc = parseDrawable(SELECTOR)!;
    const res = convertRoot(doc, "selector");
    expect(res.lost).toEqual([]);
    expect(res.next).toEqual(doc);
    expect(res.next).not.toBe(doc); // 深拷贝，不共享引用
  });

  it("不支持的类型抛错（vector 之类不该进这条路）", () => {
    const vec = parseDrawable(`<vector ${NS}><path android:pathData="M0,0"/></vector>`)!;
    expect(() => convertRoot(vec, "selector")).toThrow();
  });
});

describe("M137 往返自洽", () => {
  it("layer-list → selector → layer-list：层数一致，颜色都还在", () => {
    const doc = parseDrawable(LAYER2)!;
    const a = convertRoot(doc, "selector").next;
    const b = convertRoot(a, "layer-list").next;
    expect(b.t).toBe("layer");
    if (b.t !== "layer") return;
    expect(b.items).toHaveLength(2);
    const xml = buildDrawable(b);
    expect(xml).toContain("#FFDDE3EA");
    expect(xml).toContain("#FF3B82F6");
  });

  it("转换出的每个结果都能通过 buildDrawable 再 parse 回来（不产生坏 XML）", () => {
    const sources = [LAYER2, SELECTOR, RIPPLE, INSET];
    for (const src of sources) {
      const doc = parseDrawable(src)!;
      for (const tag of ROOT_TAGS) {
        const out = convertRoot(doc, tag).next;
        const xml = buildDrawable(out);
        expect(rootInfo(xml).tag, `${src.slice(0, 20)} → ${tag}`).toBe(tag);
        expect(parseDrawable(xml), `${tag} 解析不回`).not.toBeNull();
      }
    }
  });
});
