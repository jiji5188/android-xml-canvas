// test/xml_m352_lib_index.test.ts — M2b：设备端索引第三方 .jar / .aar（zip + class 解析）
// 用仓库里真实存在的 androidx jar/aar 做夹具，验证类名/方法名能真被抽出来。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { indexLibs, mergeThirdLexicon, readZipEntries, parseClassInfo } from "@/lib/xml/lib-index";
import { buildLexicon, type LexSourceFile } from "@/lib/xml/lexicon";

const REPO = process.cwd();
const CARDVIEW_JAR = path.join(REPO, "apk/vendor/androidx/cardview-1.0.0.jar");
const CONSTRAINT_AAR = path.join(REPO, "apk/vendor/androidx/constraintlayout-1.0.0.aar");

function asLib(p: string) {
  return { rel: path.basename(p), base64: fs.readFileSync(p).toString("base64") };
}

const hasJar = fs.existsSync(CARDVIEW_JAR);
const hasAar = fs.existsSync(CONSTRAINT_AAR);

describe("M352 M2b readZipEntries", () => {
  it("能读出中央目录条目（jar 里有 .class）", () => {
    if (!hasJar) return expect(true).toBe(true);
    const entries = readZipEntries(new Uint8Array(fs.readFileSync(CARDVIEW_JAR)));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.some((e) => /\.class$/i.test(e.name))).toBe(true);
    expect(entries.some((e) => /androidx\/cardview\/widget\/CardView\.class$/.test(e.name))).toBe(true);
  });
});

describe("M352 M2b indexLibs（真实 jar）", () => {
  it("cardview.jar → 抽出 CardView 类 + setRadius 等方法", async () => {
    if (!hasJar) return expect(true).toBe(true);
    const r = await indexLibs([asLib(CARDVIEW_JAR)]);
    expect(r.classCount).toBeGreaterThan(0);
    expect(r.failed).toEqual([]);
    const cv = r.lex.classes.get("CardView");
    expect(cv).toBeTruthy();
    expect(cv?.source).toBe("third");
    expect(cv?.pkg).toBe("androidx.cardview.widget");
    const methods = (r.lex.methods.get("CardView") || []).map((m) => m.name);
    expect(methods).toContain("setRadius");
    expect(methods).toContain("setCardBackgroundColor");
  });
});

describe("M352 M2b indexLibs（真实 aar，含嵌套 classes.jar）", () => {
  it("constraintlayout.aar → 抽出 ConstraintLayout 类", async () => {
    if (!hasAar) return expect(true).toBe(true);
    const r = await indexLibs([asLib(CONSTRAINT_AAR)]);
    expect(r.classCount).toBeGreaterThan(0);
    const cl = r.lex.classes.get("ConstraintLayout");
    expect(cl).toBeTruthy();
    expect(cl?.pkg).toContain("constraintlayout");
  });
});

describe("M352 M2b parseClassInfo 容错", () => {
  it("非 class 字节 → null，不抛", () => {
    expect(parseClassInfo(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });
  it("坏库 base64 → 记入 failed，不炸", async () => {
    const r = await indexLibs([{ rel: "bad.jar", base64: Buffer.from("not a zip").toString("base64") }]);
    expect(r.failed).toContain("bad.jar");
    expect(r.classCount).toBe(0);
  });
});

describe("M352 M2b mergeThirdLexicon", () => {
  it("第三方同名类不覆盖项目类", async () => {
    if (!hasJar) return expect(true).toBe(true);
    const r = await indexLibs([asLib(CARDVIEW_JAR)]);
    const projFiles: LexSourceFile[] = [
      {
        rel: "app/src/main/java/com/demo/CardView.java",
        lang: "java",
        text: "package com.demo;\npublic class CardView { void myThing() {} }",
      },
    ];
    const proj = buildLexicon(projFiles);
    const merged = mergeThirdLexicon(proj, r.lex);
    // 项目自己的 CardView 优先，不掺库方法
    const cvMethods = (merged.methods.get("CardView") || []).map((m) => m.name);
    expect(cvMethods).toContain("myThing");
    expect(cvMethods).not.toContain("setRadius");
    expect(merged.classes.get("CardView")?.source).toBe("project");
    // 其它库类仍合并进来（至少还有 CardView 之外的类）
    expect(merged.classes.size).toBeGreaterThan(proj.classes.size);
  });
});
