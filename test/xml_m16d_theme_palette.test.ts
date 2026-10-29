import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { DEFAULT_RENDER_THEME } from "../lib/xml/theme";
import { WIDGETS, WIDGET_GROUPS, GROUP_ICON } from "../components/widget-catalog";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const RES = {} as never;

function build(xml: string, theme?: "appcompat" | "material3") {
  const { root } = parseLayoutXml(xml);
  return buildRenderModel(root!, RES, 2, undefined, undefined, undefined, theme).root as any;
}

describe("M16d 渲染主题（AppCompat 默认）", () => {
  it("默认主题就是 appcompat", () => {
    expect(DEFAULT_RENDER_THEME).toBe("appcompat");
  });

  it("普通按钮：AppCompat 4dp 方角，Material3 20dp 胶囊", () => {
    const xml = `<Button ${A} android:layout_width="wrap_content" android:layout_height="48dp" android:text="确定" />`;
    expect(build(xml).style.borderRadius).toBe("8px");
    expect(build(xml, "material3").style.borderRadius).toBe("40px");
  });

  it("Chip：AppCompat 退化成纯文字（透明底、无圆角）", () => {
    const xml = `<Chip ${A} android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="筛选" />`;
    const ac = build(xml);
    expect(ac.style.backgroundColor).toBe("transparent");
    expect(ac.style.borderRadius).toBe("0px");
    const m3 = build(xml, "material3");
    expect(m3.style.backgroundColor).toBe("#E8DEF8");
  });
});

describe("M16d 组件面板：适配器布局独立二级分类", () => {
  it("适配器分类存在且有图标，排在布局之后", () => {
    expect(WIDGET_GROUPS).toEqual(["布局", "适配器", "文本", "输入", "控件", "进度", "图片"]);
    expect(GROUP_ICON["适配器"]).toBeTruthy();
  });

  it("需要 adapter 的列表类布局归到「适配器」，不再挤在「布局」", () => {
    for (const tag of ["ListView", "GridView", "ExpandableListView"]) {
      const w = WIDGETS.find((x) => x.tag === tag);
      expect(w, tag).toBeTruthy();
      expect(w!.group).toBe("适配器");
    }
  });

  it("纯容器仍留在「布局」下（LinearLayout / FrameLayout / TableLayout）", () => {
    for (const tag of ["LinearLayout", "FrameLayout", "TableLayout"]) {
      const w = WIDGETS.find((x) => x.tag === tag);
      expect(w, tag).toBeTruthy();
      expect(w!.group).toBe("布局");
    }
  });
});
