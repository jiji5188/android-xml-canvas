// lib/xml/zip.ts — 极简 ZIP 打包器（STORE 不压缩，纯 TS，无依赖）
// 用途：把 res/drawable/*.xml + res/layout/*.xml 打成一个 zip 下载，
// 让用户解压后直接放进 Android 工程，不会出现「找不到图标文件」。

export interface ZipEntry {
  /** zip 内路径，如 drawable/ic_search.xml */
  path: string;
  /** 文本内容（UTF-8） */
  text: string;
}

const CRC_TABLE: number[] = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return Array.from(t);
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 当前时间 → DOS 时间/日期（zip 头用） */
function dosDateTime(d: Date): { time: number; date: number } {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/** 打包成 zip（Uint8Array）；空列表也返回合法空 zip */
export function makeZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosDateTime(now);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.path);
    const data = enc.encode(e.text);
    const crc = crc32(data);

    // 本地文件头 30 + name
    const lh = new Uint8Array(30 + name.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); // 签名
    lv.setUint16(4, 20, true); // 版本
    lv.setUint16(6, 0x0800, true); // 通用标志：UTF-8 文件名
    lv.setUint16(8, 0, true); // 压缩方法：0 = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // 压缩后大小
    lv.setUint32(22, data.length, true); // 原始大小
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true); // extra 长度
    lh.set(name, 30);

    locals.push(lh, data);

    // 中央目录项 46 + name
    const ch = new Uint8Array(46 + name.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // 创建版本
    cv.setUint16(6, 20, true); // 需要版本
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true); // 本地头偏移
    ch.set(name, 46);
    centrals.push(ch);

    offset += lh.length + data.length;
  }

  const cdSize = centrals.reduce((n, c) => n + c.length, 0);
  // 结束记录 22
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total = offset + cdSize + eocd.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const chunk of [...locals, ...centrals, eocd]) {
    out.set(chunk, p);
    p += chunk.length;
  }
  return out;
}

/** 触发浏览器下载（Node 环境不调用） */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = "application/zip"): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
