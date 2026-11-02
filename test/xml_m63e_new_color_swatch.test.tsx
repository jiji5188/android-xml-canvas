// @vitest-environment jsdom
// test/xml_m63e_new_color_swatch.test.tsx — 新建资源：类型选「颜色」时值前面出现取色按钮
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { ValuesEditor } from "@/components/ValuesEditor";

const flush = async () => {
  await Promise.resolve();
  await new Promise<void>((r) => setTimeout(r, 0));
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  if (root) root.unmount();
  document.body.innerHTML = "";
  root = null;
  host = null;
});

const XML = `<resources>\n    <string name="app_name">Demo</string>\n</resources>`;

async function openNewRow() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ValuesEditor xml={XML} onChange={() => {}} />);
  await flush();
  await flush();
  (document.querySelector(".axv-val-add") as HTMLButtonElement).click();
  await flush();
  await flush();
  return document.querySelector(".axv-val-new") as HTMLElement;
}

function pickType(tag: string) {
  const sel = document.querySelector(".axv-val-new select") as HTMLSelectElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
  setter?.call(sel, tag);
  sel.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("新建资源：颜色的取色按钮", () => {
  it("默认类型（字符串）没有取色按钮", async () => {
    const row = await openNewRow();
    expect(row).not.toBeNull();
    expect(row.querySelector(".axv-cf-swatch")).toBeNull();
  });

  it("选「颜色」后出现取色按钮，且在「新资源值」输入框前面", async () => {
    const row = await openNewRow();
    pickType("color");
    await flush();

    const swatch = row.querySelector(".axv-cf-swatch");
    expect(swatch).not.toBeNull();
    const valueInput = row.querySelector('input[aria-label="新资源值"]') as HTMLInputElement;
    expect(valueInput).not.toBeNull();
    // DOM 顺序：取色按钮在值输入框之前
    const pos = swatch!.compareDocumentPosition(valueInput);
    expect(pos & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("点取色按钮弹出取色器，选预设色后写进「新资源值」", async () => {
    const row = await openNewRow();
    pickType("color");
    await flush();
    (row.querySelector(".axv-cf-swatch") as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(document.querySelector(".axv-cp-mask")).not.toBeNull();

    // 第 3 个预设 = #E74C3C
    (document.querySelectorAll(".cp-preset")[2] as HTMLDivElement).click();
    await flush();
    (document.querySelector(".cp-confirm") as HTMLButtonElement).click();
    await flush();
    const valueInput = row.querySelector('input[aria-label="新资源值"]') as HTMLInputElement;
    expect(valueInput.value.toUpperCase()).toBe("#E74C3C");
  });

  it("切回字符串后取色按钮消失", async () => {
    const row = await openNewRow();
    pickType("color");
    await flush();
    expect(row.querySelector(".axv-cf-swatch")).not.toBeNull();
    pickType("string");
    await flush();
    expect(row.querySelector(".axv-cf-swatch")).toBeNull();
  });
});
