// M57 性能基准：量化「每个 keystroke 会跑哪些全量扫描」
// 跑法：node scripts/bench-parse.mjs
import { performance } from "node:perf_hooks";

const { parseLayoutXml } = await import("../lib/xml/parser.ts");
const { lintXml } = await import("../lib/xml/lint.ts");
const { buildRenderModel } = await import("../lib/xml/css.ts");

function makeXml(n) {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push(
      `  <TextView
    android:id="@+id/tv_${i}"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="Item ${i} 一段中文文案测试"
    app:layout_constraintTop_toTopOf="parent"
    app:layout_constraintStart_toStartOf="parent"
    android:textSize="14sp"
    android:textColor="#333333" />`
    );
  }
  return `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
${rows.join("\n")}
</androidx.constraintlayout.widget.ConstraintLayout>`;
}

function timeIt(label, fn, iters = 20) {
  fn(); // warmup
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const per = (performance.now() - t0) / iters;
  console.log(`${label.padEnd(42)} ${per.toFixed(2)} ms`);
  return per;
}

for (const n of [20, 100, 300, 800]) {
  const xml = makeXml(n);
  console.log(`\n=== ${n} 个控件 / ${(xml.length / 1024).toFixed(1)} KB / ${xml.split("\n").length} 行 ===`);
  let root = null;
  timeIt("parseLayoutXml（1 次）", () => {
    root = parseLayoutXml(xml).root;
  });
  timeIt("lintXml（1 次）", () => lintXml(xml));
  timeIt("buildRenderModel（1 次）", () =>
    buildRenderModel(root, {}, 2, undefined, { w: 360, h: 640 }, undefined, undefined),
  );
  console.log("--- 现在一次 keystroke 的合计（parse×3 + lint + model）---");
  const a = timeIt("  合计", () => {
    const r1 = parseLayoutXml(xml).root;
    parseLayoutXml(xml); // treeRoot
    lintXml(xml);
    buildRenderModel(r1, {}, 2, undefined, { w: 360, h: 640 }, undefined, undefined);
  }, 10);
  timeIt("doc.toString 等价（JSON 拷贝整串）", () => JSON.stringify(xml), 50);
  console.log(
    `→ 60fps 预算 16.7ms，当前占用 ${(a / 16.7 * 100).toFixed(0)}%（还没算 React 重渲染 / DOM）`,
  );
}
