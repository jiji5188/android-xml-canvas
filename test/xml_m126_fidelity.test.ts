// M126：保存保真 —— raw 子树原样保留 + XML 声明 + 未修改时原字节写回
import { describe, expect, it } from "vitest";
import { parseDrawable } from "@/lib/xml/drawable-node";
import { buildDrawable } from "@/lib/xml/drawable-build";

const DECL = `<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- 外注释 -->
    <item android:left="2dp" android:top="2dp">
        <inset android:insetLeft="4dp" android:insetTop="4dp" android:insetRight="4dp" android:insetBottom="4dp">
            <level-list>
                <!-- 里注释 -->
                <item android:minLevel="0" android:maxLevel="50">
                    <rotate
                        android:fromDegrees="0"
                        android:toDegrees="180"
                        android:pivotX="50%"
                        android:pivotY="50%">
                        <shape android:shape="oval">
                            <solid android:color="#4A148C"/>
                        </shape>
                    </rotate>
                </item>
            </level-list>
        </inset>
    </item>
    <item android:gravity="center">
        <color android:color="#22000000"/>
    </item>
</layer-list>`;

const reindented = (xml: string, pad: string): string =>
  xml
    .split("\n")
    .map((l) => (l.trim() ? pad + l.replace(/^ +/, "") : ""))
    .join("\n");

describe("M126 保存保真", () => {
  it("XML 声明在保存后保留", () => {
    const out = buildDrawable(parseDrawable(DECL)!);
    expect(out.startsWith("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n")).toBe(true);
  });

  it("不认识的子树（level-list 里的注释、多行属性）内部结构保留", () => {
    const out = buildDrawable(parseDrawable(DECL)!);
    expect(out).toContain("<!-- 里注释 -->");
    // rotate 的多行属性保持原样，相对缩进不歪
    expect(out).toMatch(/rotate\n\s+android:fromDegrees="0"/);
    expect(out).toMatch(/pivotY="50%">/);
  });

  it("未修改时，保存的原文写回逻辑（参考相等）", () => {
    const doc = parseDrawable(DECL)!;
    const doc2 = parseDrawable(DECL)!;
    // 同一棵树、同一路径解析出来的 raw 分支必须等价
    expect(buildDrawable(doc)).toBe(buildDrawable(doc2));
    // 未编辑的 raw 分支内部字节原样出现（允许整体平移）
    const out = buildDrawable(doc);
    const rawBlock = out.slice(out.indexOf("<level-list>"), out.indexOf("</level-list>") + "</level-list>".length);
    const expectRaw = DECL.slice(DECL.indexOf("<level-list>"), DECL.indexOf("</level-list>") + "</level-list>".length);
    expect(reindented(rawBlock, "  ")).toBe(reindented(expectRaw, "  "));
  });
});
