import fs from "fs";

// ---------- A) ResImagePreview：矢量资源加「编辑」按钮 ----------
{
  const p = "components/ResImagePreview.tsx";
  let s = fs.readFileSync(p, "utf8");
  const rep = (a, b, label) => {
    if (!s.includes(a)) throw new Error("没匹配上: " + label);
    s = s.replace(a, b);
  };

  rep(
    `  const [size, setSize] = useState<{ w: number; h: number } | null>(null);`,
    `  /** M11o：矢量资源（vector xml）原文；有值才显示「编辑」按钮 */
  xml?: string;
  /** 点「编辑」→ 打开图标编辑器 */
  onEdit?: (xml: string) => void;
}>;

export function ResImagePreview({ rel, name, url, xml, onEdit, onClose }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);`,
    "props"
  );

  // 上面 rep 把原签名顶掉了，补回 Props 声明（把新字段插进 interface）
  if (!s.includes("interface Props {")) throw new Error("Props 丢了");
  // 修复：删除被 rep 顶掉的旧解构行残留
  s = s.replace(
    `export function ResImagePreview({ rel, name, url, onClose }: Props) {
  /** M11o：矢量资源（vector xml）原文；有值才显示「编辑」按钮 */`,
    `export function ResImagePreview({ rel, name, url, xml, onEdit, onClose }: Props) {
  /** M11o：矢量资源（vector xml）原文；有值才显示「编辑」按钮 */`
  );

  // 真正的做法：把 props 字段插到 interface Props 里，并删掉误插在函数体的那段
  const wrong = `  /** M11o：矢量资源（vector xml）原文；有值才显示「编辑」按钮 */
  xml?: string;
  /** 点「编辑」→ 打开图标编辑器 */
  onEdit?: (xml: string) => void;
}>;

export function ResImagePreview({ rel, name, url, xml, onEdit, onClose }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);`;
  if (!s.includes(wrong)) throw new Error("插入位置修复失败");

  s = s.replace(
    `  url: string;
  onClose: () => void;
}`,
    `  url: string;
  /** M11o：矢量资源（vector xml）原文；有值才显示「编辑」按钮 */
  xml?: string;
  /** 点「编辑」→ 打开图标编辑器 */
  onEdit?: (xml: string) => void;
  onClose: () => void;
}`
  );

  s = s.replace(wrong, `export function ResImagePreview({ rel, name, url, xml, onEdit, onClose }: Props) {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);`);

  // 判定：是不是 vector xml
  rep(
    `  if (!mounted) return null;`,
    `  /** M11o：矢量图（vector drawable）才给「编辑」入口 */
  const isVector = !!xml && /<vector[\\s>]/.test(xml) && !!onEdit;

  if (!mounted) return null;`,
    "isVector"
  );

  // 底部加「编辑」
  rep(
    `          >
            复制引用
          </button>
        </div>`,
    `          >
            复制引用
          </button>
          {isVector ? (
            <button
              className="axv-btn axv-imgprev-edit"
              onClick={() => xml && onEdit?.(xml)}
              title="打开图标编辑器（颜色 / 尺寸 / 路径 / 旋转）"
            >
              <span className="msr" aria-hidden="true" style={{ fontSize: 16 }}>
                edit
              </span>
              编辑
            </button>
          ) : null}
        </div>`,
    "编辑按钮"
  );

  fs.writeFileSync(p, s);
  console.log("ResImagePreview 已加编辑按钮");
}

// ---------- B) XmlEditor：传 xml + onEdit ----------
{
  const p = "components/XmlEditor.tsx";
  let s = fs.readFileSync(p, "utf8");
  const rep = (a, b, label) => {
    if (!s.includes(a)) throw new Error("没匹配上: " + label);
    s = s.replace(a, b);
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
    "传 xml / onEdit"
  );

  fs.writeFileSync(p, s);
  console.log("XmlEditor 已接线");
}
