// test/xml_m2b_constraints.test.ts — M2b：ConstraintLayout 四向约束求解
import { test, describe, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { solveConstraintChildren, estSize } from "../lib/xml/constraints";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const SCALE = 2; // 1dp=2px，与画布默认一致

/** 解析一段 XML → 找某 id 的渲染 style */
function styleOf(xml: string, findId: string) {
  const { root } = parseLayoutXml(xml);
  expect(root).toBeTruthy();
  const model = buildRenderModel(root!, DEFAULT_RESOURCES, SCALE);
  let found: any = null;
  const walk = (n: any) => {
    const rawId = n.rawAttrs?.["id"];
    if (rawId && (rawId === `@+id/${findId}` || rawId === findId)) found = n.style;
    for (const c of n.children ?? []) walk(c);
  };
  walk(model.root);
  return found;
}

describe("M2b ConstraintLayout 四向约束", () => {
  const CL = (inner: string) =>
    `<androidx.constraintlayout.widget.ConstraintLayout xmlns:android="http://schemas.android.com/apk/res/android" xmlns:app="http://schemas.android.com/apk/res-auto" android:layout_width="match_parent" android:layout_height="match_parent">${inner}</androidx.constraintlayout.widget.ConstraintLayout>`;

  test("01 start+top 锚 parent → 左上角", () => {
    const xml = CL(
      `<TextView android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginLeft="16dp" android:layout_marginTop="8dp" app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent" android:text="hi"/>`,
    );
    const s = styleOf(xml, "a");
    expect(s).toBeTruthy();
    expect(s!.position).toBe("absolute");
    expect(s!.left).toBe("32px"); // 16dp*2
    expect(s!.top).toBe("16px"); // 8dp*2
  });

  test("02 0dp width + start/end 锚 parent + hBias=0.5 → 水平居中", () => {
    const xml = CL(
      `<View android:id="@+id/bar" android:layout_width="0dp" android:layout_height="40dp" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" app:layout_constraintTop_toTopOf="parent" app:layout_constraintHorizontal_bias="0.5"/>`,
    );
    const s = styleOf(xml, "bar");
    // 父 412dp=824px；子满宽
    expect(s!.width).toBe("824px");
    expect(s!.left).toBe("0px");
    expect(s!.height).toBe("80px"); // 40dp
  });

  test("03 end 锚 parent → 右对齐（wrap 估宽 120dp）", () => {
    const xml = CL(
      `<TextView android:id="@+id/right" android:layout_width="wrap_content" android:layout_height="wrap_content" app:layout_constraintEnd_toEndOf="parent" app:layout_constraintTop_toTopOf="parent"/>`,
    );
    const s = styleOf(xml, "right");
    // 824 - 240 = 584
    expect(s!.left).toBe("584px");
    expect(s!.width).toBe("240px");
  });

  test("04 bottom 锚 parent → 下边对齐", () => {
    const xml = CL(
      `<View android:id="@+id/bottom" android:layout_width="100dp" android:layout_height="50dp" app:layout_constraintEnd_toEndOf="parent" app:layout_constraintBottom_toBottomOf="parent"/>`,
    );
    const s = styleOf(xml, "bottom");
    // 892*2=1784 - 100(50dp高度px) = 1684
    expect(s!.top).toBe("1684px");
  });

  test("05 start 锚兄弟右缘 → 左=兄弟右缘", () => {
    const xml = CL(
      `<TextView android:id="@+id/other" android:layout_width="wrap_content" android:layout_height="wrap_content" app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent"/>
       <TextView android:id="@+id/me" android:layout_width="wrap_content" android:layout_height="wrap_content" app:layout_constraintStart_toEndOf="@+id/other" app:layout_constraintTop_toTopOf="parent"/>`,
    );
    const s = styleOf(xml, "me");
    // 兄弟 other 估宽 120dp=240px，left=0 → 兄弟右缘 240
    expect(s!.left).toBe("240px");
  });

  test("05b start 锚兄弟左缘（toStartOf）→ 左=兄弟左缘", () => {
    const xml = CL(
      `<TextView android:id="@+id/left0" android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginStart="16dp" app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent"/>
       <TextView android:id="@+id/me2" android:layout_width="wrap_content" android:layout_height="wrap_content" app:layout_constraintStart_toStartOf="@+id/left0" app:layout_constraintTop_toTopOf="parent"/>`,
    );
    const s = styleOf(xml, "me2");
    expect(s!.left).toBe("32px"); // 兄弟左缘 = 16dp*2
  });

  test("06 找不到锚点 id → 回落 parent + warn", () => {
    const xml = CL(
      `<TextView android:id="@+id/x" android:layout_width="100dp" android:layout_height="100dp" app:layout_constraintStart_toStartOf="@+id/ghost" app:layout_constraintTop_toTopOf="parent"/>`,
    );
    const { root } = parseLayoutXml(xml);
    const model = buildRenderModel(root!, DEFAULT_RESOURCES, SCALE);
    const warns = model.issues.filter((i) => i.level === "warn" && i.message.includes("ghost"));
    expect(warns.length).toBeGreaterThan(0);
    const s = styleOf(xml, "x");
    expect(s!.left).toBe("0px");
  });

  test("07 hBias=1 贴对边（start+end 都有，0dp）", () => {
    const xml = CL(
      `<View android:id="@+id/b" android:layout_width="100dp" android:layout_height="20dp" app:layout_constraintStart_toStartOf="parent" app:layout_constraintEnd_toEndOf="parent" app:layout_constraintTop_toTopOf="parent" app:layout_constraintHorizontal_bias="1"/>`,
    );
    const s = styleOf(xml, "b");
    // free = 824 - 0 - 0 - 0 - 200 = 624；bias=1 → left = 0 + 624 = 624
    expect(s!.left).toBe("624px");
  });

  test("08 margin 计入（start 锚 + marginStart 24dp）", () => {
    const xml = CL(
      `<TextView android:id="@+id/m" android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginStart="24dp" app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent"/>`,
    );
    const s = styleOf(xml, "m");
    expect(s!.left).toBe("48px");
    expect(s!.marginTop).toBeUndefined(); // margin 已折进 left，避免双计
  });

  test("09 estSize 各控件默认尺寸", () => {
    const t = parseLayoutXml("<TextView/>").root!;
    expect(estSize(t)).toEqual({ w: 120, h: 40 });
    const img = parseLayoutXml("<ImageView/>").root!;
    expect(estSize(img)).toEqual({ w: 48, h: 48 });
  });

  test("10 约束求解纯函数：0dp 高度 + top/bottom → 撑满", () => {
    const cl = parseLayoutXml(CL(
      `<View android:id="@+id/fill" android:layout_width="100dp" android:layout_height="0dp" app:layout_constraintStart_toStartOf="parent" app:layout_constraintTop_toTopOf="parent" app:layout_constraintBottom_toBottomOf="parent"/>`,
    )).root!;
    const res = solveConstraintChildren(cl, DEFAULT_RESOURCES, 824, 1784);
    const box = res.boxes.get(cl.children[0].path)!;
    expect(box.width).toBe(200);
    expect(box.height).toBe(1784);
  });
});
