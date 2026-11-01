import fs from "node:fs";
const s = fs.readFileSync("components/XmlEditor.tsx", "utf8").split("\n");
s.forEach((l, i) => {
  if (/wsListTopProjects|readProjectMetaNative/.test(l))
    console.log((i + 1) + ": " + l.trim().slice(0, 120));
});
