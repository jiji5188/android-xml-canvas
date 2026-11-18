// @vitest-environment node
// M385：库下载完整性校验（lib-integrity）——纯逻辑测试
import { describe, expect, it } from "vitest";
import {
  checksumUrlsFor,
  isPrivateHost,
  judgeHash,
  orderBySecurity,
  parseHashFile,
  verifyDownloadedLib,
} from "@/lib/xml/lib-integrity";
import { libDownloadUrls, LIBRARY_CATALOG } from "@/lib/xml/library-catalog";
import { gradleDepDownloadUrls } from "@/lib/xml/gradle-deps";

const sha1 = "da39a3ee5e6b4b0d3255bfef95601890afd80709";
const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

describe("M385 isPrivateHost", () => {
  it("私网/本机为 true", () => {
    expect(isPrivateHost("192.168.31.101")).toBe(true);
    expect(isPrivateHost("10.0.0.5")).toBe(true);
    expect(isPrivateHost("172.16.1.1")).toBe(true);
    expect(isPrivateHost("172.31.255.255")).toBe(true);
    expect(isPrivateHost("localhost")).toBe(true);
    expect(isPrivateHost("127.0.0.1")).toBe(true);
  });
  it("公网/边界外为 false", () => {
    expect(isPrivateHost("example.com")).toBe(false);
    expect(isPrivateHost("repo1.maven.org")).toBe(false);
    expect(isPrivateHost("172.32.0.1")).toBe(false);
    expect(isPrivateHost("11.0.0.1")).toBe(false);
    expect(isPrivateHost("193.168.1.1")).toBe(false);
    expect(isPrivateHost("")).toBe(false);
  });
});

describe("M385 orderBySecurity", () => {
  it("https 优先，公网 http 丢弃，局域网 http 保留在末尾", () => {
    const out = orderBySecurity([
      "http://repo1.maven.org/maven2/x.jar",
      "https://a.example/x.jar",
      "http://192.168.31.101:8080/_dl/libs/x.jar",
      "https://b.example/x.jar",
    ]);
    expect(out).toEqual([
      "https://a.example/x.jar",
      "https://b.example/x.jar",
      "http://192.168.31.101:8080/_dl/libs/x.jar",
    ]);
  });
  it("只有公网 http → 空数组（无安全源）", () => {
    expect(orderBySecurity(["http://evil.example/x.jar"])).toEqual([]);
  });
  it("空/垃圾输入安全", () => {
    expect(orderBySecurity([])).toEqual([]);
    expect(orderBySecurity(["", "ftp://x/y"])).toEqual([]);
  });
});

describe("M385 checksumUrlsFor / parseHashFile / judgeHash", () => {
  it("校验和 URL = 制品 URL + .sha1/.sha256", () => {
    expect(checksumUrlsFor("https://r/x.jar")).toEqual([
      { url: "https://r/x.jar.sha1", algo: "sha1" },
      { url: "https://r/x.jar.sha256", algo: "sha256" },
    ]);
  });
  it("parseHashFile：裸 hex / 带文件名 / sha256 / 垃圾", () => {
    expect(parseHashFile(sha1)).toEqual({ algo: "sha1", hex: sha1 });
    expect(parseHashFile(sha1 + "  x.jar\n")).toEqual({ algo: "sha1", hex: sha1 });
    expect(parseHashFile(sha256)).toEqual({ algo: "sha256", hex: sha256 });
    expect(parseHashFile("not a hash")).toBeNull();
    expect(parseHashFile("")).toBeNull();
  });
  it("md5（32 位）不认", () => {
    expect(parseHashFile("d41d8cd98f00b204e9800998ecf8427e")).toBeNull();
  });
  it("judgeHash：一致/不一致/缺一边，大小写不敏感", () => {
    expect(judgeHash(sha1, sha1.toUpperCase())).toBe("ok");
    expect(judgeHash(sha1, sha256.slice(0, 40))).toBe("mismatch");
    expect(judgeHash(sha1, "")).toBe("unverifiable");
    expect(judgeHash(null, sha1)).toBe("unverifiable");
  });
});

describe("M385 verifyDownloadedLib", () => {
  const okDeps = {
    fetchText: async (u: string) => (u.endsWith(".sha1") ? sha1 + "  x.jar" : null),
    hashFile: async () => sha1,
  };
  it("ok：校验和取到且一致", async () => {
    const r = await verifyDownloadedLib(okDeps, "https://r/x.jar", "/tmp/x.jar");
    expect(r.status).toBe("ok");
    expect(r.algo).toBe("sha1");
    expect(r.sourceUrl).toBe("https://r/x.jar.sha1");
  });
  it("第一个源 404 → 试下一个 URL 的校验和", async () => {
    const calls: string[] = [];
    const r = await verifyDownloadedLib(
      {
        fetchText: async (u) => {
          calls.push(u);
          return u === "https://mirror-b/x.jar.sha1" ? sha1 : null;
        },
        hashFile: async () => sha1,
      },
      ["https://mirror-a/x.jar", "https://mirror-b/x.jar"],
      "/tmp/x.jar",
    );
    expect(r.status).toBe("ok");
    expect(calls).toContain("https://mirror-a/x.jar.sha1");
    expect(r.sourceUrl).toBe("https://mirror-b/x.jar.sha1");
  });
  it("mismatch：校验和与本地哈希不一致", async () => {
    const r = await verifyDownloadedLib({ ...okDeps, hashFile: async () => "0".repeat(40) }, "https://r/x.jar", "/tmp/x.jar");
    expect(r.status).toBe("mismatch");
    expect(r.actual).toBe("0".repeat(40));
  });
  it("unverifiable：仓库没放校验和", async () => {
    const r = await verifyDownloadedLib({ fetchText: async () => null, hashFile: async () => sha1 }, "https://r/x.jar", "/tmp/x.jar");
    expect(r.status).toBe("unverifiable");
    expect(r.reason).toBeTruthy();
  });
  it("unverifiable：fileHash 不可用（原生桥缺失）", async () => {
    const r = await verifyDownloadedLib({ fetchText: async () => sha1, hashFile: async () => null }, "https://r/x.jar", "/tmp/x.jar");
    expect(r.status).toBe("unverifiable");
  });
  it("fetchText 抛异常按 null 处理，不炸", async () => {
    const r = await verifyDownloadedLib(
      { fetchText: async () => { throw new Error("CORS"); }, hashFile: async () => sha1 },
      "https://r/x.jar",
      "/tmp/x.jar",
    );
    expect(r.status).toBe("unverifiable");
  });
});

describe("M385 目录真实 URL 的安全合规（防回归）", () => {
  it("内置目录每个库都有 https 源", () => {
    for (const e of LIBRARY_CATALOG) {
      const ordered = orderBySecurity(libDownloadUrls(e));
      expect(ordered.length, e.group + ":" + e.artifact).toBeGreaterThan(0);
      expect(ordered[0].startsWith("https://"), e.group + ":" + e.artifact + " 首选必须是 https").toBe(true);
    }
  });
  it("gradle 依赖下载 URL 排序后仍有 https 源", () => {
    const d = { group: "jxl", name: "jxl", version: "2.6.12", isAar: false };
    const ordered = orderBySecurity(gradleDepDownloadUrls(d as never));
    expect(ordered.length).toBeGreaterThan(0);
    expect(ordered[0].startsWith("https://")).toBe(true);
  });
});
