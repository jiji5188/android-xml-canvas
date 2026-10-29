import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

function build(xml: string): any {
  const parsed = parseLayoutXml(xml);
  return buildRenderModel(parsed.root!, DEFAULT_RESOURCES as any).root;
}

describe("M11z FrameLayout 子项 layout_gravity", () => {
  it("bottom|end 靠右下，center 居中，top|start 靠左上", () => {
    const root = build(`<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="120dp">
      <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:layout_gravity="bottom|end" android:layout_margin="8dp" android:text="右下" />
      <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:layout_gravity="center" android:text="居中" />
      <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:layout_gravity="top|start" android:text="左上" />
    </FrameLayout>`);
    const [a, b, c] = root.children;
    expect(a.style.right).toBe("0px");
    expect(a.style.bottom).toBe("0px");
    expect(a.style.left).toBe("auto");
    expect(b.style.left).toBe("50%");
    expect(b.style.top).toBe("50%");
    expect(b.style.transform).toContain("translateX(-50%)");
    expect(b.style.transform).toContain("translateY(-50%)");
    expect(c.style.left).toBe("0px");
    expect(c.style.top).toBe("0px");
  });

  it("centerCrop 的 ImageView 仍然铺满（不受 gravity 影响）", () => {
    const root = build(`<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="120dp">
      <ImageView android:layout_width="match_parent" android:layout_height="match_parent"
        android:scaleType="centerCrop" android:src="@drawable/ic_x" />
    </FrameLayout>`);
    const img = root.children[0];
    expect(img.style.width === "100%" || img.style.left === "0px").toBeTruthy();
  });
});
