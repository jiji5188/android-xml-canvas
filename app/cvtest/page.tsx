"use client";

// 临时验证页（M82）：只用于浏览器手测 IconCanvasEditor，测完删除
import { useState } from "react";
import IconCanvasEditor from "@/components/IconCanvasEditor";
import "@/components/xml-canvas.css";

const SAMPLE = `<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp" android:height="24dp"
    android:viewportWidth="24" android:viewportHeight="24"
    android:name="ic_star">
    <path android:fillColor="#1D1B20" android:pathData="M5 5h14v14H5z"/>
  </vector>`;

export default function Page() {
  const [saved, setSaved] = useState("");
  return (
    <div style={{ height: "100vh", background: "#eee", position: "relative", overflow: "hidden" }}>
      <IconCanvasEditor
        name="ic_star"
        xml={SAMPLE}
        existingNames={["ic_star"]}
        onClose={() => {
          (window as unknown as { __closed?: boolean }).__closed = true;
        }}
        onSave={(n, x) => {
          (window as unknown as { __saved?: string }).__saved = n + "\n" + x;
          setSaved(n + "\n" + x);
        }}
      />
      {saved ? <pre style={{ display: "none" }}>{saved}</pre> : null}
    </div>
  );
}
