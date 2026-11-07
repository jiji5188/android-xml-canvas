// test/xml_m176_project_rename.test.ts — M176：项目名称（目录）/ app 名称 改名纯函数
//
// 只测 lib/xml/project-rename.ts 的纯文本变换（不碰 native bridge）：
//   strings.xml app_name 读写、settings.gradle rootProject.name、
//   themes.xml Theme.X 改名、manifest @style/引用 同步
import { describe, it, expect } from "vitest";
import {
  readAppName,
  setAppName,
  readRootProjectName,
  setRootProjectName,
  readThemeName,
  renameThemeDef,
  renameThemeRef,
  dirNameOf,
  replaceTailDir,
  uniqueProjectName,
} from "@/lib/xml/project-rename";

const STRINGS = [
  '<?xml version="1.0" encoding="utf-8"?>',
  "<resources>",
  '    <string name="app_name">MyApp</string>',
  '    <string name="hello_myapp">Hello MyApp!</string>',
  "</resources>",
  "",
].join("\n");

describe("M176 app_name", () => {
  it("能读出 app_name", () => {
    expect(readAppName(STRINGS)).toBe("MyApp");
  });

  it("能改写 app_name（其它条目不动）", () => {
    const t = setAppName(STRINGS, "新名字");
    expect(readAppName(t)).toBe("新名字");
    expect(t).toContain('name="hello_myapp">Hello MyApp!');
    // 只改一处
    expect((t.match(/app_name/g) || []).length).toBe(1);
  });

  it("没有 app_name 条目时插进 <resources>", () => {
    const src = '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="x">y</string>\n</resources>\n';
    const t = setAppName(src, "A");
    expect(readAppName(t)).toBe("A");
    expect(t).toContain('<string name="app_name">A</string>');
  });

  it("XML 实体转义", () => {
    const t = setAppName(STRINGS, 'a & b "c"');
    expect(readAppName(t)).toBe('a & b "c"');
  });
});

describe("M176 settings.gradle rootProject.name", () => {
  const SETTINGS = [
    "pluginManagement {",
    "}",
    "rootProject.name = 'MyApp'",
    "include ':app'",
    "",
  ].join("\n");

  it("能读出/改写 rootProject.name", () => {
    expect(readRootProjectName(SETTINGS)).toBe("MyApp");
    const t = setRootProjectName(SETTINGS, "MyApp2");
    expect(readRootProjectName(t)).toBe("MyApp2");
    expect(t).toContain("include ':app'");
  });

  it("双引号也行", () => {
    const t = setRootProjectName("rootProject.name = \"A\"", "B");
    expect(t).toBe('rootProject.name = "B"');
  });

  it("没有该语句不报错", () => {
    const t = setRootProjectName("include ':app'", "X");
    expect(t).toBe("include ':app'");
  });
});

describe("M176 主题名", () => {
  const THEMES = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<resources>",
    "",
    '    <style name="Theme.MyApp" parent="Theme.Material3.DayNight.NoActionBar">',
    "        <item name=\"colorPrimary\">@color/primary</item>",
    "    </style>",
    "",
    "</resources>",
    "",
  ].join("\n");

  const MANIFEST = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<manifest xmlns:android=\"http://schemas.android.com/apk/res/android\">",
    "    <application",
    '        android:theme="@style/Theme.MyApp">',
    "    </application>",
    "</manifest>",
    "",
  ].join("\n");

  it("能读出主题名", () => {
    expect(readThemeName(THEMES)).toBe("Theme.MyApp");
  });

  it("themes.xml 改名定义", () => {
    const t = renameThemeDef(THEMES, "Theme.MyApp", "Theme.MyApp2");
    expect(t).toContain('<style name="Theme.MyApp2"');
    expect(readThemeName(t)).toBe("Theme.MyApp2");
  });

  it("manifest 同步 @style/ 引用", () => {
    const t = renameThemeRef(MANIFEST, "Theme.MyApp", "Theme.MyApp2");
    expect(t).toContain('@style/Theme.MyApp2"');
    expect(t).not.toContain("Theme.MyApp\"");
  });

  it("主题名不变时不动文件", () => {
    expect(renameThemeDef(THEMES, "Theme.MyApp", "Theme.MyApp")).toBe(THEMES);
    expect(renameThemeRef(MANIFEST, "Theme.MyApp", "Theme.MyApp")).toBe(MANIFEST);
  });
});

describe("M176 路径工具", () => {
  it("dirNameOf / replaceTailDir", () => {
    expect(dirNameOf("/AndroidUIIDE/Project/MyApp")).toBe("MyApp");
    expect(replaceTailDir("/AndroidUIIDE/Project/MyApp", "Other")).toBe("/AndroidUIIDE/Project/Other");
    expect(replaceTailDir("/x/y/", "z")).toBe("/x/z");
  });

  it("默认项目名避开重名（不再全是 app）", () => {
    expect(uniqueProjectName([])).toBe("MyApp");
    expect(uniqueProjectName(["MyApp"])).toBe("MyApp2");
    expect(uniqueProjectName(["MyApp", "MyApp2", "app"])).toBe("MyApp3");
  });
});
