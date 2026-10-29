import fs from "node:fs";
const s = fs.readFileSync("components/XmlEditor.tsx", "utf8");
s.split("\n").forEach((l, i) => {
  if (/BASE_PATH|\.svg"|\/samples\//.test(l)) console.log(i + 1 + ": " + l.trim().slice(0, 130));
});
