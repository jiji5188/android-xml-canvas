import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const repo = path.resolve(__dirname, "..");
const mainJava = fs.readFileSync(path.join(repo, "apk/src/com/jiji/axv/MainActivity.java"), "utf8");

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
