// test/xml_m4v_res_vectors.test.ts — 上传 res 后 vector xml 必须有全文（M4v）
// 用户 2026-10-28：@drawable/ic_scan 在预览里画不出来；资源选择弹窗的
// 「图片/XML 资源」列表也不全（drawable + mipmap 下的 xml 看不到）
// 根因：resdir 对 vector xml 只记名字（vectorNames），没存原文 →
//   ① resolveDrawable 拿不到 xml，只能返回 "vector:name" 占位（紫虚线）
//   ② DrawablePicker 的 xmlDrawables 里没有这些名字，列表自然是空的
import { describe, it, expect } from "vitest";
import { buildResourceExtras, backfillDrawableXml, type ResourceExtras } from "../lib/xml/resdir";
import { buildRenderModel } from "../lib/xml/css";
import { parseLayoutXml } from "../lib/xml/parser";
import { resolveColor, resolveDrawable } from "../lib/xml/resolve";
import type { ResTreeDir, ResTreeFile } from "../lib/xml/resdir";

const VECTOR = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24">
  <path android:fillColor="#FFFFFF" android:pathData="M3,3h7v7H3z" />
</vector>`;

const ADAPTIVE = `<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
  <background android:drawable="@drawable/ic_launcher_background" />
  <foreground android:drawable="@drawable/ic_launcher_foreground" />
</adaptive-icon>`;

const SHAPE = `<shape xmlns:android="http://schemas.android.com/apk/res/android">
  <solid android:color="#FFFFFF" /><corners android:radius="8dp" />
</shape>`;

function makeFile(text: string, name: string): File {
  const buf = Buffer.from(text, "utf8");
  return {
    name,
    type: "text/plain",
    size: buf.length,
    text: async () => text,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  } as unknown as File;
}

const FILES = [
  { name: "ic_scan.xml", path: "src/main/res/drawable/ic_scan.xml", file: makeFile(VECTOR, "ic_scan.xml") },
  { name: "ic_home.xml", path: "src/main/res/drawable/ic_home.xml", file: makeFile(VECTOR, "ic_home.xml") },
  { name: "bg_tag.xml", path: "src/main/res/drawable/bg_tag.xml", file: makeFile(SHAPE, "bg_tag.xml") },
  { name: "ic_launcher.xml", path: "src/main/res/mipmap-anydpi-v26/ic_launcher.xml", file: makeFile(ADAPTIVE, "ic_launcher.xml") },
];

describe("M4v drawable/mipmap 里的 xml 全文入库", () => {
  it("vector xml 既进 vectorNames 也进 drawableXml（原文）", async () => {
    const ex = await buildResourceExtras(FILES);
    expect(ex.vectorNames).toContain("ic_scan");
    expect(ex.drawableXml.ic_scan).toContain("<vector");
    expect(ex.drawableXml.ic_home).toContain("<vector");
  });

  it("shape xml 仍然进 drawableXml（不回归）", async () => {
    const ex = await buildResourceExtras(FILES);
    expect(ex.drawableXml.bg_tag).toContain("<shape");
    expect(ex.counts.shapes).toBe(1);
    expect(ex.counts.vectors).toBe(2);
  });

  it("mipmap-anydpi-v26 的 adaptive-icon 也进树 + drawableXml", async () => {
    const ex = await buildResourceExtras(FILES);
    expect(ex.drawableXml.ic_launcher).toContain("<adaptive-icon");
    const names: string[] = [];
    const walk = (d: ResTreeDir) => {
      for (const [k, v] of Object.entries(d.children)) {
        if ("children" in v) walk(v);
        else names.push(k);
      }
    };
    walk(ex.tree as ResTreeDir);
    expect(names).toContain("ic_launcher.xml");
  });

  it("ImageView src=@drawable/ic_scan → 真的转成 svg dataURL 画出来（不再是 vector: 占位）", async () => {
    const ex = await buildResourceExtras(FILES);
    const res = {
      strings: {},
      dimens: {},
      colors: {},
      drawables: ex.drawables,
      vectorNames: ex.vectorNames,
      drawableXml: ex.drawableXml,
      themeAttrs: ex.themeAttrs,
    };
    const model = buildRenderModel(
      parseLayoutXml(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
        android:layout_width="match_parent" android:layout_height="match_parent">
        <ImageView android:id="@+id/logo" android:layout_width="56dp" android:layout_height="56dp"
          android:src="@drawable/ic_scan" android:tint="#FFFFFF" />
      </LinearLayout>`).root!,
      res,
    );
    const img = model.root.children[0];
    expect(img.imgSrc?.startsWith("data:image/svg+xml")).toBe(true);
    expect(img.style.border).toBeUndefined();
  });
});

describe("M4v 颜色表 #AARRGGBB 转换（真实项目 colors.xml 写法）", () => {
  const res: any = {
    strings: {},
    dimens: {},
    colors: { primary: "#FF1976D2", text_primary: "#FF212121", dim: "#80212121" },
  };
  const noIssues: any[] = [];

  it("@color/primary → #1976D2（不是半透明红）", () => {
    expect(resolveColor("@color/primary", res, noIssues, "p", "textColor")).toBe("#1976D2");
    expect(resolveColor("@color/text_primary", res, noIssues, "p", "textColor")).toBe("#212121");
  });

  it("带 alpha 的 #AARRGGBB → rgba(r,g,b,a)", () => {
    expect(resolveColor("@color/dim", res, noIssues, "p", "textColor")).toBe("rgba(33, 33, 33, 0.5)");
  });
});

describe("M4v @android:drawable 内置图标不当错误", () => {
  it("返回 builtin: 且不报 warn", () => {
    const issues: any[] = [];
    const v = resolveDrawable("@android:drawable/ic_menu_preferences", { strings: {}, dimens: {}, colors: {} } as any, issues, "p", "src");
    expect(v).toBe("builtin:ic_menu_preferences");
    expect(issues.length).toBe(0);
  });
});

describe("M4v 老缓存回填（用户不用重新导入 res）", () => {
  const stale = () => {
    const file = (rel: string, text: string): ResTreeFile => ({ rel, text, kind: "drawable" });
    const tree: ResTreeDir = {
      name: "res",
      children: {
        drawable: {
          name: "drawable",
          children: { "ic_scan.xml": file("src/main/res/drawable/ic_scan.xml", VECTOR) },
        },
        "mipmap-anydpi-v26": {
          name: "mipmap-anydpi-v26",
          children: { "ic_launcher.xml": file("src/main/res/mipmap-anydpi-v26/ic_launcher.xml", ADAPTIVE) },
        },
      },
    };
    return {
      drawables: {},
      vectorNames: ["ic_scan"],
      drawableXml: {},
      valuesXml: "",
      styles: {},
      sourceFiles: [],
      counts: { images: 0, vectors: 1, values: 0, styles: 0, shapes: 0 },
      tree,
    } as unknown as ResourceExtras;
  };

  it("从 tree 回填 vector / adaptive-icon 原文", () => {
    const ex = stale();
    const n = backfillDrawableXml(ex);
    expect(n).toBe(2);
    expect(ex.drawableXml.ic_scan).toContain("<vector");
    expect(ex.drawableXml.ic_launcher).toContain("<adaptive-icon");
  });

  it("不覆盖已有条目（新生成的优先）", () => {
    const ex = stale();
    ex.drawableXml.ic_scan = "<shape/>";
    backfillDrawableXml(ex);
    expect(ex.drawableXml.ic_scan).toBe("<shape/>");
  });

  it("不是 drawable/mipmap 目录的 xml 不碰（layout/values 不进 drawableXml）", () => {
    const ex = stale();
    (ex.tree as ResTreeDir).children.layout = {
      name: "layout",
      children: { "activity_main.xml": { rel: "src/main/res/layout/activity_main.xml", text: "<LinearLayout/>", kind: "layout" } },
    };
    backfillDrawableXml(ex);
    expect(ex.drawableXml.activity_main).toBeUndefined();
  });
});
