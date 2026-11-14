package javax.lang.model;

/**
 * M249→M250：设备端 ECJ 桩（改为 enum）。
 *
 * 背景：make-compiler 把 ECJ 本体 dex 进 Android tool dex，但 ART 没有 `javax.lang.model.*`
 * （那是 JDK `java.compiler` 模块专属）。ECJ 会 link `javax.lang.model.SourceVersion`。
 *
 * 关键修正（M250）：真实 `javax.lang.model.SourceVersion` 是 **enum**。之前我写成普通
 * `final class`，导致 ART 字节码验证 `BatchAnnotationProcessorManager.configure` 时
 * 期望该类型是 `java.lang.Enum` 子类型（ECJ 按 enum 语义编译）→
 * `VerifyError: register v1 has type SourceVersion but expected java.lang.Enum`。
 * 改成 enum 后 supertype 链含 Enum，验证通过。
 *
 * API 面：覆盖 ECJ 真正用的 静态常量 / latest / valueOf / isSupported / major / minor。
 */
public enum SourceVersion {

    RELEASE_1_3(1, 3),
    RELEASE_1_4(1, 4),
    RELEASE_1_5(1, 5),
    RELEASE_1_6(1, 6),
    RELEASE_1_7(1, 7),
    RELEASE_1_8(1, 8),
    RELEASE_9(9, 0),
    RELEASE_10(10, 0),
    RELEASE_11(11, 0),
    RELEASE_12(12, 0),
    RELEASE_13(13, 0),
    RELEASE_14(14, 0),
    RELEASE_15(15, 0),
    RELEASE_16(16, 0),
    RELEASE_17(17, 0),
    RELEASE_18(18, 0),
    RELEASE_19(19, 0);

    /** ECJ 3.33 最高支持到 19 */
    public static final SourceVersion LATEST = RELEASE_19;
    public static final SourceVersion EARLIEST = RELEASE_1_3;

    private final int major;
    private final int minor;

    SourceVersion(int major, int minor) {
        this.major = major;
        this.minor = minor;
    }

    public static SourceVersion latest() {
        return LATEST;
    }

    public static boolean isSupported(int major, int minor) {
        return lookup(major + "." + minor) != null;
    }

    public static boolean isSupported(String v) {
        return lookup(v) != null;
    }

    /** 与 JDK 语义对齐：匹配不到返回 null（JDK 真实 valueOf 是 Enum.valueOf，找不到会抛 IAE；
     *  但 ECJ 这里主要拿它做「能不能编译到这个 level」的判断，null 更安全，不炸）。 */
    private static SourceVersion lookup(String v) {
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
        for (SourceVersion sv : values()) {
            if (sv.major == major && sv.minor == minor) return sv;
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
