// lib/xml/project-export.ts — M190：把整个项目打成「可编译源码包」zip
//
// 用途：手机里的项目没有 Gradle 环境，打不了 release APK。这个功能把项目
// 完整复制成一个 zip（含二进制 png/jar，跳过 .git / build / .gradle 等），
// 附一份 README_打包说明.txt（keytool 生成 keystore + 装 Gradle/Android Studio 的命令），
// 用户拷到电脑上解压后 5 分钟就能出包。
//
// 纯函数部分（shouldExportFile / buildExportReadme）可以单测；
// 文件遍历依赖 AiFileIo（native 走 bridge，web 走 ProjectSource），所以 collect 是 async。

import type { AiFileIo } from "./ai-tools";
import { makeZip, downloadBytes, type ZipEntry } from "./zip";
import { coreSkipDirs, withSkipExtras } from "./skip-dirs";

/** 这些目录整体跳过（构建产物 / VCS / IDE 缓存，没意义还占体积） */
const SKIP_DIRS = withSkipExtras(coreSkipDirs, "build");

/** 单个文件超过 6MB 就不打进去（keystore/jar 一般不会这么大，主要是防误打包） */
const MAX_FILE_BYTES = 6 * 1024 * 1024;
/** 总大小上限 80MB（base64 传输 + 手机上内存，留余量） */
const MAX_TOTAL_BYTES = 80 * 1024 * 1024;

/** 相对路径是否该打进 zip（纯函数，可单测） */
export function shouldExportFile(rel: string): boolean {
  const clean = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const segs = clean.split("/");
  for (const s of segs.slice(0, -1)) {
    if (SKIP_DIRS.has(s.toLowerCase())) return false;
  }
  return true;
}

export interface ExportReadmeOpts {
  projectName: string;
  pkg?: string | null;
  versionName?: string | null;
  storeFile?: string | null;
  alias?: string | null;
}

/** 打包说明：拷到电脑上的最小可行步骤 */
export function buildExportReadme(o: ExportReadmeOpts): string {
  const pkg = o.pkg || "（见 app/build.gradle）";
  const alias = o.alias || "release";
  const store = o.storeFile || ".axv/release.keystore";
  return [
    `# ${o.projectName} — 打包说明`,
    ``,
    `包名：${pkg}`,
    o.versionName ? `版本：${o.versionName}` : "",
    ``,
    `## 1. 生成签名文件（只需一次，Windows）`,
    ``,
    `把这段存成 make_keystore.bat 双击运行（按提示填口令，记得牢——忘了要重新生成）：`,
    ``,
    `    keytool -genkeypair -v \\`,
    `      -keystore ${store.replace(/^.*[\\/]/, "") || "release.keystore"}.keystore \\`,
    `      -alias ${alias} -keyalg RSA -keysize 2048 -validity 10000`,
    ``,
    `生成完把 .keystore 文件放进项目根目录的 ${store} 位置。`,
    ``,
    `## 2. 编译 release APK（电脑要有 JDK 17 + Android SDK）`,
    ``,
    `    # 第一次运行会下载依赖`,
    `    gradle wrapper          # 如果目录里没有 gradlew，先生成一次`,
    `    ./gradlew assembleRelease    # Windows: gradlew.bat assembleRelease`,
    ``,
    `产物在 app/build/outputs/apk/release/ 里。`,
    ``,
    `## 3. 上架前对照检查（手机里「签名与发布」弹层也能看）`,
    ``,
    `- [ ] 包名不是 com.example.*`,
    `- [ ] versionCode 比上一版大`,
    `- [ ] 图标换过（不是系统默认的 ic_launcher）`,
    `- [ ] keystore 已生成并填进 build.gradle`,
    ``,
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export interface CollectResult {
  ok: boolean;
  entries: ZipEntry[];
  skipped: string[];
  totalBytes: number;
  error?: string;
}

/** 递归遍历项目文件 → zip 条目（文本走 text、二进制走 bytes） */
export async function collectProjectFiles(
  io: AiFileIo,
  maxDepth = 8,
): Promise<CollectResult> {
  const entries: ZipEntry[] = [];
  const skipped: string[] = [];
  let total = 0;

  const walk = async (rel: string, depth: number) => {
    if (depth > maxDepth) {
      skipped.push(rel + "/（层级太深）");
      return;
    }
    const r = await io.list(rel);
    if (!r.ok) {
      skipped.push(rel ? `${rel}/（读不了：${r.error}）` : `（根目录读不了：${r.error}）`);
      return;
    }
    for (const it of r.items ?? []) {
      if (it.kind === "dir") {
        await walk(it.rel, depth + 1);
        continue;
      }
      // 文件
      if (!shouldExportFile(it.rel)) {
        skipped.push(`${it.rel}（跳过：构建产物/VCS）`);
        continue;
      }
      let ok = false;
      if (io.readBase64) {
        const b = await io.readBase64(it.rel);
        if (b.ok && b.base64) {
          const bytes = b64ToBytes(b.base64);
          if (bytes.length > MAX_FILE_BYTES) {
            skipped.push(`${it.rel}（>${MAX_FILE_BYTES / 1024 / 1024}MB）`);
          } else {
            entries.push({ path: it.rel, bytes });
            total += bytes.length;
            ok = true;
          }
        }
      }
      if (!ok) {
        const t = await io.read(it.rel);
        if (t.ok && typeof t.text === "string") {
          const bytes = new TextEncoder().encode(t.text);
          if (bytes.length > MAX_FILE_BYTES) {
            skipped.push(`${it.rel}（>${MAX_FILE_BYTES / 1024 / 1024}MB）`);
          } else {
            entries.push({ path: it.rel, text: t.text });
            total += bytes.length;
          }
        } else {
          skipped.push(`${it.rel}（读不到：${t.error ?? "未知"}）`);
        }
      }
      if (total > MAX_TOTAL_BYTES) {
        skipped.push("（总大小超 80MB，已截断——把大的 jar/so 手动补进去）");
        return;
      }
    }
  };

  await walk("", 0);
  if (entries.length === 0) {
    return { ok: false, entries, skipped, totalBytes: 0, error: "一个文件都没读到" };
  }
  return { ok: true, entries, skipped, totalBytes: total };
}

function b64ToBytes(b64: string): Uint8Array {
  // 手机 WebView 与 Node 都有 atob（Node 16+ 全局）
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ExportProjectOptions {
  io: AiFileIo;
  projectName: string;
  pkg?: string | null;
  versionName?: string | null;
  storeFile?: string | null;
  alias?: string | null;
  /** 不传就自动下载/保存 */
  onBytes?: (bytes: Uint8Array, filename: string) => void;
}

export interface ExportResult {
  ok: boolean;
  files: number;
  bytes: number;
  skipped: string[];
  filename?: string;
  error?: string;
}

/** 一键：收集 → 打包（含 README 与跳过清单）→ 下载/原生保存 */
export async function exportProjectZip(o: ExportProjectOptions): Promise<ExportResult> {
  const c = await collectProjectFiles(o.io);
  if (!c.ok) return { ok: false, files: 0, bytes: 0, skipped: c.skipped, error: c.error };

  const readme = buildExportReadme({
    projectName: o.projectName,
    pkg: o.pkg,
    versionName: o.versionName,
    storeFile: o.storeFile,
    alias: o.alias,
  });
  c.entries.push({ path: "README_打包说明.txt", text: readme });
  if (c.skipped.length > 0) {
    c.entries.push({ path: "跳过文件清单.txt", text: c.skipped.join("\n") });
  }

  const bytes = makeZip(c.entries);
  const filename = `${o.projectName}-src.zip`.replace(/[\\/:*?"<>|]/g, "-");
  if (o.onBytes) {
    o.onBytes(bytes, filename);
  } else {
    downloadBytes(bytes, filename);
  }
  return {
    ok: true,
    files: c.entries.length,
    bytes: bytes.length,
    skipped: c.skipped,
    filename,
  };
}
