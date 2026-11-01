// @vitest-environment jsdom
// test/xml_m66_res_values_panel.test.tsx — M66（C1）：资源值面板
//
// 一页列出 res/values*/ 下所有 string/color/dimen，就地改值 → 直接写回原文件；
// 新建走 values/strings.xml|colors.xml|dimens.xml，文件不存在就现建。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ResValuesPanel } from "@/components/ResValuesPanel";
import { clearResIndex } from "@/lib/xml/res-index";
import type { AiFileIo } from "@/lib/xml/ai-tools";

const RES = "app/src/main/res";

const strings = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">示例</string>
    <string name="ok">确定</string>
</resources>
`;
const colors = `<resources>
    <color name="brand">#FF112233</color>
</resources>
`;

let files: Record<string, string> = {};
const writes: { rel: string; text: string }[] = [];

const dirs: Record<string, string[]> = {
  [RES]: ["values", "layout"],
  [`${RES}/values`]: ["strings.xml", "colors.xml"],
  [`${RES}/layout`]: ["activity_main.xml"],
};

function makeIo(): AiFileIo {
  return {
    rootLabel: () => "/proj",
    async list(rel) {
      const names = dirs[rel];
      if (!names) return { ok: false, error: "目录不存在" };
      return {
        ok: true,
        items: names.map((n) => ({ kind: n.includes(".") ? ("file" as const) : ("dir" as const), name: n, rel: `${rel}/${n}` })),
      };
    },
    async read(rel) {
      const t = files[rel];
      return t === undefined ? { ok: false as const, error: "没有这个文件" } : { ok: true as const, text: t };
    },
    async write(rel, text) {
      writes.push({ rel, text });
      files[rel] = text;
      return { ok: true as const };
    },
  };
}

const flush = async (n = 8) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;

async function mount() {
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ResValuesPanel io={makeIo()} docRel={`${RES}/layout/activity_main.xml`} />);
  await flush(12);
  return host;
}

const rows = () => [...document.querySelectorAll(".axv-rv-row")] as HTMLElement[];
const rowByName = (name: string) => rows().find((r) => (r.querySelector(".axv-rv-name")?.textContent || "") === name)!;

function typeInto(el: HTMLInputElement, v: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

beforeEach(() => {
  files = { [`${RES}/values/strings.xml`]: strings, [`${RES}/values/colors.xml`]: colors };
  writes.length = 0;
  clearResIndex();
});

afterEach(() => {
  root?.unmount();
  root = null;
});

describe("M66 资源值面板", () => {
  it("列出所有 values 条目并显示计数", async () => {
    const el = await mount();
    expect(rows().length).toBe(3);
    expect(el.querySelector(".axv-rv-count")!.textContent).toContain("3 条");
    expect(el.querySelector(".axv-rv-count")!.textContent).toContain("2 个文件");
  });

  it("改值 → 只替换该条目，注释与其余行原样保留，并写回原文件", async () => {
    await mount();
    const row = rowByName("app_name");
    const input = row.querySelector(".axv-rv-value") as HTMLInputElement;
    typeInto(input, "新名字");
    // React 的 onBlur 走根节点的 focusout 委托，直接派发 blur 不会触发
    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await flush(16);

    expect(writes.length).toBe(1);
    expect(writes[0].rel).toBe(`${RES}/values/strings.xml`);
    expect(writes[0].text).toContain('<string name="app_name">新名字</string>');
    expect(writes[0].text).toContain('<string name="ok">确定</string>');
    expect(writes[0].text).toContain('<?xml version="1.0" encoding="utf-8"?>');
  });

  it("搜索按名称过滤", async () => {
    await mount();
    const q = document.querySelector(".axv-rv-q") as HTMLInputElement;
    typeInto(q, "brand");
    await flush(4);
    expect(rows().length).toBe(1);
    expect(rows()[0].textContent).toContain("brand");
  });

  it("类型筛选只显示字符串", async () => {
    await mount();
    const kindBtns = [...document.querySelectorAll(".axv-rv-kind")] as HTMLButtonElement[];
    kindBtns.find((b) => b.textContent!.startsWith("字符串"))!.click();
    await flush(4);
    expect(rows().length).toBe(2);
  });

  it("删除条目 → 写入文件且行消失", async () => {
    await mount();
    const row = rowByName("ok");
    (row.querySelector(".axv-rv-ic.del") as HTMLButtonElement).click();
    await flush(16);
    expect(writes[0].text).not.toContain('name="ok"');
    expect(rowByName("ok")).toBeUndefined();
  });

  it("新建字符串 → 落到 values/strings.xml 并保留原有条目", async () => {
    await mount();
    (document.querySelectorAll(".axv-rv-btn")[1] as HTMLButtonElement).click();
    await flush(2);
    const inputs = [...document.querySelectorAll(".axv-rv-new .axv-rv-in")] as HTMLInputElement[];
    typeInto(inputs[0], "subtitle");
    typeInto(inputs[1], "副标题");
    (document.querySelector(".axv-rv-ok") as HTMLButtonElement).click();
    await flush(20);

    const w = writes.find((x) => x.text.includes("subtitle"))!;
    expect(w.rel).toBe(`${RES}/values/strings.xml`);
    expect(w.text).toContain('<string name="subtitle">副标题</string>');
    expect(w.text).toContain('<string name="app_name">示例</string>');
    expect(rowByName("subtitle")).toBeTruthy();
  });

  it("非法资源名被拦下，不写文件", async () => {
    await mount();
    (document.querySelectorAll(".axv-rv-btn")[1] as HTMLButtonElement).click();
    await flush(2);
    const inputs = [...document.querySelectorAll(".axv-rv-new .axv-rv-in")] as HTMLInputElement[];
    typeInto(inputs[0], "1bad-name");
    typeInto(inputs[1], "x");
    (document.querySelector(".axv-rv-ok") as HTMLButtonElement).click();
    await flush(10);
    expect(writes.length).toBe(0);
    expect(document.querySelector(".axv-rv-msg")!.textContent).toContain("资源名");
  });

  it("没传 io 时提示先打开项目", async () => {
    document.body.innerHTML = "";
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(<ResValuesPanel io={null} docRel={null} />);
    await flush(4);
    expect(host.textContent).toContain("先打开一个项目目录");
  });
});
