import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(__dirname, "..");
// M239/M240：打包管线已从 MainActivity 抽到 BuildApkHelper。
// 这个测试校验的是「设备端打包链路的源码级约定」，不是「必须写在 MainActivity 里」，
// 所以两个文件拼起来查（谁持有代码都算数）。
const mainJava =
  fs.readFileSync(path.join(repo, "apk/src/com/jiji/axv/MainActivity.java"), "utf8") +
  "\n" +
  fs.readFileSync(path.join(repo, "apk/src/com/jiji/axv/BuildApkHelper.java"), "utf8");

describe("M213 设备端真编译（源码级约定）", () => {
  it("打包流程会读 javaSources / launchActivity", () => {
    expect(mainJava).toContain('p.optJSONArray("javaSources")');
    expect(mainJava).toContain('p.optString("launchActivity", "")');
  });

  it("aapt2 link 带 --java + --custom-package（生成 R.java 才能编译）", () => {
    expect(mainJava).toContain('"--java", genDir.getAbsolutePath()');
    expect(mainJava).toContain('"--custom-package", pkg');
  });

  it("编译顺序：ECJ → 收集 .class → D8 → 注入 extraDex → 再 pack", () => {
    const iEcj = mainJava.indexOf("compileProjectJava(javaSources");
    const iPack = mainJava.indexOf("ApkPack.addDexAndAlign");
    expect(iEcj).toBeGreaterThan(0);
    expect(iPack).toBeGreaterThan(iEcj);
    expect(mainJava).toContain('cl.loadClass("com.jiji.axv.compiler.EcjBridge")');
    expect(mainJava).toContain('cl.loadClass("com.jiji.axv.compiler.D8Bridge")');
  });

  it("编译器 dex 走内存加载（InMemoryDexClassLoader + ByteBuffer），不落盘避 Android14 限制", () => {
    expect(mainJava).toContain("InMemoryDexClassLoader");
    expect(mainJava).toContain("java.nio.ByteBuffer.wrap");
    expect(mainJava).not.toContain("InMemoryDexClassLoader(arr,");
  });

  it("注入的 dex 有护栏（大小上限 + dex 魔数）", () => {
    expect(mainJava).toContain("12 * 1024 * 1024");
    expect(mainJava).toContain("40L * 1024 * 1024");
    expect(mainJava).toContain("data[0] != 'd'");
  });

  it("清单固定指向壳，项目 Activity 走 axv.launcher meta-data 运行时接管", () => {
    expect(mainJava).toContain('axv.launcher');
    expect(mainJava).toContain('xmlAttr(launchActivity)');
    expect(mainJava).toContain('com.jiji.axv.shell.ShellActivity');
  });

  it("build.mjs 会跑 make-compiler 并把 tool*/android.jar 打进 assets/compiler", () => {
    const bm = fs.readFileSync(path.join(repo, "apk/build.mjs"), "utf8");
    expect(bm).toContain("make-compiler.mjs");
    expect(bm).toContain("assets/compiler/");
  });
});

// M242 回归护栏：M239 拆分时签名/加载器被「凭签名猜写」，真机 sign 步骤直接 NPE
// （Class.getConstructor on null）。这里锁死：必须用真 DexClassLoader + Class.forName + 静态 sign(7 参)。
describe("M242 签名/编译器加载器契约（防猜写回归）", () => {
  const helper = fs.readFileSync(path.join(repo, "apk/src/com/jiji/axv/BuildApkHelper.java"), "utf8");

  it("签名用真 DexClassLoader（不是自造的空壳 ClassLoader）", () => {
    expect(helper).toContain("new dalvik.system.DexClassLoader(");
    expect(helper).not.toContain("DexClassLoader2");
    expect(helper).toContain('Class.forName("com.jiji.axv.sign.SigningBridge", true, cl)');
  });

  it("反射的 sign 签名与 SigningBridge 源码一致（6 个 String + int minSdk，静态）", () => {
    // 调用侧
    expect(helper).toContain('c.getMethod("sign", String.class, String.class, String.class,');
    expect(helper).toContain("int.class);");
    expect(helper).toContain("m.invoke(null,");
    // 被调侧（唯一真相源）
    const bridge = fs.readFileSync(path.join(repo, "apk/signer-src/com/jiji/axv/sign/SigningBridge.java"), "utf8");
    expect(bridge).toMatch(/public static String sign\(String inApk, String outApk, String keystore/);
    // 静态方法 → 调用侧必须用 null 作实例，且不能出现 getConstructor().newInstance()
    expect(helper).not.toContain(".getConstructor().newInstance()");
  });

  it("签名 dex 必须设为只读（Android 14+ 禁止动态加载可写 dex）", () => {
    expect(helper).toContain("setReadOnly()");
    expect(helper).toContain("dex 文件无法设为只读");
  });

  it("编译器 dex 内存加载 + ECJ 资源父链（InMemoryDexClassLoader + ResClassLoader 服务 res/）", () => {
    expect(helper).toContain("new dalvik.system.InMemoryDexClassLoader(bb, null, resLoader)");
    expect(helper).toContain("new ResClassLoader(resDir, ctx.getClassLoader())");
    expect(helper).toContain("setContextClassLoader(cl)");
  });

  it("ensureCompiler 每次清空重解 + manifest 逐文件校验（sha256）", () => {
    expect(helper).toContain("deleteTree(dir)");
    expect(helper).toContain("sha256Hex(local)");
    expect(helper).toContain("编译器资源不完整");
  });

  it("D8 结果必须检查；dex 注入有总量护栏", () => {
    expect(helper).toContain("boolean d8Ok = Boolean.valueOf");
    expect(helper).toContain("dex 转换失败");
    expect(helper).toContain("40L * 1024 * 1024");
  });

  // M243 护栏：设备端曾长期「已编译 0 个 Java 类」——根因是 ECJ 参数只传选项、
  // 没把源码文件加进去 → ECJ 打印 usage 返回 true → D8 零输入 → 打出壳包。
  it("ECJ 参数必须包含源码文件 + R.java（M243）", () => {
    expect(helper).toContain("for (File f : files) ecjArgsList.add(f.getAbsolutePath())");
    expect(helper).toContain("ecjArgsList.addAll(rFiles)");
    expect(helper).toContain("-bootclasspath");
    expect(helper).toContain("ECJ 没产出任何 .class");
  });
});
