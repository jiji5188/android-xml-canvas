// @vitest-environment jsdom
// test/xml_m63d_values_swatch.test.tsx — values 资源表的取色块改用自定义 HSV 取色器
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
  if (host) host.remove();
  document.body.innerHTML = "";
  root = null;
  host = null;
});

const XML = `<resources>
    <color name="brand">#80FF0000</color>
</resources>`;

async function mount(onChange = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(<ValuesEditor xml={XML} onChange={onChange} />);
  await flush();
  await flush();
  return onChange;
}

describe("values 资源表取色", () => {
  it("用 ColorField（不是原生 input[type=color]）", async () => {
    await mount();
    expect(document.querySelector("input.axv-val-swatch")).toBeNull();
    expect(document.querySelector(".axv-val-row .axv-cf-swatch")).not.toBeNull();
  });

  it("点色块弹出居中蒙版取色器", async () => {
    await mount();
    (document.querySelector(".axv-cf-swatch") as HTMLButtonElement).click();
    await flush();
    await flush();
    expect(document.querySelector(".axv-cf-mask")).not.toBeNull();
    expect(document.querySelector(".axv-hsv-panel")).not.toBeNull();
  });

  it("把透明度调到 100% → 写回 #RRGGBB（大写、不带 alpha）", async () => {
    const onChange = await mount();
    (document.querySelector(".axv-cf-swatch") as HTMLButtonElement).click();
    await flush();
    await flush();

    const alpha = document.querySelector(".axv-hsv-alpha") as HTMLInputElement;
    expect(alpha).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(alpha, "100");
    alpha.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls.at(-1)?.[0] as string;
    expect(next).toContain("#FF0000");
    expect(next).not.toContain("#80FF0000");
  });

  it("@color/ 引用不显示取色块", async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    root.render(
      <ValuesEditor xml={`<resources>\n    <color name="brand">@color/base</color>\n</resources>`} onChange={() => {}} />,
    );
    await flush();
    expect(document.querySelector(".axv-cf-swatch")).toBeNull();
  });
});
