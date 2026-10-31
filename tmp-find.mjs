import fs from "node:fs";
import path from "node:path";
const outDir = "out";
const files = [];
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".js")) files.push(p);
  }
}
walk(outDir);
const keys = ["insertNewlineAndIndent", "indentOnInput", "axv-code-cur-bg"];
const found = [];
for (const f of files) {
  const s = fs.readFileSync(f, "utf8");
  for (const k of keys) if (s.includes(k)) found.push(`${f} -> ${k}`);
}
console.log(found.join("\n") || "none found");
