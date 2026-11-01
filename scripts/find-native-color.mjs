import fs from "node:fs";
import path from "node:path";

function walk(d, out = []) {
  for (const f of fs.readdirSync(d)) {
    if (["node_modules", ".git", ".next", "out"].includes(f)) continue;
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(f)) out.push(p);
  }
  return out;
}

const needle = 'type="color"';
for (const f of walk("components")) {
  const s = fs.readFileSync(f, "utf8");
  const n = s.split(needle).length - 1;
  if (n) console.log(f, n);
}
