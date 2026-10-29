import type { Metadata, Viewport } from "next";
import "./globals.css";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://jiji5188.github.io"),
  title: "Android 可视化 UI 编辑器",
  applicationName: "Android 可视化 UI 编辑器",
  alternates: { canonical: `${BASE}/` },
  description:
    "在浏览器里可视化编辑 Android 布局 XML：拖控件、改属性、实时近似真机预览，一键导出 res 资源。",
  openGraph: {
    title: "Android 可视化 UI 编辑器",
    description: "在浏览器里可视化编辑 Android 布局 XML：拖控件、改属性、实时近似真机预览，导出 res 资源与预览图。",
    images: [`${BASE}/og.png`],
    type: "website",
  },
  twitter: { card: "summary_large_image", images: [`${BASE}/og.png`] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#F5F4F7",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 图标字体改用本地 material-symbols-rounded.ttf（见 globals.css 的 @font-face）。
            Roboto 不再从 Google Fonts 拉：离线/APK 壳里外网被拦，直接落系统字体。 */}
      </head>
      <body style={{ fontFamily: "Roboto, system-ui, -apple-system, sans-serif" }}>{children}</body>
    </html>
  );
}
