import fs from "node:fs";
const main = "components/xml-canvas.css";
const add = "components/m62.css";
let css = fs.readFileSync(main, "utf8");
if (css.includes("M62：项目列表筛选框")) {
  console.log("already merged");
} else {
  css = css.replace(/\s*$/, "\n") + "\n" + fs.readFileSync(add, "utf8");
  fs.writeFileSync(main, css, "utf8");
  console.log("merged", css.length);
}
