import { describe, expect, it } from "vitest";
import { parseDrawable } from "@/lib/xml/drawable-node";
import { buildDrawable } from "@/lib/xml/drawable-build";
import { replaceAt } from "@/lib/xml/drawable-edit";

const SRC = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@drawable/bg_base"/>
    <item android:right="4dp" android:width="26dp" android:height="26dp" android:gravity="center_vertical">
        <ripple android:color="#85BEBEBE">
            <item android:drawable="@color/brand_red"/>
        </ripple>
    </item>
</layer-list>`;

describe("M157 item android:drawable", () => {
  it("layer / ripple 的引用能解析回来", () => {
    const n = parseDrawable(SRC);
    expect(n?.t).toBe("layer");
    if (n?.t !== "layer") return;
    expect(n.items[0].node).toEqual({ t: "ref", name: "bg_base" });
    const second = n.items[1].node;
    expect(second.t).toBe("ripple");
    if (second.t !== "ripple") return;
    expect(second.content).toEqual({ t: "color", color: "@color/brand_red" });
  });

  it("roundtrip 不丢 android:drawable，也不套成 item 里嵌 item", () => {
    const n = parseDrawable(SRC);
    const out = buildDrawable(n!);
    expect(out).toContain('<item android:drawable="@drawable/bg_base"/>');
    expect(out).toContain('<item android:drawable="@color/brand_red"/>');
    expect(out).not.toMatch(/<item>\s*<item /);
  });

  it("把内联 shape 换成引用后能写回去", () => {
    const n = parseDrawable(`<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle"><solid android:color="#EC4141"/></shape>
    </item>
</layer-list>`);
    const next = replaceAt(n!, [0], { t: "ref", name: "bg_ref" });
    const out = buildDrawable(next);
    expect(out).toContain('<item android:drawable="@drawable/bg_ref"/>');
    expect(out).not.toContain("<shape");
  });
});
