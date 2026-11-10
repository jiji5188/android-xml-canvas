import { describe, it, expect } from "vitest";
import { extractJavaSymbols } from "@/lib/xml/java-symbols";

describe("M210b 基本类型数组声明", () => {
  const src = `
public class AutoFitRecyclerView extends RecyclerView {
    private int columnWidth;
    private GridLayoutManager layoutManager;

    public AutoFitRecyclerView(Context context, AttributeSet attrs) {
        super(context, attrs);
        init(context, attrs);
    }

    private void init(Context context, AttributeSet attrs) {
        if (attrs != null) {
            int[] attrsArray = { android.R.attr.columnWidth };
            TypedArray array = context.obtainStyledAttributes(attrs, attrsArray);
            columnWidth = array.getDimensionPixelSize(0, -1);
            array.recycle();
        }
        layoutManager = new GridLayoutManager(getContext(), 1);
        setLayoutManager(layoutManager);
    }
}`;

  it("int[] 局部变量要收进来", () => {
    const sy = extractJavaSymbols(src);
    expect(sy.declared.has("attrsArray")).toBe(true);
  });

  it("字段 / 参数 / 其他局部变量都不漏", () => {
    const sy = extractJavaSymbols(src);
    for (const n of ["columnWidth", "layoutManager", "context", "attrs", "array"]) {
      expect(sy.declared.has(n)).toBe(true);
    }
  });

  it("其他基本类型数组声明也收", () => {
    const sy = extractJavaSymbols(`class A { void f() { char[] cs = {}; long[] ls = {}; boolean[] bs = {}; } }`);
    expect(sy.declared.has("cs")).toBe(true);
    expect(sy.declared.has("ls")).toBe(true);
    expect(sy.declared.has("bs")).toBe(true);
  });

  it("多维数组声明也收", () => {
    const sy = extractJavaSymbols(`class A { void f() { int[][] grid = {}; } }`);
    expect(sy.declared.has("grid")).toBe(true);
  });
});
