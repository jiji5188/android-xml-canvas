import fs from "node:fs";

const mf = "apk/AndroidManifest.xml";
let m = fs.readFileSync(mf, "utf8");
m = m.replace(/android:versionName="[^"]*"/, 'android:versionName="1.11"');
fs.writeFileSync(mf, m, "utf8");

const ed = "components/XmlEditor.tsx";
let e = fs.readFileSync(ed, "utf8");
e = e.replace(/const APP_VERSION = "[^"]*";/, 'const APP_VERSION = "1.11";');
fs.writeFileSync(ed, e, "utf8");

console.log(m.split("\n").slice(2, 6).join("\n"));
console.log((e.match(/const APP_VERSION = .*/) || [])[0]);
