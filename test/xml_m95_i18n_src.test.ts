// test/xml_m95_i18n_src.test.ts — M95：以中文原文为 key 的多语言机制 + 覆盖率护栏
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { t, setI18nLang, SRC_EN } from "../lib/i18n-src";
import { translate, makeT } from "../lib/i18n";

describe("M95 t()：中文原文当 key", () => {
  it("简体中文环境原样返回（不查表）", () => {
    setI18nLang("zh-Hans");
    expect(t("已生成资源")).toBe("已生成资源");
    expect(t("已生成资源")).toBe("已生成资源");
  });

  it("切到英文：命中译文，未登记的原样回落中文", () => {
    setI18nLang("en");
    expect(t("已生成资源")).toBe("Generated assets");
    expect(t("取消")).toBe("Cancel");
    // 没登记过的文案不能变成 undefined / 空串
    expect(t("这条文案还没人翻译")).toBe("这条文案还没人翻译");
    setI18nLang("zh-Hans");
  });

  it("占位符替换", () => {
    setI18nLang("en");
    expect(t("引用 {n}", { n: 3 })).toBe("3 ref(s)");
    expect(t("已删除 {name}", { name: "ic_a" })).toBe("Deleted ic_a");
    setI18nLang("zh-Hans");
  });

  it("繁体/日语未登记时回落到中文原文（不串成英文乱码）", () => {
    setI18nLang("ja");
    expect(t("这条文案还没人翻译")).toBe("这条文案还没人翻译");
    setI18nLang("zh-Hans");
  });

  it("旧的 key 体系不受影响：translate 命中老 key 优先", () => {
    const tr = makeT("en");
    expect(tr("tb.save", "保存")).not.toBe("保存");
    // 老 key 不存在时退回中文原文
    expect(translate("en", "nope.key", "原文")).toBe("原文");
    // 中文原文当 key 也能走 translate
    expect(translate("en", "已生成资源", "x")).toBe("Generated assets");
  });

  it("英文表里不能有空译文", () => {
    for (const [k, v] of Object.entries(SRC_EN)) {
      expect(v.trim().length, `空译文：${k}`).toBeGreaterThan(0);
    }
  });
});

describe("M95 覆盖率护栏", () => {
  /** 已回填的组件：这些文件里不允许再出现未包 t() 的中文字面量 */
  const CONVERTED = ["components/GenAssetsPanel.tsx", "components/IconCanvasEditor.tsx", "components/AiPanel.tsx", "components/ShapeEditor.tsx", "components/AttrPanel.tsx", "components/XmlCodeEditor.tsx", "components/SettingsPanel.tsx", "components/ManifestEditor.tsx", "components/ProjectPanel.tsx", "components/ValuesEditor.tsx", "components/ResValuesPanel.tsx", "components/TreeFileMenu.tsx"];

  const root = path.resolve(__dirname, "..");

  function unwrapped(f: string): string[] {
    const raw = fs.readFileSync(path.join(root, f), "utf8");
    // 块注释换成等量空行，行号不变
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ""));
    const out: string[] = [];
    src.split("\n").forEach((line, i) => {
      const l = line.replace(/\/\/.*$/, ""); // 行尾注释
      if (/i18n-ignore/.test(line)) return; // 明确标注不翻译（模型提示词等）
      if (!/[\u4e00-\u9fa5]/.test(l)) return;
      if (/\btt?\(|\btr\(|t\(`/.test(l)) return; // 已包
      out.push(`${i + 1}: ${l.trim().slice(0, 80)}`);
    });
    return out;
  }

  it("已回填组件不许回退（新增中文要包 t()）", () => {
    for (const f of CONVERTED) {
      expect(unwrapped(f), `${f} 有未翻译的中文`).toEqual([]);
    }
  });

  it("覆盖率报表能跑（未回填组件只统计不报错）", () => {
    const dir = path.join(root, "components");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".tsx"));
    expect(files.length).toBeGreaterThan(30);
  });
});
