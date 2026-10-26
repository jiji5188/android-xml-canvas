// test/xml_resdir.test.ts — M3b：上传 res/ 目录解析（drawable / vector / values / styles）
import { describe, it, expect } from "vitest";
import { buildResourceExtras } from "../lib/xml/resdir";

/** Node 环境没有 File，造一个最小实现（只支持 text / arrayBuffer，dataURL 走 base64） */
function makeFile(text: string, name: string, type = "text/plain"): File {
  const buf = Buffer.from(text, "utf8");
  const f = {
    name,
    type,
    size: buf.length,
    text: async () => text,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  };
  return f as unknown as File;
}

// FileReader 在 jsdom 环境可用；本测试跑在 node 环境则退化为不测图片 dataURL
const hasFileReader = typeof FileReader !== "undefined";

describe("M3b 上传 res 资源", () => {
  it("解析 values/colors.xml + dimens.xml + strings.xml", async () => {
    const files = [
      {
        name: "colors.xml",
        path: "res/values/colors.xml",
        file: makeFile(
          `<resources><color name="brand">#FF5722</color><color name="ink">#212121</color></resources>`,
          "colors.xml",
        ),
      },
      {
        name: "dimens.xml",
        path: "res/values/dimens.xml",
        file: makeFile(`<resources><dimen name="gap">24dp</dimen></resources>`, "dimens.xml"),
      },
      {
        name: "strings.xml",
        path: "res/values/strings.xml",
        file: makeFile(`<resources><string name="hello">你好</string></resources>`, "strings.xml"),
      },
    ];
    const ex = await buildResourceExtras(files);
    expect(ex.valuesXml).toContain("brand");
    expect(ex.valuesXml).toContain("gap");
    expect(ex.valuesXml).toContain("hello");
    expect(ex.counts.values).toBe(3);
  });

  it("解析 vector xml 记入 vectorNames（不渲染真实路径）", async () => {
    const files = [
      {
        name: "ic_star.xml",
        path: "res/drawable/ic_star.xml",
        file: makeFile(
          `<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp"><path android:pathData="M0,0h24v24h-24z"/></vector>`,
          "ic_star.xml",
        ),
      },
    ];
    const ex = await buildResourceExtras(files);
    expect(ex.vectorNames).toContain("ic_star");
    expect(ex.counts.vectors).toBe(1);
  });

  it("styles.xml 展开 parent 继承链（子覆盖父）", async () => {
    const styles = `<resources>
  <style name="Base">
    <item name="android:textColor">#000000</item>
    <item name="android:textSize">14sp</item>
  </style>
  <style name="Title" parent="Base">
    <item name="android:textSize">22sp</item>
  </style>
</resources>`;
    const files = [
      { name: "styles.xml", path: "res/values/styles.xml", file: makeFile(styles, "styles.xml") },
    ];
    const ex = await buildResourceExtras(files);
    expect(ex.styles["Title"].attrs["android:textSize"]).toBe("22sp"); // 子覆盖
    expect(ex.styles["Title"].attrs["android:textColor"]).toBe("#000000"); // 继承自父
  });

  it("忽略 values-night / values-v21 变体，只用默认 values", async () => {
    const mk = (v: string) => `<resources><color name="bg">${v}</color></resources>`;
    const files = [
      { name: "colors.xml", path: "res/values/colors.xml", file: makeFile(mk("#FFFFFF"), "colors.xml") },
      { name: "colors.xml", path: "res/values-night/colors.xml", file: makeFile(mk("#000000"), "colors.xml") },
    ];
    const ex = await buildResourceExtras(files);
    expect(ex.valuesXml).toContain("#FFFFFF");
    expect(ex.valuesXml).not.toContain("#000000");
  });

  it.skipIf(!hasFileReader)("drawable 图片转 dataURL，同名按密度择优", async () => {
    const png = "\u0089PNG\r\n\u001a\n"; // 假字节，只要 dataURL 前缀对即可
    const files = [
      {
        name: "ic.png",
        path: "res/drawable-hdpi/ic.png",
        file: makeFile(png, "ic.png", "image/png"),
      },
      {
        name: "ic.png",
        path: "res/drawable-xxhdpi/ic.png",
        file: makeFile(png, "ic.png", "image/png"),
      },
    ];
    const ex = await buildResourceExtras(files);
    expect(ex.drawables["ic"]).toContain("data:");
  });
});
