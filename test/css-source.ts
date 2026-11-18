// M378：xml-canvas.css 拆成 components/xml-canvas/ 13 片（index.css 桶）后，
// CSS 源码扫描类测试统一从这里读：按文件名序拼接 == 原单文件字节内容（验证过）。
import fs from "fs";
import path from "path";

export function readCssSource(): string {
  const dir = path.resolve("components/xml-canvas");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{2}-.+\.css$/.test(f))
    .sort();
  if (files.length === 0) throw new Error("components/xml-canvas/*.css 一片都没有？");
  return files.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("");
}
