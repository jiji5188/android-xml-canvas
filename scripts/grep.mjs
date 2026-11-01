import fs from "node:fs";
const file = process.argv[2];
const re = new RegExp(process.argv[3]);
const s = fs.readFileSync(file, "utf8").split("\n");
s.forEach((l, i) => {
  if (re.test(l)) console.log((i + 1) + ": " + l.trim().slice(0, 120));
});
