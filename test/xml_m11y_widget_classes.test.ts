import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

const ICON =
  "data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24'%3E%3Cpath d='M0 0h24v24H0z'/%3E%3C/svg%3E";

function build(xml: string, theme?: "appcompat" | "material3"): any {
  const parsed = parseLayoutXml(xml);
  const res = {
    ...(DEFAULT_RESOURCES as any),
    drawables: { ic_x: ICON },
    drawableXml: { ic_x: "<vector/>" },
  };
  return buildRenderModel(parsed.root!, res, 2, undefined, undefined, undefined, theme).root;
}

function find(node: any, tag: string): any {
  if (String(node.tag).endsWith(tag)) return node;
  for (const c of node.children || []) {
    const hit = find(c, tag);
    if (hit) return hit;
  }
  return null;
}

describe("M11x 全组件总览修正", () => {
  it("maxLines 必须带 -webkit-box-orient，否则行数限制不生效", () => {
    const root = build(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <TextView android:layout_width="match_parent" android:layout_height="wrap_content"
        android:text="很长很长" android:maxLines="1" android:ellipsize="end" />
    </LinearLayout>`);
    const t = find(root, "TextView");
    expect(t.style.WebkitLineClamp).toBe("1");
    expect(t.style.WebkitBoxOrient ?? t.style.webkitBoxOrient).toBe("vertical");
    expect(t.style.textOverflow).toBe("ellipsis");
    expect(t.style.overflow).toBe("hidden");
  });

  it("Chip 是小胶囊，ChipGroup 是横向换行容器", () => {
    const root = build(`<com.google.android.material.chip.ChipGroup
      xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="wrap_content">
      <com.google.android.material.chip.Chip android:layout_width="wrap_content"
        android:layout_height="wrap_content" android:text="A" android:checked="true" />
    </com.google.android.material.chip.ChipGroup>`);
    const chip = find(root, "Chip");
    expect(chip.className).toContain("axv-chip");
    expect(chip.style.flex).toBe("0 0 auto");
    expect(chip.style.borderRadius).toBeTruthy();
    const group = root;
    expect(group.className).toContain("axv-chipgroup");
    expect(group.style.flexWrap).toBe("wrap");
  });

  it("FAB 是 56dp 圆形并带图标；Extended FAB 是胶囊（Material3）；AppCompat 下方块灰底", () => {
    const xml = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <com.google.android.material.floatingactionbutton.FloatingActionButton
        android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:src="@drawable/ic_x" app:backgroundTint="#6750A4" />
      <com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
        android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="扩展" />
    </LinearLayout>`;
    const root = build(xml, "material3");
    const fab = find(root, "FloatingActionButton");
    expect(fab.className).toContain("axv-fab");
    expect(fab.style.borderRadius).toBe("50%");
    expect(fab.style.width).toBe("112px");
    expect(fab.imgSrc).toContain("data:");
    const ext = find(root, "ExtendedFloatingActionButton");
    expect(ext.className).toContain("axv-fab-ext");
    expect(ext.text).toBe("扩展");

    // M16d：默认 AppCompat —— FAB 没有 Material 主题支撑，是灰底方角块、无阴影
    const ac = build(xml);
    const acFab = find(ac, "FloatingActionButton");
    expect(acFab.style.borderRadius).toBe("8px");
    expect(acFab.style.boxShadow).toBe("none");
  });

  it("ToggleButton 用 textOn/textOff（默认 ON/OFF）", () => {
    const root = build(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <ToggleButton android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:textOn="开启" android:textOff="关闭" android:checked="true" />
      <ToggleButton android:layout_width="wrap_content" android:layout_height="wrap_content" />
    </LinearLayout>`);
    const list: any[] = [];
    const walk = (n: any) => {
      if (String(n.tag) === "ToggleButton") list.push(n);
      (n.children || []).forEach(walk);
    };
    walk(root);
    expect(list[0].text).toBe("开启");
    expect(list[1].text).toBe("OFF");
  });

  it("NumberPicker 显示 0（XML 的 android:value 在真机上无效）；TabItem 均分并标选中色", () => {
    const root = build(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <NumberPicker android:layout_width="wrap_content" android:layout_height="wrap_content" android:value="30" />
      <com.google.android.material.tabs.TabLayout android:layout_width="match_parent" android:layout_height="wrap_content">
        <com.google.android.material.tabs.TabItem android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="一" />
        <com.google.android.material.tabs.TabItem android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="二" android:checked="true" />
      </com.google.android.material.tabs.TabLayout>
    </LinearLayout>`);
    const np = find(root, "NumberPicker");
    // M16c：NumberPicker 不认 android:value（那是代码 setValue 的事），真机就是 0
    expect(np.text).toBe("0");
    expect(np.className).toContain("axv-numberpicker");
    const tabs = find(root, "TabLayout");
    expect(tabs.className).toContain("axv-tabs");
    expect(tabs.children[0].style.flex).toBe("1 1 0");
    expect(tabs.children[1].style.color).toBe("#6750A4");
  });

  it("TextInputLayout 的子 EditText 不再自带边框（避免框中框）", () => {
    const root = build(`<com.google.android.material.textfield.TextInputLayout
      xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="wrap_content">
      <EditText android:layout_width="match_parent" android:layout_height="wrap_content" />
    </com.google.android.material.textfield.TextInputLayout>`);
    const child = root.children[0];
    expect(child.style.border).toBeUndefined();
    expect(child.style.backgroundColor).toBe("transparent");
  });

  it("AutoCompleteTextView 的 hint 能显示出来；SearchView 收起态不显示 hint", () => {
    const root = build(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
      <AutoCompleteTextView android:layout_width="match_parent" android:layout_height="wrap_content"
        android:hint="AC 提示" />
      <SearchView android:layout_width="match_parent" android:layout_height="wrap_content"
        android:queryHint="搜索提示" />
    </LinearLayout>`);
    expect(root.children[0].text).toBe("AC 提示");
    // M16c：SearchView 收起态只显示放大镜，queryHint 不渲染
    expect(root.children[1].text).toBe("");
  });

  it("MaterialButton 有 strokeColor：Material3 画描边，AppCompat 退化为灰底按钮", () => {
    const xml = `<com.google.android.material.button.MaterialButton
      xmlns:android="http://schemas.android.com/apk/res/android"
      xmlns:app="http://schemas.android.com/apk/res-auto"
      android:layout_width="wrap_content" android:layout_height="wrap_content"
      android:text="描边" app:strokeColor="#6750A4" app:strokeWidth="1dp" />`;
    const m3 = build(xml, "material3");
    expect(m3.style.backgroundColor).toBe("transparent");
    expect(m3.style.border).toContain("solid");
    expect(m3.style.color).toBe("#6750A4");

    // M16d：默认 AppCompat —— Widget.Material3.Button.OutlinedButton 样式不存在，真机就是灰底实心
    const ac = build(xml);
    expect(ac.style.backgroundColor).toBe("#E8E8EC");
    expect(ac.style.color).toBe("#1D1B20");
  });
});
