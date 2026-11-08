// test/xml_m195_sign_store.test.ts — M195：签名配置按项目记住
import { describe, it, expect, beforeEach } from "vitest";
import {
  readStoredSigning,
  writeStoredSigning,
  clearStoredSigning,
  signStoreKey,
  toStoredSigning,
  paramsToStored,
} from "../lib/xml/sign-store";

/** 极简 localStorage 替身（node 环境没有 window） */
class MemLS {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

beforeEach(() => {
  const ls = new MemLS();
  (globalThis as unknown as { window: { localStorage: MemLS } }).window = { localStorage: ls };
});

describe("sign-store：按项目存取", () => {
  it("写入后能读回，口令/别名/方案都保留", () => {
    const ok = writeStoredSigning("MyApp", {
      storeFile: ".axv/release.keystore",
      storePass: "123456",
      alias: "release",
      keyPass: "123456",
      algorithm: "RSA",
      keySize: 2048,
      validityDays: 10000,
      v1: true,
      v2: true,
      v3: true,
    });
    expect(ok).toBe(true);
    const r = readStoredSigning("MyApp");
    expect(r?.storeFile).toBe(".axv/release.keystore");
    expect(r?.keyPass).toBe("123456");
    expect(r?.savedAt).toBeGreaterThan(0);
  });

  it("不同项目互不干扰", () => {
    writeStoredSigning("A", toStoredSigning({ storeFile: "a.keystore", alias: "ka", keyPass: "pa" }));
    writeStoredSigning("B", toStoredSigning({ storeFile: "b.keystore", alias: "kb", keyPass: "pb" }));
    expect(readStoredSigning("A")?.alias).toBe("ka");
    expect(readStoredSigning("B")?.storeFile).toBe("b.keystore");
    expect(readStoredSigning("C")).toBeNull();
  });

  it("清除后读不到", () => {
    writeStoredSigning("A", toStoredSigning({ storeFile: "a.keystore", alias: "ka", keyPass: "pa" }));
    clearStoredSigning("A");
    expect(readStoredSigning("A")).toBeNull();
  });

  it("坏 JSON / 缺字段走兜底不抛", () => {
    window.localStorage.setItem(signStoreKey("Bad"), "{not json");
    expect(readStoredSigning("Bad")).toBeNull();
    window.localStorage.setItem(signStoreKey("Half"), JSON.stringify({ alias: "x" }));
    const r = readStoredSigning("Half");
    expect(r?.storeFile).toBe(".axv/release.keystore");
    expect(r?.v2).toBe(true);
  });

  it("toStoredSigning 用 keyPass 兜底 storePass", () => {
    const s = toStoredSigning({ storeFile: "", alias: "", keyPass: "pw" });
    expect(s.storeFile).toBe(".axv/release.keystore");
    expect(s.alias).toBe("release");
    expect(s.storePass).toBe("pw");
  });

  it("paramsToStored 映射 SigningParams", () => {
    const s = paramsToStored({
      alias: "rel",
      keyPassword: "pw",
      storeFile: "x.keystore",
      algorithm: "EC",
      keySize: 256,
      validityDays: 365,
      v1: false,
      v2: true,
      v3: false,
    });
    expect(s).toMatchObject({ alias: "rel", storePass: "pw", keyPass: "pw", algorithm: "EC", keySize: 256, v1: false, v3: false });
  });

  it("项目名为空落到 _default", () => {
    expect(signStoreKey(null)).toBe("axv.signing.v1:_default");
    expect(signStoreKey("  ")).toBe("axv.signing.v1:_default");
  });
});
