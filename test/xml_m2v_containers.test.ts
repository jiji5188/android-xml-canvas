// M2v：容器补全（CoordinatorLayout / DrawerLayout / GridLayout / NestedScrollView / TableLayout / merge）
import { describe, expect, it } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel, gridColumnCount } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const A = `xmlns:android="http://schemas.android.com/apk/res/android"
  xmlns:app="http://schemas.android.com/apk/res-auto"`;

const model = (xml: string) => buildRenderModel(parseLayoutXml(xml)!.root!, DEFAULT_RESOURCES, 2, undefined, { w: 412, h: 892 });

describe("M2v 容器补全", () => {
  it("CoordinatorLayout 按堆叠布局渲染（flex + relative，子项 absolute）", () => {
    const m = model(
      `<androidx.coordinatorlayout.widget.CoordinatorLayout ${A}
          android:layout_width="match_parent" android:layout_height="match_parent">
         <TextView android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content" />
       </androidx.coordinatorlayout.widget.CoordinatorLayout>`,
    );
    expect(m.root.style.display).toBe("flex");
    expect(m.root.style.position).toBe("relative");
    expect(m.root.children[0].style.position).toBe("absolute");
  });

  it("DrawerLayout 同 FrameLayout 语义：子项堆叠", () => {
    const m = model(
      `<androidx.drawerlayout.widget.DrawerLayout ${A}
          android:layout_width="match_parent" android:layout_height="match_parent">
         <FrameLayout android:layout_width="match_parent" android:layout_height="match_parent" />
         <TextView android:layout_width="240dp" android:layout_height="match_parent" android:layout_gravity="start" />
       </androidx.drawerlayout.widget.DrawerLayout>`,
    );
    expect(m.root.style.display).toBe("flex");
    expect(m.root.children.every((c) => c.style.position === "absolute")).toBe(true);
  });

  it("GridLayout 用 CSS Grid，columnCount 显式指定", () => {
    const m = model(
      `<GridLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:columnCount="3">
         <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" />
       </GridLayout>`,
    );
    expect(m.root.style.display).toBe("grid");
    expect(m.root.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
  });

  it("GridLayout：无 columnCount 时按子项 layout_column 推断列数", () => {
    const m = model(
      `<GridLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content">
         <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_column="0" />
         <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_column="2" />
       </GridLayout>`,
    );
    expect(m.root.style.gridTemplateColumns).toBe("repeat(3, minmax(0, 1fr))");
    // 第二项落在第 3 列（0 基 2 → CSS 1 基 3）
    expect(m.root.children[1].style.gridColumn).toBe("3 / span 1");
  });

  it("GridLayout 跨列：layout_columnSpan=2", () => {
    const m = model(
      `<GridLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content" android:columnCount="4">
         <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_column="1" android:layout_columnSpan="2" />
       </GridLayout>`,
    );
    expect(m.root.children[0].style.gridColumn).toBe("2 / span 2");
  });

  it("NestedScrollView 当竖向滚动容器（flex column + overflowY auto）", () => {
    const m = model(
      `<androidx.core.widget.NestedScrollView ${A} android:layout_width="match_parent" android:layout_height="match_parent">
         <TextView android:layout_width="match_parent" android:layout_height="wrap_content" />
       </androidx.core.widget.NestedScrollView>`,
    );
    expect(m.root.style.display).toBe("flex");
    expect(m.root.style.flexDirection).toBe("column");
    expect(m.root.style.overflowY).toBe("auto");
  });

  it("TableLayout 竖排、TableRow 横排", () => {
    const m = model(
      `<TableLayout ${A} android:layout_width="match_parent" android:layout_height="wrap_content">
         <TableRow android:layout_width="match_parent" android:layout_height="wrap_content">
           <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" />
         </TableRow>
       </TableLayout>`,
    );
    expect(m.root.style.flexDirection).toBe("column");
    expect(m.root.children[0].style.flexDirection).toBe("row");
  });

  it("merge 根标签按堆叠容器处理（include 常见）", () => {
    const m = model(
      `<merge ${A}>
         <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" />
       </merge>`,
    );
    expect(m.root.style.display).toBe("flex");
  });

  it("gridColumnCount：非法/超大值兜底", () => {
    const fake = (cols: string[]) => ({ children: cols.map((c) => ({ attrs: (c ? { layout_column: c } : {}) as Record<string, string> })) });
    expect(gridColumnCount(3, fake([]))).toBe(3);
    expect(gridColumnCount(0, fake([]))).toBe(1);
    expect(gridColumnCount("abc", fake([]))).toBe(1);
    expect(gridColumnCount(99, fake([]))).toBe(24);
    expect(gridColumnCount(undefined, fake(["4"]))).toBe(5);
  });
});
