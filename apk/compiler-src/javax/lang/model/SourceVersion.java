package javax.lang.model;

/**
 * M245：设备端 ECJ 桩。
 *
 * 背景：make-compiler 把 ECJ 本体 dex 进 Android 的 tool dex，但 Android（ART）运行时
 * 没有 `java.compiler` 模块，也就没有 `javax.lang.model.*`。ECJ 的 batch.Main 在解析
 * `-source/-target`、以及 9+ 的 module 路径时会 link 到 `javax.lang.model.SourceVersion`，
 * 于是 `NoClassDefFoundError: Ljavax/lang/model/SourceVersion`。
 *
 * 这里放一份与 JDK API 兼容的最小实现，随 compiler dex 一起打进 APK，运行时由
 * 「编译器 classloader」加载（和 ECJ 同 dex，天然可见），ECJ 就能正常 link。
 *
 * 只覆盖 ECJ 真正用到的静态成员与方法；不引入对 java.* 以外类的依赖。
 */
public final class SourceVersion {

    public static final SourceVersion RELEASE_1_3  = valueOf("1.3");
    public static final SourceVersion RELEASE_1_4  = valueOf("1.4");
    public static final SourceVersion RELEASE_1_5  = valueOf("1.5");
    public static final SourceVersion RELEASE_1_6  = valueOf("1.6");
    public static final SourceVersion RELEASE_1_7  = valueOf("1.7");
    public static final SourceVersion RELEASE_1_8  = valueOf("1.8");
    public static final SourceVersion RELEASE_9    = valueOf("9");
    public static final SourceVersion RELEASE_10   = valueOf("10");
    public static final SourceVersion RELEASE_11   = valueOf("11");
    public static final SourceVersion RELEASE_12   = valueOf("12");
    public static final SourceVersion RELEASE_13   = valueOf("13");
    public static final SourceVersion RELEASE_14   = valueOf("14");
    public static final SourceVersion RELEASE_15   = valueOf("15");
    public static final SourceVersion RELEASE_16   = valueOf("16");
    public static final SourceVersion RELEASE_17   = valueOf("17");
    public static final SourceVersion RELEASE_18   = valueOf("18");
    public static final SourceVersion RELEASE_19   = valueOf("19");

    /** ECJ 3.33 最高支持 19 */
    private static final SourceVersion LATEST = RELEASE_19;

    private final int major;
    private final int minor;

    private SourceVersion(int major, int minor) {
        this.major = major;
        this.minor = minor;
    }

    public static SourceVersion latest() {
        return LATEST;
    }

    public static boolean isSupported(int major, int minor) {
        return valueOf(major + "." + minor) != null;
    }

    public static boolean isSupported(String v) {
        return valueOf(v) != null;
    }

    public static SourceVersion valueOf(String v) {
        if (v == null || v.isEmpty()) return null;
        int dot = v.indexOf('.');
        int major, minor;
        if (dot >= 0) {
            try {
                major = Integer.parseInt(v.substring(0, dot));
                minor = Integer.parseInt(v.substring(dot + 1));
            } catch (NumberFormatException e) {
                return null;
            }
        } else {
            try {
                major = Integer.parseInt(v);
            } catch (NumberFormatException e) {
                return null;
            }
            minor = 0;
        }
        if (major == 1) {
            return (minor >= 3 && minor <= 8) ? new SourceVersion(major, minor) : null;
        }
        if (major >= 9 && major <= 19) {
            return (minor == 0) ? new SourceVersion(major, minor) : null;
        }
        return null;
    }

    public int major() {
        return major;
    }

    public int minor() {
        return minor;
    }

    @Override
    public String toString() {
        return major == 1 ? "1." + minor : String.valueOf(major);
    }
}
