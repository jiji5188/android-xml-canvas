package com.jiji.axv;

// M191：在设备上生成 release 签名用的 keystore（PKCS#12）
//
// 为什么能做：Android 里跑的是真 JVM（ART），java.security 的 KeyPairGenerator /
// Signature / KeyStore 全都在，缺的只是桌面 JDK 才有的 keytool 命令行工具。
// 所以这里用标准 Java API 自己造：
//   1) KeyPairGenerator 生成 RSA 2048
//   2) 手写 DER 拼一张自签名 X.509 证书（只有这段要自己写，其余都是 JDK 现成能力）
//   3) CertificateFactory 把 DER 读回成 X509Certificate 对象
//   4) KeyStore("PKCS12") + setKeyEntry + store → 真 .p12 / .keystore 文件
//
// 特意不依赖 android.*：同一份代码能在桌面 javac 编译、用 keytool 验证，然后原样打进 APK。
// minSdk 24 注意：不用 java.util.Base64（API 26 才有），本类也不需要。

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.math.BigInteger;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.TimeZone;

public final class KeystoreMaker {

    /** 生成失败抛异常，成功返回文件字节数 */
    public static long make(
            String path,
            String alias,
            String password,
            String cn,
            String org,
            int validYears) throws Exception {
        if (path == null || path.trim().isEmpty()) throw new IllegalArgumentException("路径为空");
        if (alias == null || alias.trim().isEmpty()) throw new IllegalArgumentException("别名为空");
        if (password == null || password.length() < 6) throw new IllegalArgumentException("口令至少 6 位");

        String name = (cn == null || cn.trim().isEmpty()) ? "Android App" : cn.trim();
        String o = (org == null || org.trim().isEmpty()) ? "Android" : org.trim();
        int years = validYears <= 0 ? 25 : Math.min(validYears, 100);

        KeyPairGenerator kpg = KeyPairGenerator.getInstance("RSA");
        kpg.initialize(2048, new SecureRandom());
        KeyPair kp = kpg.generateKeyPair();

        byte[] certDer = selfSignedCert(kp, name, o, years);
        X509Certificate cert = (X509Certificate) CertificateFactory
                .getInstance("X.509")
                .generateCertificate(new ByteArrayInputStream(certDer));

        KeyStore ks = KeyStore.getInstance("PKCS12");
        ks.load(null, null);
        ks.setKeyEntry(alias, kp.getPrivate(), password.toCharArray(),
                new java.security.cert.Certificate[] { cert });

        File f = new File(path);
        File dir = f.getParentFile();
        if (dir != null && !dir.exists()) {
            if (!dir.mkdirs() && !dir.exists()) throw new IllegalStateException("建目录失败：" + dir);
        }
        FileOutputStream fos = new FileOutputStream(f);
        try {
            ks.store(fos, password.toCharArray());
            fos.flush();
        } finally {
            try { fos.close(); } catch (Throwable ignored) { }
        }
        return f.length();
    }

    /* ================= 自签名 X.509（DER） ================= */

    private static byte[] selfSignedCert(KeyPair kp, String cn, String org, int years) throws Exception {
        byte[] tbs = tbsCertificate(kp, cn, org, years);

        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initSign(kp.getPrivate());
        sig.update(tbs);
        byte[] signature = sig.sign();

        ByteArrayOutputStream cert = new ByteArrayOutputStream();
        cert.write(seq(concat(tbs, algorithmSha256Rsa(), bitString(signature))));
        return cert.toByteArray();
    }

    private static byte[] tbsCertificate(KeyPair kp, String cn, String org, int years) {
        byte[] version = ctx0(integer(BigInteger.ZERO));      // [0] EXPLICIT v1
        byte[][] serialBytes = new byte[1][];
        long serial = Math.abs(new SecureRandom().nextLong());
        if (serial == 0) serial = 1;
        serialBytes[0] = integer(BigInteger.valueOf(serial));
        byte[] serialDer = serialBytes[0];

        byte[] algo = algorithmSha256Rsa();
        byte[] issuer = name(cn, org);
        byte[] validity = validity(years);
        byte[] subject = name(cn, org);
        byte[] spki = kp.getPublic().getEncoded(); // 已是 SubjectPublicKeyInfo DER

        return seq(concat(version, serialDer, algo, issuer, validity, subject, spki));
    }

    private static byte[] algorithmSha256Rsa() {
        // SEQUENCE { OID 1.2.840.113549.1.1.11, NULL }
        return seq(concat(oid(new int[] { 1, 2, 840, 113549, 1, 1, 11 }), new byte[] { 0x05, 0x00 }));
    }

    private static byte[] name(String cn, String org) {
        // RDNSequence = SEQUENCE OF SET OF SEQUENCE { OID, UTF8String }
        byte[] cnSet = set(seq(concat(oid(new int[] { 2, 5, 4, 3 }), utf8(cn))));
        byte[] orgSet = set(seq(concat(oid(new int[] { 2, 5, 4, 10 }), utf8(org))));
        return seq(concat(cnSet, orgSet));
    }

    private static byte[] validity(int years) {
        long now = System.currentTimeMillis();
        long day = 24L * 3600 * 1000;
        Date start = new Date(now - day);
        Date end = new Date(now + (long) years * 365 * day);
        return seq(concat(time(start), time(end)));
    }

    /** RFC 5280：年份 < 2050 用 UTCTime（两位年），≥2050 必须 GeneralizedTime（四位年）。
     *  写错会把 2051 解析成 1951 —— 已验证过的坑。 */
    private static byte[] time(Date d) {
        SimpleDateFormat y = new SimpleDateFormat("yyyy");
        y.setTimeZone(TimeZone.getTimeZone("UTC"));
        int year = Integer.parseInt(y.format(d));
        if (year >= 2050) {
            SimpleDateFormat f = new SimpleDateFormat("yyyyMMddHHmmss'Z'");
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            try {
                return tlv(0x18, f.format(d).getBytes("US-ASCII"));
            } catch (Exception e) {
                throw new IllegalStateException(e);
            }
        }
        return utcTime(utc(d));
    }

    private static String utc(Date d) {
        SimpleDateFormat f = new SimpleDateFormat("yyMMddHHmmss'Z'");
        f.setTimeZone(TimeZone.getTimeZone("UTC"));
        return f.format(d);
    }

    /* ================= DER 基础件 ================= */

    private static byte[] concat(byte[]... parts) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        for (byte[] p : parts) bos.write(p, 0, p.length);
        return bos.toByteArray();
    }

    /** 通用 TLV 包装 */
    private static byte[] tlv(int tag, byte[] body) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bos.write(tag);
        int n = body.length;
        if (n < 0x80) {
            bos.write(n);
        } else if (n < 0x100) {
            bos.write(0x81);
            bos.write(n);
        } else if (n < 0x10000) {
            bos.write(0x82);
            bos.write((n >> 8) & 0xff);
            bos.write(n & 0xff);
        } else {
            bos.write(0x83);
            bos.write((n >> 16) & 0xff);
            bos.write((n >> 8) & 0xff);
            bos.write(n & 0xff);
        }
        bos.write(body, 0, body.length);
        return bos.toByteArray();
    }

    private static byte[] seq(byte[] body) { return tlv(0x30, body); }

    private static byte[] set(byte[] body) { return tlv(0x31, body); }

    private static byte[] ctx0(byte[] body) { return tlv(0xA0, body); }

    private static byte[] utf8(String s) {
        try {
            return tlv(0x0C, s.getBytes("UTF-8"));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] utcTime(String s) {
        try {
            return tlv(0x17, s.getBytes("US-ASCII"));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private static byte[] bitString(byte[] bytes) {
        byte[] body = new byte[bytes.length + 1];
        body[0] = 0; // 0 个填充位
        System.arraycopy(bytes, 0, body, 1, bytes.length);
        return tlv(0x03, body);
    }

    private static byte[] integer(BigInteger v) {
        byte[] b = v.toByteArray(); // 已带符号位，正数可能多一个 0x00，DER 正好要求
        return tlv(0x02, b);
    }

    private static byte[] oid(int[] arcs) {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        bos.write(arcs[0] * 40 + arcs[1]);
        for (int i = 2; i < arcs.length; i++) {
            int v = arcs[i];
            byte[] tmp = new byte[5];
            int len = 0;
            tmp[len++] = (byte) (v & 0x7f);
            v >>>= 7;
            while (v > 0) {
                tmp[len++] = (byte) ((v & 0x7f) | 0x80);
                v >>>= 7;
            }
            for (int k = len - 1; k >= 0; k--) bos.write(tmp[k]);
        }
        return tlv(0x06, bos.toByteArray());
    }

    private KeystoreMaker() { }
}
