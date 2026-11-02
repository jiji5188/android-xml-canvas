// M89a：vector 的 <group> 结构保留（解析建树 → 序列化回来不丢）
// 背景：原来 parseVectorModel 只认第一个 <group>，嵌套 group 在解析时被拍平，
// 保存后结构全丢。现在按节点树保留：name / translateX/Y / rotation / scale / pivot / 嵌套层级。
import { describe, it, expect } from "vitest";
import { parseVectorModel, buildVectorXml, flattenNodes, type VectorNode } from "@/lib/xml/vector-edit";

const NESTED = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <group
        android:name="outer"
        android:translateX="2"
        android:translateY="3"
        android:rotation="15"
        android:pivotX="12"
        android:pivotY="12">
        <path
            android:fillColor="#111111"
            android:pathData="M2 2h4v4h-4z"/>
        <group
            android:name="inner"
            android:scaleX="0.5"
            android:scaleY="0.5"
            android:pivotX="6"
            android:pivotY="6">
            <path
                android:fillColor="#222222"
                android:fillAlpha="0.5"
                android:pathData="M6 6h6v6h-6z"/>
        </group>
    </group>
    <path
        android:fillColor="#333333"
        android:pathData="M1 20h22v2h-22z"/>
</vector>`;

const countGroups = (xml: string) => (xml.match(/<group\b/g) || []).length;

describe("M89a vector 组结构", () => {
  it("解析出两层 group，名字与变换都在", () => {
    const m = parseVectorModel(NESTED)!;
    expect(m.nodes).toBeTruthy();
    const top = m.nodes!.filter((n) => n.kind === "group") as Extract<VectorNode, { kind: "group" }>[];
    expect(top.length).toBe(1);
    expect(top[0].name).toBe("outer");
    expect(top[0].translateX).toBe(2);
    expect(top[0].translateY).toBe(3);
    expect(top[0].attrs.rotation).toBe(15);
    expect(top[0].attrs.pivotX).toBe(12);
    const inner = top[0].children.find((n) => n.kind === "group") as Extract<VectorNode, { kind: "group" }>;
    expect(inner.name).toBe("inner");
    expect(inner.attrs.scaleX).toBe(0.5);
    expect(inner.attrs.scaleY).toBe(0.5);
    // 顶层还有一个裸 path
    expect(m.nodes!.filter((n) => n.kind === "path").length).toBe(1);
  });

  it("扁平 paths 仍然按深度优先顺序给出全部路径", () => {
    const m = parseVectorModel(NESTED)!;
    expect(m.paths.length).toBe(3);
    expect(flattenNodes(m.nodes!).map((p) => p.d)).toEqual(m.paths.map((p) => p.d));
    expect(m.paths[1].alpha).toBe(0.5);
  });

  it("原样序列化：group 层数 / name / 变换都保留", () => {
    const m = parseVectorModel(NESTED)!;
    const out = buildVectorXml(m, "ic_nested");
    expect(out.match(/<group\b/g)!.length).toBe(2);
    expect(out).toContain('android:name="outer"');
    expect(out).toContain('android:name="inner"');
    expect(out).toContain('android:translateX="2"');
    expect(out).toContain('android:translateY="3"');
    expect(out).toContain('android:rotation="15"');
    expect(out).toContain('android:scaleX="0.5"');
    expect(out).toContain('android:fillAlpha="0.5"');
    expect(out).toContain('android:pathData="M6 6h6v6h-6z"');
  });

  it("再解析一次，结构和路径完全一致（往返稳定）", () => {
    const a = parseVectorModel(NESTED)!;
    const b = parseVectorModel(buildVectorXml(a, "ic_nested"))!;
    expect(b.paths.map((p) => [p.d, p.fill, p.alpha ?? 1])).toEqual(a.paths.map((p) => [p.d, p.fill, p.alpha ?? 1]));
    expect(JSON.stringify(b.nodes)).toBe(JSON.stringify(a.nodes));
  });

  it("单层无 name 的 group 也能保留，恒等组不写 pivot", () => {
    const xml = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
    <group>
        <path android:fillColor="#000000" android:pathData="M0 0h24v24h-24z"/>
    </group>
</vector>`;
    const m = parseVectorModel(xml)!;
    const out = buildVectorXml(m);
    expect(countGroups(out)).toBe(1);
    expect(out).not.toContain("android:pivotX");
    expect(out).toContain("android:pathData=\"M0 0h24v24h-24z\"");
  });

  it("改扁平 paths 的填充色时组结构仍然保留（parse 后 node 与 path 共享同一对象）", () => {
    const m = parseVectorModel(NESTED)!;
    m.paths[0].fill = "#04409F";
    const out = buildVectorXml(m);
    expect(out).toContain('android:fillColor="#04409F"');
    expect(out).toContain('android:name="outer"');
    expect(countGroups(out)).toBe(2);
  });

  it("往扁平 paths 里新增路径时按扁平输出（结构已不可信，不能把旧 group 写回去）", () => {
    const m = parseVectorModel(NESTED)!;
    m.paths.push({ d: "M0 0h4v4h-4z", fill: "#444444" });
    const out = buildVectorXml(m);
    expect(out).toContain('android:pathData="M0 0h4v4h-4z"');
    expect(out).not.toContain('android:name="outer"');
  });
});
