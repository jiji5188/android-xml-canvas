import fs from "node:fs";
const main = "components/xml-canvas.css";
const add = "components/m63c.css";
let css = fs.readFileSync(main, "utf8");
if (css.includes("M63c：颜色取色器改成")) {
  console.log("already merged");
} else {
  css = css.replace(/\s*$/, "\n") + "\n" + fs.readFileSync(add, "utf8");
  fs.writeFileSync(main, css, "utf8");
  console.log("merged", css.length);
}
