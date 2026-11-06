import { describe, expect, it } from "vitest";
import { applyResNamePrefix, defaultResName } from "@/lib/xml/resname";
import { cloneDrawableNode } from "@/lib/xml/drawable-edit";
import { buildResourcePreviewFiles } from "@/lib/xml/res-preview";
import { collectProjectRes } from "@/lib/xml/res-collect";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import type { DrawableNode } from "@/lib/xml/drawable-node";

describe("M158 资源名前缀", () => {
  it("新资源按类型加前缀", () => {
    expect(applyResNamePrefix("login", "selector")).toBe("bg_select_login");
    expect(applyResNamePrefix("menu", "layer-list")).toBe("bg_layer_menu");
    expect(applyResNamePrefix("add", "vector")).toBe("ic_add");
  });
  it("已经是同类型前缀就不重复叠加", () => {
    expect(applyResNamePrefix("bg_select_ok", "selector")).toBe("bg_select_ok");
    expect(applyResNamePrefix("ic_add", "vector")).toBe("ic_add");
  });
  it("不同类型的前缀会被换成当前类型的", () => {
    expect(applyResNamePrefix("bg_login", "layer-list")).toBe("bg_layer_login");
    expect(applyResNamePrefix("bg_select_login", "shape")).toBe("bg_select_login");
    expect(applyResNamePrefix("ic_add", "selector")).toBe("bg_select_add");
  });
  it("空名给类型默认名", () => {
    expect(defaultResName("selector")).toBe("bg_select_new");
    expect(defaultResName("vector")).toBe("ic_new");
  });
});

describe("M158 结构树复制", () => {
  it("cloneDrawableNode 深拷贝且 key 重新发号", () => {
    const src = {
      kind: "shape",
      key: "k1",
      shape: "rectangle",
      solid: "#fff",
      corners: 4,
      stroke: "",
      strokeWidth: 0,
      gradient: null,
      size: null,
      padding: null,
    } as unknown as DrawableNode;
    const copy = cloneDrawableNode(src) as unknown as { key?: string; shape?: string };
    expect(copy).not.toBe(src);
    expect(copy.shape).toBe("rectangle");
    expect(copy.key).toBeTruthy();
    // 同一份节点连续复制两次不能互相干扰
    const a = cloneDrawableNode(src);
    const b = cloneDrawableNode(src);
    expect(a).not.toBe(b);
  });
});

describe("M158 资源真预览的文件清单", () => {
  it("drawable 生成 View + Button + 禁用态，全部引用同一个资源", () => {
    const p = buildResourcePreviewFiles("login", "<selector />", "drawable");
    expect(p.layoutName).toBe("res_preview_bg_select_login");
    const layout = p.files.find((f) => f.path.startsWith("layout/"))!;
    expect(layout.text).toContain('@drawable/bg_select_login"');
    expect(layout.text).toContain("res_button_disabled");
    expect(layout.text).toContain("android:enabled=\"false\"");
    expect(p.files.some((f) => f.path === "drawable/bg_select_login.xml")).toBe(true);
  });
  it("icon 用 24/48/96dp 三档 ImageView", () => {
    const p = buildResourcePreviewFiles("ic_add", "<vector />", "icon");
    const layout = p.files.find((f) => f.path.startsWith("layout/"))!;
    expect(layout.text).toContain("@drawable/ic_add");
    expect(layout.text).toContain("res_icon_24");
    expect(layout.text).toContain("res_icon_96");
    expect(layout.text).not.toContain("<Button");
  });
  it("带上项目其它 drawable，但不重复当前资源、不合法名跳过", () => {
    const p = buildResourcePreviewFiles("ic_add", "<vector />", "icon", {
      "ic_add": "<dup />",
      "bg_x": "<shape />",
      "Bad Name": "<x />",
    });
    expect(p.files.filter((f) => f.path === "drawable/ic_add.xml")).toHaveLength(1);
    expect(p.files.some((f) => f.path === "drawable/bg_x.xml")).toBe(true);
    expect(p.files.some((f) => f.path === "drawable/Bad Name.xml")).toBe(false);
  });
});

function fakeIo(root: string, files: Record<string, string>): AiFileIo {
  return {
    rootLabel: () => root,
    async list(rel) {
      if (rel === "app/src/main/res") {
        const dirs = [...new Set(Object.keys(files).map((p) => p.split("/")[4]))];
        return { ok: true, items: dirs.map((d) => ({ name: d, kind: "dir" as const, rel: `${rel}/${d}` })) };
      }
      const prefix = `${rel}/`;
      const items = Object.keys(files)
        .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
        .map((p) => ({ name: p.slice(prefix.length), kind: "file" as const, rel: p }));
      return { ok: true, items };
    },
    async read(rel) {
      return rel in files ? { ok: true, text: files[rel] } : { ok: false, error: "ENOENT" };
    },
    async write() {
      return { ok: false, error: "readonly" };
    },
  };
}

describe("M158 真机渲染补齐项目资源", () => {
  it("布局引用 → drawable → 再引用 color，递归补齐", async () => {
    const io = fakeIo(`t-${Math.random()}`, {
      "app/src/main/res/layout/activity_main.xml": "<L />",
      "app/src/main/res/drawable/bg_button_selector.xml":
        '<selector><item android:drawable="@drawable/bg_btn_shape"/></selector>',
      "app/src/main/res/drawable/bg_btn_shape.xml":
        '<shape><solid android:color="@color/brand"/></shape>',
      "app/src/main/res/values/colors.xml": '<resources><color name="brand">#123456</color></resources>',
    });
    const r = await collectProjectRes(io, "app/src/main/res/layout/activity_main.xml", [
      { path: "layout/activity_main.xml", text: '<Button android:background="@drawable/bg_button_selector"/>' },
    ]);
    const paths = r.files.map((f) => f.path);
    expect(paths).toContain("drawable/bg_button_selector.xml");
    expect(paths).toContain("drawable/bg_btn_shape.xml");
    expect(paths).toContain("values/colors.xml");
    expect(r.missing).toEqual([]);
    expect(r.added).toBe(3);
  });

  it("项目里真没有的资源用占位顶住，并记进 stubbed", async () => {
    const io = fakeIo(`t-${Math.random()}`, {
      "app/src/main/res/values/strings.xml": "<resources/>",
    });
    const r = await collectProjectRes(io, "app/src/main/res/layout/a.xml", [
      { path: "layout/a.xml", text: '<View android:background="@drawable/nope"/>' },
    ]);
    // M159：不能因一个缺图就整包 link 失败→ 生成透明占位 shape，同时如实回报
    expect(r.missing).toEqual([]);
    expect(r.stubbed).toEqual(["drawable/nope"]);
    expect(r.files.map((f) => f.path)).toContain("drawable/nope.xml");
  });

  it("自定义控件属性自动声明，图片资源走 base64", async () => {
    const io = fakeIo(`t-${Math.random()}`, {
      "app/src/main/res/values/strings.xml": "<resources/>",
      "app/src/main/res/drawable/ic_menu.png": "PNGDATA",
    });
    (io as unknown as { readBase64: (rel: string) => Promise<{ ok: boolean; base64?: string }> }).readBase64 =
      async (rel: string) =>
        rel.endsWith("ic_menu.png") ? { ok: true, base64: "UE5HREFUQQ==" } : { ok: false };

    const r = await collectProjectRes(io, "app/src/main/res/layout/a.xml", [
      {
        path: "layout/a.xml",
        text: '<com.google.android.material.card.MaterialCardView app:cardCornerRadius="8dp"><ImageView android:src="@drawable/ic_menu"/></com.google.android.material.card.MaterialCardView>',
      },
    ]);
    const byPath = new Map(r.files.map((f) => [f.path, f]));
    const attrs = byPath.get("values/axv_attrs.xml");
    expect(attrs?.text).toContain('<attr name="cardCornerRadius" />');
    expect(byPath.get("drawable/ic_menu.png")?.base64).toBe("UE5HREFUQQ==");
    expect(r.stubbed).toEqual([]);
  });

  it("没有 IO 时原样返回", async () => {
    const r = await collectProjectRes(null, null, [{ path: "layout/a.xml", text: "<L/>" }]);
    expect(r.files).toHaveLength(1);
    expect(r.missing).toEqual([]);
  });
});
