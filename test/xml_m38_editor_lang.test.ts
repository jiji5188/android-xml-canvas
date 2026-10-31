import { describe, expect, it } from "vitest";
import { langLabel, pickLang } from "@/lib/xml/editor-lang";

describe("M38 pickLang", () => {
  it("Java 系：.java / .kt / .kts（不区分大小写）", () => {
    expect(pickLang("app/src/main/java/com/demo/MainActivity.java")).toBe("java");
    expect(pickLang("MainActivity.JAVA")).toBe("java");
    expect(pickLang("ui/Main.kt")).toBe("java");
    expect(pickLang("build.gradle.kts")).toBe("java");
  });

  it("Windows 反斜杠路径也能认后缀", () => {
    expect(pickLang("D:\\proj\\app\\src\\main\\java\\A.java")).toBe("java");
  });

  it("其余（xml/资源/manifest/空）→ xml", () => {
    expect(pickLang("app/src/main/AndroidManifest.xml")).toBe("xml");
    expect(pickLang("res/values/strings.xml")).toBe("xml");
    expect(pickLang("activity_main.xml")).toBe("xml");
    expect(pickLang(null)).toBe("xml");
    expect(pickLang("")).toBe("xml");
  });

  it("看起来像扩展名但不在白名单里 → xml（不会误判成 Java）", () => {
    expect(pickLang("notes.javax")).toBe("xml");
    expect(pickLang("Main.java.bak")).toBe("xml");
  });

  it("langLabel 给界面用", () => {
    expect(langLabel("java")).toBe("Java");
    expect(langLabel("xml")).toBe("XML");
  });
});
