import fs from "fs";
const p = "components/XmlEditor.tsx";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error("没匹配上: " + label);
  s = s.replace(a, b);
  console.log("改好: " + label);
};

rep(
  `          url={resImage.url}
          onClose={() => setResImage(null)}`,
  `          url={resImage.url}
          xml={
            generatedDrawables[resImage.name] ??
            resExtras?.drawableXml?.[resImage.name] ??
            resExtras?.drawableXml?.[resImage.name.replace(/\\.xml$/i, "")]
          }
          onEdit={(iconXml) => {
            const n = resImage.name.replace(/\\.xml$/i, "");
            setResImage(null);
            setResIcon({ name: n, xml: iconXml });
          }}
          onClose={() => setResImage(null)}`,
  "ResImagePreview 传 xml / onEdit"
);

fs.writeFileSync(p, s);

// CSS：编辑按钮的图标 + 间隙
let css = fs.readFileSync("components/xml-canvas.css", "utf8");
if (!css.includes(".axv-imgprev-edit")) {
  css = css.trimEnd() + `

/* M11o：图片预览框里的「编辑」（矢量图专用） */
.axv-imgprev-edit {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
`;
  fs.writeFileSync("components/xml-canvas.css", css);
  console.log("CSS 已追加");
}
