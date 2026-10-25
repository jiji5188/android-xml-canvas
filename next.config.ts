import type { NextConfig } from "next";

// Set NEXT_PUBLIC_BASE_PATH=/<repo> when deploying to a GitHub Pages project site.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  devIndicators: false,
  // 手机/其他设备通过局域网 IP 访问 dev server 时，Next 16 默认会拦 /_next/* 返回 403
  // （HMR 的 WebSocket 也会连不上），这里显式放行局域网来源
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "192.168.31.101",
    "192.168.31.101:3000",
    "192.168.31.*",
  ],
};

export default nextConfig;
