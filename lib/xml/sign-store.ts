// lib/xml/sign-store.ts — M195：把签名配置记住（按项目）
//
// 为什么：build.gradle 里的 signingConfigs 是「项目配置」，但用户每次点打包还要重填口令，
// 而且 keystore 路径/别名/签名方案也容易忘。这里按项目名存一份到本机 localStorage，
// 下次打开签名面板直接回填 —— build.gradle 里读得到的值优先，读不到才用这份。
//
// 注意：口令以明文存在本机 localStorage（和写进 build.gradle 的性质一样），只在本机生效。
import type { SigningParams } from "./signing";

export interface StoredSigning {
  storeFile: string;
  storePass: string;
  alias: string;
  keyPass: string;
  algorithm: "RSA" | "EC";
  keySize: number;
  validityDays: number;
  v1: boolean;
  v2: boolean;
  v3: boolean;
  /** 最后一次成功打包/写入的时间（ms） */
  savedAt?: number;
}

const PREFIX = "axv.signing.v1:";

export function signStoreKey(projectName: string | null | undefined): string {
  const n = (projectName || "").trim() || "_default";
  return PREFIX + n;
}

function ls(): Storage | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readStoredSigning(projectName: string | null | undefined): StoredSigning | null {
  const s = ls();
  if (!s) return null;
  try {
    const raw = s.getItem(signStoreKey(projectName));
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<StoredSigning>;
    if (!o || typeof o !== "object") return null;
    return {
      storeFile: typeof o.storeFile === "string" ? o.storeFile : ".axv/release.keystore",
      storePass: typeof o.storePass === "string" ? o.storePass : "",
      alias: typeof o.alias === "string" ? o.alias : "release",
      keyPass: typeof o.keyPass === "string" ? o.keyPass : "",
      algorithm: o.algorithm === "EC" ? "EC" : "RSA",
      keySize: Number.isFinite(o.keySize) ? Number(o.keySize) : 2048,
      validityDays: Number.isFinite(o.validityDays) ? Number(o.validityDays) : 10000,
      v1: o.v1 !== false,
      v2: o.v2 !== false,
      v3: o.v3 !== false,
      savedAt: Number.isFinite(o.savedAt) ? Number(o.savedAt) : undefined,
    };
  } catch {
    return null;
  }
}

export function writeStoredSigning(
  projectName: string | null | undefined,
  s: Omit<StoredSigning, "savedAt"> & { savedAt?: number },
): boolean {
  const st = ls();
  if (!st) return false;
  try {
    st.setItem(signStoreKey(projectName), JSON.stringify({ ...s, savedAt: s.savedAt ?? Date.now() }));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredSigning(projectName: string | null | undefined): void {
  const st = ls();
  if (!st) return;
  try {
    st.removeItem(signStoreKey(projectName));
  } catch {
    /* ignore */
  }
}

/** 打包表单 → 可存储结构（口令缺省时会从 keyPass 兜底，因为两边目前是同一条） */
export function toStoredSigning(
  p: { storeFile: string; storePass?: string; alias: string; keyPass?: string },
  extra?: Partial<Omit<StoredSigning, "storeFile" | "storePass" | "alias" | "keyPass">>,
): Omit<StoredSigning, "savedAt"> {
  const keyPass = p.keyPass ?? "";
  return {
    storeFile: p.storeFile || ".axv/release.keystore",
    storePass: p.storePass ?? keyPass,
    alias: p.alias || "release",
    keyPass,
    algorithm: extra?.algorithm === "EC" ? "EC" : "RSA",
    keySize: extra?.keySize ?? 2048,
    validityDays: extra?.validityDays ?? 10000,
    v1: extra?.v1 !== false,
    v2: extra?.v2 !== false,
    v3: extra?.v3 !== false,
  };
}

/** SigningParams → 可存储结构 */
export function paramsToStored(p: SigningParams): Omit<StoredSigning, "savedAt"> {
  return {
    storeFile: p.storeFile || ".axv/release.keystore",
    storePass: p.keyPassword || "",
    alias: p.alias || "release",
    keyPass: p.keyPassword || "",
    algorithm: p.algorithm === "EC" ? "EC" : "RSA",
    keySize: p.keySize || 2048,
    validityDays: p.validityDays || 10000,
    v1: p.v1 !== false,
    v2: p.v2 !== false,
    v3: p.v3 !== false,
  };
}
