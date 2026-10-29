import fs from "node:fs";
const s = fs.readFileSync("components/XmlEditor.tsx", "utf8");
s.split("\n").forEach((l, i) => {
  if (l.startsWith("import") && l.includes("lib/xml")) console.log(i + 1 + ": " + l.trim());
});
