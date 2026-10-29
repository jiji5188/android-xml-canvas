// 把 public/logo.svg 的设计落到 Android 矢量 drawable + Next 的 icon.svg + favicon.ico
// 只做一次性生成，不进构建链路。
import fs from "node:fs";

const logo = fs.readFileSync("public/logo.svg", "utf8");

// 1) app/icon.svg：Next 会用它生成 <link rel="icon">（保留完整设计，含渐变）
fs.writeFileSync("app/icon.svg", logo, "utf8");
console.log("wrote app/icon.svg");

// 2) Android 矢量：vector 不支持 CSS 渐变（需要 aapt:attr），这里用等效纯色，48dp 下肉眼一致
const r = (x, y, w, h, rad) => {
  const a = Math.min(rad, w / 2, h / 2);
  return `M${x + a},${y} H${x + w - a} A${a},${a} 0 0 1 ${x + w},${y + a} V${y + h - a} A${a},${a} 0 0 1 ${x + w - a},${y + h} H${x + a} A${a},${a} 0 0 1 ${x},${y + h - a} V${y + a} A${a},${a} 0 0 1 ${x + a},${y} Z`;
};

const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- 应用图标：紫色圆角底 + 画布外框 + 强调色标题条 + 选中控件（四角控制点）
     设计稿见 public/logo.svg（渐变版）；vector 不支持 CSS 渐变，这里用等效纯色 -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp" android:height="48dp"
    android:viewportWidth="48" android:viewportHeight="48">

    <!-- 底板 -->
    <path android:fillColor="#6750A4" android:pathData="${r(0, 0, 48, 48, 11)}" />

    <!-- 手机外框（描边） -->
    <path android:strokeColor="#FFFFFF" android:strokeWidth="2.2" android:strokeAlpha="0.96"
        android:fillColor="#00000000" android:pathData="${r(12.6, 7.4, 22.8, 33.2, 4.4)}" />

    <!-- 状态条 -->
    <path android:fillColor="#FFFFFF" android:fillAlpha="0.45" android:pathData="${r(20.6, 10.4, 6.8, 1.5, 0.75)}" />

    <!-- 标题条（强调色） -->
    <path android:fillColor="#FFD8E4" android:pathData="${r(16.6, 14.6, 14.8, 3.6, 1.8)}" />

    <!-- 文本行 -->
    <path android:fillColor="#FFFFFF" android:fillAlpha="0.92" android:pathData="${r(16.6, 20.3, 9, 2.2, 1.1)}" />

    <!-- 选中控件：半透明底 + 白框 -->
    <path android:fillColor="#FFFFFF" android:fillAlpha="0.24" android:pathData="${r(16.6, 24.6, 14.8, 7.6, 1.8)}" />
    <path android:strokeColor="#FFFFFF" android:strokeWidth="1.2" android:fillColor="#00000000"
        android:pathData="${r(16.6, 24.6, 14.8, 7.6, 1.8)}" />

    <!-- 四角控制点 -->
    <path android:fillColor="#FFFFFF" android:pathData="${r(15.4, 23.4, 2.4, 2.4, 0.5)}" />
    <path android:fillColor="#FFFFFF" android:pathData="${r(30.2, 23.4, 2.4, 2.4, 0.5)}" />
    <path android:fillColor="#FFFFFF" android:pathData="${r(15.4, 31, 2.4, 2.4, 0.5)}" />
    <path android:fillColor="#FFFFFF" android:pathData="${r(30.2, 31, 2.4, 2.4, 0.5)}" />

    <!-- 底部导航条 -->
    <path android:fillColor="#FFFFFF" android:fillAlpha="0.55" android:pathData="${r(19.4, 35.4, 9.2, 2, 1)}" />
</vector>
`;
fs.writeFileSync("apk/res/drawable/ic_launcher.xml", xml, "utf8");
console.log("wrote apk/res/drawable/ic_launcher.xml");

// 3) favicon.ico：用刚渲染好的 48px PNG 包一个标准 ICO（PNG 载荷，Vista+ 通用）
const png = fs.readFileSync("public/icons/icon-48.png");
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type = icon
header.writeUInt16LE(1, 4); // count
const entry = Buffer.alloc(16);
entry.writeUInt8(48, 0); // width
entry.writeUInt8(48, 1); // height
entry.writeUInt8(0, 2);
entry.writeUInt8(0, 3);
entry.writeUInt16LE(1, 4); // planes
entry.writeUInt16LE(32, 6); // bpp
entry.writeUInt32LE(png.length, 8);
entry.writeUInt32LE(6 + 16, 12);
fs.writeFileSync("app/favicon.ico", Buffer.concat([header, entry, png]));
console.log("wrote app/favicon.ico", 6 + 16 + png.length, "bytes");
