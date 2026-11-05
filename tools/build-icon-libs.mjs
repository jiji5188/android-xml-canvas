// tools/build-icon-libs.mjs — M145：把第三方 SVG 图标库转成 App 的懒加载图标数据
//
// 用法：node tools/build-icon-libs.mjs
//   - 读 D:/android-xml-canvas/icon-libs 下解压好的三方库
//   - 归一成 IconItem[]（24×24 视口，多 path 拼成一条 d，evenodd 标记 fr）
//   - gzip + base64 落到 lib/icon-data/<key>.ts（动态 import，主包不背体积）
//
// 只接受 viewBox="0 0 24 24" 的库（16/20 的小尺寸直接用同库 24 版本，
// 避免在脚本里重算 path 坐标）。数字精度按库配置：路径特别啰嗦的库降到 1 位，
// 省一半体积（24 视口里 0.1 单位 ≈ 0.4% 误差，肉眼不可见）。
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const ROOT = "D:/android-xml-canvas/icon-libs";
const OUT = "lib/icon-data";

/** RemixIcon 目录 → 本项目的分类键 */
const REMIX_CAT = {
  Arrows: "arrow",
  Buildings: "place",
  Business: "action",
  Communication: "device",
  Design: "geo",
  Development: "action",
  Device: "device",
  Document: "file",
  Editor: "action",
  Finance: "common",
  Food: "nature",
  "Game & Sports": "geo",
  "Health & Medical": "common",
  Logos: "geo",
  Map: "place",
  Media: "media",
  Others: "common",
  System: "device",
  "User & Faces": "people",
  Weather: "nature",
};

const attr = (tag, name) => {
  const m =
    tag.match(new RegExp(name + '\\s*=\\s*"([^"]*)"', "i")) ||
    tag.match(new RegExp(name + "\\s*=\\s*'([^']*)'", "i"));
  return m ? m[1] : null;
};

/** 路径数字降精度（SVGO round precision 的简化版） */
function roundD(d, prec) {
  if (prec == null) return d;
  const k = Math.pow(10, prec);
  return d.replace(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi, (m) => {
    const v = Math.round(parseFloat(m) * k) / k;
    return String(v);
  });
}

/** 一个 svg 文本 → IconItem 的 {d, st, fr}；不是 24 视口返回 null */
function svgToItem(svg, prec) {
  const vb = attr(svg, "viewBox") || "";
  const nums = vb.trim().split(/[\s,]+/).map(Number);
  if (nums.length === 4 && (nums[2] !== 24 || nums[3] !== 24)) return null;

  const tags = svg.match(/<path\b[^>]*>/gi) || [];
  if (!tags.length) return null;

  const ds = [];
  let evenodd = false;
  let stroked = false;
  let filled = false;
  for (const tag of tags) {
    const d = attr(tag, "d");
    if (!d) continue;
    ds.push(roundD(d.replace(/\s+/g, " ").trim(), prec));
    const fr = attr(tag, "fill-rule");
    if (fr && /even-?odd/i.test(fr)) evenodd = true;
    const f = attr(tag, "fill");
    if (f && f !== "none") filled = true;
    const s = attr(tag, "stroke");
    if (s && s !== "none") stroked = true;
  }
  if (!ds.length) return null;

  // 顶层 <svg fill="none" stroke="currentColor"> 的描边库（Heroicons outline 就是这种）
  const rootFill = attr(svg, "fill");
  const rootStroke = attr(svg, "stroke");
  if (rootFill === "none" && rootStroke) stroked = true;
  if (rootFill && rootFill !== "none") filled = true;

  const st = !filled && stroked ? 1 : 0;
  const item = { d: ds.join(" "), st };
  if (!st && evenodd) item.fr = 1;
  return item;
}

/** 读一个目录下的 svg（不递归） */
function readDir(dir, cat, opts) {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".svg"));
  const out = [];
  let skipped = 0;
  for (const f of files.sort()) {
    const svg = fs.readFileSync(path.join(dir, f), "utf8");
    const it = svgToItem(svg, opts.prec);
    if (!it) {
      skipped++;
      continue;
    }
    out.push({ n: opts.nameFn(f), c: cat, ...it });
  }
  return { items: out, skipped, total: files.length };
}

const plainName = (f) => f.replace(/\.svg$/, "");
const sets = {};

/* ---------- Heroicons：24/outline（描边）+ 24/solid（实心） ---------- */
{
  const base = path.join(ROOT, "heroicons-master/optimized/24");
  const o = { prec: 2, nameFn: plainName };
  const a = readDir(path.join(base, "outline"), "common", o);
  const b = readDir(path.join(base, "solid"), "common", o);
  sets.hero = { items: [...a.items, ...b.items], note: `outline ${a.items.length} + solid ${b.items.length}`, skipped: a.skipped + b.skipped };
}

/* ---------- MingCute：core-regular + core-filled（路径啰嗦，精度降 1 位） ---------- */
{
  const base = path.join(ROOT, "mingcute-icons-main/packages/svg");
  const o = { prec: 1, nameFn: plainName };
  const a = readDir(path.join(base, "core-regular"), "common", o);
  const b = readDir(path.join(base, "core-filled"), "common", o);
  sets.mingcute = {
    items: [...a.items, ...b.items],
    note: `regular ${a.items.length} + filled ${b.items.length}`,
    skipped: a.skipped + b.skipped,
  };
}

/* ---------- RemixIcon：按目录分类，-fill/-line 都留 ---------- */
{
  const root = path.join(ROOT, "RemixIcon-master/icons");
  const o = { prec: 2, nameFn: plainName };
  const items = [];
  let skipped = 0;
  let dirs = 0;
  for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    dirs++;
    const r = readDir(path.join(root, dir.name), REMIX_CAT[dir.name] || "common", o);
    items.push(...r.items);
    skipped += r.skipped;
  }
  sets.remix = { items, note: `${dirs} 个分类目录`, skipped };
}

/* ---------- 输出 ---------- */
fs.mkdirSync(OUT, { recursive: true });
console.log("key       items   skipped   rawKB   gzKB   b64KB   note");
const summary = {};
for (const [key, v] of Object.entries(sets)) {
  const json = JSON.stringify(v.items);
  const gz = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });
  const b64 = gz.toString("base64");
  fs.writeFileSync(
    path.join(OUT, `${key}.ts`),
    `// 自动生成，请勿手改 — tools/build-icon-libs.mjs\n// ${key}: ${v.items.length} 个图标（${v.note}）\nconst B64 =\n  "${b64}";\nexport default B64;\n`,
    "utf8",
  );
  summary[key] = { items: v.items.length, b64KB: Math.round(b64.length / 1024) };
  console.log(
    `${key.padEnd(9)} ${String(v.items.length).padStart(5)}   ${String(v.skipped).padStart(5)}   ` +
      `${(json.length / 1024).toFixed(0).padStart(5)}  ${(gz.length / 1024).toFixed(0).padStart(5)}  ` +
      `${(b64.length / 1024).toFixed(0).padStart(5)}   ${v.note}`,
  );
}

const sample = sets.hero.items.slice(0, 2).map((i) => `${i.n} st=${i.st} fr=${i.fr ?? 0} d=${i.d.slice(0, 34)}…`);
console.log("\nsample:", sample.join("\n        "));
console.log("\nsummary:", JSON.stringify(summary));
