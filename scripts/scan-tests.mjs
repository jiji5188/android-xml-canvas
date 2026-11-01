import fs from "node:fs";
function walk(d, out) {
  for (const f of fs.readdirSync(d)) {
    if (["node_modules", ".git", ".next"].includes(f)) continue;
    const p = d + "/" + f;
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const needles = ['axv-attr-sw', 'type="color"'];
for (const f of walk("test", [])) {
  const s = fs.readFileSync(f, "utf8");
  const hit = needles.filter((n) => s.includes(n));
  if (hit.length) console.log("HIT", f, hit.join(","));
}
