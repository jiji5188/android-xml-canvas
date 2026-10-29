import fs from "node:fs";

const css = "components/xml-canvas.css";
const s = fs.readFileSync(css, "utf8");
const i = s.indexOf(".axv-about-desc {");
if (i < 0) throw new Error("anchor missing");
const add = `
/* M16g：关于页的项目 logo（圆角一点，跟应用图标同观感） */
.axv-about-logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  flex: 0 0 auto;
  box-shadow: 0 2px 8px rgba(103, 80, 164, 0.28);
}
`;
fs.writeFileSync(css, s.slice(0, i) + add + s.slice(i), "utf8");
console.log("ok");
