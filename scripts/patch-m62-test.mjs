import fs from "node:fs";
const p = "test/xml_m25d_project_panel.test.tsx";
let s = fs.readFileSync(p, "utf8");
s = s.replace("function mount(p: ProjectPanelProps): HTMLDivElement {", "async function mount(p: ProjectPanelProps): Promise<HTMLDivElement> {");
s = s.replace("  root.render(<ProjectPanel {...p} />);\n  return host;", "  root.render(<ProjectPanel {...p} />);\n  await flush();\n  await flush();\n  return host;");
s = s.split("const el = mount(").join("const el = await mount(");
s = s.replace(/it\("([^"]+)", \(\) => /g, 'it("$1", async () => ');
fs.writeFileSync(p, s, "utf8");
console.log("patched");
