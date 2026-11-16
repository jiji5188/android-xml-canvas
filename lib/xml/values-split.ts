// lib/xml/values-split.ts — M340：把合并的 values 片段拆成「标准 7 文件」
//
// 背景（用户 2026-11-17）：工具以前把上传/合并的 values 全塞进一个 values/res_values.xml，
// 不规范、大项目容易乱。Android 工程里 res/values/ 下是 7 个标准文件：
//   strings.xml（字符串）/ colors.xml（颜色）/ dimens.xml（尺寸 dp/sp）/
//   themes.xml（主题 Theme）/ styles.xml（控件 Style）/ arrays.xml（数组）/ integers.xml（数字）
// 这里按元素类型把片段归到对应文件；一个文件里同类多条正常共存，空的不生成。
//
// 只做「纯逻辑 + 可单测」，不碰 IO。导出/保存统一用它替代旧的 res_values.xml。

import { splitValueElements, type ValueElement } from "./values-merge";

/** 标准 values 文件名（顺序固定，导出好读） */
export const STANDARD_VALUES_FILES = [
  "strings.xml",
  "colors.xml",
  "dimens.xml",
  "integers.xml",
  "arrays.xml",
  "styles.xml",
  "themes.xml",
] as const;
export type StandardValuesFile = (typeof STANDARD_VALUES_FILES)[number];

/** 元素（tag + name）该进哪个标准文件 */
export function fileForElement(el: ValueElement): StandardValuesFile {
  const head = el.text.slice(0, el.text.indexOf(">") + 1);
  const tag = (/^<\s*([A-Za-z-]+)/.exec(el.text) || [])[1] || "";
  const name = (head.match(/\bname\s*=\s*"([^"]*)"/) || [])[1] || "";
  switch (tag) {
    case "string":
    case "plurals":
      return "strings.xml";
    case "color":
      return "colors.xml";
    case "dimen":
      return "dimens.xml";
    case "integer":
      return "integers.xml";
    case "array":
    case "string-array":
    case "integer-array":
      return "arrays.xml";
    case "style":
      return /^Theme\b/i.test(name) ? "themes.xml" : "styles.xml";
    case "declare-styleable":
    case "attr":
      return "styles.xml";
    case "item":
      // <item type="color"> 跟 type 走；没 type 的归 styles
      return typeOfFile(el.text) || "styles.xml";
    default:
      // bool / fraction / eat-comment 等少见标签：按语义归到最接近的标准文件
      if (tag === "bool" || tag === "fraction") return "dimens.xml";
      return "styles.xml";
  }
}

function typeOfFile(text: string): StandardValuesFile | "" {
  const head = text.slice(0, text.indexOf(">") + 1);
  const t = (head.match(/\btype\s*=\s*"([^"]*)"/) || [])[1] || "";
  switch (t) {
    case "string":
    case "plurals":
      return "strings.xml";
    case "color":
      return "colors.xml";
    case "dimen":
      return "dimens.xml";
    case "integer":
      return "integers.xml";
    case "bool":
      return "dimens.xml";
    default:
      return "";
  }
}

/** 把 values 片段拆成 7 个标准文件（只有非空的才进结果） */
export function splitValuesIntoStandardFiles(fragment: string): Record<string, string> {
  const groups: Record<StandardValuesFile, string[]> = {
    "strings.xml": [],
    "colors.xml": [],
    "dimens.xml": [],
    "integers.xml": [],
    "arrays.xml": [],
    "styles.xml": [],
    "themes.xml": [],
  };
  for (const el of splitValueElements(fragment)) {
    const f = fileForElement(el);
    groups[f].push(el.text.trim());
  }
  const out: Record<string, string> = {};
  for (const name of STANDARD_VALUES_FILES) {
    const body = groups[name];
    if (body.length === 0) continue;
    out[`values/${name}`] = wrap(name, body);
  }
  return out;
}

function wrap(file: string, body: string[]): string {
  const head = `<?xml version="1.0" encoding="utf-8"?>\n`;
  const comment = `<!-- ${file} -->\n`;
  return `${head}${comment}<resources>\n${body.join("\n")}\n</resources>\n`;
}
