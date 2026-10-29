import fs from "fs";
const p = "components/AttrPanel.tsx";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error("没匹配上: " + label);
  s = s.replace(a, b);
  console.log("改好: " + label);
};

// 1) 新 prop：把「图标编辑」上抛给 XmlEditor（IconEditor 挂在那里）
rep(
  "  onPickIcon?: (attr: string, resourceName: string, vectorXml: string) => void;",
  "  onPickIcon?: (attr: string, resourceName: string, vectorXml: string) => void;\n  /** M11p：从资源对话框直接打开图标编辑器（xml 为空 = 当前值不是 vector，让编辑器新建） */\n  onEditIconResource?: (name: string, xml: string | undefined, attr: string) => void;",
  "prop 声明"
);

rep(
  "  onPickIcon,\n",
  "  onPickIcon,\n  onEditIconResource,\n",
  "解构"
);

// 2) DrawablePicker 传 onEditIcon
rep(
  `          onPickIcon={() => {
            setDpOpen(null);
            setIconPick(dpOpen);
          }}`,
  `          onPickIcon={() => {
            setDpOpen(null);
            setIconPick(dpOpen);
          }}
          onEditIcon={() => {
            const attr = dpOpen;
            const nm = String(node.rawAttrs[attr] ?? "")
              .replace(/^@(?:drawable|mipmap)\\//, "")
              .replace(/\\.xml$/i, "");
            const xml = nm ? (generatedXml?.[nm] ?? resExtras?.drawableXml?.[nm]) : undefined;
            const isVec = !!xml && /<vector[\\s>]/.test(xml);
            setDpOpen(null);
            onEditIconResource?.(isVec ? nm : "", isVec ? xml : undefined, attr);
          }}`,
  "onEditIcon 回调"
);

fs.writeFileSync(p, s);
