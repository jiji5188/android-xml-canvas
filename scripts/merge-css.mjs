import fs from "node:fs";
const main = "components/xml-canvas.css";
const add = "components/m60c-m61.css";
let css = fs.readFileSync(main, "utf8");
if (css.includes("M61：Java/Kotlin 函数列表")) {
  console.log("already merged");
} else {
  const block = fs.readFileSync(add, "utf8");
  css = css.replace(/\s*$/, "\n") + "\n" + block;
  fs.writeFileSync(main, css, "utf8");
  console.log("merged, new length", css.length);
}
