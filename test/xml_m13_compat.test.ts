import { describe, it, expect } from "vitest";
import { toCompatXml } from "../lib/xml/compat";
import { exportLayoutXml } from "../lib/xml/export";

const CL = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
  xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:app="http://schemas.android.com/apk/res-auto"
  android:layout_width="match_parent" android:layout_height="match_parent">

  <TextView android:id="@+id/title"
    android:layout_width="0dp" android:layout_height="wrap_content"
    android:text="标题"
    app:layout_constraintStart_toStartOf="parent"
    app:layout_constraintEnd_toEndOf="parent"
    app:layout_constraintTop_toTopOf="parent" />

  <com.google.android.material.button.MaterialButton android:id="@+id/btn"
    android:layout_width="wrap_content" android:layout_height="wrap_content"
    android:text="确定" app:cornerRadius="12dp"
    app:layout_constraintTop_toBottomOf="@id/title"
    app:layout_constraintStart_toStartOf="parent" />

  <androidx.constraintlayout.widget.Guideline android:id="@+id/g1"
    android:layout_width="wrap_content" android:layout_height="wrap_content"
    android:orientation="vertical" app:layout_constraintGuide_percent="0.5" />

  <TextView android:id="@+id/after"
    android:layout_width="wrap_content" android:layout_height="wrap_content"
    android:text="参考了 guideline"
    app:layout_constraintStart_toEndOf="@id/g1"
    app:layout_constraintTop_toBottomOf="@id/btn" />
</androidx.constraintlayout.widget.ConstraintLayout>`;

describe("M13 兼容模式导出", () => {
  const r = toCompatXml(CL);

  it("ConstraintLayout → RelativeLayout", () => {
    expect(r.xml).toContain("<RelativeLayout");
    expect(r.xml).not.toContain("ConstraintLayout");
  });

  it("左右撑满的子项 → match_parent", () => {
    expect(r.xml).toMatch(/android:id="@\+id\/title"[\s\S]*?layout_width="match_parent"/);
    expect(r.xml).toContain("layout_alignParentTop=\"true\"");
  });

  it("约束翻成 RelativeLayout 规则", () => {
    expect(r.xml).toContain("layout_below=\"@id/title\"");
    expect(r.xml).toContain("layout_alignParentStart=\"true\"");
  });

  it("Material 控件降级、库属性全清、无 xmlns:app", () => {
    expect(r.xml).toContain("<Button");
    expect(r.xml).not.toContain("MaterialButton");
    expect(r.xml).not.toContain("cornerRadius");
    expect(r.xml).not.toContain("xmlns:app");
    expect(r.xml).not.toMatch(/\bapp:/);
  });

  it("Guideline 被移除，引用它的属性一起清掉", () => {
    expect(r.xml).not.toContain("Guideline");
    expect(r.xml).not.toContain("@id/g1");
    expect(r.stats.removed).toBe(1);
  });

  it("导出入口按 mode 分流", () => {
    const modern = exportLayoutXml(CL);
    const compat = exportLayoutXml(CL, { mode: "compat" });
    expect(modern).toContain("ConstraintLayout");
    expect(compat).toContain("RelativeLayout");
    expect(compat.startsWith("<?xml")).toBe(true);
    expect(modern).toMatch(/app:layout_constraintStart_toStartOf/);
  });

  it("全组件总览也能整份降级（无 androidx / 无 app: 残留）", async () => {
    const { SAMPLE_PROJECTS } = await import("../lib/xml/sample-projects");
    const p = SAMPLE_PROJECTS.find((x) => x.key === "all-widgets")!;
    const out = exportLayoutXml(p.layout, { mode: "compat" });
    expect(out).not.toMatch(/\bapp:/);
    expect(out).not.toContain("xmlns:app");
    expect(out).not.toMatch(/<androidx\./);
    expect(out).not.toMatch(/<com\.google\./);
    // 标签层不得出现 CL（正文里出现的 “ConstraintLayout” 是控件名文字，不算）
    expect(out).not.toMatch(/<ConstraintLayout/);
    expect(out).not.toContain("layout_constraint");
  });
});
