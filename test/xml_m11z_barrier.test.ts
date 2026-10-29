import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import { SAMPLE_PROJECTS } from "../lib/xml/sample-projects";

const CL = `<androidx.constraintlayout.widget.ConstraintLayout
  xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:app="http://schemas.android.com/apk/res-auto"
  android:layout_width="match_parent" android:layout_height="180dp">
  <TextView android:id="@+id/tv_a" android:layout_width="wrap_content" android:layout_height="40dp"
    android:text="A"
    app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent"
    android:layout_marginStart="16dp" android:layout_marginTop="16dp" />
  <TextView android:id="@+id/tv_b" android:layout_width="0dp" android:layout_height="60dp"
    android:text="B"
    app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="@id/tv_a"
    android:layout_marginStart="16dp" />
  <androidx.constraintlayout.widget.Barrier android:id="@+id/barrier"
    android:layout_width="wrap_content" android:layout_height="wrap_content"
    app:barrierDirection="bottom" app:constraint_referenced_ids="tv_a,tv_b" />
  <TextView android:id="@+id/below" android:layout_width="wrap_content" android:layout_height="wrap_content"
    android:layout_marginTop="8dp" android:text="屏障下方"
    app:layout_constraintTop_toBottomOf="@id/barrier" app:layout_constraintStart_toStartOf="parent" />
</androidx.constraintlayout.widget.ConstraintLayout>`;

function build(xml: string): any {
  const parsed = parseLayoutXml(xml);
  return buildRenderModel(parsed.root!, DEFAULT_RESOURCES as any);
}

describe("M11z Barrier 定位", () => {
  it("barrierDirection=bottom 落在被引用子项的最下沿，而不是父容器底部", () => {
    const model = build(CL);
    const root = model.root;
    const byText = (t: string) => root.children.find((c: any) => (c.text || "").trim() === t);
    const a = byText("A");
    const b = byText("B");
    const below = byText("屏障下方");
    const barrier = root.children.find((c: any) => String(c.tag).endsWith("Barrier"));
    const bottomOfMembers = Math.max(
      parseFloat(a.style.top) + parseFloat(a.style.height),
      parseFloat(b.style.top) + parseFloat(b.style.height),
    );
    expect(parseFloat(barrier.style.top)).toBe(bottomOfMembers);
    // 屏障线本身 0 高（水平线），否则下面那行会多跳一个容器高
    expect(parseFloat(barrier.style.height)).toBe(2);
    // 屏障下方 = 屏障位置 + 8dp(16px)
    expect(parseFloat(below.style.top)).toBe(bottomOfMembers + 16);
  });

  it("全组件总览样例里没有「约束目标未找到」的报警", () => {
    const p: any = SAMPLE_PROJECTS.find((x) => x.key === "all-widgets");
    const parsed = parseLayoutXml(p.layout);
    const model = buildRenderModel(parsed.root!, {
      ...(DEFAULT_RESOURCES as any),
      drawableXml: { ...(p.drawables || {}) },
    } as any);
    const missing = model.issues.filter((i) => /未找到/.test(i.message));
    expect(missing.map((i) => i.message)).toEqual([]);
  });
});
