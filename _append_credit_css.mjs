import fs from "node:fs";

const css = "components/xml-canvas.css";
const s = fs.readFileSync(css, "utf8");
const i = s.indexOf(".axv-about-desc {");
if (i < 0) throw new Error("anchor not found");
const j = s.indexOf("}", i);

const add = `
/* M16f：关于页的致谢（项目来源 + 开源致谢列表） */
.axv-credit-upstream {
  padding: 0 14px 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--axv-on-surface-variant);
}
.axv-credit-upstream a {
  color: #6750A4;
  font-weight: 600;
}
.axv-credit-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.axv-credit-list li {
  padding: 0 14px;
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--axv-on-surface-variant);
}
.axv-credit-list li a {
  color: #6750A4;
  font-weight: 700;
  text-decoration: none;
}
.axv-credit-list li a:hover {
  text-decoration: underline;
}
.axv-credit-by {
  margin-left: 8px;
  font-size: 11px;
  color: var(--axv-on-surface-variant);
}
.axv-credit-lic {
  margin-left: 8px;
  font-size: 10px;
  color: var(--axv-on-surface-variant);
  background: var(--axv-surface-sunken);
  border-radius: 4px;
  padding: 1px 6px;
}
.axv-credit-role {
  margin-top: 3px;
  font-size: 11.5px;
  color: var(--axv-on-surface-variant);
  opacity: 0.85;
}`;

fs.writeFileSync(css, s.slice(0, j + 1) + add + s.slice(j + 1), "utf8");
console.log("css appended at", j);
