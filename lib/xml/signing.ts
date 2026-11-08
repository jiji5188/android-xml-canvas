// lib/xml/signing.ts — M188a：签名配置纯函数
// 生成/改写 app/build.gradle 的 signingConfigs + buildTypes 引用；keystore 参数校验。
// 全部纯函数（输入文本/参数，输出文本/结果），可单测，不碰文件 IO。

/** keystore 参数（生成或导入时用户填的） */
export interface SigningParams {
  /** 别名（alias）；空串 = 未设置 */
  alias: string;
  /** 口令（keystore password + key password，Android 默认同一个） */
  keyPassword: string;
  /** keystore 文件相对项目根的路径，默认 .axv/release.keystore */
  storeFile?: string;
  /** 算法：RSA（默认 2048）/ EC */
  algorithm?: "RSA" | "EC";
  /** RSA 位数（EC 时忽略） */
  keySize?: number;
  /** 有效期（天），默认 10000（约 27 年） */
  validityDays?: number;
  /** 签名 scheme 开关（apksigner 的） */
  v1?: boolean;
  v2?: boolean;
  v3?: boolean;
}

const PKG_ALIAS = /^[A-Za-z][A-Za-z0-9_]{0,49}$/;

export interface SigningCheckResult {
  ok: boolean;
  /** 第一个不 ok 的原因（中文），ok 时 null */
  error: string | null;
}

/** 校验一组签名参数，返回第一个错误（便于 UI 直接展示） */
export function validateSigning(p: SigningParams): SigningCheckResult {
  if (!p.alias.trim()) return { ok: false, error: "别名不能为空" };
  if (!PKG_ALIAS.test(p.alias.trim()))
    return { ok: false, error: "别名只能字母/数字/下划线，以字母开头（≤50 字符）" };
  if (!p.keyPassword) return { ok: false, error: "口令不能为空" };
  const size = p.keySize ?? 2048;
  if (p.algorithm === "RSA" && ![1024, 2048, 3072, 4096].includes(size))
    return { ok: false, error: "RSA 位数只能是 1024/2048/3072/4096" };
  const days = p.validityDays ?? 10000;
  if (days < 1) return { ok: false, error: "有效期至少 1 天" };
  if (!p.v1 && !p.v2 && !p.v3)
    return { ok: false, error: "至少启用一种签名 scheme（v1/v2/v3）" };
  return { ok: true, error: null };
}

/**
 * 在 build.gradle 文本里写入 signingConfigs + release 的 signingConfig 引用。
 * 幂等：已有 signingConfigs 块则整块替换；没有则插在 android { 内 defaultConfig 之后。
 * 返回 { ok, nextXml→nextGradle, changed, error }。
 */
export function applySigningToGradle(
  gradleText: string,
  p: SigningParams,
): { ok: boolean; next: string; changed: boolean; error: string | null } {
  const check = validateSigning(p);
  if (!check.ok) return { ok: false, next: gradleText, changed: false, error: check.error };

  const store = p.storeFile || ".axv/release.keystore";
  const alias = p.alias.trim();
  const pwd = p.keyPassword;
  const v1 = p.v1 ?? true;
  const v2 = p.v2 ?? true;
  const v3 = p.v3 ?? true;

  // 生成 gradle 片段
  const signingBlock = [
    `    signingConfigs {`,
    `        release {`,
    `            storeFile file('${store}')`,
    `            storePassword '${pwd}'`,
    `            keyAlias '${alias}'`,
    `            keyPassword '${pwd}'`,
    `            enableV1Signing ${v1}`,
    `            enableV2Signing ${v2}`,
    `            enableV3Signing ${v3}`,
    `        }`,
    `    }`,
  ].join("\n");

  // 找 android { 块（可能带插件式 DSL）
  const androidIdx = gradleText.search(/\bandroid\s*\{/);
  if (androidIdx < 0)
    return { ok: false, next: gradleText, changed: false, error: "没找到 android { 块" };

  // 先去掉已有的 signingConfigs 块（从 signingConfigs { 到配对的 }）
  let text = removeBlock(gradleText, /signingConfigs\s*\{/);

  // 去掉 release 里旧的 signingConfig 行（避免重复）
  text = text.replace(
    /(\s*signingConfig\s+signingConfigs\.release\s*\n?)/g,
    "",
  );

  // 插入点：android { 之后的下一行（defaultConfig 之前）最稳
  const afterAndroid = text.indexOf("{", androidIdx);
  if (afterAndroid < 0)
    return { ok: false, next: gradleText, changed: false, error: "android { 结构不对" };
  const insertAt = afterAndroid + 1;
  text = text.slice(0, insertAt) + "\n" + signingBlock + text.slice(insertAt);

  // release buildType 里加 signingConfig（如果还没有）
  const releaseIdx = text.search(/\brelease\s*\{/);
  if (releaseIdx >= 0) {
    const braceStart = text.indexOf("{", releaseIdx);
    const braceEnd = findClosingBrace(text, braceStart);
    if (braceEnd > braceStart && !text.slice(braceStart, braceEnd).includes("signingConfig")) {
      text =
        text.slice(0, braceStart + 1) +
        "\n            signingConfig signingConfigs.release" +
        text.slice(braceStart + 1);
    }
  }

  const changed = text !== gradleText;
  return { ok: true, next: text, changed, error: null };
}

/** 去掉 name { ... } 整块（含 name 那一行）；没有就原样返回 */
function removeBlock(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return text;
  const start = m.index;
  const braceStart = text.indexOf("{", start);
  if (braceStart < 0) return text;
  const braceEnd = findClosingBrace(text, braceStart);
  if (braceEnd <= braceStart) return text;
  // 向后吃到换行/块尾，避免留空行
  let end = braceEnd + 1;
  if (text[end] === "\n") end++;
  return text.slice(0, start) + text.slice(end);
}

/** 从 openBrace 位置找到配对的 }（跳过字符串） */
function findClosingBrace(text: string, open: number): number {
  let depth = 0;
  let inStr: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (c === inStr && text[i - 1] !== "\\") inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") inStr = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return text.length - 1;
}

/** M188c：项目里根本没有 app/build.gradle 时，生成一份带签名的基础模板。
 *  之所以要它：用户打开的是轻量工程（只建了 res/layout）或旧工程，
 *  以前会直接报「先建项目」把路堵死；现在允许当场生成。
 *  pkg 不传默认 com.example.app（不猜项目名，以免猜错包名）。 */
export function defaultAppGradle(p: SigningParams, pkg?: string): {
  ok: boolean;
  next: string;
  error: string | null;
} {
  const check = validateSigning(p);
  if (!check.ok) return { ok: false, next: "", error: check.error };
  const store = p.storeFile || ".axv/release.keystore";
  const alias = p.alias.trim();
  const pwd = p.keyPassword;
  const v1 = p.v1 ?? true;
  const v2 = p.v2 ?? true;
  const v3 = p.v3 ?? true;
  const id = (pkg || "com.example.app").trim();
  return {
    ok: true,
    error: null,
    next: [
      "// 由 XML 画板生成的基础 app/build.gradle（含 release 签名配置）",
      "plugins {",
      "    id 'com.android.application'",
      "}",
      "",
      "android {",
      `    namespace '${id}'`,
      "    compileSdk 34",
      "",
      "    defaultConfig {",
      `        applicationId '${id}'`,
      "        minSdk 24",
      "        targetSdk 34",
      "        versionCode 1",
      "        versionName '1.0'",
      "    }",
      "",
      "    signingConfigs {",
      "        release {",
      `            storeFile file('${store}')`,
      `            storePassword '${pwd}'`,
      `            keyAlias '${alias}'`,
      `            keyPassword '${pwd}'`,
      `            enableV1Signing ${v1}`,
      `            enableV2Signing ${v2}`,
      `            enableV3Signing ${v3}`,
      "        }",
      "    }",
      "",
      "    buildTypes {",
      "        release {",
      "            minifyEnabled false",
      "            signingConfig signingConfigs.release",
      "        }",
      "    }",
      "}",
      "",
      "dependencies {",
      "}",
      "",
    ].join("\n"),
  };
}

/** 读取 build.gradle 里已有的 signingConfigs（解析成参数，UI 回填用）；没有就 null */
export function readSigningFromGradle(
  gradleText: string,
): SigningParams | null {
  const m = gradleText.match(
    /signingConfigs\s*\{\s*(?:\w+\s*\{[\s\S]*?\}\s*)+\}/,
  );
  if (!m) return null;
  const block = m[0];
  const pick = (re: RegExp) => block.match(re)?.[1] ?? "";
  const bool = (re: RegExp) => {
    const v = pick(re);
    return v ? v === "true" : undefined;
  };
  return {
    alias: pick(/keyAlias\s+'([^']*)'/),
    keyPassword: pick(/keyPassword\s+'([^']*)'/),
    storeFile: pick(/storeFile\s+file\('([^']*)'\)/) || ".axv/release.keystore",
    algorithm: "RSA",
    keySize: 2048,
    validityDays: 10000,
    v1: bool(/enableV1Signing\s+(true|false)/),
    v2: bool(/enableV2Signing\s+(true|false)/),
    v3: bool(/enableV3Signing\s+(true|false)/),
  };
}
