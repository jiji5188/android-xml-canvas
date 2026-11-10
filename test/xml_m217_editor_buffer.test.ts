// test/xml_m217_editor_buffer.test.ts — M217：打包前把「未保存的编辑器内容」合并进文件清单
import { describe, it, expect } from "vitest";
import { samePath, withCurrentSource, withCurrentXml } from "@/lib/xml/editor-buffer";

describe("M217 samePath", () => {
  it("分隔符方向 / ./ 前缀 / 大小写不影响", () => {
    expect(samePath("app\\src\\main\\java\\A.java", "app/src/main/java/A.java")).toBe(true);
    expect(samePath("./app/src/A.java", "app/src/A.java")).toBe(true);
    expect(samePath("App/src/A.java", "app/src/A.java")).toBe(true);
  });

  it("项目相对路径 vs res 相对路径（后缀匹配）", () => {
    expect(samePath("app/src/main/res/layout/activity_main.xml", "layout/activity_main.xml")).toBe(true);
  });

  it("不会把同名不同目录的文件混为一谈", () => {
    expect(samePath("res/values/strings.xml", "res/values-zh/strings.xml")).toBe(false);
  });

  it("空值一律 false", () => {
    expect(samePath("", "a.java")).toBe(false);
    expect(samePath(null, "a.java")).toBe(false);
    expect(samePath("a.java", undefined)).toBe(false);
  });
});

describe("M217 withCurrentSource", () => {
  const src = [
    { path: "app/src/main/java/com/x/MainActivity.java", code: "old" },
    { path: "app/src/main/java/com/x/Util.java", code: "util" },
  ];

  it("覆盖正在编辑的那个文件（这才是用户看到的代码）", () => {
    const out = withCurrentSource(src, "app/src/main/java/com/x/MainActivity.java", "new code");
    expect(out[0].code).toBe("new code");
    expect(out[1].code).toBe("util");
    expect(src[0].code).toBe("old"); // 不改原数组
  });

  it("新建未保存的文件会补进清单", () => {
    const out = withCurrentSource(src, "app/src/main/java/com/x/NewActivity.kt", "class NewActivity");
    expect(out).toHaveLength(3);
    expect(out[2].path).toBe("app/src/main/java/com/x/NewActivity.kt");
  });

  it("非 Java/Kotlin 文档不动清单", () => {
    expect(withCurrentSource(src, "res/layout/activity_main.xml", "<x/>")).toHaveLength(2);
    expect(withCurrentSource(src, null, "abc")).toHaveLength(2);
  });

  it("内容没变时返回原引用（避免无意义的打包差异）", () => {
    const out = withCurrentSource(src, "app/src/main/java/com/x/Util.java", "util");
    expect(out).toBe(src);
  });

  it("路径只有后缀一致也能覆盖（项目根不同）", () => {
    const out = withCurrentSource(src, "MainActivity.java", "suffix match");
    expect(out[0].code).toBe("suffix match");
  });
});

describe("M217 withCurrentXml", () => {
  const files = [
    { path: "layout/activity_main.xml", text: "<old/>" },
    { path: "values/strings.xml", text: "<resources><string name=\"a\">a</string></resources>" },
  ];

  it("绝对值路径能对上 res 相对路径", () => {
    const out = withCurrentXml(files, "app/src/main/res/layout/activity_main.xml", "<new/>");
    expect(out[0].text).toBe("<new/>");
    expect(files[0].text).toBe("<old/>");
  });

  it("找不到同名条目就原样返回（不凭空造资源）", () => {
    expect(withCurrentXml(files, "res/layout/other.xml", "<x/>")).toBe(files);
  });

  it("非 xml 文档不动", () => {
    expect(withCurrentXml(files, "app/src/main/java/A.java", "code")).toBe(files);
  });
});
