// @vitest-environment jsdom
// test/xml_m127_transforms.test.tsx — M127 变换 4 tab
//
// 验证：
//   1. 解析：<inset><clip><scale><rotate>shape</rotate></scale></clip></inset> → shape + 4 条变换
//   2. build：变换顺序 = 原文嵌套顺序（外→内），inset 在 rotate 之前
//   3. roundTrip：parse → build → parse 完全等价
//   4. TransformTabs UI：未添加时显示「添加」，添加后参数区出现，移除后消失
//   5. 预览：rotate 层 CSS transform 里有 rotate()，inset 已消化成位置偏移

import { describe, it, expect, afterEach } from "vitest";
import { useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parseDrawable, flattenDrawable } from "@/lib/xml/drawable-node";
import { buildDrawable } from "@/lib/xml/drawable-build";
import { TransformTabs } from "@/components/drawable/TransformTabs";
import { DrawablePreview } from "@/components/DrawablePreview";

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    root.unmount();
    await flush();
  }
  host?.remove();
  root = null;
  host = null;
});

async function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(el);
  await flush();
  return host;
}

const NS = `xmlns:android="http://schemas.android.com/apk/res/android"`;

const CHAIN_XML = `<inset ${NS} android:insetLeft="4dp" android:insetTop="4dp">
  <clip android:clipOrientation="horizontal" android:gravity="center">
    <scale android:scaleWidth="50%" android:scaleHeight="80%" android:scaleGravity="center">
      <rotate android:fromDegrees="15" android:toDegrees="90" android:pivotX="50%" android:pivotY="50%">
        <shape android:shape="rectangle"><solid android:color="#FF112233"/></shape>
      </rotate>
    </scale>
  </clip>
</inset>`;

describe("M127 解析", () => {
  it("4 层嵌套变换压成 shape + transform 链", () => {
    const doc = parseDrawable(CHAIN_XML)!;
    expect(doc.t).toBe("shape");
    expect(doc.transform?.map((t) => t.kind)).toEqual(["inset", "clip", "scale", "rotate"]);
    expect(doc.transform?.[0].params["insetLeft"]).toBe("4dp");
    expect(doc.transform?.[2].params["scaleWidth"]).toBe("50%");
    expect(doc.transform?.[3].params["fromDegrees"]).toBe("15");
  });

  it("flatten：inset 进 layer.inset，其余进 layer.transform", () => {
    const doc = parseDrawable(CHAIN_XML)!;
    const layers = flattenDrawable(doc)!;
    const l = layers[0];
    expect(l.inset).toEqual({ l: 4, t: 4, r: 0, b: 0 });
    expect(l.transform?.map((t) => t.kind)).toEqual(["clip", "scale", "rotate"]);
  });

  it("build 保持嵌套顺序（inset 在最外层）", () => {
    const doc = parseDrawable(CHAIN_XML)!;
    const xml = buildDrawable(doc);
    expect(xml.indexOf("<inset")).toBeLessThan(xml.indexOf("<clip"));
    expect(xml.indexOf("<clip")).toBeLessThan(xml.indexOf("<scale"));
    expect(xml.indexOf("<scale")).toBeLessThan(xml.indexOf("<rotate"));
    // roundTrip
    const b = parseDrawable(xml)!;
    expect(b.transform?.map((t) => t.kind)).toEqual(["inset", "clip", "scale", "rotate"]);
  });

  it("全零 inset 不写参数（只有 4 个 0 时）", () => {
    const xml = buildDrawable({
      t: "shape",
      spec: { kind: "rectangle", solid: "#FF000000" },
      transform: [{ kind: "inset", params: {} }],
    } as any);
    expect(xml).toContain("<inset");
    expect(xml).not.toContain("insetLeft");
  });

  it("没有变换的 shape 不套任何 wrapper", () => {
    const xml = buildDrawable({ t: "shape", spec: { kind: "rectangle", solid: "#FF000000" } });
    expect(xml).not.toContain("<inset");
    expect(xml).not.toContain("<rotate");
  });
});

// UI：用受控包裹组件，才能看到添加后的参数区
async function mountTabs(initial: any, onMutate: (n: any) => void) {
  let latest: any = initial;
  function Wrap() {
    const [node, setNode] = useState(initial);
    return (
      <TransformTabs
        node={node}
        onChange={(n) => {
          latest = n;
          setNode(n);
          onMutate(n);
        }}
      />
    );
  }
  const h = await mount(<Wrap />);
  return {
    h,
    get out() {
      return latest;
    },
    clickTab(label: string) {
      const btn = Array.from(h.querySelectorAll<HTMLButtonElement>(".axv-transform-tab")).find(
        (b) => b.textContent?.includes(label),
      );
      btn?.click();
    },
    clickText(rx: RegExp) {
      const el = Array.from(h.querySelectorAll<HTMLElement>("button, .axv-btn")).find((b) =>
        rx.test(b.textContent || ""),
      );
      (el as HTMLButtonElement | undefined)?.click();
    },
    inputs(sel: string) {
      return Array.from(h.querySelectorAll<HTMLInputElement>(sel));
    },
  };
}

/** React 受控输入：走原型 setter，直接赋 .value 不触发 onChange */
function typeInto(el: HTMLElement, text: string) {
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("M127 TransformTabs UI", () => {
  it("空变换：点「内缩」tab + 添加 → 生成 4 个参数框", async () => {
    let out: any = null;
    const m = await mountTabs({ t: "shape", spec: { kind: "rectangle", solid: "#FF000000" } }, (n) => (out = n));
    m.clickTab("内缩");
    await flush();
    m.clickText(/添加/);
    await flush();
    expect(out?.transform?.[0].kind).toBe("inset");
    expect(out?.transform?.[0].params.insetLeft).toBe("0dp");
    expect(m.inputs(".axv-transform-field input").length).toBe(4);
  });

  it("移除变换：有 inset 时点「移除」→ transform 消失", async () => {
    let out: any = null;
    const start = {
      t: "shape" as const,
      spec: { kind: "rectangle" as const, solid: "#FF000000" },
      transform: [{ kind: "inset" as const, params: { insetLeft: "4dp" } }],
    };
    const m = await mountTabs(start, (n) => (out = n));
    m.clickTab("内缩");
    await flush();
    m.clickText(/移除/);
    await flush();
    expect(out?.transform).toBeUndefined();
  });

  it("预览：rotate 层带 CSS transform，inset 消化成 left/top", async () => {
    const doc = parseDrawable(CHAIN_XML)!;
    const h = await mount(
      <div style={{ width: 100, height: 100 }}>
        <DrawablePreview doc={doc} width={100} height={100} interactive={false} showStateBar={false} />
      </div>,
    );
    const layer = h.querySelector(".axv-dp-layer[data-kind='shape']") as HTMLElement;
    expect(layer).toBeTruthy();
    const st = layer.style;
    expect(st.transform).toContain("rotate(15deg)");
    // 默认 scale=1：4dp = 4px
    expect(st.left).toBe("4px");
  }, 10000);
});
