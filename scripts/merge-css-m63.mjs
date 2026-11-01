import fs from "node:fs";
const main = "components/xml-canvas.css";
const add = "components/m63.css";
let css = fs.readFileSync(main, "utf8");
if (css.includes("M63：HSV 取色器")) {
  console.log("already merged");
} else {
  css = css.replace(/\s*$/, "\n") + "\n" + fs.readFileSync(add, "utf8");
  fs.writeFileSync(main, css, "utf8");
  console.log("merged", css.length);
}
