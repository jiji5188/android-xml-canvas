import { describe, it } from "vitest";
import { highlightXml } from "@/components/XmlCodeEditor";

const cases = [
  ['<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">\n  <TextView android:text="oops"\n', "残缺标签"],
  ["这不是 xml {{{ <<< >>> 乱写", "垃圾"],
  ["<LinearLayout>", "半截"],
  ["", "空"],
  ["<a b=", "残缺属性"],
  ["<a b='", "残缺引号"],
  ["<a ", "残缺名"],
  ["</", "残缺闭合"],
  ["<!-- 未闭合注释", "残缺注释"],
  ["<?xml ", "残缺声明"],
  ["@" .repeat(5000), "长文本"],
];

describe("highlightXml 容错", () => {
  for (const [src, name] of cases) {
    it(name, () => {
      const out = highlightXml(src);
      if (typeof out !== "string") throw new Error("不是字符串");
    });
  }
});
