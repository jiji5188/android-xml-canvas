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
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;600;700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400..700,0..1,0&display=block"
        />
      </head>
      <body style={{ fontFamily: "Roboto, system-ui, sans-serif" }}>{children}</body>
    </html>
  );
}
