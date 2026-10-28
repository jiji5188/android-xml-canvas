import fs from "fs";

// ---------- A) GenAssetsPanel：vector 双击 → onEditIcon ----------
{
  const p = "components/GenAssetsPanel.tsx";
  let s = fs.readFileSync(p, "utf8");
  const rep = (a, b, label) => {
    if (!s.includes(a)) throw new Error("没匹配上: " + label);
    s = s.replace(a, b);
  };

  if (!s.includes("onEditIcon")) {
    rep(
      "  /** M11：双击形状资源 → 打开形状编辑器改内容 */\n  onEditShape?: (name: string, xml: string) => void;",
      "  /** M11：双击形状资源 → 打开形状编辑器改内容 */\n  onEditShape?: (name: string, xml: string) => void;\n  /** M11j：双击图标（vector）→ 打开图标编辑器 */\n  onEditIcon?: (name: string, xml: string) => void;",
      "props onEditIcon"
    );
    rep("  inline,\n  onEditShape,\n}: Props) {", "  inline,\n  onEditShape,\n  onEditIcon,\n}: Props) {", "解构");
    rep(
      '                className={\n                  "axv-assets-row" + (onEditShape && r.kind === "shape" ? " axv-assets-row-editable" : "")\n                }\n                key={r.name}\n                onDoubleClick={() => {\n                  if (!onEditShape || r.kind !== "shape") return;\n                  onEditShape(r.name, r.xml);\n                }}\n                title={onEditShape && r.kind === "shape" ? "双击编辑形状内容" : undefined}',
      '                className={\n                  "axv-assets-row" +\n                  ((onEditShape && r.kind === "shape") || (onEditIcon && r.kind === "vector")\n                    ? " axv-assets-row-editable"\n                    : "")\n                }\n                key={r.name}\n                onDoubleClick={() => {\n                  if (r.kind === "shape" && onEditShape) onEditShape(r.name, r.xml);\n                  else if (r.kind === "vector" && onEditIcon) onEditIcon(r.name, r.xml);\n                }}\n                title={\n                  r.kind === "shape" && onEditShape\n                    ? "双击编辑形状内容"\n                    : r.kind === "vector" && onEditIcon\n                      ? "双击编辑图标（颜色 / 尺寸 / 路径 / 旋转）"\n                      : undefined\n                }',
      "双击分发"
    );
    fs.writeFileSync(p, s);
    console.log("GenAssetsPanel 已支持图标双击");
  } else {
    console.log("GenAssetsPanel 已改过，跳过");
  }
}

// ---------- B) XmlEditor ----------
{
  const p = "components/XmlEditor.tsx";
  let s = fs.readFileSync(p, "utf8");
  const rep = (a, b, label) => {
    if (!s.includes(a)) throw new Error("没匹配上: " + label);
    s = s.replace(a, b);
  };

  // import
  if (!s.includes('from "./IconEditor"')) {
    const im = /^import \{ GenAssetsPanel \} from "\.\/GenAssetsPanel";$/m;
    if (!im.test(s)) throw new Error("GenAssetsPanel import 行没找到");
    s = s.replace(im, (line) => line + '\nimport IconEditor from "./IconEditor";');
  }

  // state
  if (!s.includes("resIcon")) {
    rep(
      '  /** M4u：从资源树里直接打开的「绘制编辑器」（drawable/*.xml） */',
      '  /** M11j：正在编辑的生成图标（vector） */\n  const [resIcon, setResIcon] = useState<{ name: string; xml: string } | null>(null);\n  /** M4u：从资源树里直接打开的「绘制编辑器」（drawable/*.xml） */',
      "resIcon state"
    );
  }

  // 传参
  if (!s.includes("onEditIcon={" + "{name, iconXml}")) {
    rep(
      '                onEditShape={(name, shapeXml) => setResShape({ name, xml: shapeXml })}',
      '                onEditShape={(name, shapeXml) => setResShape({ name, xml: shapeXml })}\n                onEditIcon={(name, iconXml) => setResIcon({ name, xml: iconXml })}',
      "onEditIcon 接线"
    );
  }

  // 渲染
  if (!s.includes("<IconEditor")) {
    const snip = fs.readFileSync("snip-icon.txt", "utf8");
    const anchor = "      {/* M4u：资源树里的图片 / vector xml → 图片预览框 */}";
    if (!s.includes(anchor)) throw new Error("预览框锚点没匹配上");
    s = s.replace(anchor, snip + anchor);
  }

  fs.writeFileSync(p, s);
  console.log("XmlEditor 已接入 IconEditor");
}
