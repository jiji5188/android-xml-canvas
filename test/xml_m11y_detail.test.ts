import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";
import { isContainerTag } from "../lib/xml/insert";

const ICON =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M0 0h24v24H0z'/%3E%3C/svg%3E";

function build(xml: string): any {
  const parsed = parseLayoutXml(xml);
  const res = {
    ...(DEFAULT_RESOURCES as any),
    drawables: { ic_x: ICON },
    drawableXml: { ic_x: "<vector/>" },
  };
  return buildRenderModel(parsed.root!, res).root;
}

function findAll(node: any, tag: string, out: any[] = []): any[] {
  if (String(node.tag).endsWith(tag)) out.push(node);
  for (const c of node.children || []) findAll(c, tag, out);
  return out;
}

describe("M11y 细节补齐", () => {
  it("TextInputLayout 的 hint 浮到框线上（label），且子 EditText 不重复显示", () => {
    const root = build(`<com.google.android.material.textfield.TextInputLayout
      xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent" android:layout_height="wrap_content"
      app:boxBackgroundMode="outline" app:boxStrokeColor="#6750A4">
      <com.google.android.material.textfield.TextInputEditText
        android:layout_width="match_parent" android:layout_height="wrap_content"
        android:hint="请输入邮箱" />
    </com.google.android.material.textfield.TextInputLayout>`);
    expect(root.label).toBe("请输入邮箱");
    // 有内边距（否则文字贴描边）
    expect(root.style.paddingLeft).toBe("32px");
    expect(root.style.paddingTop).toBe("16px");
    // 子控件仍然是占位文本，但没自己的边框（避免框中框）
    expect(root.children[0].style.border).toBeUndefined();
  });

  it("TextInputLayout 自身写 hint 也当标签", () => {
    const root = build(`<com.google.android.material.textfield.TextInputLayout
      xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="wrap_content"
      android:hint="手机号">
      <EditText android:layout_width="match_parent" android:layout_height="wrap_content" />
    </com.google.android.material.textfield.TextInputLayout>`);
    expect(root.label).toBe("手机号");
  });

  it("SearchView 是圆角搜索框（浅底 + 左侧留给放大镜）", () => {
    const root = build(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <SearchView android:layout_width="match_parent" android:layout_height="wrap_content"
        android:queryHint="搜索订单" />
    </LinearLayout>`);
    const sv = root.children[0];
    expect(sv.className).toContain("axv-search");
    expect(sv.style.borderRadius).toBe("48px");
    expect(sv.style.backgroundColor).toBe("#F3EDF7");
    expect(sv.style.paddingLeft).toBe("80px");
    expect(sv.text).toBe("搜索订单");
  });

  it("Chip 有 closeIcon 时多一个 axv-chip-close 类", () => {
    const root = build(`<com.google.android.material.chip.ChipGroup
      xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent" android:layout_height="wrap_content">
      <com.google.android.material.chip.Chip android:layout_width="wrap_content"
        android:layout_height="wrap_content" android:text="可关闭" app:closeIcon="@drawable/ic_x" />
      <com.google.android.material.chip.Chip android:layout_width="wrap_content"
        android:layout_height="wrap_content" android:text="普通" />
    </com.google.android.material.chip.ChipGroup>`);
    const chips = findAll(root, "Chip");
    expect(chips[0].className).toContain("axv-chip-close");
    expect(chips[1].className).not.toContain("axv-chip-close");
  });

  it("固定高的 ConstraintLayout 子项溢出时裁掉；wrap_content 时按子项收高", () => {
    const fixed = build(`<androidx.constraintlayout.widget.ConstraintLayout
      xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent" android:layout_height="100dp">
      <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="溢出" android:layout_marginTop="200dp"
        app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" />
    </androidx.constraintlayout.widget.ConstraintLayout>`);
    expect(fixed.style.height).toBe("200px");
    expect(fixed.style.overflow).toBe("hidden");

    const wrap = build(`<androidx.constraintlayout.widget.ConstraintLayout
      xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent" android:layout_height="wrap_content">
      <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:text="一" app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" />
      <TextView android:layout_width="wrap_content" android:layout_height="60dp"
        android:text="二" android:layout_marginTop="100dp"
        app:layout_constraintTop_toTopOf="parent" app:layout_constraintStart_toStartOf="parent" />
    </androidx.constraintlayout.widget.ConstraintLayout>`);
    // 子项下沿 100dp + 60dp = 320px，容器应收到这个高度而不是整屏高
    expect(parseFloat(wrap.style.height)).toBe(320);
    expect(wrap.style.overflow).toBeUndefined();
  });

  it("CollapsingToolbarLayout / BottomAppBar 算容器，可以放子控件", () => {
    expect(isContainerTag("androidx.coordinatorlayout.widget.CollapsingToolbarLayout") ||
      isContainerTag("com.google.android.material.appbar.CollapsingToolbarLayout")).toBe(true);
    expect(isContainerTag("CollapsingToolbarLayout")).toBe(true);
    expect(isContainerTag("com.google.android.material.bottomappbar.BottomAppBar")).toBe(true);
    // 仍然是叶子：BottomNavigationView 子项由 menu 生成
    expect(isContainerTag("com.google.android.material.bottomnavigation.BottomNavigationView")).toBe(false);
  });
});
