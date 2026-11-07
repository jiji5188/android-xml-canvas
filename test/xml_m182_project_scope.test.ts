// test/xml_m182_project_scope.test.ts — M182 项目分段视图的分类纯函数
import { describe, expect, it } from "vitest";
import {
  countByKind,
  groupByDir,
  isCodeFile,
  isLayoutFile,
  matchScope,
  resKindOf,
  shortDirLabel,
  type ScannedEntry,
} from "@/lib/xml/project-scope";

const P = "app/src/main/res";
const J = "app/src/main/java/com/example/app";

describe("resKindOf", () => {
  it("mipmap / drawable 归到 图标", () => {
    expect(resKindOf(`${P}/mipmap-anydpi-v26/ic_launcher.xml`)).toBe("icon");
    expect(resKindOf(`${P}/drawable/ic_star.png`)).toBe("icon");
    expect(resKindOf(`${P}/drawable/shape_bg.xml`)).toBe("icon");
  });
  it("res/color* 与 values/colors.xml 归到 颜色", () => {
    expect(resKindOf(`${P}/color/list_bg.xml`)).toBe("color");
    expect(resKindOf(`${P}/values/colors.xml`)).toBe("color");
    expect(resKindOf(`${P}/values-night/colors.xml`)).toBe("color");
  });
  it("strings / arrays 归到 文本", () => {
    expect(resKindOf(`${P}/values/strings.xml`)).toBe("text");
    expect(resKindOf(`${P}/values/arrays.xml`)).toBe("text");
  });
  it("其余 values 文件（dimen/style）归到 其他", () => {
    expect(resKindOf(`${P}/values/dimens.xml`)).toBe("other");
    expect(resKindOf(`${P}/values/themes.xml`)).toBe("other");
  });
  it("raw / font / menu / xml 归到 其他", () => {
    expect(resKindOf(`${P}/raw/sound.mp3`)).toBe("other");
    expect(resKindOf(`${P}/menu/main.xml`)).toBe("other");
    expect(resKindOf(`${P}/xml/backup_rules.xml`)).toBe("other");
  });
  it("布局文件也归到 其他（res 段里它们会出现在 其他 tab）", () => {
    expect(resKindOf(`${J}/MainActivity.java`)).toBeNull();
    expect(resKindOf("build.gradle")).toBeNull();
    expect(resKindOf(`${P}/layout/activity_main.xml`)).toBe("other");
  });
});

describe("isLayoutFile", () => {
  it("res/layout 及其限定符目录都是布局", () => {
    expect(isLayoutFile(`${P}/layout/activity_main.xml`)).toBe(true);
    expect(isLayoutFile(`${P}/layout-land/toolbar.xml`)).toBe(true);
    expect(isLayoutFile(`${P}/layout-sw600dp/detail.xml`)).toBe(true);
  });
  it("其他 res 目录 / 非 res 路径都不是布局", () => {
    expect(isLayoutFile(`${P}/menu/main.xml`)).toBe(false);
    expect(isLayoutFile(`${J}/MainActivity.java`)).toBe(false);
  });
});

describe("isCodeFile", () => {
  it("java / kt 源码与 AndroidManifest 算代码", () => {
    expect(isCodeFile(`${J}/MainActivity.java`)).toBe(true);
    expect(isCodeFile(`${J}/ui/Helper.kt`)).toBe(true);
    expect(isCodeFile("app/src/main/AndroidManifest.xml")).toBe(true);
  });
  it("res 下的 xml 不算代码", () => {
    expect(isCodeFile(`${P}/layout/activity_main.xml`)).toBe(false);
    expect(isCodeFile("build.gradle")).toBe(false);
  });
});

describe("matchScope + countByKind + groupByDir", () => {
  const files: ScannedEntry[] = [
    { rel: `${P}/layout/activity_main.xml`, name: "activity_main.xml", isDir: false },
    { rel: `${P}/layout/toolbar.xml`, name: "toolbar.xml", isDir: false },
    { rel: `${P}/values/strings.xml`, name: "strings.xml", isDir: false },
    { rel: `${P}/values/colors.xml`, name: "colors.xml", isDir: false },
    { rel: `${P}/mipmap-xhdpi/ic_launcher.png`, name: "ic_launcher.png", isDir: false },
    { rel: `${J}/MainActivity.java`, name: "MainActivity.java", isDir: false },
    { rel: "app/src/main/AndroidManifest.xml", name: "AndroidManifest.xml", isDir: false },
    { rel: `${P}`, name: "res", isDir: true },
  ];

  it("layout 段只出布局", () => {
    const got = matchScope(files, "layout");
    expect(got.map((f) => f.name)).toEqual(["activity_main.xml", "toolbar.xml"]);
  });
  it("code 段出 java + manifest", () => {
    const got = matchScope(files, "code");
    expect(got.map((f) => f.name).sort()).toEqual(["AndroidManifest.xml", "MainActivity.java"]);
  });
  it("res 段按 kind 过滤，缺省 kind 出全部 res 文件", () => {
    const icon = matchScope(files, "res", "icon");
    expect(icon.map((f) => f.name)).toEqual(["ic_launcher.png"]);
    // 布局文件也落在 res 段（归入 其他 tab）
    expect(matchScope(files, "res").map((f) => f.name).sort()).toEqual([
      "activity_main.xml",
      "colors.xml",
      "ic_launcher.png",
      "strings.xml",
      "toolbar.xml",
    ]);
  });
  it("countByKind 数对（布局文件也归到 其他，和 res 段行为一致）", () => {
    expect(countByKind(files)).toEqual({ icon: 1, text: 1, color: 1, other: 2 });
  });
  it("groupByDir 按父目录聚合", () => {
    const groups = groupByDir(files);
    const layoutDir = groups.find((g) => g.dir === `${P}/layout`);
    expect(layoutDir?.files.length).toBe(2);
    expect(groups.find((g) => g.dir === J)?.files.map((f) => f.name)).toEqual(["MainActivity.java"]);
  });
});

describe("shortDirLabel", () => {
  it("res 路径保留 res/ 前缀，java 路径转成点号包名", () => {
    expect(shortDirLabel(`${P}/layout`)).toBe("res/layout");
    expect(shortDirLabel(`${J}`)).toBe("com.example.app");
    expect(shortDirLabel("app/src/main")).toBe("src/main");
    expect(shortDirLabel("")).toBe("(项目根)");
  });
});
