// test/xml_m65_res_index.test.ts — M65：用假文件系统验证「引用 → 文件:行号」
import { beforeEach, describe, expect, it } from "vitest";
import { clearResIndex, createResResolver } from "../lib/xml/res-index";
import type { AiFileIo } from "../lib/xml/ai-tools";

const RES = "app/src/main/res";

const files: Record<string, string> = {
  [`${RES}/values/strings.xml`]: `<resources>
    <string name="app_name">示例</string>
</resources>`,
  [`${RES}/values/colors.xml`]: `<resources>
  <color name="brand">#FF112233</color>
</resources>`,
  [`${RES}/values-night/colors.xml`]: `<resources>
  <color name="brand">#FF000000</color>
</resources>`,
  [`${RES}/layout/activity_main.xml`]: `<LinearLayout/>`,
  [`${RES}/drawable/ic_star.xml`]: `<vector/>`,
};

const dirs: Record<string, string[]> = {
  [RES]: ["values", "values-night", "layout", "drawable"],
  [`${RES}/values`]: ["strings.xml", "colors.xml"],
  [`${RES}/values-night`]: ["colors.xml"],
  [`${RES}/layout`]: ["activity_main.xml"],
  [`${RES}/drawable`]: ["ic_star.xml", "logo.png"],
};

function makeIo(): AiFileIo {
  return {
    rootLabel: () => "/proj",
    async list(rel) {
      const names = dirs[rel];
      if (!names) return { ok: false, error: "目录不存在" };
      return { ok: true, items: names.map((n) => ({ kind: n.includes(".") ? ("file" as const) : ("dir" as const), name: n, rel: `${rel}/${n}` })) };
    },
    async read(rel) {
      const t = files[rel];
      return t === undefined ? { ok: false as const, error: "没有这个文件" } : { ok: true as const, text: t };
    },
    async write() {
      return { ok: true as const };
    },
  };
}

beforeEach(() => clearResIndex());

describe("M65 createResResolver", () => {
  it("@string/app_name → values/strings.xml:2", async () => {
    const r = createResResolver(makeIo(), `${RES}/layout/activity_main.xml`)!;
    const hit = await r.resolve("@string/app_name");
    expect(hit).toMatchObject({ rel: `${RES}/values/strings.xml`, line: 2 });
  });

  it("同名颜色优先命中第一个 values 目录（values 在 values-night 前）", async () => {
    const r = createResResolver(makeIo(), `${RES}/layout/activity_main.xml`)!;
    const hit = await r.resolve("@color/brand");
    expect(hit).toMatchObject({ rel: `${RES}/values/colors.xml`, line: 2 });
  });

  it("@layout/x 直接指向文件第 1 行", async () => {
    const r = createResResolver(makeIo(), `${RES}/layout/activity_main.xml`)!;
    const hit = await r.resolve("@layout/activity_main");
    expect(hit).toMatchObject({ rel: `${RES}/layout/activity_main.xml`, line: 1 });
  });

  it("drawable 按文件名精确匹配（ic_star → ic_star.xml）", async () => {
    const r = createResResolver(makeIo(), `${RES}/layout/activity_main.xml`)!;
    const hit = await r.resolve("@drawable/ic_star");
    expect(hit).toMatchObject({ rel: `${RES}/drawable/ic_star.xml`, line: 1 });
  });

  it("没有的资源返回 null，不抛异常", async () => {
    const r = createResResolver(makeIo(), `${RES}/layout/activity_main.xml`)!;
    expect(await r.resolve("@string/not_there")).toBeNull();
    expect(await r.resolve("@+id/btn")).toBeNull();
  });

  it("docRel 不同也能推出 res 目录（根相对路径）", async () => {
    const r = createResResolver(makeIo(), "app/src/main/res/layout/activity_main.xml")!;
    const hit = await r.resolve("@string/app_name");
    expect(hit?.rel).toBe("app/src/main/res/values/strings.xml");
  });

  it("没有项目源时返回 null，UI 提示只读", async () => {
    expect(createResResolver(null, null)).toBeNull();
  });
});
