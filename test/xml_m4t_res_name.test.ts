// test/xml_m4t_res_name.test.ts — 非法资源名不能进 drawable/ 文件（M4t）
// 用户 2026-10-28 问 @drawable/ic_home 存哪了 → 顺带查出现场 localStorage 里
// 有旧版本留下的 "#E8EEFA" / "#FFFFFF" 当资源名，这种会写出 drawable/#E8EEFA.xml 编译报错
import { describe, it, expect } from "vitest";
import { buildResBundle } from "../lib/xml/bundle";

const SHAPE = `<shape xmlns:android="http://schemas.android.com/apk/res/android">
  <solid android:color="#E8EEFA" /><corners android:radius="8dp" />
</shape>`;

const LAYOUT = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
  android:layout_width="match_parent" android:layout_height="match_parent" />`;

describe("M4t 资源名合法性", () => {
  it("非法名（#E8EEFA / 大写 / 数字开头 / 带斜杠）不进 res 包", () => {
    const entries = buildResBundle({
      layoutXml: LAYOUT,
      layoutName: "activity_main",
      generatedDrawables: {
        "#E8EEFA": SHAPE,
        "#FFFFFF": SHAPE,
        Ic_Home: SHAPE,
        "1abc": SHAPE,
        "a/b": SHAPE,
        ic_home: SHAPE,
      },
    });
    const drawables = entries.map((e) => e.path).filter((p) => p.startsWith("drawable/"));
    expect(drawables).toEqual(["drawable/ic_home.xml"]);
  });

  it("正常名照常进包", () => {
    const entries = buildResBundle({
      layoutXml: LAYOUT,
      layoutName: "activity_main",
      generatedDrawables: { bg_rect_r8: SHAPE },
    });
    expect(entries.some((e) => e.path === "drawable/bg_rect_r8.xml")).toBe(true);
  });
});
