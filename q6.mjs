import fs from "fs";

// ---------- A) GenAssetsPanel：内嵌版去掉「关闭」按钮 + 形状双击编辑 ----------
{
  const p = "components/GenAssetsPanel.tsx";
  let s = fs.readFileSync(p, "utf8");
  const rep = (a, b, label) => {
    if (!s.includes(a)) throw new Error("没匹配上: " + label);
    s = s.replace(a, b);
  };

  // 1) 内嵌版 foot 去掉关闭按钮（保留说明文字）
  rep(
    `      <div className="axv-assets-foot">
        <span>
          改名 / 删除只影响编辑器里生成的资源；已上传 res 目录里的同名文件不会被改动
        </span>
        <button className="axv-btn" onClick={onClose}>
          关闭
        </button>
      </div>`,
    `      <div className="axv-assets-foot">
        <span>
          改名 / 删除只影响编辑器里生成的资源；已上传 res 目录里的同名文件不会被改动。
          形状资源双击可直接改内容。
        </span>
      </div>`,
    "内嵌 foot 关闭按钮"
  );

  // 2) props 增加 onEditShape
  rep(
    `  /** M11：内嵌到左侧 tab 面板里（不用弹窗/遮罩层） */
  inline?: boolean;`,
    `  /** M11：内嵌到左侧 tab 面板里（不用弹窗/遮罩层） */
  inline?: boolean;
  /** M11：双击形状资源 → 打开形状编辑器改内容 */
  onEditShape?: (name: string, xml: string) => void;`,
    "props onEditShape"
  );

  rep(
    `  onNote,
  inline,
}: Props) {`,
    `  onNote,
  inline,
  onEditShape,
}: Props) {`,
    "解构 onEditShape"
  );

  // 3) 行上挂双击（仅形状类资源、且传了回调时）
  const rowOld = `              <div className="axv-assets-row" key={r.name}>`;
  if (!s.includes(rowOld)) throw new Error("row 锚点没匹配上");
  const rowNew = `              <div
                className={
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
                }
              >`;
  s = s.replace(rowOld, rowNew);

  fs.writeFileSync(p, s);
  console.log("GenAssetsPanel 已更新");
}

// ---------- B) XmlEditor：传 onEditShape ----------
{
  const p = "components/XmlEditor.tsx";
  let s = fs.readFileSync(p, "utf8");
  const old = `                onDelete={onDeleteAsset}
                onClose={() => setLeftView("parts")}`;
  if (!s.includes(old)) throw new Error("GenAssetsPanel 内嵌调用锚点没匹配上");
  s = s.replace(
    old,
    `                onDelete={onDeleteAsset}
                onEditShape={(name, shapeXml) => setResShape({ name, xml: shapeXml })}
                onClose={() => setLeftView("parts")}`
  );
  fs.writeFileSync(p, s);
  console.log("XmlEditor 已接线 onEditShape");
}
