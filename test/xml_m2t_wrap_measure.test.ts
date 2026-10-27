// M2t：wrap_content 真实尺寸（DOM 实测回填）
// 纯函数层验证：实测表命中 → CL/RL 求解用实测 px；未命中 → 仍走 estSize 估算（向后兼容）

import { describe, expect, it } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { solveConstraintChildren } from "../lib/xml/constraints";
import { solveRelativeChildren } from "../lib/xml/relative";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:app="http://schemas.android.com/apk/res-auto"`;

describe("M2t wrap 实测尺寸", () => {
  it("CL：实测表命中时 wrap 子项按实测 px 定宽，而不是 estSize 的 120dp", () => {
    const { root } = parseLayoutXml(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          android:layout_width="match_parent" android:layout_height="match_parent">
         <TextView android:id="@+id/tv" android:layout_width="wrap_content" android:layout_height="wrap_content"
             android:text="Hi"
             app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent" />
       </ConstraintLayout>`,
    )!;
    const cl = root!;
    const tv = cl.children[0];

    // 无实测：estSize 估 120dp × 40dp → scale 2 → 320 × 80? 实际 estSize 120/40 dp * 2
    const noMeas = solveConstraintChildren(cl, DEFAULT_RESOURCES, 800, 1600);
    const boxNo = noMeas.boxes.get(tv.path)!;
    expect(boxNo.wrapW).toBe(true);
    expect(boxNo.width).toBe(240); // 120dp * 2

    // 有实测：宽 88px 高 44px（模拟浏览器按文字算出的真实尺寸）
    const med = new Map([[tv.path, { w: 88, h: 44 }]]);
    const withMeas = solveConstraintChildren(cl, DEFAULT_RESOURCES, 800, 1600, med);
    const box = withMeas.boxes.get(tv.path)!;
    expect(box.width).toBe(88);
    expect(box.height).toBe(44);
    expect(box.wrapW).toBe(true);
    expect(box.wrapH).toBe(true);
  });

  it("CL：实测值只影响 wrap 轴，dp 尺寸轴不受污染", () => {
    const { root } = parseLayoutXml(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          android:layout_width="match_parent" android:layout_height="match_parent">
         <TextView android:id="@+id/tv" android:layout_width="200dp" android:layout_height="wrap_content"
             app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent" />
       </ConstraintLayout>`,
    )!;
    const cl = root!;
    const tv = cl.children[0];
    const med = new Map([[tv.path, { w: 88, h: 44 }]]);
    const r = solveConstraintChildren(cl, DEFAULT_RESOURCES, 800, 1600, med);
    const box = r.boxes.get(tv.path)!;
    expect(box.width).toBe(400); // 200dp * 2 不被实测覆盖
    expect(box.height).toBe(44); // wrap 轴用实测
    expect(box.wrapW).toBe(false);
    expect(box.wrapH).toBe(true);
  });

  it("CL：实测值参与兄弟锚点定位（A 在 B 右侧，B 是 wrap）", () => {
    const { root } = parseLayoutXml(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          android:layout_width="match_parent" android:layout_height="match_parent">
         <TextView android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content"
             android:text="A"
             app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent" />
         <TextView android:id="@+id/b" android:layout_width="wrap_content" android:layout_height="wrap_content"
             android:text="B"
             app:layout_constraintStart_toEndOf="@+id/a" app:layout_constraintTop_toTopOf="parent" />
       </ConstraintLayout>`,
    )!;
    const cl = root!;
    const [a, b] = cl.children;
    const med = new Map([
      [a.path, { w: 90, h: 44 }],
      [b.path, { w: 60, h: 44 }],
    ]);
    const r = solveConstraintChildren(cl, DEFAULT_RESOURCES, 800, 1600, med);
    expect(r.boxes.get(a.path)!.width).toBe(90);
    expect(r.boxes.get(b.path)!.left).toBe(90); // B 紧贴 A 右缘（用实测 90 而非估算 240）
  });

  it("RL：实测表命中时 wrap 子项按实测尺寸，且 toEndOf 定位跟着变", () => {
    const { root } = parseLayoutXml(
      `<RelativeLayout ${A} android:layout_width="match_parent" android:layout_height="match_parent">
         <TextView android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content"
             android:layout_alignParentStart="true" />
         <TextView android:id="@+id/b" android:layout_width="wrap_content" android:layout_height="wrap_content"
             android:layout_toEndOf="@+id/a" />
       </RelativeLayout>`,
    )!;
    const rl = root!;
    const [a, b] = rl.children;
    const med = new Map([
      [a.path, { w: 70, h: 40 }],
      [b.path, { w: 50, h: 40 }],
    ]);
    const r = solveRelativeChildren(rl, DEFAULT_RESOURCES, 800, 1600, med);
    expect(r.boxes.get(a.path)!.width).toBe(70);
    expect(r.boxes.get(b.path)!.left).toBe(70);
  });

  it("buildRenderModel：wrap 轴渲染成 auto（交给浏览器算真尺寸），dp 轴仍是 px", () => {
    const { root } = parseLayoutXml(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          android:layout_width="match_parent" android:layout_height="match_parent">
         <TextView android:id="@+id/tv" android:layout_width="wrap_content" android:layout_height="48dp"
             app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent" />
       </ConstraintLayout>`,
    )!;
    const model = buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, { w: 412, h: 892 });
    const child = model.root.children[0];
    expect(child.style.width).toBe("auto");
    expect(child.style.height).toBe("96px"); // 48dp * 2
  });

  it("buildRenderModel：传实测表后，非 wrap 轴不受影响且节点位置用实测宽度", () => {
    const { root } = parseLayoutXml(
      `<androidx.constraintlayout.widget.ConstraintLayout ${A}
          android:layout_width="match_parent" android:layout_height="match_parent">
         <TextView android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content"
             app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent" />
         <TextView android:id="@+id/b" android:layout_width="wrap_content" android:layout_height="wrap_content"
             app:layout_constraintStart_toEndOf="@+id/a" app:layout_constraintTop_toTopOf="parent" />
       </ConstraintLayout>`,
    )!;
    const cl = root!;
    const [a, b] = cl.children;
    const med = new Map([
      [a.path, { w: 100, h: 40 }],
      [b.path, { w: 80, h: 40 }],
    ]);
    const model = buildRenderModel(root!, DEFAULT_RESOURCES, 2, undefined, { w: 412, h: 892 }, med);
    const ca = model.root.children[0];
    const cb = model.root.children[1];
    expect(ca.style.width).toBe("auto");
    expect(cb.style.left).toBe("100px");
  });
});
