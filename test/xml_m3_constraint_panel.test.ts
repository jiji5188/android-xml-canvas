// test/xml_m3_constraint_panel.test.ts — 自动约束推断 + 默认约束 + app: 前缀序列化
import { describe, it, expect } from "vitest";
import { autoConstrain, hasConstraints, nextViewId } from "../lib/xml/autoconstrain";
import { applyConstraintDefaults } from "../lib/xml/insert";
import { parseLayoutXml, serialize } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const SCALE = 2; // 1dp = 2px

const CL = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
</androidx.constraintlayout.widget.ConstraintLayout>`;

describe("hasConstraints", () => {
  it("无约束属性返回 false", () => {
    expect(hasConstraints({ id: "@+id/a", layout_width: "wrap_content" })).toBe(false);
  });
  it("有约束属性返回 true", () => {
    expect(hasConstraints({ layout_constraintTop_toTopOf: "parent" })).toBe(true);
  });
});

describe("nextViewId", () => {
  it("跳过已占用的序号", () => {
    expect(nextViewId(["@+id/view_1", "@+id/view_2"])).toBe("@+id/view_3");
  });
  it("无冲突时从 1 开始", () => {
    expect(nextViewId(["@+id/foo"])).toBe("@+id/view_1");
  });
  it("忽略非 id 引用（@id/ 也算占用）", () => {
    expect(nextViewId(["@id/view_1"])).toBe("@+id/view_2");
  });
});

describe("autoConstrain — 无约束时智能堆叠", () => {
  const parent = { left: 0, top: 0, width: 800, height: 1200 };
  const me = { left: 0, top: 0, width: 200, height: 80 };

  it("贴父容器左边 + 顶部，8dp 边距", () => {
    const r = autoConstrain({ attrs: {}, box: me, parent, siblings: [], prev: null, scale: SCALE });
    const map = Object.fromEntries(r.changes.map(([k, v]) => [k, v]));
    expect(map.layout_constraintStart_toStartOf).toBe("parent");
    expect(map.layout_constraintTop_toTopOf).toBe("parent");
    expect(map.layout_marginStart).toBe("8dp");
    expect(map.layout_marginTop).toBe("8dp");
  });

  it("有上一个兄弟时接在它下面", () => {
    const prev = { ref: "@+id/a", tag: "TextView", box: { left: 0, top: 0, width: 200, height: 80 } };
    const r = autoConstrain({ attrs: {}, box: { ...me, top: 96 }, parent, siblings: [prev], prev, scale: SCALE });
    const map = Object.fromEntries(r.changes.map(([k, v]) => [k, v]));
    expect(map.layout_constraintTop_toBottomOf).toBe("@+id/a");
    expect(map.layout_constraintTop_toTopOf).toBeUndefined();
  });

  it("下方放不下时改为与上一个兄弟顶对齐（不跑出屏幕）", () => {
    const prev = { ref: "@+id/btn", tag: "Button", box: { left: 500, top: 1600, width: 200, height: 80 } };
    const r = autoConstrain({
      attrs: {},
      box: { ...me, top: 1700 },
      parent,
      siblings: [prev],
      prev,
      scale: SCALE,
    });
    const map = Object.fromEntries(r.changes.map(([k, v]) => [k, v]));
    expect(map.layout_constraintTop_toTopOf).toBe("@+id/btn");
    expect(map.layout_constraintTop_toBottomOf).toBeUndefined();
    expect(map.layout_marginTop).toBe("0dp");
  });
});

describe("autoConstrain — 已有约束时就近推断", () => {
  const parent = { left: 0, top: 0, width: 800, height: 1200 };

  it("靠近顶部时选 Top_toTopOf parent（margin 正确）", () => {
    const attrs = { layout_constraintStart_toStartOf: "parent" };
    const box = { left: 20, top: 20, width: 100, height: 40 };
    const r = autoConstrain({ attrs, box, parent, siblings: [], prev: null, scale: SCALE });
    const map = Object.fromEntries(r.changes.map(([k, v]) => [k, v]));
    expect(map.layout_constraintTop_toTopOf).toBe("parent");
    expect(map.layout_marginTop).toBe("10dp");
  });

  it("靠近底部时选 Bottom_toBottomOf parent（margin 正确）", () => {
    const attrs = { layout_constraintTop_toTopOf: "parent" };
    const box = { left: 20, top: 1100, width: 100, height: 40 };
    const r = autoConstrain({ attrs, box, parent, siblings: [], prev: null, scale: SCALE });
    const map = Object.fromEntries(r.changes.map(([k, v]) => [k, v]));
    expect(map.layout_constraintBottom_toBottomOf).toBe("parent");
    expect(map.layout_marginBottom).toBe("30dp");
  });

  it("贴着兄弟右缘时选 Start_toEndOf 该兄弟", () => {
    const attrs = { layout_constraintTop_toTopOf: "parent" };
    const sib = { ref: "@+id/a", tag: "TextView", box: { left: 0, top: 0, width: 200, height: 80 } };
    const box = { left: 216, top: 0, width: 100, height: 40 }; // 距兄弟右缘 16px = 8dp
    const r = autoConstrain({ attrs, box, parent, siblings: [sib], prev: sib, scale: SCALE });
    const map = Object.fromEntries(r.changes.map(([k, v]) => [k, v]));
    expect(map.layout_constraintStart_toEndOf).toBe("@+id/a");
    expect(map.layout_marginStart).toBe("8dp");
  });

  it("水平只保留一侧约束（清掉另一侧，避免过度约束）", () => {
    const attrs = { layout_constraintEnd_toEndOf: "parent", layout_constraintTop_toTopOf: "parent" };
    const box = { left: 20, top: 20, width: 100, height: 40 };
    const r = autoConstrain({ attrs, box, parent, siblings: [], prev: null, scale: SCALE });
    const map = Object.fromEntries(r.changes.map(([k, v]) => [k, v]));
    // 靠左 → Start_toStartOf 胜出，End_toEndOf 被清掉
    expect(map.layout_constraintStart_toStartOf).toBe("parent");
    expect(map.layout_constraintEnd_toEndOf).toBeNull();
  });

  it("负边距（明显重叠）不选为锚点时会回落到别的候选", () => {
    const attrs = { layout_constraintTop_toTopOf: "parent" };
    const sib = { ref: "@+id/a", tag: "TextView", box: { left: 0, top: 0, width: 400, height: 80 } };
    const box = { left: 20, top: 0, width: 100, height: 40 }; // 与兄弟重叠
    const r = autoConstrain({ attrs, box, parent, siblings: [sib], prev: sib, scale: SCALE });
    const map = Object.fromEntries(r.changes.map(([k, v]) => [k, v]));
    expect(map.layout_constraintStart_toStartOf).toBe("parent");
  });
});

describe("applyConstraintDefaults — 插入到 CL 时补默认约束", () => {
  it("给无 id 的控件补 id + 贴父容器约束", () => {
    const xml = CL.replace("</androidx", `<TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="a"/>\n</androidx`);
    const out = applyConstraintDefaults(xml, "#0/0");
    expect(out).toContain('android:id="@+id/view_1"');
    expect(out).toContain("layout_constraintStart_toStartOf");
    expect(out).toContain("layout_marginStart");
  });

  it("父容器不是 ConstraintLayout 时原样返回", () => {
    const xml = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:text="a"/></LinearLayout>`;
    expect(applyConstraintDefaults(xml, "#0/0")).toBe(xml);
  });

  it("已有约束则不覆盖", () => {
    const xml = CL.replace("</androidx", `<TextView android:id="@+id/a" layout_constraintTop_toTopOf="parent" android:layout_width="wrap_content" android:layout_height="wrap_content"/>\n</androidx`);
    const out = applyConstraintDefaults(xml, "#0/0");
    expect(out).toBe(xml);
  });
});

describe("ConstraintLayout 渲染（回归）", () => {
  const src = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="hi" app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent" android:layout_marginStart="16dp" android:layout_marginTop="24dp"/>
</androidx.constraintlayout.widget.ConstraintLayout>`;

  it("CL 子项 position 必须是 absolute（否则 left/top 变成 flow 偏移，位置全错）", () => {
    const { root } = parseLayoutXml(src);
    const model = buildRenderModel(root!, DEFAULT_RESOURCES, 2);
    const child = model.root.children[0];
    expect(child.style.position).toBe("absolute");
    expect(String(child.style.left)).toBe("32px");
    expect(String(child.style.top)).toBe("48px");
  });

  it("100% 高度的 CL 容器要落实成 px（否则子项全 absolute 时容器塔成 0 高）", () => {
    const { root } = parseLayoutXml(src);
    const model = buildRenderModel(root!, DEFAULT_RESOURCES, 2);
    expect(String(model.root.style.height)).toBe("1640px"); // 内容区 820dp * 2
    expect(String(model.root.style.width)).toBe("824px");
  });
});

describe("serialize — app: 前缀与 xmlns:app 自动补全", () => {
  const src = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android" android:layout_width="match_parent" android:layout_height="match_parent">
  <TextView android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content" app:layout_constraintTop_toTopOf="parent"/>
</androidx.constraintlayout.widget.ConstraintLayout>`;

  it("约束属性序列化成 app: 前缀", () => {
    const { root } = parseLayoutXml(src);
    const out = serialize(root!);
    expect(out).toContain("app:layout_constraintTop_toTopOf");
    expect(out).not.toContain("android:layout_constraint");
  });

  it("根节点自动补 xmlns:app", () => {
    const { root } = parseLayoutXml(src);
    const out = serialize(root!);
    expect(out).toContain('xmlns:app="http://schemas.android.com/apk/res-auto"');
  });

  it("普通属性仍是 android: 前缀", () => {
    const { root } = parseLayoutXml(src);
    const out = serialize(root!);
    expect(out).toContain('android:layout_width="wrap_content"');
  });

  it("没有约束属性时不乱加 xmlns:app", () => {
    const { root } = parseLayoutXml(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:text="a"/></LinearLayout>`);
    const out = serialize(root!);
    expect(out).not.toContain("xmlns:app");
  });
});
