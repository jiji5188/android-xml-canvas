// test/xml_m63b_parsed_doc_order.test.ts — TDZ 防回归
//
// 背景：M57 把 parse 合并成一份 `parsedDoc` 后，若它的声明挪到「用它的 useMemo」后面，
// render 时 memo 主体立即执行 → ReferenceError: Cannot access 'parsedDoc' before initialization，
// 画布直接白屏（用户反馈过一次）。这里用源码顺序做最直接的护栏。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SRC = readFileSync(resolve(process.cwd(), "components/XmlEditor.tsx"), "utf8").split("\n");

/** 忽略注释行后的「真实使用」行号（1 起） */
function refLines(name: string): number[] {
  const out: number[] = [];
  SRC.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    if (new RegExp(`\\b${name}\\b`).test(line)) out.push(i + 1);
  });
  return out;
}

describe("parsedDoc 声明顺序（TDZ 护栏）", () => {
  it("声明必须早于任何使用（含 model memo 里的 `const parsed = parsedDoc`）", () => {
    const decl = SRC.findIndex((l) => /const parsedDoc = useMemo\(/.test(l)) + 1;
    expect(decl).toBeGreaterThan(0);
    const uses = refLines("parsedDoc").filter((n) => n !== decl);
    expect(uses.length).toBeGreaterThan(0);
    for (const n of uses) {
      expect(n, `第 ${n} 行用到了 parsedDoc，但它在第 ${decl} 行才声明`).toBeGreaterThan(decl);
    }
  });
});
