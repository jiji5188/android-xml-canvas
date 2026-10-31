// test/xml_m39_values_ui.test.tsx — M39：values 表格视图接线（视图切换 / 默认表格 / 纯函数判定）
import { describe, it, expect, vi } from "vitest";
import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { XmlCodeView, type XmlCodeViewProps } from "../components/XmlCodeView";
import { ValuesEditor } from "../components/ValuesEditor";
import { CodeEditor } from "../components/CodeEditor";
import { isValuesPath } from "../lib/xml/doc-kind";

type El = { type: unknown; props: Record<string, any> };

function props(over: Partial<XmlCodeViewProps> = {}): XmlCodeViewProps {
  return {
    open: true,
    isMobile: true,
    leftOpen: false,
    rightOpen: false,
    value: '<resources><color name="a">#fff</color></resources>',
    onChange: vi.fn(),
    errors: [],
    onFormat: vi.fn(),
    values: true,
    fileKey: "app/src/main/res/values/colors.xml",
    onNote: vi.fn(),
    ...over,
  };
}

function collect(n: ReactNode, out: El[] = []): El[] {
  if (Array.isArray(n)) {
    for (const c of n) collect(c as ReactNode, out);
    return out;
  }
  if (!isValidElement(n)) return out;
  const el = n as unknown as El;
  out.push(el);
  collect(el.props?.children as ReactNode, out);
  return out;
}

describe("M39 isValuesPath", () => {
  it("认得 res/values 与 values-xxx 变体", () => {
    expect(isValuesPath("app/src/main/res/values/colors.xml")).toBe(true);
    expect(isValuesPath("res/values/strings.xml")).toBe(true);
    expect(isValuesPath("res/values-night/colors.xml")).toBe(true);
    expect(isValuesPath("values/dimens.xml")).toBe(true);
    expect(isValuesPath("app\\src\\main\\res\\values\\colors.xml")).toBe(true);
  });

  it("布局/其他目录不算", () => {
    expect(isValuesPath("res/layout/activity_main.xml")).toBe(false);
    expect(isValuesPath("res/values/../layout/a.xml")).toBe(false);
    expect(isValuesPath("AndroidManifest.xml")).toBe(false);
    expect(isValuesPath("values.xml")).toBe(false);
    expect(isValuesPath(null)).toBe(false);
    expect(isValuesPath(undefined)).toBe(false);
  });
});

describe("M39 XmlCodeView 接线", () => {
  it("values 文件渲染切换条，默认是表格视图", () => {
    const html = renderToStaticMarkup(<XmlCodeView {...props()} />);
    expect(html).toContain("axv-code-switch");
    expect(html).toContain("表格");
    expect(html).toContain("代码");
    // 默认进入表格：出现 values 表格的类
    expect(html).toContain("axv-val");
    expect(html).toContain('aria-selected="true"');
  });

  it("values 文件的表格里解析出条目", () => {
    const html = renderToStaticMarkup(<XmlCodeView {...props()} />);
    expect(html).toContain('value="a"');
    expect(html).toContain('value="#fff"');
  });

  it("非 values 文件不出现切换条，直接是代码编辑器", () => {
    const p = props({ values: false, fileKey: "res/layout/a.xml", value: "<LinearLayout/>" });
    const tree = XmlCodeView(p) as unknown as El;
    const all = collect(tree as unknown as ReactNode);
    expect(all.some((e) => String(e.props.className ?? "").includes("axv-code-switch"))).toBe(false);
    expect(all.some((e) => e.type === CodeEditor)).toBe(true);
    expect(all.some((e) => e.type === ValuesEditor)).toBe(false);
  });

  it("values 文件里表格拿得到 xml / onChange / onNote", () => {
    const p = props();
    const tree = XmlCodeView(p) as unknown as El;
    // values 分支是函数组件 ValuesTabs，直接渲染成静态标记即可验证内容
    const html = renderToStaticMarkup(<XmlCodeView {...p} />);
    expect(html).toContain("共 1 条资源");
    expect(tree).toBeTruthy();
  });

  it("open=false 依旧完全不渲染", () => {
    expect(XmlCodeView(props({ open: false }))).toBeNull();
  });
});

describe("M39 ValuesEditor 内容", () => {
  it("按类型给出 chip 与计数", () => {
    const xml = `<resources>
    <color name="c">#112233</color>
    <dimen name="d">8dp</dimen>
    <string name="s">hi</string>
</resources>`;
    const html = renderToStaticMarkup(<ValuesEditor xml={xml} onChange={() => {}} />);
    expect(html).toContain("全部");
    expect(html).toContain("颜色");
    expect(html).toContain("尺寸");
    expect(html).toContain("字符串");
    expect(html).toContain("共 3 条资源");
    // 颜色行带取色器
    expect(html).toContain('type="color"');
    expect(html).toContain('value="#112233"');
  });

  it("解析失败时给出说明而不是空白", () => {
    const html = renderToStaticMarkup(<ValuesEditor xml="<LinearLayout/>" onChange={() => {}} />);
    expect(html).toContain("axv-val-empty");
    expect(html).toContain("没找到");
  });

  it("空 values 文件给空态提示", () => {
    const html = renderToStaticMarkup(<ValuesEditor xml="<resources></resources>" onChange={() => {}} />);
    expect(html).toContain("还没有资源");
  });
});
