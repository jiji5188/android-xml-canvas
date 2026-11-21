import { describe, expect, it } from "vitest";
import { buildRIndex, rTableTypes, type RIndex } from "@/lib/xml/r-index";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";

function fakeTree() {
  return {
    name: "res",
    children: {
      layout: {
        name: "layout",
        children: {
          "activity_main.xml": { rel: "layout/activity_main.xml", text: "<LinearLayout/>", kind: "layout" },
          "activity_login.xml": { rel: "layout/activity_login.xml", text: "<FrameLayout/>", kind: "layout" },
        },
      },
      "layout-land": {
        name: "layout-land",
        children: {
          "activity_main.xml": { rel: "layout-land/activity_main.xml", text: "<LinearLayout/>", kind: "layout" },
        },
      },
      values: {
        name: "values",
        children: {
          "strings.xml": {
            rel: "values/strings.xml",
            text: '<resources><string name="app_name">退件</string><string name="hint">输入</string></resources>',
            kind: "values",
          },
          "colors.xml": {
            rel: "values/colors.xml",
            text: '<resources><color name="colorPrimary">#2196F3</color></resources>',
            kind: "values",
          },
        },
      },
      raw: {
        name: "raw",
        children: {
          "ring_up.mp3": { rel: "raw/ring_up.mp3", text: null, kind: "other" },
          "ring_down.mp3": { rel: "raw/ring_down.mp3", text: null, kind: "other" },
        },
      },
      "drawable-hdpi": {
        name: "drawable-hdpi",
        children: {
          "ic_launcher.png": { rel: "drawable-hdpi/ic_launcher.png", text: null, kind: "drawable" },
        },
      },
      "mipmap-anydpi-v26": {
        name: "mipmap-anydpi-v26",
        children: {
          "ic_launcher.xml": { rel: "mipmap-anydpi-v26/ic_launcher.xml", text: "<adaptive-icon/>", kind: "drawable" },
        },
      },
      menu: {
        name: "menu",
        children: {
          "main_menu.xml": { rel: "menu/main_menu.xml", text: "<menu/>", kind: "menu" },
        },
      },
    },
  };
}

const RIDX: RIndex = {
  layout: ["activity_main", "activity_login"],
  string: ["app_name", "hint"],
  color: ["colorPrimary"],
  raw: ["ring_up", "ring_down"],
  drawable: ["ic_launcher"],
  mipmap: ["ic_launcher"],
  menu: ["main_menu"],
  id: ["btn_submit"],
};

/** 光标放在 doc 末尾（col = doc.length + 1 是 1-based） */
function rAtEnd(doc: string, rid: RIndex = RIDX) {
  return computeJavaSuggest(doc, { line: 1, col: doc.length + 1 }, undefined, undefined, rid);
}

describe("M465 buildRIndex", () => {
  it("按类型归组资源名（限定符目录剥离 + 扩展名剥离 + 去重）", () => {
    const idx = buildRIndex({ tree: fakeTree() } as never);
    expect(idx.layout).toEqual(["activity_main", "activity_login"]);
    expect(idx.string).toEqual(["app_name", "hint"]);
    expect(idx.color).toEqual(["colorPrimary"]);
    expect(idx.raw).toEqual(["ring_up", "ring_down"]);
    expect(idx.drawable).toEqual(["ic_launcher"]);
    expect(idx.mipmap).toEqual(["ic_launcher"]);
    expect(idx.menu).toEqual(["main_menu"]);
  });

  it("resExtras.ids 进 id 表", () => {
    const idx = buildRIndex({ tree: fakeTree(), ids: ["tv_title", "btn_submit"] } as never);
    expect(idx.id).toContain("tv_title");
    expect(idx.id).toContain("btn_submit");
  });

  it("生成的 drawable 并进 drawable 表", () => {
    const idx = buildRIndex({ tree: fakeTree() } as never, { axv_shape_card: "<shape/>" });
    expect(idx.drawable).toContain("axv_shape_card");
  });

  it("没有资源时返回 {}", () => {
    expect(buildRIndex(null)).toEqual({});
    expect(buildRIndex({} as never)).toEqual({});
  });

  it("rTableTypes 按 R_TYPES 标准顺序 + 非标类型补后", () => {
    expect(rTableTypes(RIDX)).toEqual(["id", "layout", "drawable", "mipmap", "string", "color", "raw", "menu"]);
    expect(rTableTypes({ zebra: ["x"], id: ["a"] })).toEqual(["id", "zebra"]);
    expect(rTableTypes({})).toEqual([]);
  });
});

describe("M465 computeJavaSuggest R 候选", () => {
  it("R. 光标在点号后 → 列类型表", () => {
    // 真实场景：用户打完 "R." 的瞬间，光标紧跟点号（右侧还没打括号）
    const r = rAtEnd("findViewById(R.");
    expect(r).not.toBeNull();
    expect(r!.items).toEqual(["id", "layout", "drawable", "mipmap", "string", "color", "raw", "menu"]);
  });

  it("R.la 光标在 la 后 → 前缀过滤类型（la 开头只有 layout）", () => {
    const r = rAtEnd("R.la");
    expect(r!.items).toEqual(["layout"]);
  });

  it("R.layout. 光标在点号后 → 列该类型资源名", () => {
    const r = rAtEnd("setContentView(R.layout.");
    expect(r).not.toBeNull();
    expect(r!.items).toEqual(["activity_main", "activity_login"]);
  });

  it("R.layout.ac → 前缀过滤资源名", () => {
    const r = rAtEnd("R.layout.ac");
    expect(r!.items).toEqual(["activity_main", "activity_login"]);
  });

  it("R.layout.zzz → 无匹配返回 null", () => {
    expect(rAtEnd("R.layout.zzz")).toBeNull();
  });

  it("R.raw. → 列 raw 资源", () => {
    const r = rAtEnd("MediaPlayer.create(ctx, R.raw.");
    expect(r!.items).toEqual(["ring_up", "ring_down"]);
  });

  it("R.id. → 列 id 资源", () => {
    const r = rAtEnd("findViewById(R.id.");
    expect(r!.items).toEqual(["btn_submit"]);
  });

  it("不传 rIndex → 行末 R.layout. 走旧链路不弹资源名", () => {
    const r = rAtEnd("R.layout.", {});
    // 无 rIndex 时 receiver "layout" 解析不到类型 → 不弹
    if (r) expect(r.items).not.toContain("activity_main");
  });

  it("R.abc → 前缀无类型匹配返回 null", () => {
    expect(rAtEnd("R.abc")).toBeNull();
  });
});
