import fs from "fs";
const p = "components/XmlEditor.tsx";
let s = fs.readFileSync(p, "utf8");
const rep = (a, b, label) => {
  if (!s.includes(a)) throw new Error("没匹配上: " + label);
  s = s.replace(a, b);
  console.log("改好: " + label);
};

// 1) resIcon 增加 attr（从属性面板进来时，保存后要把值写回该属性）
rep(
  `  const [resIcon, setResIcon] = useState<{ name: string; xml: string } | null>(null);`,
  `  const [resIcon, setResIcon] = useState<{ name: string; xml: string; attr?: string } | null>(
    null
  );`,
  "resIcon 类型"
);

// 2) AttrPanel 传 onEditIconResource
rep(
  `                onPickIcon={onPickIcon}`,
  `                onPickIcon={onPickIcon}
                onEditIconResource={(name, iconXml, attr) =>
                  setResIcon({ name: name || "ic_icon", xml: iconXml ?? "", attr })
                }`,
  "AttrPanel 接线"
);

// 3) 保存时：从属性面板进来的，写回 @drawable/名字
rep(
  `            if (safeName !== oldName) onRenameAsset(oldName, safeName);
            setResIcon(null);`,
  `            if (safeName !== oldName) onRenameAsset(oldName, safeName);
            // M11p：从属性面板「图标编辑」进来的话，保存后把属性指向这个资源
            if (resIcon.attr) commitAttr(resIcon.attr, "@drawable/" + safeName);
            setResIcon(null);`,
  "保存回写属性"
);

fs.writeFileSync(p, s);
