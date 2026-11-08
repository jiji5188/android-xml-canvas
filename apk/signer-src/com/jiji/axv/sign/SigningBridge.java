package com.jiji.axv.sign;

import com.android.apksig.ApkSigner;

import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.Certificate;
import java.security.cert.X509Certificate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * M192：把 apksig（官方签名实现）包成「一次调用」的静态方法。
 *
 * 为什么要绕这一层：设备上没有 apksigner 命令行，但 apksig 本身是纯 Java。
 * build.mjs 会把本类和 apksigner.jar 一起 dex 成 assets/apksig/signer.dex，
 * 运行时用 DexClassLoader 加载，反射调 sign(...)。
 * 这样签名完全交给官方实现（v1/v2/v3 都正确），不用自己拼 ASN.1 和签名块格式。
 */
public final class SigningBridge {

    private SigningBridge() {}

    /**
     * @param inApk      已对齐（4 字节）但未签名的 apk
     * @param outApk     输出路径
     * @param keystore   PKCS#12 文件
     * @param storePass  keystore 口令
     * @param alias      别名（空则取第一个）
     * @param keyPass    私钥口令（空则用 storePass）
     * @param minSdk     目标最小 SDK（决定是否加 v1）
     * @return "ok:<字节数>" 或 "err:<原因>"
     */
    public static String sign(String inApk, String outApk, String keystore, String storePass, String alias,
            String keyPass, int minSdk) {
        try {
            char[] sp = storePass == null ? new char[0] : storePass.toCharArray();
            KeyStore ks = KeyStore.getInstance("PKCS12");
            FileInputStream in = new FileInputStream(keystore);
            try {
                ks.load(in, sp);
            } finally {
                in.close();
            }
            String a = alias == null || alias.isEmpty() ? firstAlias(ks) : alias;
            char[] kp = (keyPass == null || keyPass.isEmpty() ? sp : keyPass.toCharArray());
            PrivateKey key = (PrivateKey) ks.getKey(a, kp);
            if (key == null) return "err:keystore 里没有别名 " + a;
            Certificate[] chain = ks.getCertificateChain(a);
            if (chain == null || chain.length == 0) return "err:别名 " + a + " 没有证书";

            List<X509Certificate> certs = new ArrayList<X509Certificate>();
            for (Certificate c : chain) {
                if (!(c instanceof X509Certificate)) return "err:证书不是 X.509";
                certs.add((X509Certificate) c);
            }

            ApkSigner.SignerConfig cfg = new ApkSigner.SignerConfig.Builder(a, key, certs).build();
            ApkSigner signer = new ApkSigner.Builder(Collections.singletonList(cfg))
                    .setInputApk(new File(inApk))
                    .setOutputApk(new File(outApk))
                    .setMinSdkVersion(minSdk)
                    .setV1SigningEnabled(minSdk < 24)
                    .setV2SigningEnabled(true)
                    .setV3SigningEnabled(true)
                    .build();
            signer.sign();
            return "ok:" + new File(outApk).length();
        } catch (Throwable t) {
            String m = t.getMessage();
            return "err:" + (m == null ? t.getClass().getSimpleName() : m);
        }
    }

    private static String firstAlias(KeyStore ks) throws Exception {
        java.util.Enumeration<String> e = ks.aliases();
        if (e.hasMoreElements()) return e.nextElement();
        throw new IllegalStateException("keystore 是空的");
    }
}
