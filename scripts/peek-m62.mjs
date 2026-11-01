import fs from "node:fs";
const s = fs.readFileSync("components/ProjectPanel.tsx", "utf8").split("\n");
s.forEach((l, i) => {
  if (l.includes('tab === "projects" ? (')) console.log((i + 1) + ": START " + JSON.stringify(l));
  if (l.trim() === ") : (") console.log((i + 1) + ": MID " + JSON.stringify(l));
});
