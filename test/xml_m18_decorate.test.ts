// @vitest-environment jsdom
// M18：run-decorate 的结构行为（jsdom 没有布局，所以只断言 DOM/属性/文字这些确定的点）
import { beforeEach, describe, expect, it } from "vitest";
import { decorateRunScreen, type DecorateHooks } from "../components/run-decorate";
import { parseLayoutXml } from "../lib/xml/parser";

function hooks() {
  const logs: string[] = [];
  const toasts: string[] = [];
  const taps: string[] = [];
  const h: DecorateHooks = {
    log: (_lv, msg) => logs.push(msg),
    tap: (p) => taps.push(p),
    toast: (t) => toasts.push(t),
  };
  return { h, logs, toasts, taps };
}

function wrap(inner: string) {
  return `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
      android:layout_width="match_parent" android:layout_height="match_parent">${inner}</LinearLayout>`;
}

/** 造一个「已渲染」的小画布：节点带 data-tag / data-path，跟 XmlCanvas 的输出对齐 */
function build(inner: string) {
  const parsed = parseLayoutXml(wrap(inner));
  if (!parsed.root) throw new Error("parse failed");
  const root = document.createElement("div");
  document.body.appendChild(root);
  const make = (tag: string, path: string, text = "") => {
    const el = document.createElement("div");
    el.dataset.tag = tag;
    el.dataset.path = path;
    el.textContent = text;
    root.appendChild(el);
    return el;
  };
  return { root, make, parsed };
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("M18 run-decorate：输入框", () => {
  it("hint 变成占位符、可编辑、聚焦能记日志", () => {
    const { root, make, parsed } = build(
      `<EditText android:id="@+id/et" android:layout_width="match_parent"
        android:layout_height="wrap_content" android:hint="请输入手机号"/>`,
    );
    const et = make("EditText", "#0/0", "请输入手机号");
    const { h, logs } = hooks();
    decorateRunScreen(root, parsed.root, h);

    // hint 不再当正文画，改挂 data-run-hint 由 CSS ::before 显示
    expect(et.textContent).toBe("");
    expect(et.dataset.runHint).toBe("请输入手机号");
    expect(et.classList.contains("axv-run-input-empty")).toBe(true);
    expect(["plaintext-only", "true"]).toContain(et.getAttribute("contenteditable"));

    et.dispatchEvent(new FocusEvent("focus"));
    expect(logs.some((l) => l.includes("聚焦") && l.includes("EditText#et"))).toBe(true);
  });
});

describe("M18 run-decorate：勾选类", () => {
  it("CheckBox 点一下切换 data-run-checked，并记日志", () => {
    const { root, make, parsed } = build(
      `<CheckBox android:id="@+id/cb" android:layout_width="wrap_content"
        android:layout_height="wrap_content" android:checked="true"/>`,
    );
    const cb = make("CheckBox", "#0/0");
    const { h, logs } = hooks();
    decorateRunScreen(root, parsed.root, h);
    expect(cb.dataset.runChecked).toBe("1");

    cb.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(cb.dataset.runChecked).toBe("0");
    expect(logs.some((l) => l.includes("取消选中"))).toBe(true);
  });

  it("RadioButton 点击会把同组兄弟关掉", () => {
    const { root, make, parsed } = build(
      `<RadioButton android:id="@+id/a" android:layout_width="wrap_content" android:layout_height="wrap_content" android:checked="true"/>
       <RadioButton android:id="@+id/b" android:layout_width="wrap_content" android:layout_height="wrap_content"/>`,
    );
    const group = document.createElement("div");
    root.appendChild(group);
    const a = document.createElement("div");
    a.dataset.tag = "RadioButton";
    a.dataset.path = "#0/0";
    const b = document.createElement("div");
    b.dataset.tag = "RadioButton";
    b.dataset.path = "#0/1";
    group.append(a, b);

    const { h } = hooks();
    decorateRunScreen(root, parsed.root, h);
    expect(a.dataset.runChecked).toBe("1");
    expect(b.dataset.runChecked).toBe("0");

    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(b.dataset.runChecked).toBe("1");
    expect(a.dataset.runChecked).toBe("0");
  });
});

describe("M18 run-decorate：列表 / 网格", () => {
  it("ListView 无子项时注入 8 行，点第 3 行记 onItemClick", () => {
    const { root, make, parsed } = build(
      `<ListView android:id="@+id/lv" android:layout_width="match_parent" android:layout_height="match_parent"/>`,
    );
    const lv = make("ListView", "#0/0");
    const { h, logs } = hooks();
    decorateRunScreen(root, parsed.root, h);

    expect(lv.querySelectorAll(".axv-run-row")).toHaveLength(8);
    expect(lv.classList.contains("axv-run-list")).toBe(true);
    // XML 的 display 是行内样式，必须 inline 覆盖回来
    expect(lv.style.display).toBe("block");

    const row = lv.querySelectorAll<HTMLElement>(".axv-run-row")[2];
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(row.classList.contains("on")).toBe(true);
    expect(logs.some((l) => l.includes("position=2"))).toBe(true);
  });

  it("GridView 走两列网格（inline display:grid）", () => {
    const { root, make, parsed } = build(
      `<GridView android:id="@+id/gv" android:layout_width="match_parent" android:layout_height="match_parent"/>`,
    );
    const gv = make("GridView", "#0/0");
    const { h } = hooks();
    decorateRunScreen(root, parsed.root, h);

    expect(gv.classList.contains("axv-run-grid")).toBe(true);
    expect(gv.style.display).toBe("grid");
    expect(gv.style.gridTemplateColumns).toBe("1fr 1fr");
    expect(gv.querySelectorAll(".axv-run-row")).toHaveLength(4);
  });

  it("写了子项的列表：每行可点，不再注入假数据", () => {
    const { root, make, parsed } = build(
      `<ListView android:layout_width="match_parent" android:layout_height="match_parent"/>`,
    );
    const lv = make("ListView", "#0/0");
    const a = document.createElement("div");
    a.textContent = "第一行";
    const b = document.createElement("div");
    b.textContent = "第二行";
    lv.append(a, b);

    const { h, logs } = hooks();
    decorateRunScreen(root, parsed.root, h);

    expect(lv.querySelectorAll(".axv-run-row")).toHaveLength(0);
    expect(a.dataset.runIndex).toBe("0");
    b.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(b.classList.contains("on")).toBe(true);
    expect(logs.some((l) => l.includes("position=1"))).toBe(true);
  });
});

describe("M18 run-decorate：Spinner", () => {
  it("点开弹 3 个候选，选中后回填文字 + toast", () => {
    const { root, make, parsed } = build(
      `<Spinner android:id="@+id/sp" android:layout_width="match_parent" android:layout_height="wrap_content"/>`,
    );
    const sp = make("Spinner", "#0/0");
    const { h, logs, toasts } = hooks();
    decorateRunScreen(root, parsed.root, h);

    sp.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const menu = root.querySelector(".axv-run-popup");
    expect(menu).toBeTruthy();
    expect(menu!.querySelectorAll(".axv-run-popup-item")).toHaveLength(3);
    expect(menu!.getAttribute("style")).toContain("left:");

    menu!.querySelectorAll<HTMLElement>(".axv-run-popup-item")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(sp.textContent).toContain("选项二");
    expect(toasts).toContain("已选择：选项二");
    expect(logs.some((l) => l.includes("选择") && l.includes("选项二"))).toBe(true);
  });

  it("android:entries 写了就用自己的选项", () => {
    const { root, make, parsed } = build(
      `<Spinner android:id="@+id/sp" android:layout_width="match_parent" android:layout_height="wrap_content"
        android:entries="北京,上海,广州"/>`,
    );
    const sp = make("Spinner", "#0/0");
    const { h } = hooks();
    decorateRunScreen(root, parsed.root, h);
    sp.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const items = Array.from(root.querySelectorAll(".axv-run-popup-item")).map((n) => n.textContent);
    expect(items).toEqual(["北京", "上海", "广州"]);
  });
});

describe("M18 run-decorate：统计 / 清理", () => {
  it("interactive 只数能操作的控件（ImageView 这类不算）", () => {
    const { root, make, parsed } = build(
      `<TextView android:layout_width="wrap_content" android:layout_height="wrap_content"/>
       <Button android:id="@+id/b" android:layout_width="wrap_content" android:layout_height="wrap_content"/>
       <ImageView android:layout_width="wrap_content" android:layout_height="wrap_content"/>`,
    );
    make("TextView", "#0/0", "说明文字");
    make("Button", "#0/1", "确定");
    make("ImageView", "#0/2");
    const { h } = hooks();
    const r = decorateRunScreen(root, parsed.root, h);
    // TextView + Button 可点，ImageView 不在可交互清单里
    expect(r.interactive).toBe(2);
  });

  it("cleanup 之后按钮不再有涟漪节点", () => {
    const { root, make, parsed } = build(
      `<Button android:id="@+id/b" android:layout_width="wrap_content" android:layout_height="wrap_content"/>`,
    );
    const btn = make("Button", "#0/0", "确定");
    const { h } = hooks();
    const r = decorateRunScreen(root, parsed.root, h);
    r.cleanup();

    btn.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(root.querySelector(".axv-run-ripple")).toBeNull();
  });
});
