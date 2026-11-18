// test/xml_m368_libs_utils.test.ts — M368：库管理面板纯逻辑（排序/过滤/大小格式化）
import { describe, it, expect } from "vitest";
import { formatBytes, matchLibQuery, sortLibFiles, matchGradleDep } from "@/lib/xml/libs-utils";

describe("M368 formatBytes", () => {
  it("字节数转人话", () => {
    expect(formatBytes(34)).toBe("34 B");
    expect(formatBytes(860)).toBe("860 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(860 * 1024)).toBe("860 KB");
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
    expect(formatBytes(1.2 * 1024 * 1024)).toBe("1.2 MB");
    expect(formatBytes(48 * 1024 * 1024)).toBe("48 MB");
  });
  it("无效值返回 null", () => {
    expect(formatBytes(undefined)).toBeNull();
    expect(formatBytes(null)).toBeNull();
    expect(formatBytes(-1)).toBeNull();
    expect(formatBytes(NaN)).toBeNull();
  });
});

describe("M368 matchLibQuery", () => {
  it("空查询全匹配", () => {
    expect(matchLibQuery("okhttp.aar", "x/y", "")).toBe(true);
    expect(matchLibQuery("okhttp.aar", "x/y", "  ")).toBe(true);
  });
  it("name 或 rel 子串命中（大小写不敏感）", () => {
    expect(matchLibQuery("okhttp-4.12.0.aar", "libs/okhttp-4.12.0.aar", "okhttp")).toBe(true);
    expect(matchLibQuery("okhttp-4.12.0.aar", "libs/okhttp-4.12.0.aar", "OKHTTP")).toBe(true);
    expect(matchLibQuery("material.aar", "app/src/main/libs/material.aar", "src/main")).toBe(true);
  });
  it("多词 AND", () => {
    expect(matchLibQuery("okhttp-4.12.0.aar", "libs/x", "okhttp 4.12")).toBe(true);
    expect(matchLibQuery("okhttp-4.12.0.aar", "libs/x", "okhttp retrofit")).toBe(false);
  });
  it("不匹配", () => {
    expect(matchLibQuery("okhttp.aar", "libs/x", "retrofit")).toBe(false);
  });
});

describe("M368 sortLibFiles", () => {
  it("按名称大小写不敏感排序，不改原数组", () => {
    const input = [
      { name: "beta.jar", rel: "b" },
      { name: "Alpha.aar", rel: "a" },
      { name: "alpha2.jar", rel: "c" },
    ];
    const out = sortLibFiles(input);
    expect(out.map((x) => x.name)).toEqual(["Alpha.aar", "alpha2.jar", "beta.jar"]);
    expect(input.map((x) => x.name)).toEqual(["beta.jar", "Alpha.aar", "alpha2.jar"]);
  });
});

describe("M368 matchGradleDep", () => {
  it("name/group 命中", () => {
    expect(matchGradleDep({ name: "okhttp", group: "com.squareup.okhttp3" }, "okhttp3")).toBe(true);
    expect(matchGradleDep({ name: "okhttp", group: "com.squareup.okhttp3" }, "retrofit")).toBe(false);
  });
});
