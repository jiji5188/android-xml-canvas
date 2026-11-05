// lib/xml/num-input.ts — 数字输入框的过滤/解析（M136）
//
// 以前到处各写一份 `parseFloat(raw)`，问题是：
//   1. 非数字字符不会被拦住（"1a" 也能进去，保存后写进 XML 就是脏值）
//   2. 空串到底算 0 还是算「不设」没有统一说法，各字段各写各的
// 这里集中成两个纯函数，UI 只管调用，测试也只测这里。

/**
 * 只保留数字 / 一个小数点 /（可选）开头的负号。
 * 例：`-12.3dp` → `-12.3`，`a1b.2c.3` → `1.23`，`--5` → `-5`
 */
export function filterNumber(raw: string, allowNegative = true): string {
  let out = "";
  let dot = false;
  for (const ch of raw) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (ch === "." && !dot) {
      dot = true;
      out += ch;
    } else if (ch === "-" && allowNegative && out.length === 0) out += "-";
  }
  return out;
}

/**
 * 把输入框里的草稿解析成数字。
 * - 空 / 只有一个负号或小数点 → fallback（由调用方决定「空 = 0」还是「空 = 不设」）
 * - 解析不出来 → fallback（不写脏值）
 */
export function parseNumberField(
  raw: string,
  fallback: number | undefined,
  opts: { allowNegative?: boolean; min?: number; max?: number } = {},
): number | undefined {
  const clean = filterNumber(raw, opts.allowNegative !== false);
  if (clean === "" || clean === "-" || clean === "." || clean === "-.") return fallback;
  const n = Number.parseFloat(clean);
  if (!Number.isFinite(n)) return fallback;
  let v = n;
  if (opts.min !== undefined) v = Math.max(opts.min, v);
  if (opts.max !== undefined) v = Math.min(opts.max, v);
  return v;
}
