import fs from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => fs.readFileSync(`${root}/${p}`, "utf8");

describe("M87 抽屉加入资源 tab + 整体变换挪到排列", () => {
  const src = read("components/IconCanvasEditor.tsx");

  it("抽屉 tab 为 5 个：样式 / 排列 / 图层 / 资源 / 画布", () => {
    expect(src).toContain(
      '[["style", "样式"], ["align", "排列"], ["layers", "图层"], ["res", "资源"], ["board", "画布"]]',
    );
    expect(src).toContain('useState<"style" | "align" | "layers" | "res" | "board">("style")');
  });

  it("排列页含整体变换（旋转 / 水平镜像 / 垂直镜像）", () => {
    const align = src.slice(src.indexOf('sheetTab === "align"'), src.indexOf('sheetTab === "layers"'));
    expect(align).toContain("整体变换");
    expect(align).toContain("水平镜像");
    expect(align).toContain("垂直镜像");
  });

  it("资源页含 名称 / 尺寸（dp）/ 插入图标 / 选择图标", () => {
    const res = src.slice(src.indexOf('sheetTab === "res"'), src.indexOf('sheetTab === "board"'));
    expect(res).toContain("名称");
    expect(res).toContain("尺寸（dp）");
    expect(res).toContain("插入图标");
    expect(res).toContain("选择图标");
    expect(res).toContain('className="axv-icon-ed-err"');
  });

  it("右侧边栏不再含资源分组与整体变换", () => {
    const form = src.slice(src.indexOf("axv-cv-form"), src.indexOf("axv-cv-sheet"));
    expect(form).not.toContain("尺寸（dp）");
    expect(form).not.toContain("水平镜像");
    // 保留 pathData 与查看 XML
    expect(form).toContain("axv-icon-ed-pathdata");
    expect(form).toContain("查看生成的 XML");
  });
});
