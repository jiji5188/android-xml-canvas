// @vitest-environment jsdom
// M52：① 选择资源颜色 tab 的色块旁直接一条透明度滑杆（拖动只写回不关弹窗）
//      ② 自定义形状的填充色 / 涟漪色旁同款滑杆
import { describe, it, expect, beforeEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { DrawablePicker } from "@/components/DrawablePicker";
import { ShapeEditor } from "@/components/ShapeEditor";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement;

beforeEach(() => {
  if (root) root.unmount();
  root = null;
  document.body.innerHTML = "";
  host = document.createElement("div");
  document.body.appendChild(host);
});

async function mount(el: React.ReactElement) {
  root = createRoot(host);
  root.render(el);
  await flush();
}

/** React 受控 input 在 jsdom 里必须用原型 setter + input 事件 */
function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value");
  if (desc && desc.set) desc.set.call(el, v);
  else el.value = v;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function rangeByLabel(label: string): HTMLInputElement {
  const el = document.querySelector(`input[type="range"][aria-label="${label}"]`);
  expect(el, `找不到滑杆 ${label}`).toBeTruthy();
  return el as HTMLInputElement;
}

const noop = () => {};

const picker = (props: Partial<React.ComponentProps<typeof DrawablePicker>> = {}) => (
  <DrawablePicker attrName="background" value="#FF0000" onEditShape={noop} onCommit={noop} onClose={noop} {...props} />
);

describe("M52 选择资源弹窗：透明度滑杆", () => {
  it("滑杆默认值 = 当前颜色的 alpha（#80FF0000 → 50%）", async () => {
    await mount(picker({ value: "#80FF0000" }));
    expect(rangeByLabel("不透明度").value).toBe("50");
  });

  it("不透明色当 100%", async () => {
    await mount(picker({ value: "#FF0000" }));
    expect(rangeByLabel("不透明度").value).toBe("100");
  });

  it("拖到 50% → onApply 写回 #80RRGGBB，且不调用 onCommit（弹窗不关）", async () => {
    const applied: string[] = [];
    const committed: string[] = [];
    await mount(
      picker({ onApply: (v) => applied.push(v), onCommit: (v) => committed.push(v) }),
    );
    setInputValue(rangeByLabel("不透明度"), "50");
    await flush();
    expect(applied).toEqual(["#80FF0000"]);
    expect(committed).toEqual([]);
  });

  it("拖回 100% → 省掉 FF，写 #RRGGBB", async () => {
    const applied: string[] = [];
    await mount(picker({ value: "#80FF0000", onApply: (v) => applied.push(v) }));
    setInputValue(rangeByLabel("不透明度"), "100");
    await flush();
    expect(applied).toEqual(["#FF0000"]);
  });

  it("非颜色值（@drawable/x）滑杆置灰，不改值", async () => {
    const applied: string[] = [];
    await mount(picker({ value: "@drawable/x", onApply: (v) => applied.push(v) }));
    expect(rangeByLabel("不透明度").disabled).toBe(true);
    expect(applied).toEqual([]);
  });

  it("点色板仍然写回并关闭（走 onCommit）", async () => {
    const committed: string[] = [];
    await mount(picker({ onCommit: (v) => committed.push(v), onApply: noop }));
    const sw = document.querySelector('.axv-dp-swatch[title="#00C853"]') as HTMLButtonElement;
    expect(sw).toBeTruthy();
    sw.click();
    await flush();
    expect(committed).toEqual(["#00C853"]);
  });
});

describe("M52 自定义形状：透明度滑杆", () => {
  const shape = () => (
    <ShapeEditor attrName="background" value="" existingNames={[]} onClose={noop} onSave={noop} />
  );

  const solidInput = () =>
    [...document.querySelectorAll("input")].find((i) =>
      i.getAttribute("placeholder")?.includes("#80FFFFFF"),
    ) as HTMLInputElement;

  it("填充色滑杆 → 写回 #AARRGGBB（30% → #4DFFFFFF）", async () => {
    await mount(shape());
    setInputValue(rangeByLabel("填充不透明度"), "30");
    await flush();
    expect(solidInput().value.toUpperCase()).toBe("#4DFFFFFF");
  });

  it("输入带 alpha 的色值后，滑杆跟着变（#33FF0000 → 20%）", async () => {
    await mount(shape());
    setInputValue(solidInput(), "#33FF0000");
    await flush();
    expect(rangeByLabel("填充不透明度").value).toBe("20");
  });

  it("涟漪色也有滑杆（#33FFFFFF → 20%）", async () => {
    await mount(shape());
    const boxes = [...document.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    const ripple = boxes.find((b) => b.parentElement?.textContent?.includes("水波纹"));
    if (ripple && !ripple.checked) {
      ripple.click();
      await flush();
    }
    const sl = document.querySelector('input[type="range"][aria-label="涟漪不透明度"]') as HTMLInputElement;
    expect(sl).toBeTruthy();
    expect(sl.value).toBe("20");
  });
});
