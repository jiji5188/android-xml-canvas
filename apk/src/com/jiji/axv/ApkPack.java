package com.jiji.axv;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.CRC32;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * M192：把 aapt2 出来的「纯资源 apk」变成「可安装 apk」。
 *
 * 干两件事：
 * 1) 塞一个 classes.dex（APK 里有一个能启动的 Activity 才能装上点开）
 * 2) 保证 resources.arsc 是「不压缩 + 4 字节对齐」（Android 要求，否则安装后读不到资源）
 *
 * ⚠ 为什么不用 java.util.zip.ZipOutputStream：它给 DEFLATED 条目一律置 flag bit 3
 *   并写 data descriptor（因为流式写不知道压缩后大小）。Android 的 libziparchive 对
 *   带 data descriptor 的 apk 很不友好（apk 内的 resources.arsc/classes.dex 会读不出来，
 *    典型表现：装不上或装上秒崩）。所以这里手写 zip：本地头里直接写 crc/csize/size，
 *    flag = 0，全程没有 descriptor。
 *
 * 签名不在这里做 —— 交给 apksig（见 SigningBridge）。
 */
public final class ApkPack {

    private ApkPack() {}

    private static final int DOS_TIME = 0x0000;
    private static final int DOS_DATE = 0x0021; // 1980-01-01，固定值让产物可复现

    /** 必须不压缩且 4 字节对齐的条目（Android 运行时直接 mmap 这些文件） */
    private static boolean mustStore(String name) {
        return "resources.arsc".equals(name);
    }

    public static void addDexAndAlign(File inApk, byte[] dex, File outApk) throws IOException {
        addDexAndAlign(inApk, dex, null, outApk);
    }

    /**
     * M211：shell dex 占 classes.dex，用户在 Studio 里编好的 dex 依次作 classes2.dex / classes3.dex …
     * （原生 multidex，API 21+ 自动加载）——这样布局里的自定义控件才能 inflate。
     */
    public static void addDexAndAlign(File inApk, byte[] dex, List<byte[]> extraDex, File outApk) throws IOException {
        List<String> names = new ArrayList<String>();
        List<byte[]> datas = new ArrayList<byte[]>();
        List<Boolean> stores = new ArrayList<Boolean>();

        names.add("classes.dex");
        datas.add(dex);
        stores.add(Boolean.FALSE);

        if (extraDex != null) {
            int idx = 2;
            for (byte[] d : extraDex) {
                if (d == null || d.length < 8) continue;
                names.add("classes" + idx + ".dex");
                datas.add(d);
                stores.add(Boolean.FALSE);
                idx++;
            }
        }

        ZipInputStream zis = new ZipInputStream(new FileInputStream(inApk));
        try {
            ZipEntry e;
            byte[] buf = new byte[64 * 1024];
            while ((e = zis.getNextEntry()) != null) {
                if (e.isDirectory()) continue;
                String name = e.getName();
                if ("classes.dex".equals(name)) continue;
                if (name.matches("classes[0-9]+\\.dex")) continue;
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                int r;
                while ((r = zis.read(buf)) > 0) bo.write(buf, 0, r);
                names.add(name);
                datas.add(bo.toByteArray());
                stores.add(Boolean.valueOf(mustStore(name)));
            }
        } finally {
            zis.close();
        }

        CRC32 crc32 = new CRC32();
        OutputStream os = new FileOutputStream(outApk);
        CountingOutputStream out = new CountingOutputStream(os);
        ByteArrayOutputStream cd = new ByteArrayOutputStream();
        int count = 0;
        try {
            for (int i = 0; i < names.size(); i++) {
                String name = names.get(i);
                byte[] raw = datas.get(i);
                boolean stored = stores.get(i).booleanValue();
                byte[] nameB = name.getBytes("UTF-8");

                crc32.reset();
                crc32.update(raw);
                long crc = crc32.getValue();

                byte[] body;
                int method;
                if (stored) {
                    method = 0; // STORED
                    body = raw;
                } else {
                    method = 8; // DEFLATED
                    body = deflate(raw);
                }

                long lho = out.count();
                int extraLen = 0;
                byte[] extra = null;
                if (stored) {
                    // 数据起点 = lho + 30 + nameLen + extraLen → 补到 4 的倍数
                    int pad = (int) ((4 - ((lho + 30 + nameB.length) % 4)) % 4);
                    if (pad > 0) {
                        if (pad < 4) pad += 4; // extra 字段要放得下 id(2)+len(2)
                        extra = new byte[pad];
                        extra[0] = (byte) 0xD9; // 与 zipalign 同款 extra id 0xd935
                        extra[1] = (byte) 0x35;
                        extra[2] = (byte) (pad - 4);
                        extra[3] = 0;
                        extraLen = pad;
                    }
                }

                // ---- 本地文件头 ----
                le32(out, 0x04034b50L);
                le16(out, 20); // version needed
                le16(out, 0); // flags：关键——不设 bit3，就不写 data descriptor
                le16(out, method);
                le16(out, DOS_TIME);
                le16(out, DOS_DATE);
                le32(out, crc);
                le32(out, body.length);
                le32(out, raw.length);
                le16(out, nameB.length);
                le16(out, extraLen);
                out.write(nameB);
                if (extra != null) out.write(extra);
                out.write(body);

                // ---- 中央目录条目 ----
                le32(cd, 0x02014b50L);
                le16(cd, 20); // version made by
                le16(cd, 20); // version needed
                le16(cd, 0); // flags
                le16(cd, method);
                le16(cd, DOS_TIME);
                le16(cd, DOS_DATE);
                le32(cd, crc);
                le32(cd, body.length);
                le32(cd, raw.length);
                le16(cd, nameB.length);
                le16(cd, 0); // extra
                le16(cd, 0); // comment
                le16(cd, 0); // disk start
                le16(cd, 0); // internal attrs
                le32(cd, 0); // external attrs
                le32(cd, lho);
                cd.write(nameB);
                count++;
            }

            long cdStart = out.count();
            byte[] cdBytes = cd.toByteArray();
            out.write(cdBytes);
            le32(out, 0x06054b50L);
            le16(out, 0);
            le16(out, 0);
            le16(out, count);
            le16(out, count);
            le32(out, cdBytes.length);
            le32(out, cdStart);
            le16(out, 0); // comment
        } finally {
            out.close();
        }
    }

    private static byte[] deflate(byte[] raw) {
        Deflater d = new Deflater(Deflater.DEFAULT_COMPRESSION, true);
        try {
            d.setInput(raw);
            d.finish();
            ByteArrayOutputStream bo = new ByteArrayOutputStream(Math.max(64, raw.length / 2));
            byte[] buf = new byte[64 * 1024];
            while (!d.finished()) {
                int n = d.deflate(buf);
                if (n <= 0) break;
                bo.write(buf, 0, n);
            }
            return bo.toByteArray();
        } finally {
            d.end();
        }
    }

    private static void le16(OutputStream o, int v) throws IOException {
        o.write(v & 0xff);
        o.write((v >>> 8) & 0xff);
    }

    private static void le32(OutputStream o, long v) throws IOException {
        o.write((int) (v & 0xff));
        o.write((int) ((v >>> 8) & 0xff));
        o.write((int) ((v >>> 16) & 0xff));
        o.write((int) ((v >>> 24) & 0xff));
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int r;
        while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
        return bo.toByteArray();
    }

    /** zip 里要写「已写出多少字节」，OutputStream 不暴露，包一层记数 */
    static final class CountingOutputStream extends OutputStream {
        private final OutputStream out;
        private long n;

        CountingOutputStream(OutputStream out) {
            this.out = out;
        }

        long count() {
            return n;
        }

        @Override
        public void write(int b) throws IOException {
            out.write(b);
            n++;
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            out.write(b, off, len);
            n += len;
        }

        @Override
        public void flush() throws IOException {
            out.flush();
        }

        @Override
        public void close() throws IOException {
            out.close();
        }
    }
}
