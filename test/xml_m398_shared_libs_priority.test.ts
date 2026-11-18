// M398：共享库查找优先级（共享库 → 旧相对路径兜底 → 私有回退目录），同名先到先得；
// 且编译/预检查路径共享库在前（use-build-apk 的 allBuildLibs 顺序由调用方保证，这里测 collectSharedLibs 本身）。
// 背景（真机根因）：collectSharedLibs 以前用相对路径 "/AndroidUIIDE/libs"，Android 上 canon 到 "/AndroidUIIDE/libs"
// 不存在 → 共享库永远 0 个，只有项目库进 classpath → 用户报「只加载了 app/src/main/libs 的库」。
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { collectSharedLibs, SHARED_LIB_DIRS } from "../lib/xml/project-libs";

type FakeNative = {
  listDir?: (p: string) => string | null;
  readBase64?: (p: string) => string | null;
  saveFile?: () => void;
  getWorkspace?: () => string;
};

function setBridge(b: FakeNative | undefined) {
  (window as unknown as { AxvNative?: FakeNative }).AxvNative = b;
}

const b64 = (n: number) => "A".repeat(n * 4).padEnd(n, "B");

describe("M398 共享库查找优先级", () => {
  beforeEach(() => setBridge(undefined));
  afterEach(() => setBridge(undefined));

  it("候选目录顺序 = 共享库 → 相对兜底 → 私有回退", () => {
    expect(SHARED_LIB_DIRS[0]).toBe("/storage/emulated/0/AndroidUIIDE/libs");
    expect(SHARED_LIB_DIRS[1]).toBe("/AndroidUIIDE/libs");
    expect(SHARED_LIB_DIRS[2]).toContain("axv-libs");
    // 绝对路径优先（真机 cwd=/ 时相对路径 canon 不存在）
    expect(SHARED_LIB_DIRS[0].startsWith("/storage/")).toBe(true);
  });

  it("共享库绝对路径能读到（以前相对路径读不到 → 0 个库）", async () => {
    const dir0 = SHARED_LIB_DIRS[0];
    setBridge({
      saveFile() {},
      getWorkspace() { return ""; },
      listDir: (p: string) =>
        p === dir0
          ? JSON.stringify({ ok: true, items: [{ name: "gson-2.10.jar", kind: "file", path: `${dir0}/gson-2.10.jar`, size: 100 }] })
          : JSON.stringify({ ok: false }),
      readBase64: (p: string) => (p === `${dir0}/gson-2.10.jar` ? b64(100) : null),
    });
    const r = await collectSharedLibs();
    expect(r).toHaveLength(1);
    expect(r[0].rel).toBe("shared/gson-2.10.jar");
  });

  it("同名库：优先级高的目录赢（共享库 > 回退目录）", async () => {
    const [d0, , d2] = SHARED_LIB_DIRS;
    setBridge({
      saveFile() {},
      getWorkspace() { return ""; },
      listDir: (p: string) =>
        p === d0
          ? JSON.stringify({ ok: true, items: [{ name: "bcprov.jar", kind: "file" }] })
          : p === d2
            ? JSON.stringify({ ok: true, items: [{ name: "bcprov.jar", kind: "file" }] })
            : JSON.stringify({ ok: false }),
      readBase64: (p: string) => (p.startsWith(d0) ? "AAA=" : "BBB="),
    });
    const r = await collectSharedLibs();
    expect(r).toHaveLength(1); // 去重后只留一个
    expect(r[0].base64).toBe("AAA="); // 共享库的
  });

  it("目录 1 没读成功（无权限/不存在）→ 继续扫后面的目录，notes 标明每个目录结果", async () => {
    const [, d1, d2] = SHARED_LIB_DIRS;
    setBridge({
      saveFile() {},
      getWorkspace() { return ""; },
      listDir: (p: string) => (p === d2 ? JSON.stringify({ ok: true, items: [{ name: "jxl.jar", kind: "file" }] }) : JSON.stringify({ ok: false })),
      readBase64: () => b64(50),
    });
    const notes: string[] = [];
    const r = await collectSharedLibs(notes);
    expect(r).toHaveLength(1);
    expect(r[0].rel).toBe("shared/jxl.jar");
    expect(notes.some((n) => n.includes("不可读"))).toBe(true);
    expect(notes.some((n) => n.includes("共享库合计"))).toBe(true);
  });

  it("40MB 总量帽跨目录累计（前面的目录收满后，后面的目录不再收）", async () => {
    // MAX_TOTAL = 40MB、单文件 ≤ 15MB：目录 0 放 4 个 12MB（共 48MB > 40MB）→ 只收 3 个，目录 2 的 b.jar 被总量帽挡掉
    const [d0, , d2] = SHARED_LIB_DIRS;
    const mb12 = "A".repeat(Math.ceil((12 * 1024 * 1024) / 0.75));
    setBridge({
      saveFile() {},
      getWorkspace() { return ""; },
      listDir: (p: string) =>
        p === d0
          ? JSON.stringify({ ok: true, items: [1, 2, 3, 4].map((i) => ({ name: `a${i}.jar`, kind: "file" })) })
          : p === d2
            ? JSON.stringify({ ok: true, items: [{ name: "b.jar", kind: "file" }] })
            : JSON.stringify({ ok: false }),
      readBase64: () => mb12,
    });
    const r = await collectSharedLibs();
    // 36MB 收满（a1~a3），a4 加进去就 48MB > 40MB 跳；b.jar 同理跳
    expect(r.map((x) => x.rel)).toEqual(["shared/a1.jar", "shared/a2.jar", "shared/a3.jar"]);
  });
});
