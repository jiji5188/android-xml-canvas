import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { WIDGETS } from "../components/widget-catalog";

const RES = { colors: {}, dimens: {}, attrs: {}, themeAttrs: {} } as never;

describe("M14d 表格 / 绝对布局 / 选择器渲染", () => {
  it("AbsoluteLayout 子项按 layout_x/y 绝对定位（16dp → 32px @scale2）", () => {
    const xml = `<AbsoluteLayout android:layout_width="match_parent" android:layout_height="240dp">
      <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:layout_x="16dp" android:layout_y="16dp" android:text="A"/>
      <TextView android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:layout_x="64dp" android:layout_y="96dp" android:text="B"/>
    </AbsoluteLayout>`;
    const m = buildRenderModel(parseLayoutXml(xml).root!, RES);
    const abs = m.root!;
    expect(abs.tag).toBe("AbsoluteLayout");
    const [a, b] = abs.children!;
    expect(a.style.position).toBe("absolute");
    expect(a.style.left).toBe("32px");
    expect(a.style.top).toBe("32px");
    expect(b.style.left).toBe("128px");
    expect(b.style.top).toBe("192px");
  });

  it("TableLayout / TableRow 是 flex 布局（列纵向堆叠、行横向排列）", () => {
    const xml = `<TableLayout android:layout_width="match_parent" android:layout_height="wrap_content"
        android:stretchColumns="*">
      <TableRow>
        <TextView android:layout_width="0dp" android:layout_height="wrap_content"
          android:layout_weight="1" android:text="c1"/>
        <TextView android:layout_width="0dp" android:layout_height="wrap_content"
          android:layout_weight="1" android:text="c2"/>
      </TableRow>
    </TableLayout>`;
    const m = buildRenderModel(parseLayoutXml(xml).root!, RES);
    expect(m.root!.style.display).toBe("flex");
    expect(m.root!.style.flexDirection).toBe("column");
    const row = m.root!.children![0];
    expect(row.style.display).toBe("flex");
    expect(row.style.flexDirection).toBe("row");
    // stretchColumns="*" → 单元格 0dp + weight 1 撑满
    expect(row.children![0].style.width).toBe("0px");
    expect(row.children![0].style.flexGrow).toBe(1);
  });

  it("DatePicker / TimePicker 渲染成占位框（带说明文字）", () => {
    const xml = `<LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content">
      <DatePicker android:layout_width="wrap_content" android:layout_height="wrap_content"/>
      <TimePicker android:layout_width="wrap_content" android:layout_height="wrap_content"/>
      <NumberPicker android:layout_width="wrap_content" android:layout_height="wrap_content"
        android:minValue="0" android:maxValue="99" android:value="8"/>
      <ExpandableListView android:layout_width="match_parent" android:layout_height="240dp"/>
    </LinearLayout>`;
    const m = buildRenderModel(parseLayoutXml(xml).root!, RES);
    const kids = m.root!.children!;
    expect(kids[0].className).toContain("axv-datepicker");
    expect(kids[0].text).toContain("DatePicker");
    expect(kids[1].className).toContain("axv-timepicker");
    expect(kids[2].className).toContain("axv-numberpicker");
    expect(kids[3].className).toContain("axv-list");
  });

  it("组件面板里新加的 9 个磁贴都能解析（无 error 级问题）", () => {
    const keys = ["absolute", "table", "table_row", "button_bar", "expandable_list", "number_picker", "date_picker", "time_picker", "frame"];
    for (const k of keys) {
      const w = WIDGETS.find((x) => x.key === k)!;
      const { root, issues } = parseLayoutXml(w.xml);
      expect({ key: k, ok: !!root, errs: issues.filter((i) => i.level === "error").length }).toEqual({ key: k, ok: true, errs: 0 });
    }
  });
});
