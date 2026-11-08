// test/xml_m188a_signing.test.ts — M188a 签名纯函数
import { describe, it, expect } from "vitest";
import {
  validateSigning,
  applySigningToGradle,
  readSigningFromGradle,
  type SigningParams,
} from "../lib/xml/signing";

const BASE_GRADLE = [
  "plugins {",
  "    id 'com.android.application'",
  "}",
  "",
  "android {",
  "    namespace 'com.example.app'",
  "    compileSdk 34",
  "",
  "    defaultConfig {",
  "        applicationId \"com.example.app\"",
  "        minSdk 21",
  "        targetSdk 34",
  "        versionCode 1",
  '        versionName "1.0"',
  "    }",
  "",
  "    buildTypes {",
  "        release {",
  "            minifyEnabled false",
  "        }",
  "    }",
  "}",
].join("\n");

const P: SigningParams = {
  alias: "release",
  keyPassword: "secret123",
  storeFile: ".axv/release.keystore",
  algorithm: "RSA",
  keySize: 2048,
  validityDays: 10000,
  v1: true,
  v2: true,
  v3: true,
};

describe("validateSigning", () => {
  it("合法参数通过", () => {
    expect(validateSigning(P).ok).toBe(true);
  });
  it("空别名报", () => {
    const r = validateSigning({ ...P, alias: "" });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("别名");
  });
  it("数字开头别名报", () => {
    expect(validateSigning({ ...P, alias: "9x" }).ok).toBe(false);
  });
  it("RSA 位数字段非法报", () => {
    expect(validateSigning({ ...P, keySize: 1500 }).ok).toBe(false);
  });
  it("EC 不校验位数", () => {
    expect(
      validateSigning({ ...P, algorithm: "EC", keySize: 999 }).ok,
    ).toBe(true);
  });
  it("全关 scheme 报", () => {
    const r = validateSigning({ ...P, v1: false, v2: false, v3: false });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("scheme");
  });
  it("有效期 0 报", () => {
    expect(validateSigning({ ...P, validityDays: 0 }).ok).toBe(false);
  });
});

describe("applySigningToGradle", () => {
  it("从无到有：插入 signingConfigs + release 引用", () => {
    const r = applySigningToGradle(BASE_GRADLE, P);
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    expect(r.next).toContain("signingConfigs {");
    expect(r.next).toContain("keyAlias 'release'");
    expect(r.next).toContain("storeFile file('.axv/release.keystore')");
    // release 块里引用
    const rel = r.next.slice(r.next.indexOf("release {"));
    expect(rel).toContain("signingConfig signingConfigs.release");
  });
  it("幂等：已存在时替换不重复", () => {
    const once = applySigningToGradle(BASE_GRADLE, P);
    const twice = applySigningToGradle(once.next, P);
    expect(twice.ok).toBe(true);
    expect(twice.next.match(/signingConfigs \{/g)!.length).toBe(1);
    expect(twice.next.match(/signingConfig signingConfigs.release/g)!.length).toBe(1);
  });
  it("参数非法不动文件", () => {
    const r = applySigningToGradle(BASE_GRADLE, { ...P, alias: "" });
    expect(r.ok).toBe(false);
    expect(r.next).toBe(BASE_GRADLE);
  });
  it("scheme 开关写进 gradle", () => {
    const r = applySigningToGradle(BASE_GRADLE, { ...P, v3: false });
    expect(r.next).toContain("enableV3Signing false");
  });
  it("没有 android 块时报错", () => {
    const r = applySigningToGradle("plugins { id 'x' }", P);
    expect(r.ok).toBe(false);
  });
});

describe("readSigningFromGradle", () => {
  it("读回已写入的参数", () => {
    const written = applySigningToGradle(BASE_GRADLE, P).next;
    const back = readSigningFromGradle(written);
    expect(back).not.toBeNull();
    expect(back!.alias).toBe("release");
    expect(back!.keyPassword).toBe("secret123");
    expect(back!.storeFile).toBe(".axv/release.keystore");
    expect(back!.v1).toBe(true);
    expect(back!.v2).toBe(true);
    expect(back!.v3).toBe(true);
  });
  it("没有 signingConfigs 返回 null", () => {
    expect(readSigningFromGradle(BASE_GRADLE)).toBeNull();
  });
});
