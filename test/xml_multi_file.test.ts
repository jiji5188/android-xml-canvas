// test/xml_multi_file.test.ts
// 多文件项目：纯数据层的增删改查与边界（同名、最后一个不能删、损坏数据回落）

import { describe, expect, it } from "vitest";
import {
  addFile,
  activeFile,
  createProject,
  guessFileName,
  normalizeFileName,
  parseProject,
  removeFile,
  renameFile,
  serializeProject,
  switchFile,
  uniqueFileName,
  updateFileXml,
  MAX_FILES,
} from "../lib/xml/multi-file";

const p0 = () => createProject("demo", { name: "a.xml", xml: "<LinearLayout/>" });

describe("多文件项目", () => {
  it("createProject 只含一个文件且为激活状态", () => {
    const p = p0();
    expect(p.files).toHaveLength(1);
    expect(p.activeId).toBe(p.files[0].id);
    expect(activeFile(p)!.name).toBe("a.xml");
  });

  it("addFile 追加并切过去，id 不重复", () => {
    const { project, id } = addFile(p0(), "b.xml", "<FrameLayout/>");
    expect(project.files).toHaveLength(2);
    expect(project.activeId).toBe(id);
    expect(new Set(project.files.map((f) => f.id)).size).toBe(2);
  });

  it("addFile 同名自动加序号", () => {
    const { project } = addFile(p0(), "a.xml", "<x/>");
    expect(project.files[1].name).toBe("a_2.xml");
  });

  it("updateFileXml 只影响目标文件；内容相同返回原对象", () => {
    const { project } = addFile(p0(), "b.xml", "<FrameLayout/>");
    const first = project.files[0].id;
    const next = updateFileXml(project, first, "<LinearLayout><TextView/></LinearLayout>", 123);
    expect(next.files[0].xml).toContain("TextView");
    expect(next.files[1].xml).toBe("<FrameLayout/>");
    expect(updateFileXml(next, first, next.files[0].xml)).toBe(next);
  });

  it("switchFile 切换激活项，不存在的 id 不动", () => {
    const { project } = addFile(p0(), "b.xml", "<x/>");
    const first = project.files[0].id;
    expect(switchFile(project, first).activeId).toBe(first);
    expect(switchFile(project, "nope")).toBe(project);
  });

  it("removeFile 删当前文件时切到相邻文件", () => {
    const { project } = addFile(p0(), "b.xml", "<x/>");
    const [a, b] = project.files;
    const after = removeFile({ ...project, activeId: b.id }, b.id);
    expect(after.files.map((f) => f.id)).toEqual([a.id]);
    expect(after.activeId).toBe(a.id);
  });

  it("最后一个文件删不掉", () => {
    const p = p0();
    expect(removeFile(p, p.files[0].id)).toBe(p);
  });

  it("renameFile 规整 + 去重", () => {
    const { project } = addFile(p0(), "b.xml", "<x/>");
    const b = project.files[1];
    expect(renameFile(project, b.id, "我的 布局").files[1].name).toBe("我的_布局.xml");
    expect(renameFile(project, b.id, "a.xml").files[1].name).toBe("a_2.xml");
  });

  it("normalizeFileName 补后缀 / 去路径 / 去非法字符", () => {
    expect(normalizeFileName("layout")).toBe("layout.xml");
    expect(normalizeFileName("res/layout/main.xml")).toBe("main.xml");
    expect(normalizeFileName('a<b>c.xml')).toBe("abc.xml");
    expect(normalizeFileName("   ")).toBe("layout.xml");
  });

  it("uniqueFileName 支持排除自己（改名成自己原名不重复加号）", () => {
    const { project } = addFile(p0(), "b.xml", "<x/>");
    const b = project.files[1];
    expect(uniqueFileName("b.xml", project.files, b.id)).toBe("b.xml");
  });

  it("guessFileName 按根标签命名", () => {
    expect(guessFileName("<androidx.constraintlayout.widget.ConstraintLayout/>")).toBe(
      "constraint_layout.xml",
    );
    expect(guessFileName("<LinearLayout/>")).toBe("linear_layout.xml");
    expect(guessFileName("garbage")).toBe("layout.xml");
  });

  it("序列化/反序列化往返一致；损坏数据返回 null", () => {
    const { project } = addFile(p0(), "b.xml", "<x/>");
    const back = parseProject(serializeProject(project))!;
    expect(back.files.map((f) => f.name)).toEqual(project.files.map((f) => f.name));
    expect(back.activeId).toBe(project.activeId);
    expect(parseProject("{bad json")).toBeNull();
    expect(parseProject(JSON.stringify({ files: [] }))).toBeNull();
    expect(parseProject(null)).toBeNull();
  });

  it("反序列化时 activeId 失效则回落第一个文件，坏条目被丢弃", () => {
    const raw = JSON.stringify({
      name: "x",
      activeId: "ghost",
      files: [
        { id: "f1", name: "a.xml", xml: "<A/>", updatedAt: 1 },
        { bogus: true },
        { id: "f2", name: "b.xml", xml: "<B/>" },
      ],
    });
    const p = parseProject(raw)!;
    expect(p.files).toHaveLength(2);
    expect(p.activeId).toBe("f1");
    expect(p.files[1].name).toBe("b.xml");
  });

  it("MAX_FILES 上限时不新增", () => {
    let p = p0();
    for (let i = 0; i < MAX_FILES + 5; i++) p = addFile(p, `f${i}.xml`, "<x/>").project;
    expect(p.files.length).toBe(MAX_FILES);
  });
});
