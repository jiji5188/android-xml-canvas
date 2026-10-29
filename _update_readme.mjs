import fs from "node:fs";

const p = "README.md";
const s = fs.readFileSync(p, "utf8");

// 1) 顶部改成新项目名 + 说明这是 M3E Canvas 的衍生
const headerOld = `<p align="center">
  <strong>Sketch Material 3 Expressive screens in the browser, link them, tap through them, and copy a prompt for your AI coding tool.</strong>
</p>`;
const headerNew = `<p align="center">
  <strong>Android 可视化 UI 编辑器 —— 在浏览器里拖控件、改属性，实时近似真机预览，导出 res 资源。</strong>
</p>

<p align="center">
  本项目是 <a href="https://github.com/lnkiai/m3e-canvas"><b>M3E Canvas</b></a>（MIT，lnkiai）的衍生拓展：
  保留其画布交互与组件模型，把目标从 Material 3 网页原型改为 <b>Android 布局 XML</b> 的可视化编辑。
</p>`;
if (!s.includes(headerOld)) throw new Error("header anchor missing");
let out = s.replace(headerOld, headerNew);

// 2) 致谢小节：插在 License 之前（与 lib/xml/credits.ts 同口径）
const credits = `## 致谢 / Acknowledgements

本项目的开发与运行依赖以下开源项目与作者的分享，在此致谢（与「关于」页面同一份口径）：

- **M3E Canvas** — [lnkiai](https://github.com/lnkiai)（MIT）— 项目上游：画布交互、组件模型、图层/资源面板与导出思路。
- **Material Components for Android** — Google（Apache-2.0）— 加载指示器的图形形状与动画模型。
- **Material Symbols** — Google（Apache-2.0）— 界面图标字体。
- **Android Open Source Project** — Google / Open Handset Alliance（Apache-2.0）— 布局规则与控件行为的实现依据。
- **Next.js** — Vercel（MIT）— 应用框架与静态导出。
- **React** — Meta（MIT）— 界面渲染与状态管理。
- **TypeScript** — Microsoft（Apache-2.0）— 类型系统。
- **Vitest** — Vitest team（MIT）— 单元测试。
- **Playwright** — Microsoft（Apache-2.0）— 端到端测试。
- **opentype.js** — Frederik De Bleser 等（MIT）— 字体轮廓读取。
- **html-to-image** — bubkoo（MIT）— 预览画布导出 PNG。
- **Motion** — Framer（MIT）— 面板与画布过渡动画。
- **Tailwind CSS** — Tailwind Labs（MIT）— 样式工具链。

`;

const licIdx = out.indexOf("## <img src=\"docs/readme/ui/icon-license.png\"");
if (licIdx < 0) throw new Error("license section missing");
out = out.slice(0, licIdx) + credits + out.slice(licIdx);

// 3) License 行补上「衍生自」
out = out.replace(
  "MIT © lnkiai",
  "MIT © jiji5188（衍生自 MIT 许可的 M3E Canvas © lnkiai）"
);

fs.writeFileSync(p, out, "utf8");
console.log("README updated");
