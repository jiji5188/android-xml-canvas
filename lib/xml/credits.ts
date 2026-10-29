// lib/xml/credits.ts — 开源致谢（关于页面 / README 同一份口径）
//
// 单一事实源：关于面板只从这里渲染，不要再在组件里硬写列表。
// 改完这里记得同步 README.md 的「致谢 / Acknowledgements」小节（两份内容要保持一致）。

export interface Credit {
  /** 项目名 */
  name: string;
  /** 作者 / 组织 */
  by: string;
  /** 主页或仓库 */
  url: string;
  /** 许可证 */
  license: string;
  /** 在本项目里承担什么（一句中文说明，写给使用者看） */
  role: string;
}

/** 上游项目：本仓库由它拓展而来（必须置顶、必须写清楚） */
export const UPSTREAM: Credit = {
  name: "M3E Canvas",
  by: "lnkiai",
  url: "https://github.com/lnkiai/m3e-canvas",
  license: "MIT",
  role: "画布交互、组件模型、图层/资源面板与导出思路均来自这个项目；本项目在它的基础上把目标从 Material 3 网页原型改为 Android 布局 XML 可视化编辑。",
};

export const CREDITS: Credit[] = [
  {
    name: "Material Components for Android",
    by: "Google",
    url: "https://github.com/material-components/material-components-android",
    license: "Apache-2.0",
    role: "加载指示器的图形形状与动画模型（经 Aler1x/m3-loading-indicator 整理）。",
  },
  {
    name: "Material Symbols",
    by: "Google",
    url: "https://fonts.google.com/icons",
    license: "Apache-2.0",
    role: "界面图标字体（material-symbols-rounded）。",
  },
  {
    name: "Android Open Source Project",
    by: "Google / Open Handset Alliance",
    url: "https://source.android.com/",
    license: "Apache-2.0",
    role: "布局规则、控件行为与属性语义的依据：预览之所以「像真机」，是因为照着它的实现推的。",
  },
  {
    name: "Next.js",
    by: "Vercel",
    url: "https://nextjs.org/",
    license: "MIT",
    role: "应用框架与静态导出（APK 壳里跑的就是导出的静态站点）。",
  },
  {
    name: "React",
    by: "Meta",
    url: "https://react.dev/",
    license: "MIT",
    role: "界面渲染与状态管理。",
  },
  {
    name: "TypeScript",
    by: "Microsoft",
    url: "https://www.typescriptlang.org/",
    license: "Apache-2.0",
    role: "类型系统：布局模型、属性解析这些容易写错的地方靠它兜底。",
  },
  {
    name: "Vitest",
    by: "Vitest team",
    url: "https://vitest.dev/",
    license: "MIT",
    role: "单元测试（当前 800+ 条，覆盖解析、求解、导出与渲染模型）。",
  },
  {
    name: "Playwright",
    by: "Microsoft",
    url: "https://playwright.dev/",
    license: "Apache-2.0",
    role: "端到端测试与浏览器自动化验证。",
  },
  {
    name: "opentype.js",
    by: "Frederik De Bleser 等",
    url: "https://opentype.js.org/",
    license: "MIT",
    role: "读取字体轮廓，用于图标/文字的矢量导出。",
  },
  {
    name: "html-to-image",
    by: "bubkoo",
    url: "https://github.com/bubkoo/html-to-image",
    license: "MIT",
    role: "把预览画布导出成 PNG 预览图。",
  },
  {
    name: "Motion",
    by: "Framer",
    url: "https://motion.dev/",
    license: "MIT",
    role: "面板与画布的过渡动画。",
  },
  {
    name: "Tailwind CSS",
    by: "Tailwind Labs",
    url: "https://tailwindcss.com/",
    license: "MIT",
    role: "样式工具链（预览画布自身的样式仍是手写 CSS，保证与导出无关）。",
  },
];

/** 项目自身的名字与一句话定位（关于面板 / README 共用） */
export const PROJECT_NAME = "Android 可视化 UI 编辑器";
export const PROJECT_TAGLINE =
  "在浏览器里可视化编辑 Android 布局 XML：拖控件、改属性、实时近似真机预览，一键导出 res 资源。";
