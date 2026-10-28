import fs from "fs";
const p = "components/xml-canvas.css";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error("没匹配上: " + label);
  s = s.replace(a, b);
};

// 代码视图容器同步上移（工具栏 0~46 + 标签栏 52~92 → 从 100 开始）
rep(
  `.axv-mob-xml {
  position: absolute;
  inset: 124px 12px 12px;`,
  `.axv-mob-xml {
  position: absolute;
  /* M11d：工具栏贴顶后整体上移（0~46 工具栏 + 52~92 标签栏 → 100 起） */
  inset: 100px 12px 12px;`,
  "mob-xml 桌面"
);

rep(
  `  .axv-mob-xml {
    inset: 128px 20px 20px;
  }`,
  `  .axv-mob-xml {
    inset: 100px 20px 20px;
  }`,
  "mob-xml 中屏"
);

rep(
  `  .axv-mob-xml {
    inset: 130px 12px 12px;
  }`,
  `  .axv-mob-xml {
    inset: 100px 12px 12px;
  }`,
  "mob-xml 手机"
);

fs.writeFileSync(p, s);
console.log("代码视图 inset 已同步");
