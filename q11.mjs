import fs from "fs";
const p = "components/xml-canvas.css";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error("没匹配上: " + label);
  s = s.replace(a, b);
  console.log("改好: " + label);
};

// 1) pathData 文本域高度
rep(
  `.axv-icon-ed-pathdata {
  min-height: 72px;
}`,
  `.axv-icon-ed-pathdata {
  /* M11l：用户指定 150px */
  min-height: 150px;
}`,
  "pathdata min-height"
);

// 2) 变换那三个按钮宽 90px
rep(
  `.axv-icon-ed-btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 4px 0;
}`,
  `.axv-icon-ed-btns {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 4px 0;
}
/* M11l：旋转 / 水平镜像 / 垂直镜像 三个按钮固定 90px */
.axv-icon-ed-btns > .axv-set-btn {
  flex: 0 0 90px;
  width: 90px;
  padding: 0 4px;
}`,
  "变换按钮宽 90px"
);

// 3) 底部条：竖排 + auto 高 + padding 0 16px 16px + gap 6
rep(
  `.axv-icon-page-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 52px;
  padding: 0 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  background: var(--axv-surface, #fff);
  font-size: 12px;
  color: var(--axv-muted, #71717a);
}`,
  `.axv-icon-page-foot {
  flex: 0 0 auto;
  display: flex;
  /* M11l：竖排（说明在上、按钮在下），高度自适应 */
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  gap: 6px;
  height: auto;
  padding: 0 16px 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  background: var(--axv-surface, #fff);
  font-size: 12px;
  color: var(--axv-muted, #71717a);
}
.axv-icon-page-foot > span:last-child {
  justify-content: flex-end;
}`,
  "底部条竖排"
);

// 4) axv-set-group 内边距
const setGroupRe = /\.axv-set-group \{[^}]*\}/;
const m = setGroupRe.exec(s);
if (!m) throw new Error("axv-set-group 规则没找到");
const oldRule = m[0];
const newRule = /padding:\s*[^;]+;/.test(oldRule)
  ? oldRule.replace(/padding:\s*[^;]+;/, "padding: 6px 8px;")
  : oldRule.replace("{", "{\n  padding: 6px 8px;");
s = s.replace(oldRule, newRule);
console.log("改好: axv-set-group padding（原值: " + (oldRule.match(/padding:\s*[^;]+;/) || ["无"])[0] + "）");

fs.writeFileSync(p, s);
