import fs from "fs";
const p = "components/xml-canvas.css";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error("没匹配上: " + label);
  s = s.replace(a, b);
};

// 1) 工具栏顶到 0
rep(
  `  position: absolute;
  left: 0;
  right: 0;
  top: 14px;
  display: flex;
  align-items: center;
  /* M6b：左按钮 | 中间可滚工具栏（吃满剩余宽度）| 右按钮；`,
  `  position: absolute;
  left: 0;
  right: 0;
  /* M11d：贴顶（原来是 14px 悬浮） */
  top: 0;
  display: flex;
  align-items: center;
  /* M6b：左按钮 | 中间可滚工具栏（吃满剩余宽度）| 右按钮；`,
  "toolbar top"
);

// 2) 标签栏紧贴工具栏下沿（工具栏 0~46）
rep(
  `  position: absolute;
  top: 64px;
  left: 0;
  right: 0;
  display: flex;
  gap: 3px;
  z-index: 10;`,
  `  position: absolute;
  /* M11d：工具栏贴顶后（0~46），标签栏跟着上移 */
  top: 52px;
  left: 0;
  right: 0;
  display: flex;
  gap: 3px;
  z-index: 10;`,
  "mob-tabs top"
);

// 3) 舞台：margin-top 100 + padding 24
rep(
  `.axv-stage {
  position: absolute;
  inset: 0;
  background: #F5F4F7;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  /* safe center：手机屏比可见区宽时从左侧对齐，不会被裁掉左边 */
  justify-content: safe center;
  padding: 124px 20px 24px;`,
  `.axv-stage {
  position: absolute;
  inset: 0;
  background: #F5F4F7;
  overflow: auto;
  display: flex;
  align-items: flex-start;
  /* safe center：手机屏比可见区宽时从左侧对齐，不会被裁掉左边 */
  justify-content: safe center;
  /* M11d：顶部留白交给 margin-top（100）统一控制，padding 四边 24 */
  margin-top: 100px;
  padding: 24px;`,
  "stage padding"
);

// 4) 手机档：padding 同步（顶部偏移已由 margin-top 提供）
rep(
  `  .axv-stage {
    /* M10：工具栏（top:8 + ≈46）+ 移动端 tab 行（top:56 + 最多两行≈62）≈ 124，留余量 130 */
    padding: 130px 8px 16px;
  }`,
  `  .axv-stage {
    /* M11d：顶部偏移由 margin-top:100 提供（工具栏 8~54 + tab 56~96 都在它后面），
       这里只留四边呼吸空间 */
    padding: 24px 8px 16px;
  }`,
  "手机 stage padding"
);

fs.writeFileSync(p, s);
console.log("stage / toolbar / tabs 已调整");
