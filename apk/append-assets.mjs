// apk/append-assets.mjs — 把静态站点以 STORE（无压缩、无 data descriptor）追加进 APK
//
// 背景：aapt2 在 Windows 上打 assets 会用反斜杠路径（AssetManager 读不到）；
// 而 .NET ZipArchive 追加条目又写 data descriptor（压缩流），Android 的
// libziparchive 解析它会在启动时直接崩（闪退）。
// 所以：用 aapt2 link（不带 -A）出基础包，自己追加 assets，全部 STORE。
//
// 原理：APK 就是 zip。读入现有 zip，保留「所有本地条目 + 原中央目录」字节原样
//（含 aapt2 的对齐 padding），只在尾部追加新条目并重算中央目录/EOCD。
// 新条目走 STORE：本地头里直接写死 crc/size，不产生 data descriptor。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// ---- CRC32（与 lib/xml/zip.ts 同款） ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = (CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)) >>> 0;
  return c ^ 0xffffffff >>> 0;
}

const DOS = { time: 0x0021, date: 0x4f0b }; // 固定时间戳，保证可复现

/** 从文件末尾找 EOCD，返回 { eocd, cdOffset, cdSize } */
function findEocd(buf) {
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return {
        eocd: i,
        cdOffset: buf.readUInt32LE(i + 16),
        cdSize: buf.readUInt32LE(i + 12),
      };
    }
  }
  throw new Error("找不到 EOCD，输入不是合法 zip");
}

function main() {
  const [apkPath, assetsDir] = [process.argv[2], process.argv[3]].map((s) => path.resolve(s));
  if (!apkPath || !assetsDir) {
    console.error("用法: node append-assets.mjs <apk> <assets-www-dir>");
    process.exit(2);
  }

  // 收集要追加的文件（保持目录序，稳定输出）
  const files = [];
  (function walk(dir, rel) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const r = rel ? rel + "/" + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else files.push(r);
    }
  })(assetsDir, "");

  const buf = fs.readFileSync(apkPath);
  const { cdOffset, cdSize } = findEocd(buf);
  if (cdOffset + cdSize !== buf.length - 22) {
    console.warn("警告：中央目录后还有字节（可能是其他工具追加的），仍按原样保留前缀");
  }

  // 前缀 = 所有本地条目（0 → cdOffset，含 aapt2 的 padding）
  const prefixLen = cdOffset;

  // 新条目：本地头 + 数据（STORE）
  const locals = [];
  const centrals = [];
  let localBytes = 0;
  const enc = new TextEncoder();

  for (const rel of files) {
    const data = fs.readFileSync(path.join(assetsDir, rel));
    const name = enc.encode("assets/www/" + rel);
    const crc = crc32(data);

    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 文件名
    lv.setUint16(8, 0, true); // STORE
    lv.setUint16(10, DOS.time, true);
    lv.setUint16(12, DOS.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    lh.set(name, 30);
    locals.push(lh, data);

    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS.time, true);
    cv.setUint16(14, DOS.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, prefixLen + localBytes, true); // 本地头偏移
    ch.set(name, 46);
    centrals.push(ch);

    localBytes += lh.length + data.length;
  }

  // 原中央目录条目原样搬进新中央目录（它们记录的本地头偏移仍然有效，前缀没动）
  const oldCentral = buf.subarray(cdOffset, cdOffset + cdSize);
  const newCdSize = oldCentral.length + centrals.reduce((n, c) => n + c.length, 0);
  const newCdOffset = prefixLen + localBytes;

  // 原来的 EOCD 里 count 是多少（保留原条目数）
  const oldEocdCount = buf.readUInt16LE(buf.length - 22 + 8);
  const newCount = oldEocdCount + files.length;

  const out = new Uint8Array(prefixLen + localBytes + newCdSize + 22);
  let p = 0;
  out.set(buf.subarray(0, prefixLen), p); p += prefixLen;
  for (const c of locals) { out.set(c, p); p += c.length; }
  out.set(oldCentral, p); p += oldCentral.length;
  for (const c of centrals) { out.set(c, p); p += c.length; }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, newCount, true);
  ev.setUint16(10, newCount, true);
  ev.setUint32(12, newCdSize, true);
  ev.setUint32(16, newCdOffset, true);
  ev.setUint16(20, 0, true);
  out.set(eocd, p);

  fs.writeFileSync(apkPath, out);
  console.log(`追加 ${files.length} 个 asset 文件（STORE），APK 现在 ${(out.length / 1048576).toFixed(2)} MB`);
}

main();
