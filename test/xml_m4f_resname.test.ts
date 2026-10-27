import { describe, it, expect } from "vitest";
import {
  isValidResName,
  isDrawableRef,
  resNameFromValue,
  sanitizeResName,
  isColorValue,
} from "../lib/xml/resname";

describe("resname — Android 资源命名规则", () => {
  it("isValidResName：合法 a-z0-9_ 且不以数字开头", () => {
    expect(isValidResName("bg_card")).toBe(true);
    expect(isValidResName("ic_search")).toBe(true);
    expect(isValidResName("a")).toBe(true);
    expect(isValidResName("0abc")).toBe(false); // 数字开头
    expect(isValidResName("BG")).toBe(false); // 大写
    expect(isValidResName("#00C853")).toBe(false); // 颜色值不是资源名
    expect(isValidResName("a-b")).toBe(false);
    expect(isValidResName("")).toBe(false);
  });

  it("isDrawableRef：只对合法的 @drawable/xxx 引用为真", () => {
    expect(isDrawableRef("@drawable/bg_card")).toBe(true);
    expect(isDrawableRef("@mipmap/ic_launcher")).toBe(true);
    expect(isDrawableRef("@drawable/bg_card.xml")).toBe(true);
    expect(isDrawableRef("#00C853")).toBe(false); // 纯色不是引用
    expect(isDrawableRef("@drawable/#00C853")).toBe(false); // 名字里有 #
    expect(isDrawableRef("@drawable/0bad")).toBe(false); // 数字开头
  });

  it("resNameFromValue：颜色值绝不能被当成资源名（本次 bug 根因）", () => {
    expect(resNameFromValue("#00C853")).toBe("");
    expect(resNameFromValue("@drawable/bg_rect_r12")).toBe("bg_rect_r12");
    expect(resNameFromValue("@drawable/#00C853")).toBe("");
    expect(resNameFromValue("@mipmap/logo")).toBe("logo");
    expect(resNameFromValue("")).toBe("");
  });

  it("sanitizeResName：脏输入压成合法名", () => {
    expect(sanitizeResName("#00C853")).toBe("bg_00c853"); // # 变 _、数字开头补 bg_
    expect(sanitizeResName("My Card")).toBe("my_card");
    expect(sanitizeResName("001")).toBe("bg_001");
    expect(sanitizeResName("")).toBe("bg");
    expect(sanitizeResName("ic_search", "ic")).toBe("ic_search");
  });

  it("isColorValue", () => {
    expect(isColorValue("#FFF")).toBe(true);
    expect(isColorValue("#00C853")).toBe(true);
    expect(isColorValue("#80FF0000")).toBe(true);
    expect(isColorValue("@drawable/x")).toBe(false);
  });
});
