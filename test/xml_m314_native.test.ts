// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildRenderModel } from "@/lib/xml/css";
import { parseLayoutXml } from "@/lib/xml/parser";
import { DEFAULT_RESOURCES } from "@/lib/xml/resources";

function m(xml: string) {
  return buildRenderModel(parseLayoutXml(xml).root!, DEFAULT_RESOURCES) as unknown as {
    root: { className?: string; style: Record<string, string> };
  };
}

describe("M314 native style", () => {
  it("Switch off: 轨道 42x18, 滑块 20, 中性灰底", () => {
    const r = m(`<Switch android:layout_width="wrap_content" android:layout_height="wrap_content" />`);
    expect(r.root.className).toContain("axv-switch");
    expect(r.root.style["--axv-ctl-w"]).toBe("84px"); // 42*2
    expect(r.root.style["--axv-ctl-h"]).toBe("36px"); // 18*2
    expect(r.root.style["--axv-ctl-thumb-d"]).toBe("40px"); // 20*2
  });
  it("Switch on: 滑块 22 外扩, 右移", () => {
    const r = m(`<Switch android:layout_width="wrap_content" android:layout_height="wrap_content" android:checked="true" />`);
    expect(r.root.style["--axv-ctl-thumb-d"]).toBe("44px"); // 22*2
    expect(r.root.style["--axv-ctl-thumb-x"]).toBe("36px"); // 18*2
  });
  it("EditText: 下划线, 无整盒", () => {
    const r = m(`<EditText android:layout_width="match_parent" android:layout_height="wrap_content" />`);
    expect(r.root.style.border).toBe("none");
    expect(r.root.style.borderBottom).toContain("#BDBDBD");
    expect(r.root.style.backgroundColor).toBe("transparent");
  });
  it("Spinner: 原生 dropdown 无整盒", () => {
    const r = m(`<Spinner android:layout_width="match_parent" android:layout_height="wrap_content" />`);
    expect(r.root.style.border).toBe("none");
    expect(r.root.style.borderBottom).toContain("#BDBDBD");
  });
});
