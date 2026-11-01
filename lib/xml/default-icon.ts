/**
 * M48：应用默认项目图标（绿格子底 + 白色安卓机器人头）
 *
 * 为什么要内置：项目列表里没能读到项目自己的 ic_launcher（比如项目是网页版建的、
 * 或者图片资源还没生成）时，卡片会退化成「文件夹图标」，看着像没加载完。现在统一
 * 回退到这张默认图标，新建项目生成的启动图也用同一套配色。
 *
 * 以 SVG 形式内联成 data URL：不用打包二进制、任意分辨率都清晰，web 与 APK 都能用。
 */

const TEAL = "#3FBFA0";

/** 机器人头 + 网格的 SVG（144×144，圆角方块） */
export const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <defs>
    <clipPath id="r">
      <rect x="4" y="4" width="136" height="136" rx="22" ry="22"/>
    </clipPath>
  </defs>
  <rect x="4" y="4" width="136" height="136" rx="22" ry="22" fill="${TEAL}"/>
  <g clip-path="url(#r)" stroke="#ffffff" stroke-opacity="0.28" stroke-width="1.2">
    <path d="M24 4V140 M48 4V140 M72 4V140 M96 4V140 M120 4V140"/>
    <path d="M4 24H140 M4 48H140 M4 72H140 M4 96H140 M4 120H140"/>
  </g>
  <g fill="#ffffff">
    <path d="M38 96a34 34 0 0 1 68 0z"/>
    <circle cx="62" cy="84" r="5.4" fill="${TEAL}"/>
    <circle cx="82" cy="84" r="5.4" fill="${TEAL}"/>
  </g>
  <g stroke="#ffffff" stroke-width="6.5" stroke-linecap="round">
    <path d="M52.5 66.5L44 53"/>
    <path d="M91.5 66.5L100 53"/>
  </g>
</svg>`;

/** 直接丢给 <img src> 用 */
export const DEFAULT_ICON_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(DEFAULT_ICON_SVG)}`;

/** 启动图前景/背景用的主题色（写进 Android 工程时保持一致） */
export const DEFAULT_ICON_COLOR = TEAL;
