// @vitest-environment node
// M289：国际化覆盖率护栏 —— components/app 里的中文字面量必须都在 SRC_EN（或 i18n.ts 字典）里登记
// 否则切英文时会漏成中文。新增中文文案后跑这里会红，去 lib/i18n-src.ts 的 SRC_EN 补。
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collectFiles(p, out);
    else if (/\.(tsx?)$/.test(e.name)) out.push(p);
  }
  return out;
}

function knownChineseKeys(): Set<string> {
  const srcTxt = fs.readFileSync(path.join(root, "lib/i18n-src.ts"), "utf8");
  const i18nTxt = fs.readFileSync(path.join(root, "lib/i18n.ts"), "utf8");
  const keys = new Set<string>();
  for (const m of srcTxt.matchAll(/"((?:[^"\\]|\\.)+)"\s*:/g)) keys.add(m[1]);
  for (const m of i18nTxt.matchAll(/"([^"]*[\u4e00-\u9fff][^"]*)"\s*:/g)) keys.add(m[1]);
  return keys;
}

describe("i18n coverage", () => {
  it("components/app 里的中文字面量都有译文登记", () => {
    const keys = knownChineseKeys();
    const cn = /[\u4e00-\u9fff]/;
    const files = collectFiles(path.join(root, "components")).concat(
      collectFiles(path.join(root, "app")),
    );
    const missing: string[] = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
      lines.forEach((ln, i) => {
        if (!cn.test(ln) || /i18n-ignore/.test(ln)) return;
        const t = ln.trim();
        if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
        for (const m of ln.matchAll(/"((?:[^"\\]|\\.)*[\u4e00-\u9fff](?:[^"\\]|\\.)*)"/g)) {
          const s = m[1];
          if (s.length > 160) continue;
          if (!keys.has(s)) missing.push(path.relative(root, f) + ":" + (i + 1) + " " + s.slice(0, 40));
        }
      });
    }
    if (missing.length) {
      console.error("缺译文 " + missing.length + " 条，补进 lib/i18n-src.ts 的 SRC_EN：\n" + missing.join("\n"));
    }
    expect(missing).toEqual([]);
  });
});
