import fs from "fs";
const p = "components/xml-canvas.css";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error("没匹配上: " + label);
  s = s.replace(a, b);
};

// 1) 工具栏 top 0（已为 0，确认写法规范成 0px）
rep(
  `  /* M11d：贴顶（原来是 14px 悬浮） */
  top: 0;`,
  `  /* M11d：贴顶（原来是 14px 悬浮） */
  top: 0px;`,
  "toolbar top 0px"
);

// 2) 标签栏 top 48
rep(
  `  /* M11d：工具栏贴顶后（0~46），标签栏跟着上移 */
  top: 52px;`,
  `  /* M11f：工具栏贴顶后（0~46），标签栏 48 紧贴 */
  top: 48px;`,
  "mob-tabs top 48"
);

// 3) 舞台 margin-top 92
rep(
  `  /* M11d：顶部留白交给 margin-top（100）统一控制，padding 四边 24 */
  margin-top: 100px;`,
  `  /* M11f：顶部留白交给 margin-top（92）统一控制，padding 四边 24 */
  margin-top: 92px;`,
  "stage margin-top"
);

fs.writeFileSync(p, s);
console.log("top / margin 已调整");
