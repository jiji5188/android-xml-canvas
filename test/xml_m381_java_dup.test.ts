// M381：io(SAF) 与 native 双通道扫同一 Java 文件时 rel 前缀不同 → 按 rel 去重失效，
// ECJ 报一片 "The type X is already defined"。按「包名+文件名」去重。
import { describe, it, expect } from "vitest";
import { javaIdentity, dedupeJavaSources } from "../lib/xml/java-files";

describe("M381 Java 源码按包名+文件名去重", () => {
  it("同一文件、不同 rel 前缀（SAF 根在 app/ vs native 根在项目根）→ 认成同一个", () => {
    const code = "package com.momo.ReturnSystem;\npublic class Cell {}\n";
    expect(javaIdentity("src/main/java/com/momo/ReturnSystem/Cell.java", code)).toBe(
      javaIdentity("app/src/main/java/com/momo/ReturnSystem/Cell.java", code),
    );
  });

  it("不同包的同名文件 → 不算重复（本来就是两个类型）", () => {
    const a = "package a.b;\npublic class Foo {}\n";
    const b = "package x.y;\npublic class Foo {}\n";
    expect(javaIdentity("a/Foo.java", a)).not.toBe(javaIdentity("x/Foo.java", b));
  });

  it("dedupeJavaSources：99 份里 49 个双份 → 保留 51 份（去重的进 dups）", () => {
    const list: { rel: string; text: string }[] = [];
    for (let i = 0; i < 49; i++) {
      const code = `package com.momo.ReturnSystem;\npublic class T${i} {}\n`;
      list.push({ rel: `src/main/java/com/momo/ReturnSystem/T${i}.java`, text: code });
      list.push({ rel: `app/src/main/java/com/momo/ReturnSystem/T${i}.java`, text: code });
    }
    list.push({ rel: "injected/AxvRuntimeLog.java", text: "package com.axv.runtime;\npublic class AxvRuntimeLog {}\n" });
    const r = dedupeJavaSources(list);
    expect(r.out.length).toBe(50); // 49 + 1
    expect(r.dups.length).toBe(49);
    // 保留的是先出现的那份（io 通道）
    expect(r.out[0].rel).toBe("src/main/java/com/momo/ReturnSystem/T0.java");
  });

  it("没有 package 声明的文件按默认包归组，同名仍算重复（ECJ 同样会报 already defined）", () => {
    const code = "public class Main {}\n";
    expect(javaIdentity("java/Main.java", code)).toBe(javaIdentity("app/java/Main.java", code));
  });
});
