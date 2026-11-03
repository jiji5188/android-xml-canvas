// test/xml_m93_locale_preview.test.ts — M93：多语言预览（values-<locale>/strings.xml）
// 用户痛点：中文布局在英文环境下会不会被撑坏，完全没法验证。
import { describe, expect, it } from "vitest";
import {
  buildResourceExtras,
  parseQualifier,
  parseValuesInto,
  decodeXmlEntities,
} from "../lib/xml/resdir";
import { resolveText, localeString } from "../lib/xml/resolve";
import { DEFAULT_RESOURCES, mergeResourceFragment } from "../lib/xml/resources";
import type { ResourceTable } from "../lib/xml/types";

function makeFile(text: string, name: string): File {
  const buf = Buffer.from(text, "utf8");
  return {
    name,
    type: "text/plain",
    size: buf.length,
    text: async () => text,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  } as unknown as File;
}

const DEFAULT_STRINGS = `<resources>
  <string name="app_name">我的应用</string>
  <string name="hello">你好</string>
</resources>`;

const EN_STRINGS = `<resources>
  <string name="app_name">My Application</string>
  <string name="hello">Hello</string>
</resources>`;

const ZH_RCN_STRINGS = `<resources>
  <string name="hello">你好呀（简体）</string>
</resources>`;

const EN_LONG = `<resources>
  <string name="app_name">A Very Long Application Name</string>
</resources>`;

describe("M93 限定符解析", () => {
  it("parseQualifier 认 night / 语言 / 版本号", () => {
    expect(parseQualifier("")).toEqual({ night: false, locale: "" });
    expect(parseQualifier("-night")).toEqual({ night: true, locale: "" });
    expect(parseQualifier("-en")).toEqual({ night: false, locale: "en" });
    expect(parseQualifier("-zh-rCN")).toEqual({ night: false, locale: "zh-rCN" });
    expect(parseQualifier("-zh-rCN-night")).toEqual({ night: true, locale: "zh-rCN" });
    expect(parseQualifier("-v21")).toEqual({ night: false, locale: "" });
    expect(parseQualifier("-land")).toEqual({ night: false, locale: "" });
  });

  it("parseValuesInto 抽 string 并反解实体", () => {
    const out: Record<string, string> = {};
    parseValuesInto(`<resources><string name="a">A &amp; B</string></resources>`, "string", out);
    expect(out.a).toBe("A & B");
    expect(decodeXmlEntities("&#39;x&#39;")).toBe("'x'");
  });
});

describe("M93 多语言预览", () => {
  async function load() {
    return buildResourceExtras([
      { name: "strings.xml", path: "res/values/strings.xml", file: makeFile(DEFAULT_STRINGS, "strings.xml") },
      { name: "strings.xml", path: "res/values-en/strings.xml", file: makeFile(EN_STRINGS, "strings.xml") },
      { name: "strings.xml", path: "res/values-zh-rCN/strings.xml", file: makeFile(ZH_RCN_STRINGS, "strings.xml") },
    ]);
  }

  it("resdir 收集 values-<locale>/strings.xml", async () => {
    const extras = await load();
    expect(Object.keys(extras.stringsByLocale ?? {}).sort()).toEqual(["en", "zh-rCN"]);
    expect(extras.stringsByLocale?.en.hello).toBe("Hello");
    expect(extras.stringsByLocale?.["zh-rCN"].hello).toBe("你好呀（简体）");
  });

  it("resolveText 按 locale 取值，缺项回落默认 values", async () => {
    const extras = await load();
    const base = mergeResourceFragment(extras.valuesXml);
    const table = {
      ...base,
      stringsByLocale: extras.stringsByLocale,
      locale: "en",
    } as ResourceTable;

    const issues: { level: "warn" | "error"; nodePath: string; message: string }[] = [];
    expect(resolveText("@string/hello", table, issues, "#0")).toBe("Hello");
    expect(resolveText("@string/app_name", table, issues, "#0")).toBe("My Application");
    // 英文包里没有的键 → 回落默认
    expect(localeString({ ...table, stringsByLocale: { en: {} } }, "hello")).toBe("你好");
  });

  it("zh-rCN 没写的键回落 zh，再回落默认", () => {
    const table = {
      ...DEFAULT_RESOURCES,
      strings: { hello: "默认" },
      stringsByLocale: { "zh-rCN": { hello: "简体" }, zh: { hello: "中文" }, en: {} },
      locale: "zh-rCN",
    } as ResourceTable;
    expect(localeString(table, "hello")).toBe("简体");
    expect(localeString({ ...table, stringsByLocale: { zh: { hello: "中文" } } }, "hello")).toBe("中文");
    expect(localeString({ ...table, stringsByLocale: {} }, "hello")).toBe("默认");
  });

  it("切到英文长文案时文本真的变了（能验证是否撑坏布局）", async () => {
    const extras = await buildResourceExtras([
      { name: "strings.xml", path: "res/values/strings.xml", file: makeFile(DEFAULT_STRINGS, "strings.xml") },
      { name: "strings.xml", path: "res/values-en-rUS/strings.xml", file: makeFile(EN_LONG, "strings.xml") },
    ]);
    const table = {
      ...mergeResourceFragment(extras.valuesXml),
      stringsByLocale: extras.stringsByLocale,
      locale: "en-rUS",
    } as ResourceTable;
    expect(localeString(table, "app_name")).toBe("A Very Long Application Name");
    // en-rUS 找不到时按 en 回落
    expect(localeString({ ...table, locale: "en" }, "app_name")).toBe("我的应用");
  });
});
