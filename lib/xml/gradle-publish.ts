// lib/xml/gradle-publish.ts — M189：发布信息（版本号 / SDK 级别 / 发布前检查）
//
// 和 project-info.ts 一样走「纯文本外科手术」，不做 AST：只认 Android 工程里
// 最常见的 `versionCode 1` / `versionCode = 1` / `versionName '1.0'` 三种写法。
// 找不到就返回 null —— 让 UI 提示，不猜也不新建。

export interface PublishInfo {
  versionCode: number | null;
  versionName: string | null;
  applicationId: string | null;
  namespace: string | null;
  minSdk: number | null;
  targetSdk: number | null;
  compileSdk: number | null;
}

/** 读 `key 值` / `key = 值`（不要求引号，数字/字符串都行） */
function readRaw(text: string, key: string): string | null {
  const m = new RegExp(`(?<![\\w])${key}[ \\t]*=?[ \\t]*["']?([\\w.\\-]+)["']?`).exec(text);
  return m ? m[1] : null;
}

function readNum(text: string, key: string): number | null {
  const raw = readRaw(text, key);
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

/** 读版本与 SDK 信息；任何一项没有就 null */
export function readPublishInfo(gradle: string): PublishInfo {
  return {
    versionCode: readNum(gradle, "versionCode"),
    versionName: readRaw(gradle, "versionName"),
    applicationId: readRaw(gradle, "applicationId"),
    namespace: readRaw(gradle, "namespace"),
    minSdk: readNum(gradle, "minSdk"),
    targetSdk: readNum(gradle, "targetSdk"),
    compileSdk: readNum(gradle, "compileSdk"),
  };
}

export interface SetVersionInput {
  versionCode?: number | null;
  versionName?: string | null;
}

/** 改写 versionCode / versionName（保持原有写法风格：原来带不带 = 跟着走）。
 *  只改传了的那几项；一项都没传视作失败。 */
export function setPublishVersion(
  gradle: string,
  input: SetVersionInput,
): { ok: boolean; text: string; msg?: string } {
  let next = gradle;
  let changed = 0;

  if (input.versionCode != null) {
    const v = Math.max(1, Math.floor(input.versionCode));
    const re = /((?<![\w])versionCode[ \t]*=?[ \t]*)(\d+)/;
    if (re.test(next)) {
      next = next.replace(re, `$1${v}`);
      changed++;
    }
  }

  if (input.versionName != null && input.versionName.trim()) {
    const v = input.versionName.trim();
    // 引号风格保持一致：原来是 '…' 就用 '，是 "…" 就用 "
    const re = /((?<![\w])versionName[ \t]*=?[ \t]*)(["'])([^"']*)\2/;
    const m = re.exec(next);
    if (m) {
      next = next.replace(re, `$1${m[2]}${v}${m[2]}`);
      changed++;
    }
  }

  if (changed === 0) return { ok: false, text: gradle, msg: "build.gradle 里没找到对应的版本字段" };
  return { ok: true, text: next };
}

/** versionCode +1（发布一次升一位） */
export function bumpVersionCode(gradle: string, delta = 1): { ok: boolean; text: string; next?: number } {
  const cur = readPublishInfo(gradle).versionCode;
  if (cur == null) return { ok: false, text: gradle };
  const want = Math.max(1, cur + delta);
  const r = setPublishVersion(gradle, { versionCode: want });
  return { ok: r.ok, text: r.text, next: want };
}

export type PublishIssueLevel = "error" | "warn" | "info";

export interface PublishIssue {
  level: PublishIssueLevel;
  msg: string;
  /** 可一键修的动作标识（UI 决定怎么处理） */
  fix?: "bump-version" | "set-package" | "enable-v2";
}

export interface PublishCheckInput {
  info: PublishInfo;
  /** keystore 文件是否真的存在（undefined = 没检查） */
  keystoreExists?: boolean;
  /** keystore 相对路径（提示文案用） */
  storeFile?: string;
  /** 是否至少开了一种签名 scheme */
  anyScheme?: boolean;
  /** 应用名是否是默认值（Android Studio 默认 My Application / 空） */
  defaultAppName?: boolean;
}

/** 发布前检查：返回按严重程度排过序的问题列表（空 = 可以发） */
export function checkPublish(input: PublishCheckInput): PublishIssue[] {
  const out: PublishIssue[] = [];
  const { info } = input;

  if (info.versionCode == null) {
    out.push({ level: "error", msg: "build.gradle 里没有 versionCode，无法发布" });
  } else if (info.versionCode < 1) {
    out.push({ level: "error", msg: "versionCode 必须 ≥ 1", fix: "bump-version" });
  }

  if (!info.versionName || !info.versionName.trim()) {
    out.push({ level: "warn", msg: "没有 versionName，应用内看不到版本号" });
  }

  const pkg = info.applicationId || info.namespace;
  if (!pkg || !/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)+$/.test(pkg)) {
    out.push({ level: "error", msg: "包名不合法（要像 com.example.app）", fix: "set-package" });
  } else if (pkg.startsWith("com.example")) {
    out.push({ level: "warn", msg: "包名还是 com.example.* —— 上架前建议改成自己的域名", fix: "set-package" });
  }

  if (info.minSdk == null) {
    out.push({ level: "warn", msg: "没有设置 minSdk，低版本设备无法安装" });
  }
  if (info.targetSdk != null && info.minSdk != null && info.targetSdk < info.minSdk) {
    out.push({ level: "error", msg: "targetSdk 比 minSdk 还小，构建会失败" });
  }

  if (input.anyScheme === false) {
    out.push({ level: "error", msg: "v1/v2/v3 全关，Android 7 以上装不上", fix: "enable-v2" });
  }

  if (input.keystoreExists === false) {
    out.push({
      level: "warn",
      msg: `keystore 文件还不存在（${input.storeFile || ".axv/release.keystore"}）——配置先写好，签名文件需要生成`,
    });
  }

  if (input.defaultAppName) {
    out.push({ level: "info", msg: "应用名还是默认值，桌面图标下会显示它" });
  }

  const order: Record<PublishIssueLevel, number> = { error: 0, warn: 1, info: 2 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}
