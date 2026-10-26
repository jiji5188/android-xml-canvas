const fs = require("fs");
for (const f of ["components/XmlEditor.tsx", "lib/xml/samples.ts", "lib/xml/css.ts", "lib/xml/parser.ts"]) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, "utf8").split("\n");
  t.forEach((l, i) => {
    if (/DEFAULT_XML|initialXml|useState<string>\(|SAMPLES\[/.test(l)) {
      console.log(f + ":" + (i + 1) + ": " + l.trim().slice(0, 140));
    }
  });
}
