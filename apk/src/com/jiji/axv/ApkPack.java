package com.jiji.axv;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * M192：把 aapt2 出来的「纯资源 apk」变成「可安装 apk」。
 *
 * 干两件事：
 * 1) 塞一个 classes.dex（APK 里有一个能启动的 Activity 才能装上点开）
 * 2) 保证 resources.arsc 是「不压缩 + 4 字节对齐」（Android 要求，否则安装后读不到资源）
 *
 * 注意：这里不写签名 —— 签名交给 apksig（见 SigningBridge），官方实现，v2/v3 都对。
 */
public final class ApkPack {

    private ApkPack() {}

    /** 需要对齐的条目（都要以 STORED 写） */
    private static boolean mustStore(String name) {
        return "resources.arsc".equals(name) || name.endsWith(".so") || name.startsWith("assets/") && false;
    }

    public static void addDexAndAlign(File inApk, byte[] dex, File outApk) throws IOException {
        FileOutputStream fos = new FileOutputStream(outApk);
        CountingOutputStream cout = new CountingOutputStream(fos);
        ZipOutputStreamEx zos = new ZipOutputStreamEx(cout);
        try {
            // classes.dex 放第一个（dex 优先，加载器不用翻目录）
            writeEntry(zos, cout, "classes.dex", dex, false);

            ZipInputStream zis = new ZipInputStream(new FileInputStream(inApk));
            try {
                ZipEntry e;
                byte[] buf = new byte[64 * 1024];
                while ((e = zis.getNextEntry()) != null) {
                    if (e.isDirectory()) continue;
                    String name = e.getName();
                    if ("classes.dex".equals(name)) continue;
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    int r;
                    while ((r = zis.read(buf)) > 0) bo.write(buf, 0, r);
                    writeEntry(zos, cout, name, bo.toByteArray(), mustStore(name));
                }
            } finally {
                zis.close();
            }
        } finally {
            try {
                zos.close();
            } catch (Throwable ignored) {
                // 已经在上面 close 过一次，忽略
            }
        }
    }

    private static void writeEntry(ZipOutputStreamEx zos, CountingOutputStream cout, String name, byte[] data,
            boolean stored) throws IOException {
        ZipEntry e = new ZipEntry(name);
        CRC32 crc = new CRC32();
        crc.update(data);
        e.setCrc(crc.getValue());
        e.setSize(data.length);
        e.setTime(1600000000000L); // 固定时间，产物可复现
        if (stored) {
            e.setMethod(ZipEntry.STORED);
            // 数据起点 = 当前位置 + 本地头(30) + 文件名 + extra → 补到 4 的倍数
            long headerEnd = cout.count() + 30 + name.length();
            int pad = (int) ((4 - (headerEnd % 4)) % 4);
            if (pad > 0) {
                if (pad < 4) pad += 4; // extra 字段至少 4 字节才能写 id+len
                byte[] extra = new byte[pad];
                extra[0] = (byte) 0xD9; // 与 zipalign 同款 extra id 0xd935
                extra[1] = (byte) 0x35;
                extra[2] = (byte) (pad - 4);
                extra[3] = 0;
                e.setExtra(extra);
            }
        } else {
            e.setMethod(ZipEntry.DEFLATED);
        }
        zos.putNextEntry(e);
        zos.write(data);
        zos.closeEntry();
    }

    /** ZipOutputStream 不暴露写出字节数，包一层记数用于算对齐 */
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

    /** 只为显式控制 close 顺序 */
    static final class ZipOutputStreamEx extends java.util.zip.ZipOutputStream {
        ZipOutputStreamEx(OutputStream out) {
            super(out);
        }
    }

    static byte[] readAll(InputStream in) throws IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[64 * 1024];
        int r;
        while ((r = in.read(buf)) > 0) bo.write(buf, 0, r);
        return bo.toByteArray();
    }
}
