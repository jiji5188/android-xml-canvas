// M118：drawable 预览点击/触摸演示（ripple + selector 状态切换）
// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { DrawablePreview } from "@/components/DrawablePreview";
import { parseDrawable } from "@/lib/xml/drawable-node";

const NS = `xmlns:android="http://schemas.android.com/apk/res/android"`;

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement;

async function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(el);
  await flush();
}

function pointerDown(el: Element) {
  el.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 }));
}
function pointerUp(el: Element) {
  el.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
}

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  if (root) {
    root.unmount();
    root = null;
  }
  document.body.innerHTML = "";
});

describe("M118 DrawablePreview 交互预览", () => {
  it("ripple：常态没有波纹层，按下出现，松开淡出", async () => {
    const doc = parseDrawable(`<ripple ${NS} android:color="#33FF0000">
      <item><shape android:shape="rectangle"><solid android:color="#FF112233"/></shape></item>
    </ripple>`)!;
    await mount(<DrawablePreview doc={doc} width={200} height={100} />);

    const box = host.querySelector(".axv-dp-box")!;
    expect(box).toBeTruthy();
    expect(host.querySelector(".axv-dp-ripple")).toBeNull();

    pointerDown(box);
    await flush();
    const ripple = host.querySelector(".axv-dp-ripple");
    expect(ripple, "按下后应出现波纹").toBeTruthy();
    expect(ripple!.classList.contains("is-on")).toBe(true);
    // 波纹色来自 ripple 的 android:color（#33FF0000 → 20% 不透明的红）
    expect((ripple as HTMLElement).style.background).toContain("rgba(255, 0, 0");
    // 状态徽标
    expect(host.querySelector(".axv-dp-badge")!.textContent).toBe("按下");

    pointerUp(box);
    await flush();
    expect(host.querySelector(".axv-dp-ripple")!.classList.contains("is-fading")).toBe(true);
  });

  it("selector：按下切到 state_pressed 那支（不是同一形状换色）", async () => {
    const doc = parseDrawable(`<selector ${NS}>
      <item android:state_pressed="true">
        <layer-list>
          <item><shape android:shape="rectangle"><solid android:color="#FF0000FF"/></shape></item>
          <item><shape android:shape="oval"><solid android:color="#FFFF0000"/></shape></item>
        </layer-list>
      </item>
      <item><shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape></item>
    </selector>`)!;
    await mount(<DrawablePreview doc={doc} width={200} height={100} />);

    const layers = () => Array.from(host.querySelectorAll(".axv-dp-layer"));
    expect(layers().length).toBe(1);
    expect(layers()[0].getAttribute("data-path")).toContain("state");

    pointerDown(host.querySelector(".axv-dp-box")!);
    await flush();
    expect(layers().length, "pressed 态是两层（layer-list）").toBe(2);
    expect(layers()[1].getAttribute("data-path")).toContain("item#1");
  });

  it("禁用开关：切到 state_enabled=false 那支", async () => {
    const doc = parseDrawable(`<selector ${NS}>
      <item android:state_enabled="false">
        <shape android:shape="rectangle"><solid android:color="#FF999999"/></shape>
      </item>
      <item><shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape></item>
    </selector>`)!;
    await mount(<DrawablePreview doc={doc} width={200} height={100} />);

    const layerBg = () => (host.querySelector(".axv-dp-layer") as HTMLElement).style.background;
    expect(layerBg()).toContain("rgb(255, 255, 255");

    const toggle = Array.from(host.querySelectorAll<HTMLButtonElement>(".axv-dp-toggle")).find(
      (b) => b.textContent === "禁用",
    )!;
    toggle.click();
    await flush();
    expect(toggle.classList.contains("on")).toBe(true);
    expect(layerBg()).toContain("rgb(153, 153, 153");
  });

  it("禁用后按下不再触发按压态", async () => {
    const doc = parseDrawable(`<selector ${NS}>
      <item><shape android:shape="rectangle"><solid android:color="#FFFFFFFF"/></shape></item>
    </selector>`)!;
    await mount(<DrawablePreview doc={doc} width={200} height={100} />);

    const toggle = host.querySelector<HTMLButtonElement>(".axv-dp-toggle")!;
    toggle.click();
    await flush();
    pointerDown(host.querySelector(".axv-dp-box")!);
    await flush();
    expect(host.querySelector(".axv-dp-badge")!.textContent).toBe("常态");
  });

  it("unsupported 层画虚线占位，不假装能渲染", async () => {
    const doc = parseDrawable(`<layer-list ${NS}>
      <item><animated-vector android:drawable="@drawable/x"/></item>
      <item><shape android:shape="oval"/></item>
    </layer-list>`)!;
    await mount(<DrawablePreview doc={doc} width={200} height={100} />);
    const unknown = host.querySelectorAll(".axv-dp-unknown");
    expect(unknown.length).toBe(1);
    expect(unknown[0].getAttribute("data-kind")).toBe("unsupported");
  });

  it("只读模式（interactive=false）按下不响应，并显示锁标记", async () => {
    const doc = parseDrawable(`<shape ${NS} android:shape="rectangle"><solid android:color="#FF112233"/></shape>`)!;
    await mount(<DrawablePreview doc={doc} width={200} height={100} interactive={false} />);
    pointerDown(host.querySelector(".axv-dp-box")!);
    await flush();
    expect(host.querySelector(".axv-dp-ripple")).toBeNull();
    expect(host.querySelector(".axv-dp-lock")).toBeTruthy();
  });
});
