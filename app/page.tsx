"use client";

import { useEffect } from "react";

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
const TARGET = `${BASE}/xml/`;

/** 根路由：M3E 编辑器下线后，`/` 直接进 Android XML 布局编辑器 */
export default function Home() {
  useEffect(() => {
    window.location.replace(TARGET);
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        gap: 12,
        background: "#F5F4F7",
        color: "#1B1B1F",
        fontFamily: "Roboto, system-ui, sans-serif",
        fontSize: 14,
      }}
    >
      <div style={{ textAlign: "center", lineHeight: 1.7 }}>
        <div>正在打开 Android XML 布局编辑器…</div>
        <a href={TARGET} style={{ color: "#04409F", fontWeight: 600 }}>
          没反应？点这里
        </a>
      </div>
    </main>
  );
}
