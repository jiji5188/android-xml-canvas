import fs from "node:fs";
const F = "components/ProjectPanel.tsx";
const lines = fs.readFileSync(F, "utf8").split("\n");

// 1) 取 815..942（1-based）之间的整块 JSX（是 `{tab === "projects" ? (` 的 <div> 子树）
const startIdx = 815 - 1; // `      {tab === "projects" ? (`
const bodyStart = 816 - 1; // `        <div className="axv-ws-panel">`
const bodyEnd = 942 - 1; // `        </div>`
if (!lines[startIdx].includes('tab === "projects" ? (')) throw new Error("start anchor moved");
if (lines[bodyStart].trim() !== '<div className="axv-ws-panel">') throw new Error("body start moved");
if (lines[bodyEnd].trim() !== "</div>") throw new Error("body end moved");

const body = lines.slice(bodyStart, bodyEnd + 1);
// 去掉最外层缩进 2 格（从 8 空格缩进变 6？保持 6 空格：原来是 8，新组件里用 6）
const dedented = body.map((l) => (l.startsWith("        ") ? l.slice(2) : l));

// 2) 用组件调用替换整块
const call = ["      {tab === \"projects\" ? <ProjectsTab p={p} /> : ("];
const rest = lines.slice(bodyEnd + 1); // 从 `      ) : (` 开始
const out = [...lines.slice(0, startIdx), ...call, ...rest];
fs.writeFileSync(F, out.join("\n"), "utf8");

// 3) 追加 ProjectsTab 组件（放在 ProjectPanel 之前）
const comp = `
/** M62：项目列表 tab（自带筛选状态；单独成组件是为了让 ProjectPanel 保持无 hooks，
 *  已有单测是直接调 ProjectPanel(props) 拿元素树的） */
function ProjectsTab({ p }: { p: ProjectPanelProps }) {
  const { tr, wsState, wsBusy, wsMsg, projects, metaOf } = p;
  const [projQuery, setProjQuery] = useState("");
  const shownProjects = useMemo(() => {
    const k = projQuery.trim().toLowerCase();
    if (!k) return projects;
    return projects.filter((it) => {
      const nm = metaOf(it)?.name || "";
      return (
        nm.toLowerCase().includes(k) ||
        it.name.toLowerCase().includes(k) ||
        it.rel.toLowerCase().includes(k)
      );
    });
  }, [projects, projQuery, metaOf]);

  return (
${dedented.map((l) => "    " + l).join("\n")}
  );
}
`;

let txt = fs.readFileSync(F, "utf8");
const marker = "export function ProjectPanel(p: ProjectPanelProps) {";
if (!txt.includes(marker)) throw new Error("ProjectPanel marker missing");
txt = txt.replace(marker, comp.trim() + "\n\n" + marker);
fs.writeFileSync(F, txt, "utf8");
console.log("extracted", dedented.length, "lines");
