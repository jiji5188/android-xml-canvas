import { describe, it, expect } from "vitest";
import { translate } from "../lib/i18n";

// M322：translate 中文界面必须正确返回中文，不能掉到英文 fallback
// 两套约定并存：A) key=命名键 + fallback=中文；B) key=中文原文 + fallback=英文
describe("M322 translate 中文界面不再误出英文", () => {
  it("B 类：中文 key + 英文 fallback → 中文界面返回中文 key", () => {
    const zh = translate("zh-Hans", "挑一个 Android 主题，写进项目的 themes.xml，预览与真机包都会用它。", "Pick an Android theme; ...");
    expect(zh).toBe("挑一个 Android 主题，写进项目的 themes.xml，预览与真机包都会用它。");
  });

  it("B 类：中文 key 在 SRC_EN 有登记 → 英文界面出英文", () => {
    const en = translate("en", "真预览", "Native preview");
    expect(en).toBe("Native preview");
  });

  it("A 类：命名键 + 中文 fallback → 中文界面出中文", () => {
    const zh = translate("zh-Hans", "err.parseTitle", "这个 XML 现在画不出来");
    expect(zh).toBe("这个 XML 现在画不出来");
  });

  it("A 类：命名键 → 英文界面出英文字典", () => {
    const en = translate("en", "err.parseTitle", "这个 XML 现在画不出来");
    expect(en).not.toMatch(/[\u4e00-\u9fff]/); // 不含中文
    expect(en.length).toBeGreaterThan(0);
  });

  it("占位符替换仍生效（中文 key）", () => {
    const zh = translate("zh-Hans", "已保存 {n} 个文件", "Saved {n} files", { n: 3 });
    expect(zh).toBe("已保存 3 个文件");
  });

  it("繁体：中文 key 无繁体译文时回退简体 key（不落到英文）", () => {
    const hant = translate("zh-Hant", "这是一个测试文案没有繁体", "This is a test");
    expect(hant).toBe("这是一个测试文案没有繁体");
  });
});
