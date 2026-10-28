import fs from "fs";
const s = fs.readFileSync("components/XmlEditor.tsx", "utf8").split(/\r?\n/);
let depth = 0;
for (let i = 1486; i <= 2120; i++) {
  const line = s[i - 1] ?? "";
  const opens = (line.match(/<div\b/g) || []).length;
  const closes = (line.match(/<\/div>/g) || []).length;
  depth += opens - closes;
  if ((opens || closes) && depth <= 0 && i > 1486) console.log(`${i}\td=${depth}\t${line.trim().slice(0, 80)}`);
}
console.log("final depth", depth);
