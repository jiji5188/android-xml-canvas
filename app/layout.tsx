import type { Metadata, Viewport } from "next";
import "./globals.css";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://lnkiai.github.io"),
  title: "Android XML 布局预览",
  applicationName: "Android XML Canvas",
  alternates: { canonical: `${BASE}/` },
  description:
    "浏览器里编辑 Android 布局 XML：实时预览、按资源目录解析主题、导出 res 包与预览图。",
  openGraph: {
    title: "Android XML 布局预览",
    description: "浏览器里编辑 Android 布局 XML：实时预览、导出 res 包与预览图。",
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
