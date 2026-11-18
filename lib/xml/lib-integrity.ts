// lib/xml/lib-integrity.ts — M385：库 jar/aar 下载后的完整性校验
//
// 背景（M384 安全审计）：lib 下载走 DownloadManager / HttpURLConnection，jar 直接进
// ECJ classpath、最终变成产物里的 dex。之前既不校验内容、又允许明文 http 源 →
// 中间人在任意一跳换掉 jar 就等于往用户 App 里塞代码。
//
// 做法：Maven 仓库（central / google / 各镜像）都在制品旁边放 .sha1 / .sha256 校验和文件。
// 下载完成后：① 用原生 fileHash 算本地哈希 ② 拉同源校验和文件 ③ 比对。
// 拿不到校验和 → 标记「无法校验」（不阻断，但日志写明），绝不假装通过。
//
// 纯逻辑（URL 排序 / 校验和解析 / 判定）放这里，便于单测；网络与原生调用由调用方注入。

export type HashAlgo = "sha1" | "sha256";

/** 判定结果：ok=一致，mismatch=不一致，unverifiable=拿不到校验和或算不出本地哈希 */
export type VerifyStatus = "ok" | "mismatch" | "unverifiable";

export interface VerifyResult {
  status: VerifyStatus;
  algo?: HashAlgo;
  expected?: string;
  actual?: string;
  /** 实际取到校验和的那个 URL（诊断用） */
  sourceUrl?: string;
  /** unverifiable 时的原因 */
  reason?: string;
}

/** 私网/本机主机名（局域网镜像用 http 可接受，公网 http 一律不认） */
export function isPrivateHost(host: string): boolean {
  const h = (host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return false;
  if (h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "::1") return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

/** URL 安全排序：https 优先；http 只留私网；其它 http 直接丢（返回空表示无安全源） */
export function orderBySecurity(urls: string[]): string[] {
  const https: string[] = [];
  const lan: string[] = [];
  for (const raw of urls || []) {
    const u = String(raw || "").trim();
    if (!u) continue;
    if (/^https:\/\//i.test(u)) { https.push(u); continue; }
    if (/^http:\/\//i.test(u)) {
      const m = /^http:\/\/([^/:?#]+)/i.exec(u);
      if (m && isPrivateHost(m[1])) lan.push(u);
    }
  }
  return [...https, ...lan];
}

/** 制品 URL → 候选校验和 URL（先 sha1，Maven 全都有；再 sha256，部分镜像有） */
export function checksumUrlsFor(libUrl: string): { url: string; algo: HashAlgo }[] {
  const u = String(libUrl || "").trim();
  if (!u) return [];
  return [
    { url: u + ".sha1", algo: "sha1" },
    { url: u + ".sha256", algo: "sha256" },
  ];
}

/** 解析校验和文件内容（可能带文件名、换行、空格）→ {algo, hex}；不像校验和就 null */
export function parseHashFile(text: string): { algo: HashAlgo; hex: string } | null {
  if (!text) return null;
  // 取第一个长 hex 片段（sha256=64 优先试，sha1=40；md5=32 不认，碰撞太多）
  const m = /[0-9a-fA-F]{64}|[0-9a-fA-F]{40}/.exec(String(text).slice(0, 4096));
  if (!m) return null;
  const hex = m[0].toLowerCase();
  return { algo: hex.length === 64 ? "sha256" : "sha1", hex };
}

/** 期望值 vs 本地实际值 → 判定（大小写不敏感；缺一边就是 unverifiable） */
export function judgeHash(expected: string | null | undefined, actual: string | null | undefined): VerifyStatus {
  const e = String(expected || "").trim().toLowerCase();
  const a = String(actual || "").trim().toLowerCase();
  if (!e || !a) return "unverifiable";
  return e === a ? "ok" : "mismatch";
}

export interface VerifyDeps {
  /** 取文本（校验和文件），失败返回 null（不抛） */
  fetchText: (url: string) => Promise<string | null>;
  /** 算本地文件哈希：返回 hex 或 null */
  hashFile: (path: string, algo: HashAlgo) => Promise<string | null>;
}

/** 对一个已下载的库文件做校验：拿不到校验和就 unverifiable（不阻断，但不假装成功） */
export async function verifyDownloadedLib(
  deps: VerifyDeps,
  libUrl: string | string[],
  localPath: string,
): Promise<VerifyResult> {
  const urls = (Array.isArray(libUrl) ? libUrl : [libUrl]).filter(Boolean);
  if (!urls.length || !localPath) return { status: "unverifiable", reason: "缺少 URL 或本地路径" };
  for (const one of urls) {
    for (const cand of checksumUrlsFor(one)) {
      let text: string | null = null;
      try {
        text = await deps.fetchText(cand.url);
      } catch {
        text = null;
      }
      if (!text) continue;
      const parsed = parseHashFile(text);
      if (!parsed) continue;
      let actual: string | null = null;
      try {
        actual = await deps.hashFile(localPath, parsed.algo);
      } catch {
        actual = null;
      }
      const status = judgeHash(parsed.hex, actual);
      return {
        status,
        algo: parsed.algo,
        expected: parsed.hex,
        actual: actual || undefined,
        sourceUrl: cand.url,
        reason: status === "unverifiable" ? "算不出本地哈希（原生 fileHash 不可用？）" : undefined,
      };
    }
  }
  return { status: "unverifiable", reason: "仓库未提供校验和文件（或网络/CORS 取不到）" };
}
