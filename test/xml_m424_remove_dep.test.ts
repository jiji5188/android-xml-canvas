// test/xml_m424_remove_dep.test.ts — M424：removeImplementation（移除 = 删声明 + 删文件的前半）
import { describe, it, expect } from "vitest";
import { removeImplementation, insertImplementation } from "@/lib/xml/gradle-deps";
import { removeNoteKind } from "@/components/LibsPanel";

describe("M424 removeImplementation", () => {
  const G = "dependencies {\n    implementation 'com.example:lib:1.0.0'\n    implementation 'other:x:2.0'\n}\n";

  it("groovy：删掉匹配行，其它依赖保留", () => {
    const [next, hit] = removeImplementation(G, "com.example:lib:1.0.0");
    expect(hit).toBe(true);
    expect(next).toContain("other:x:2.0");
    expect(next).not.toContain("com.example:lib:1.0.0");
    expect(next).toContain("dependencies {");
    expect(next.trimEnd().endsWith("}")).toBe(true);
  });

  it("kts：implementation(\"g:a:v\") 也认", () => {
    const k = 'dependencies {\n    implementation("com.example:lib:1.0.0")\n}\n';
    const [next, hit] = removeImplementation(k, "com.example:lib:1.0.0");
    expect(hit).toBe(true);
    expect(next).not.toContain("com.example:lib");
  });

  it("api / compileOnly 等其它配置词也删", () => {
    const t = "dependencies {\n    api 'a:b:1'\n    compileOnly 'c:d:2'\n}\n";
    const [n1, h1] = removeImplementation(t, "a:b:1");
    expect(h1).toBe(true);
    expect(n1).not.toContain("a:b:1");
    expect(n1).toContain("c:d:2");
    const [n2, h2] = removeImplementation(t, "c:d:2");
    expect(h2).toBe(true);
    expect(n2).not.toContain("c:d:2");
    expect(n2).toContain("api 'a:b:1'");
  });

  it("行尾单行注释一起删", () => {
    const t = "dependencies {\n    implementation 'a:b:1' // 老库\n}\n";
    const [next, hit] = removeImplementation(t, "a:b:1");
    expect(hit).toBe(true);
    expect(next).not.toContain("a:b:1");
    expect(next).not.toContain("老库");
  });

  it("坐标不匹配 → 不删，原文返回", () => {
    const [next, hit] = removeImplementation(G, "com.example:lib:9.9.9");
    expect(hit).toBe(false);
    expect(next).toBe(G);
  });

  it("坐标里带正则元字符也安全（点号只匹配点号）", () => {
    const t = "dependencies {\n    implementation 'a.b:c:1'\n}\n";
    const [next, hit] = removeImplementation(t, "aXb:c:1");
    expect(hit).toBe(false);
    expect(next).toBe(t);
    const [n2, h2] = removeImplementation(t, "a.b:c:1");
    expect(h2).toBe(true);
    expect(n2).not.toContain("a.b:c:1");
  });

  it("删完与 insertImplementation 幂等互逆", () => {
    const [inserted] = insertImplementation("dependencies {\n}\n", "a:b:1", false);
    const [removed, hit] = removeImplementation(inserted, "a:b:1");
    expect(hit).toBe(true);
    expect(removed).not.toContain("a:b:1");
    expect(removed).toContain("dependencies {");
  });
});

describe("M424 removeNoteKind（移除结果→提示条目）", () => {
  const base = { hadFile: true, fileOk: true, declWanted: false, declRemoved: false, lastErr: "", declErr: "" };

  it("纯文件行删成功 → done", () => {
    expect(removeNoteKind(base).key).toBe("libs.remove_done");
  });
  it("有声明且声明删成 + 文件删成 → done", () => {
    const n = removeNoteKind({ ...base, declWanted: true, declRemoved: true });
    expect(n.key).toBe("libs.remove_done");
    expect(n.ok).toBe(true);
  });
  it("只有声明、文件本来就不在、声明删成 → done（不报文件删失败）", () => {
    const n = removeNoteKind({ ...base, hadFile: false, fileOk: false, declWanted: true, declRemoved: true });
    expect(n.key).toBe("libs.remove_done");
  });
  it("文件删成但声明删失败 → decl_fail（带 where）", () => {
    const n = removeNoteKind({ ...base, declWanted: true, declRemoved: false, declErr: "app/build.gradle" });
    expect(n.key).toBe("libs.remove_decl_fail");
    expect(n.vars.where).toBe("app/build.gradle");
    expect(n.ok).toBe(true);
  });
  it("声明删成但文件删失败 → decl_only（带 err）", () => {
    const n = removeNoteKind({ ...base, declWanted: true, declRemoved: true, fileOk: false, lastErr: "perm denied" });
    expect(n.key).toBe("libs.remove_decl_only");
    expect(n.vars.err).toBe("perm denied");
    expect(n.ok).toBe(true);
  });
  it("全失败 → fail（不 refresh）", () => {
    const n = removeNoteKind({ ...base, fileOk: false, declWanted: true, declRemoved: false, lastErr: "nope" });
    expect(n.key).toBe("libs.remove_fail");
    expect(n.ok).toBe(false);
  });
});
