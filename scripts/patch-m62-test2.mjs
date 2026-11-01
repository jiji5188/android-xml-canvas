import fs from "node:fs";
const p = "test/xml_m25d_project_panel.test.tsx";
let s = fs.readFileSync(p, "utf8");
// input!.value = "x"; input!.dispatchEvent(...); await flush();  → await typeInto(input!, "x");
s = s.replace(
  /input!\.value = "([^"]*)";\s*\n\s*input!\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\);\s*\n\s*await flush\(\);/g,
  (_m, v) => `await typeInto(input!, "${v}");`,
);
s = s.replace(
  /input\.value = "([^"]*)";\s*\n\s*input\.dispatchEvent\(new Event\("input", \{ bubbles: true \}\)\);\s*\n\s*await flush\(\);/g,
  (_m, v) => `await typeInto(input, "${v}");`,
);
fs.writeFileSync(p, s, "utf8");
console.log("done");
