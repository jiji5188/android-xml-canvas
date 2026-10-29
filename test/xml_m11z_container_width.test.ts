import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

function build(xml: string): any {
  const parsed = parseLayoutXml(xml);
  return buildRenderModel(parsed.root!, DEFAULT_RESOURCES as any).root;
}

describe("M11z 容器宽度按父内容盒算（不是屏幕宽）", () => {
  it("带 padding 的 LinearLayout 里，match_parent 的 ConstraintLayout 用父内容宽", () => {
    const root = build(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent" android:layout_height="wrap_content"
      android:orientation="vertical" android:padding="12dp">
      <androidx.constraintlayout.widget.ConstraintLayout
        android:layout_width="match_parent" android:layout_height="100dp">
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
          android:text="hi" app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" />
      </androidx.constraintlayout.widget.ConstraintLayout>
    </LinearLayout>`);
    // 屏宽 412dp = 824px，扣掉左右各 12dp(24px) = 776px
    expect(root.children[0].style.width).toBe("776px");
  });

  it("RelativeLayout match_parent 也不会超宽（用户报的问题）", () => {
    const root = build(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent" android:layout_height="wrap_content"
      android:orientation="vertical" android:padding="12dp">
      <RelativeLayout android:layout_width="match_parent" android:layout_height="120dp">
        <TextView android:id="@+id/t" android:layout_width="wrap_content" android:layout_height="wrap_content"
          android:text="标题" android:layout_centerInParent="true" />
      </RelativeLayout>
    </LinearLayout>`);
    expect(root.children[0].style.width).toBe("776px");
    expect(root.children[0].style.height).toBe("240px");
  });

  it("嵌套 CL：内层按外层内容盒（外层有 padding 再扣一层）", () => {
    const root = build(`<androidx.constraintlayout.widget.ConstraintLayout
      xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent" android:layout_height="wrap_content" android:padding="8dp">
      <androidx.constraintlayout.widget.ConstraintLayout
        android:layout_width="match_parent" android:layout_height="80dp"
        app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent">
        <TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="x"
          app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" />
      </androidx.constraintlayout.widget.ConstraintLayout>
    </androidx.constraintlayout.widget.ConstraintLayout>`);
    // 824 - 8dp*2*2px = 792
    expect(root.children[0].style.width).toBe("792px");
  });
});
