const fs = require("fs");
const t = fs.readFileSync("components/XmlEditor.tsx", "utf8");
const lines = t.split("\n");
lines.forEach((l, i) => {
  if (/layout_margin/.test(l)) console.log((i + 1) + ": " + l.trim().slice(0, 120));
});
const css = fs.readFileSync("lib/xml/css.ts", "utf8");
const i = css.indexOf("function DP");
console.log("--- DP ---");
console.log(css.slice(i, i + 260));
