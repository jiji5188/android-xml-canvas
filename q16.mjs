import fs from "fs";
let css = fs.readFileSync("components/xml-canvas.css", "utf8");
if (!css.includes(".axv-icon-ed-warn")) {
  css = css.trimEnd() + `

/* M11p：图标编辑器的提示条（空内容 / 传进来的不是 vector） */
.axv-icon-ed-warn {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
  border-radius: 10px;
  border: 1px solid #f0c36d;
  background: #fff8e6;
  color: #7a5200;
  font-size: 12px;
  line-height: 1.5;
}
.axv-icon-ed-warn .msr {
  flex: 0 0 auto;
  color: #b8860b;
}
html[data-axv-theme="dark"] .axv-icon-ed-warn {
  border-color: #6b5320;
  background: #3a2f13;
  color: #f2d79a;
}
`;
  fs.writeFileSync("components/xml-canvas.css", css);
  console.log("warn 样式已追加");
} else {
  console.log("warn 样式已存在");
}
