import fs from "node:fs";
const s = fs.readFileSync("components/widget-catalog.ts", "utf8");
const keys = ["list_view", "grid_view", "expandable_list", "spinner", "list", "mat_swipe", "mat_pager2", "recycler", "gallery", "adapter"];
for (const k of keys) {
  const i = s.indexOf(`key: "${k}"`);
  if (i < 0) { console.log(k.padEnd(16), "NOT FOUND"); continue; }
  const seg = s.slice(i, i + 240).replace(/\n\s*/g, " ");
  console.log(k.padEnd(16), seg.slice(0, 200));
}
