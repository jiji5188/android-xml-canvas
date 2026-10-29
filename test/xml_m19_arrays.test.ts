// M19：string-array 资源 → Spinner 候选
import { describe, expect, it } from "vitest";
import { DEFAULT_RESOURCES, DEFAULT_STRING_ARRAYS, mergeResourceFragment, stringArrayOf } from "../lib/xml/resources";
import { resolveSpinner, spinnerOptions } from "../lib/xml/run-sim";

describe("M19 resources：string-array 解析", () => {
  it("内置默认表带了常用数组", () => {
    expect(DEFAULT_RESOURCES.stringArrays?.cities).toEqual(["北京", "上海", "广州", "深圳", "成都"]);
    expect(DEFAULT_STRING_ARRAYS.sort_order[0]).toBe("最新优先");
  });

  it("values 里的 <string-array> 能解析进表（用户优先）", () => {
    const frag = `<resources>
      <string-array name="cities">
        <item>杭州</item>
        <item>&#39;Sanya</item>
        <item>丽江</item>
      </string-array>
      <string-array name="units">
        <item>升</item>
      </string-array>
    </resources>`;
    const t = mergeResourceFragment(frag);
    expect(t.stringArrays?.cities).toEqual(["杭州", "'Sanya", "丽江"]); // 实体已反转义
    expect(t.stringArrays?.units).toEqual(["升"]); // 覆盖默认表
    // 没定义的数组保留默认值
    expect(t.stringArrays?.sort_order).toHaveLength(4);
  });

  it("stringArrayOf：@array/ 与 @android:array/ 都能取，取不到给 null", () => {
    expect(stringArrayOf(DEFAULT_RESOURCES, "@array/cities")).toEqual(["北京", "上海", "广州", "深圳", "成都"]);
    expect(stringArrayOf(DEFAULT_RESOURCES, "@android:array/cities")).toEqual(["北京", "上海", "广州", "深圳", "成都"]);
    expect(stringArrayOf(DEFAULT_RESOURCES, "@array/nope")).toBeNull();
    expect(stringArrayOf(DEFAULT_RESOURCES, "普通字符串")).toBeNull();
  });
});

describe("M19 run-sim：resolveSpinner 候选来源优先级", () => {
  it("字面量逗号分隔 > @array（资源表有） > @array（资源表没有 → null） > 缺省 → null", () => {
    const table = { stringArrays: { cities: ["北京", "上海"] } };
    expect(resolveSpinner("杭州, 大理", table)).toEqual(["杭州", "大理"]);
    expect(resolveSpinner("@array/cities", table)).toEqual(["北京", "上海"]);
    expect(resolveSpinner("@array/nope", table)).toBeNull();
    expect(resolveSpinner(undefined, table)).toBeNull();
    // 旧 API 兼容：不给资源表时 @array 给占位候选而不是 null
    expect(spinnerOptions("@array/cities")[0]).toContain("未解析");
    expect(spinnerOptions(undefined)).toEqual(["选项一", "选项二", "选项三"]);
  });
});
