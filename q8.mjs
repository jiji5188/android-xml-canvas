import fs from "fs";

// ---------- A) GenAssetsPanel：vector 双击 → onEditIcon ----------
{
  const p = "components/GenAssetsPanel.tsx";
  let s = fs.readFileSync(p, "utf8");
  const rep = (a, b, label) => {
    if (!s.includes(a)) throw new Error("没匹配上: " + label);
    s = s.replace(a, b);
  };

  rep(
    `  /** M11：双击形状资源 → 打开形状编辑器改内容 */
  onEditShape?: (name: string, xml: string) => void;`,
    `  /** M11：双击形状资源 → 打开形状编辑器改内容 */
  onEditShape?: (name: string, xml: string) => void;
  /** M11j：双击图标（vector）→ 打开图标编辑器 */
  onEditIcon?: (name: string, xml: string) => void;`,
    "props onEditIcon"
  );

  rep(
    `  inline,
  onEditShape,
}: Props) {`,
    `  inline,
  onEditShape,
  onEditIcon,
}: Props) {`,
    "解构 onEditIcon"
  );

  rep(
    `                className={
                  "axv-assets-row" + (onEditShape && r.kind === "shape" ? " axv-assets-row-editable" : "")
                }
                key={r.name}
                onDoubleClick={() => {
                  if (!onEditShape || r.kind !== "shape") return;
                  onEditShape(r.name, r.xml);
                }}
                title={onEditShape && r.kind === "shape" ? "双击编辑形状内容" : undefined}`,
    `                className={
                  "axv-assets-row" +
                  ((onEditShape && r.kind === "shape") || (onEditIcon && r.kind === "vector")
                    ? " axv-assets-row-editable"
                    : "")
                }
                key={r.name}
                onDoubleClick={() => {
                  if (r.kind === "shape" && onEditShape) onEditShape(r.name, r.xml);
                  else if (r.kind === "vector" && onEditIcon) onEditIcon(r.name, r.xml);
                }}
                title={
                  r.kind === "shape" && onEditShape
                    ? "双击编辑形状内容"
                    : r.kind === "vector" && onEditIcon
                      ? "双击编辑图标（颜色 / 尺寸 / 路径 / 旋转）"
                      : undefined
                }`,
    "双击分发"
  );

  fs.writeFileSync(p, s);
  console.log("GenAssetsPanel 已支持图标双击");
}

// ---------- B) XmlEditor：接线 ----------
{
  const p = "components/XmlEditor.tsx";
  let s = fs.readFileSync(p, "utf8");
  const rep = (a, b, label) => {
    if (!s.includes(a)) throw new Error("没匹配上: " + label);
    s = s.replace(a, b);
  };

  // 1) 状态：正在编辑的图标
  rep(
    `  /** M4u：从资源树里直接打开的「绘制编辑器」（drawable/*.xml） */`,
    `  /** M11j：正在编辑的生成图标（vector） */
  const [resIcon, setResIcon] = useState<{ name: string; xml: string } | null>(null);
  /** M4u：从资源树里直接打开的「绘制编辑器」（drawable/*.xml） */`,
    "resIcon state"
  );

  // 2) 内嵌面板传 onEditIcon
  rep(
    `                onEditShape={(name, shapeXml) => setResShape({ name, xml: shapeXml })}`,
    `                onEditShape={(name, shapeXml) => setResShape({ name, xml: shapeXml })}
                onEditIcon={(name, iconXml) => setResIcon({ name, xml: iconXml })}`,
    "onEditIcon 接线"
  );

  // 3) 图标编辑器渲染
  rep(
    `      {/* M4u：资源树里的图片 / vector xml → 图片预览框 */}`,
    `      {/* M11j：生成的图标 → 图标编辑器（颜色 / 尺寸 / 路径 / 旋转） */}
      {resIcon ? (
        <IconEditor
          name={resIcon.name}
          xml={resIcon.xml}
          existingNames={Object.keys(generatedDrawables)}
          onClose={() => setResIcon(null)}
          onSave={(safeName, iconXml) => {
            setGeneratedDrawables((m) => {
              const next = { ...m };
              if (safeName !== resIcon.name) delete next[resIcon.name];
              next[safeName] = iconXml;
              return next;
            });
            if (safeName !== resIcon.name) {
              // 改名时同步改布局里的 @drawable/ 引用
              onRenameAsset(resIcon.name, safeName);
            }
            setResIcon(null);
            setExportNote(`已保存 res/drawable/${safeName}.xml`);
            window.setTimeout(() => setExportNote(" "), 3200);
          }}
        />
      ) : null}

      {/* M4u：资源树里的图片 / vector xml → 图片预览框 */}`,
    "IconEditor 渲染"
  );

  fs.writeFileSync(p, s);
  console.log("XmlEditor 已接入 IconEditor");
}
