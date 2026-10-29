import fs from "node:fs";

const p = "app/manifest.webmanifest";
const s = fs.readFileSync(p, "utf8");
const out = s
  .replace('"name": "M3E Canvas"', '"name": "Android 可视化 UI 编辑器"')
  .replace('"short_name": "M3E Canvas"', '"short_name": "Android可视化"')
  .replace(
    '"description": "Sketch Material 3 Expressive screens in the browser and turn them into vibe-coding prompts."',
    '"description": "在浏览器里可视化编辑 Android 布局 XML：拖控件、改属性、实时近似真机预览，一键导出 res 资源。"'
  );
fs.writeFileSync(p, out, "utf8");
console.log(fs.readFileSync(p, "utf8").split("\n").slice(0, 6).join("\n"));
