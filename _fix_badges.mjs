import fs from "node:fs";

const p = "README.md";
let s = fs.readFileSync(p, "utf8");

// star 徽章指向上游会误导（点进去是别人的项目）→ 指向本仓库
s = s.replaceAll("github.com/lnkiai/m3e-canvas/stargazers", "github.com/jiji5188/android-xml-canvas/stargazers");
s = s.replaceAll("img.shields.io/github/stars/lnkiai/m3e-canvas", "img.shields.io/github/stars/jiji5188/android-xml-canvas");

// 上游的赞助徽章/链接对本仓库没意义，去掉这一整行
s = s.replace(/\s*<a href="https:\/\/github\.com\/sponsors\/lnkiai">.*?<\/a>\n/, "\n");

// 上游 demo/在线地址也不适用
s = s.replace(
  /<p align="center"><a href="https:\/\/lnkiai\.github\.io\/m3e-canvas\/">.*?<\/p>/,
  '<p align="center"><a href="https://jiji5188.github.io/android-xml-canvas/"><img src="docs/readme/ui/open-en.png" height="56" alt="Open the editor" /></a></p>'
);

fs.writeFileSync(p, s, "utf8");
console.log("badges updated");
