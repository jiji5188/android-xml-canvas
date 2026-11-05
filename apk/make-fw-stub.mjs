// apk/make-fw-stub.mjs —— 从 android.jar 里抠出 framework 的 resources.arsc，
// 打成一个极小的「framework 资源包」，给设备上的 aapt2 当 -I 用。
//
// 为什么需要：`aapt2 link` 必须拿 framework 资源来解析 android:layout_width 这类属性。
// 桌面版用 `-I android.jar` 就行，但手机上 /system/framework/framework-res.apk 常常
// 读不到（SELinux / 换了路径），实测 link 直接 exit=1: failed to load include path。
// android.jar 里就带着同一份 resources.arsc（17MB → 压完 4.4MB），塞进 assets 最稳。
//
// 用法：node apk/make-fw-stub.mjs <android.jar> <out.apk>
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

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
  return (c ^ 0xffffffff) >>> 0;
}

/** 从 zip 里读出一个条目（只支持 STORE / DEFLATE，够用） */
function readZipEntry(buf, want) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("不是合法 zip（找不到 EOCD）");
  const cdOffset = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("中央目录损坏");
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === want) {
      if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error("本地头损坏");
      const lNameLen = buf.readUInt16LE(localOff + 26);
      const lExtraLen = buf.readUInt16LE(localOff + 28);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(start, start + compSize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return zlib.inflateRawSync(raw);
      throw new Error("不支持的压缩方式 " + method);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const DOS = { time: 0x0021, date: 0x4f0b };

/** 写一个「只有一个条目」的 zip：内容 DEFLATE 压缩 */
function writeZip(outPath, name, data) {
  const nameBuf = Buffer.from(name, "utf8");
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(8, 8); // deflate
  local.writeUInt16LE(DOS.time, 10);
  local.writeUInt16LE(DOS.date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(8, 10);
  central.writeUInt16LE(DOS.time, 12);
  central.writeUInt16LE(DOS.date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);
  central.writeUInt16LE(0, 32);
  central.writeUInt16LE(0, 34);
  central.writeUInt16LE(0, 36);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42);

  const cdOffset = local.length + nameBuf.length + deflated.length;
  const cdSize = central.length + nameBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, Buffer.concat([local, nameBuf, deflated, central, nameBuf, eocd]));
}

function main() {
  const [jar, out] = process.argv.slice(2);
  if (!jar || !out) {
    console.error("用法: node apk/make-fw-stub.mjs <android.jar> <out.apk>");
    process.exit(2);
  }
  const buf = fs.readFileSync(jar);
  const arsc = readZipEntry(buf, "resources.arsc");
  if (!arsc) throw new Error("android.jar 里没有 resources.arsc：" + jar);
  writeZip(out, "resources.arsc", arsc);
  const sz = fs.statSync(out).size;
  console.log(`framework 资源桩: ${out}  ${(sz / 1048576).toFixed(2)} MB（原始 ${(arsc.length / 1048576).toFixed(2)} MB）`);
}

main();
