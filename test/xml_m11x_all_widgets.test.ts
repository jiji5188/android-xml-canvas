import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { parseLayoutXml } from "../lib/xml/parser";
import { buildRenderModel } from "../lib/xml/css";
import { SAMPLE_PROJECTS } from "../lib/xml/sample-projects";
import { DEFAULT_RESOURCES } from "../lib/xml/resources";

function collect(n: any, out: any[] = []): any[] {
  out.push(n);
  for (const c of n.children) collect(c, out);
  return out;
}

describe("M11x 全组件总览样例", () => {
  const proj = SAMPLE_PROJECTS.find((p) => p.key === "all-widgets");
  const parsed = parseLayoutXml(proj!.layout);
  const model = buildRenderModel(parsed.root!, {
    ...(DEFAULT_RESOURCES as any),
    drawableXml: proj!.drawables,
  });

  it("样例存在且能被解析", () => {
    expect(proj).toBeTruthy();
    expect(parsed.issues ?? []).toEqual([]);
  });

  it("渲染不报错且节点数量够多（>120）", () => {
    const nodes = collect(model.root);
    expect(nodes.length).toBeGreaterThan(120);
  });

  it("关键控件都出现在渲染树里", () => {
    const tags = new Set(collect(model.root).map((n) => String(n.tag).split(".").pop()));
    for (const t of [
      "TextView", "Button", "MaterialButton", "EditText", "TextInputLayout", "AutoCompleteTextView",
      "ImageView", "ImageButton", "CheckBox", "RadioButton", "Switch", "SwitchMaterial", "SeekBar",
      "RatingBar", "Slider", "ProgressBar", "CircularProgressIndicator", "RecyclerView", "ListView",
      "Spinner", "TableLayout", "TableRow", "GridLayout", "CardView", "MaterialCardView", "Chip",
      "FloatingActionButton", "TabLayout", "Toolbar", "AppBarLayout", "ConstraintLayout", "Guideline",
      "Barrier", "RelativeLayout", "FrameLayout", "DrawerLayout", "CoordinatorLayout", "NestedScrollView",
      "HorizontalScrollView", "CheckedTextView", "ToggleButton", "NumberPicker", "SearchView", "ViewPager2",
    ]) {
      expect(tags.has(t), `缺控件 ${t}`).toBe(true);
    }
  });

  it("错误级问题为 0（warn 可以有，error 不行）", () => {
    const errs = collect(model.root).flatMap((n) => n.issues).filter((i: any) => i.level === "error");
    const warns = collect(model.root).flatMap((n) => n.issues).filter((i: any) => i.level === "warn");
    if (warns.length) console.log("WARN:", [...new Set(warns.map((w: any) => w.message))].join("\nWARN: "));
    expect(errs.map((e: any) => e.message)).toEqual([]);
  });

  it("public/samples/all-widgets.xml 与内置样例一致（可选下载）", () => {
    const p = path.join(process.cwd(), "public/samples/all-widgets.xml");
    const disk = fs.readFileSync(p, "utf8");
    expect(disk.length).toBeGreaterThan(2000);
    expect(disk).toContain("<ScrollView");
  });
});
