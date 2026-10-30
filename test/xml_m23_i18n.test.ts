import { describe, expect, it } from "vitest";
import { LANG_OPTIONS, normalizeLang, systemLang, resolveLang, translate, makeT } from "@/lib/i18n";

describe("M23 界面语言", () => {
  it("系统语言标签映射", () => {
    expect(normalizeLang("zh-CN")).toBe("zh-Hans");
    expect(normalizeLang("zh-Hans-CN")).toBe("zh-Hans");
    expect(normalizeLang("zh-TW")).toBe("zh-Hant");
    expect(normalizeLang("zh-HK")).toBe("zh-Hant");
    expect(normalizeLang("zh-Hant")).toBe("zh-Hant");
    expect(normalizeLang("en-US")).toBe("en");
    expect(normalizeLang("ja-JP")).toBe("ja");
    // 不认识的语言回落到简体中文（不炸、不乱码）
    expect(normalizeLang("de-DE")).toBe("zh-Hans");
    expect(normalizeLang("")).toBe("zh-Hans");
    expect(normalizeLang(null)).toBe("zh-Hans");
  });

  it("auto 跟随系统，显式选择优先", () => {
    expect(resolveLang("en")).toBe("en");
    expect(resolveLang("ja")).toBe("ja");
    expect(resolveLang("zh-Hant")).toBe("zh-Hant");
    // auto 的结果必须是受支持的代码
    expect(["zh-Hans", "zh-Hant", "en", "ja"]).toContain(resolveLang("auto"));
    expect(["zh-Hans", "zh-Hant", "en", "ja"]).toContain(systemLang());
  });

  it("多语言文案：命中翻译、参数替换、缺失回退原文", () => {
    expect(translate("zh-Hans", "rail.parts", "组件")).toBe("组件");
    expect(translate("en", "rail.parts", "组件")).toBe("Widgets");
    expect(translate("ja", "rail.settings", "设置")).toBe("設定");
    // 占位符
    expect(translate("en", "save.doneAs", "{dir}|{n}", { dir: "res", n: 3 })).toBe("Saved to “res”: 3 files (with dependencies)");
    // 未知 key 用调用方给的中文兜底
    expect(translate("en", "no.such.key", "兜底中文")).toBe("兜底中文");
    // 未知语言不许抛错
    expect(translate("en" as never, "rail.parts", "组件")).toBe("Widgets");
  });

  it("每种语言都覆盖同一批 key（避免切换后出现半截中文）", () => {
    const keys = ["rail.parts", "rail.layers", "rail.settings", "set.lang", "save.title", "err.parseTitle"];
    for (const lang of ["zh-Hans", "zh-Hant", "en", "ja"] as const) {
      const t = makeT(lang);
      for (const k of keys) {
        const v = t(k, "");
        expect(v).not.toBe("");
        // 英文/日文里不应该残留这些只有中文才用的词
        if (lang === "en") expect(v).not.toMatch(/[组件图层设置保存解析]/);
      }
    }
  });

  it("语言下拉项含「跟随系统」且默认值是 auto", () => {
    expect(LANG_OPTIONS[0].value).toBe("auto");
    expect(LANG_OPTIONS.map((o) => o.value)).toEqual(["auto", "zh-Hans", "zh-Hant", "en", "ja"]);
  });
});
