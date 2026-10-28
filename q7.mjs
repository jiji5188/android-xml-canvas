import fs from "fs";
const p = "components/GenAssetsPanel.tsx";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error("没匹配上: " + label);
  s = s.replace(a, b);
};

// 只有 <shape> 根的资源交给形状编辑器（selector / ripple / layer-list 结构不同，改了会破坏原文件）
rep(
  `                className={
                  "axv-assets-row" +
                  (onEditShape && r.kind !== "vector" ? " axv-assets-row-editable" : "")
                }
                key={r.name}
                onDoubleClick={() => {
                  if (!onEditShape || r.kind === "vector") return;
                  onEditShape(r.name, r.xml);
                }}
                title={
                  onEditShape && r.kind !== "vector" ? "双击编辑形状内容" : undefined
                }`,
  `                className={
                  "axv-assets-row" + (onEditShape && r.kind === "shape" ? " axv-assets-row-editable" : "")
                }
                key={r.name}
                onDoubleClick={() => {
                  if (!onEditShape || r.kind !== "shape") return;
                  onEditShape(r.name, r.xml);
                }}
                title={onEditShape && r.kind === "shape" ? "双击编辑形状内容" : undefined}`,
  "双击条件收紧为 shape"
);

fs.writeFileSync(p, s);

// CSS：可编辑行的手型 + hover 提示
const c = "components/xml-canvas.css";
let css = fs.readFileSync(c, "utf8");
if (!css.includes(".axv-assets-row-editable")) {
  css += `
/* M11i：可双击编辑的形状资源行 */
.axv-assets-row-editable {
  cursor: pointer;
}
.axv-assets-row-editable:hover {
  background: var(--axv-primary-soft, #e8f0fe);
}
`;
}
fs.writeFileSync(c, css);
console.log("已收紧 + 加样式");
