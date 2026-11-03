import { describe, expect, it } from "vitest";
import { computeSuggest } from "../lib/xml/keyword-suggest";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

/** 把光标放在给定行末尾调 suggest */
function at(line: string, docLines: string[] = [line]) {
  const doc = docLines.join("\n");
  const r = computeSuggest(doc, { line: 1, col: line.length + 1 });
  if (!r) throw new Error("no suggestion for: " + line);
  return r;
}

describe("M94 Android 词汇表补全", () => {
  it("属性补全：layout_weight / textAlignment / inputType 都在", () => {
    const r1 = at(`<LinearLayout ${A} android:layout_we`);
    expect(r1.items).toContain("android:layout_weight");
    const r2 = at(`<TextView android:textAli`);
    expect(r2.items).toContain("android:textAlignment");
    const r3 = at(`<EditText android:input`);
    expect(r3.items).toContain("android:inputType");
  });

  it("ConstraintLayout 全系列（含 goneMargin / percent / ratio）", () => {
    const r = at(`<View app:layout_constraintDimension`, [`<View app:layout_constraintDimension`]);
    expect(r.items).toContain("app:layout_constraintDimensionRatio");
    const r2 = at(`<View app:layout_goneMargin`);
    expect(r2.items.some((i) => i.startsWith("app:layout_goneMargin"))).toBe(true);
    const r3 = at(`<View app:layout_constraintWidth_pe`);
    expect(r3.items).toContain("app:layout_constraintWidth_percent");
  });

  it("Material 属性：endIconMode / cardCornerRadius / menu", () => {
    expect(at(`<com.google.android.material.textfield.TextInputLayout app:endIcon`).items)
      .toContain("app:endIconMode");
    expect(at(`<com.google.android.material.card.MaterialCardView app:cardCorner`).items)
      .toContain("app:cardCornerRadius");
  });

  it("标签补全：Chip / ViewPager2 / include / vector", () => {
    expect(at(`<Ch`).items).toContain("Chip");
    expect(at(`<ViewPager`).items).toContain("ViewPager2");
    expect(at(`<inc`).items).toContain("include");
    expect(at(`<vec`).items).toContain("vector");
  });

  it("属性值补全：inputType / adjustResize / chainStyle 值", () => {
    const r = at(`<EditText android:inputType="textMulti`);
    expect(r.items).toContain("textMultiLine");
    const r2 = at(`<activity android:windowSoftInputMode="adjustRe`);
    expect(r2.items).toContain("adjustResize");
    const r3 = at(`<View app:layout_constraintHorizontal_chainStyle="pa`);
    // chainStyle 的 packed / spread / spread_inside 也要能补出来
    expect(r3?.items ?? []).toContain("packed");
  });

  it("前缀过滤生效：不会把无关词塞满 12 条", () => {
    const r = at(`<TextView android:textCol`);
    expect(r.items.length).toBeLessThanOrEqual(12);
    expect(r.items.every((i) => i.toLowerCase().startsWith("android:textcol"))).toBe(true);
  });
});
