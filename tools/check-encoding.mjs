#!/usr/bin/env node
// tools/check-encoding.mjs — 编码闸门：把「PowerShell 按 GBK 写源码」变成提交前/CI 直接拒收。
//
// 背景：本仓库在 Windows 上用 PowerShell 干活，`Set-Content` / `Add-Content` / `Out-File`
// 默认按 GBK 落盘，中文注释会变成乱码 + U+FFFD，Turbopack 直接报 invalid utf-8（页面 500），
// 而 tsc / vitest 全绿，非常隐蔽。这条闸门替代「靠人自觉」。
//
// 用法：
//   node tools/check-encoding.mjs            # 检查 git 跟踪的源码文件
//   node tools/check-encoding.mjs --all      # 同上（保留参数位，方便以后扩）
//   node tools/check-encoding.mjs a.ts b.md  # 只查指定文件
//
// 退出码：0 = 全部干净；1 = 有文件需要修（附修法）。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** 只查这些后缀（其余当二进制/无关） */
const EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".css", ".scss", ".json", ".md", ".yml", ".yaml",
  ".gradle", ".kts", ".java", ".kt", ".xml", ".html",
]);

/** 已知合法例外：带 BOM / 含 U+FFFD 是有意为之的测试夹具 */
const ALLOW = [
  /(^|\/)_broken\//, // 故意放坏的夹具（含带 BOM 的一个）
  /^test\/xml_writeback\.test\.ts$/, // 故意带 BOM 当夹具
  /^AndroidManifest\.xml$/, // 根目录：aapt 编好的二进制 AXML（FF FE 头），不是文本
  /^apk\/AndroidManifest\.xml$/, // APK 壳的清单：带 BOM 但 aapt2 能正常读，不要动
  /^package-lock\.json$/,
];

/** 构建产物 / 导出目录：里面有小压缩文件的合法 U+FFFD，不参与检查 */
const SKIP_PREFIX = ["out/", ".next/", "shots/", "test-results/", "assets/www/", "tmpchk/", "tmp-apkchk/"];

/** 单文件上限 2MB（再大基本是产物） */
const MAX = 2 * 1024 * 1024;

function tracked() {
  try {
    const out = execFileSync("git", ["ls-files", "-z"], { encoding: "buffer" });
    return out.toString("utf8").split("\0").filter(Boolean);
  } catch {
    return [];
  }
}

/** 返回 null 表示没问题，否则返回问题描述 */
function inspect(file) {
  let buf;
  try {
    const st = fs.statSync(file);
    if (!st.isFile() || st.size > MAX) return null;
    buf = fs.readFileSync(file);
  } catch {
    return null;
  }
  if (buf.length === 0) return null;

  // 编译过的二进制 AXML（aapt2 产物：03 00 08 00 开头）——不是文本，跳过
  if (buf.length >= 4 && buf[0] === 0x03 && buf[1] === 0x00 && buf[2] === 0x08 && buf[3] === 0x00) return null;
  // PNG / JPEG / ZIP / gzip 头：二进制，跳过
  if (buf[0] === 0x89 && buf[1] === 0x50) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8) return null;
  if (buf[0] === 0x50 && buf[1] === 0x4b) return null;
  if (buf[0] === 0x1f && buf[1] === 0x8b) return null;

  // UTF-16 BOM：源码里一律不该出现
  if (buf.length >= 2 && ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff))) {
    return "UTF-16（带 BOM）—— 源码必须 UTF-8 无 BOM";
  }

  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = hasBom ? buf.subarray(3) : buf;

  let text;
  try {
    // fatal:true → 非法 UTF-8 直接抛（GBK 中文必然抛）
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    // 再确认一下是不是 GBK（如果 GBK 也解不出，就是纯二进制/损坏）
    let hint = "不是合法 UTF-8";
    try {
      const gbk = new TextDecoder("gbk").decode(body);
      if (/\uFFFD/.test(gbk) === false && /[\u4e00-\u9fff]/.test(gbk)) {
        hint = "疑似 GBK 编码（中文注释被 PowerShell 按 GBK 落盘）";
      }
    } catch {
      /* ignore */
    }
    return hint;
  }

  if (text.includes("\uFFFD")) return "含 U+FFFD 替换字符（已损坏，中文丢了）";
  if (hasBom) return "UTF-8 带 BOM —— 源码必须无 BOM";
  return null;
}

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = (args.length ? args : tracked()).filter((f) => {
  const norm = f.replace(/\\/g, "/");
  if (!EXTS.has(path.extname(f).toLowerCase())) return false;
  if (SKIP_PREFIX.some((p) => norm.startsWith(p))) return false;
  if (ALLOW.some((re) => re.test(norm))) return false;
  return true;
});

const bad = [];
for (const f of files) {
  const why = inspect(f);
  if (why) bad.push({ file: f, why });
}

if (bad.length === 0) {
  console.log(`✓ 编码检查通过（${files.length} 个文件，全部 UTF-8 无 BOM）`);
  process.exit(0);
}

console.error(`✗ 编码检查失败：${bad.length} / ${files.length} 个文件有问题\n`);
for (const b of bad) console.error(`  ${b.file}\n    → ${b.why}`);
console.error(`
修法：
  先确认是文本还是二进制：head 看开头字节 / 用编辑器打开
  GBK 乱码 → 用编辑器重写一遍（write/edit 工具固定 UTF-8 无 BOM）
  含 U+FFFD 的没法自动还原，需要手工补回中文
  中文文件一律用编辑器写，不要用 PowerShell 的 Set-Content / Add-Content / Out-File
`);
process.exit(1);
