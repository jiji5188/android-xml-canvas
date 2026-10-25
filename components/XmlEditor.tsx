// components/XmlEditor.tsx — M1a 主入口：左侧 XML 代码区 + 右侧画布 + 底部属性面板
// "use client"；粘贴 XML 或载入样例 → 实时渲染；点画布选中节点 → 属性面板可看可改（M1b）。

"use client";

import { useEffect, useMemo, useState } from "react";
import { parseLayoutXml } from "@/lib/xml/parser";
import { buildRenderModel } from "@/lib/xml/css";
import { mergeResourceFragment, DEFAULT_RESOURCES } from "@/lib/xml/resources";
import type { ResourceTable } from "@/lib/xml/types";
import { XmlCanvas } from "./XmlCanvas";
import "./xml-canvas.css";

type Tab = "list" | "toolbar" | "frame" | "custom";

const SAMPLES: Record<Exclude<Tab, "custom">, string> = {
  list: `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="@color/card_bg"
    android:padding="16dp">

  <TextView
      android:id="@+id/tvTitle"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:text="@string/app_name"
      android:textSize="18sp"
      android:textStyle="bold"/>

  <View
      android:layout_width="match_parent"
      android:layout_height="1dp"
      android:layout_marginTop="8dp"
      android:background="@color/divider"/>

  <TextView
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="16dp"
      android:padding="12dp"
      android:text="项目一"/>

  <Button
      android:id="@+id/btnConfirm"
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:layout_marginTop="24dp"
      android:text="@string/button_ok"
      android:background="@color/primary"
      android:textColor="@color/white"/>
</LinearLayout>`,
  toolbar: `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="56dp"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:background="@color/primary">

  <TextView
      android:layout_width="0dp"
      android:layout_height="match_parent"
      android:layout_weight="1"
      android:gravity="center_vertical"
      android:paddingStart="16dp"
      android:paddingEnd="16dp"
      android:text="标题栏"
      android:textSize="18sp"
      android:textColor="@color/white"/>

  <Button
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="@string/button_cancel"
      android:background="@color/transparent"
      android:textColor="@color/white"
      android:layout_marginEnd="16dp"/>
</LinearLayout>`,
  frame: `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/page_bg">

  <ScrollView
      android:layout_width="match_parent"
      android:layout_height="match_parent"
      android:padding="24dp">
    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical">
      <TextView
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:text="主体内容"
          android:textSize="16sp"/>
      <EditText
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:layout_marginTop="16dp"
          android:hint="输入框"
          android:padding="12dp"/>
      <ImageView
          android:layout_width="match_parent"
          android:layout_height="120dp"
          android:layout_marginTop="16dp"
          android:background="@color/card_bg"
          android:adjustViewBounds="true"/>
      <ProgressBar
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:layout_marginTop="16dp"
          android:style="?android:attr/progressBarStyleHorizontal"/>
    </LinearLayout>
  </ScrollView>

  <ImageView
      android:layout_width="48dp"
      android:layout_height="48dp"
      android:layout_gravity="bottom|end"
      android:layout_margin="24dp"
      android:background="@color/accent"/>
</FrameLayout>`,
};

const SCALE = 2; // 1dp = 2px

export function XmlEditor() {
  const [tab, setTab] = useState<Tab>("list");
  const [xml, setXml] = useState<string>(SAMPLES.list);
  const [resourceFragment, setResourceFragment] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  const resources: ResourceTable = useMemo(() => {
    return resourceFragment.trim() ? mergeResourceFragment(resourceFragment) : DEFAULT_RESOURCES;
  }, [resourceFragment]);

  const { model, issues, parseErr } = useMemo(() => {
    const { root, issues } = parseLayoutXml(xml);
    if (!root) return { model: null, issues, parseErr: true };
    return { model: buildRenderModel(root, resources, SCALE), issues, parseErr: false };
  }, [xml, resources]);

  // 切换 tab / 载入样例时清空选中
  useEffect(() => setSelectedPath(null), [xml]);

  const setTabAndXml = (t: Exclude<Tab, "custom">) => {
    setTab(t);
    setXml(SAMPLES[t]);
  };

  // 找选中节点的 rawAttrs（M1a 只读展示；M1b 改）
  const selectedAttrs = useMemo(() => {
    if (!selectedPath || !model) return null;
    const find = (n: (typeof model.root | any), path: string): any => {
      if (n.path === path) return n;
      for (const c of n.children ?? []) {
        const r = find(c, path);
        if (r) return r;
      }
      return null;
    };
    return find(model.root, selectedPath)?.rawAttrs ?? null;
  }, [selectedPath, model]);

  const widthPx = Math.round(412 * SCALE * scale); // 手机屏 412dp 基准
  const heightPx = Math.round(892 * SCALE * scale);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* 顶部工具条 */}
      <div className="axv-toolbar">
        <span style={{ fontWeight: 700, fontSize: 14, marginRight: 12 }}>Android 可视化布局编辑器</span>
        {(["list", "toolbar", "frame"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTabAndXml(t)}
            style={{
              padding: "5px 12px", borderRadius: 8, cursor: "pointer",
              background: tab === t ? "#6750A4" : "transparent",
              color: tab === t ? "#fff" : "#cdd6f4",
              border: "1px solid " + (tab === t ? "#6750A4" : "#45455e"),
              fontSize: 13,
            }}
          >
            {t === "list" ? "竖列表" : t === "toolbar" ? "横工具栏" : "悬浮布局"}
          </button>
        ))}
        <button
          onClick={() => setTab("custom")}
          style={{
            padding: "5px 12px", borderRadius: 8, cursor: "pointer", fontSize: 13,
            background: tab === "custom" ? "#6750A4" : "transparent",
            color: tab === "custom" ? "#fff" : "#cdd6f4",
            border: "1px solid " + (tab === "custom" ? "#6750A4" : "#45455e"),
          }}
        >
          自定义
        </button>
        <div style={{ flex: 1 }} />
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#8a8fa3" }}>
          缩放 {scale.toFixed(2)}×
          <input type="range" min={0.4} max={1.5} step={0.1} value={scale} onChange={(e) => setScale(parseFloat(e.target.value))} style={{ width: 90 }} />
        </label>
      </div>

      {/* 主体：左 XML / 右画布 */}
      <div className="axv-split">
        {/* 左：XML 代码区 */}
        <div className="axv-left-pane">
          <div style={{ padding: "6px 12px", fontSize: 11, color: "#8a8fa3", background: "#181825", borderBottom: "1px solid #313244" }}>
            res/layout/{tab === "custom" ? "custom" : tab === "list" ? "list" : tab === "toolbar" ? "toolbar" : "floating"}.xml（M1a 实时预览，可直接编辑下方内容）
          </div>
          <textarea
            className="axv-pane"
            value={xml}
            spellCheck={false}
            onChange={(e) => { setXml(e.target.value); setTab("custom"); }}
            style={{ border: "none", outline: "none", display: "block", width: "100%", flex: 1, resize: "none", background: "#181825", color: "#cdd6f4", font: "inherit" }}
          />
          <details style={{ padding: "8px 12px", fontSize: 12, color: "#8a8fa3", background: "#181825", borderTop: "1px solid #313244" }}>
            <summary style={{ cursor: "pointer" }}>资源表（@string / @dimen / @color 自定义）</summary>
            <textarea
              value={resourceFragment}
              onChange={(e) => setResourceFragment(e.target.value)}
              placeholder={'<resources>\n  <string name="app_name">My App</string>\n  <dimen name="margin_small">8dp</dimen>\n  <color name="primary">#FF0000</color>\n</resources>'}
              style={{ width: "100%", height: 120, marginTop: 6, background: "#1e1e2e", color: "#cdd6f4", border: "1px solid #45455e", borderRadius: 8, font: "inherit", padding: 8, boxSizing: "border-box" }}
            />
          </details>
        </div>

        {/* 右：画布 */}
        <div className="axv-right-pane">
          <div className="axv-stage" style={{ flex: 1 }}>
            {parseErr ? (
              <div className="axv-canvas-empty">XML 解析失败，请检查结构</div>
            ) : model ? (
              <div
                style={{
                  width: widthPx,
                  minHeight: heightPx,
                  border: "2px solid #45455e",
                  borderRadius: 24,
                  overflow: "hidden",
                  background: model.root.style.background || "#fff",
                  boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
                }}
              >
                <XmlCanvas node={model.root} selectedPath={selectedPath} onSelect={setSelectedPath} />
              </div>
            ) : null}
          </div>

          {/* 属性面板 */}
          <div className="axv-prop-panel" style={{ height: 168, borderTop: "1px solid #e0e0e0" }}>
            {selectedAttrs ? (
              <div>
                <div className="axv-prop-title">
                  选中：{selectedPath}（{model?.root.path === selectedPath ? "根节点" : "子节点"}）
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px", maxHeight: 120, overflowY: "auto" }}>
                  {Object.entries(selectedAttrs).map(([k, v]) => (
                    <div className="axv-prop-row" key={k}>
                      <label>{k}</label>
                      <input readOnly value={String(v)} />
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ color: "#8a8fa3", fontSize: 13, padding: "8px 4px" }}>
                在画布上点任意控件查看属性（M1a 只读；M1b 改后回写 XML）
              </div>
            )}
          </div>

          {/* issue 提示 */}
          {issues.length > 0 && (
            <div style={{ maxHeight: 90, overflowY: "auto", background: "#fff8e1", color: "#7a5b00", fontSize: 12, padding: "8px 12px", borderTop: "1px solid #f0e6b0" }}>
              <strong>{issues.length} 条提示：</strong>
              {issues.slice(0, 8).map((i, idx) => (
                <div key={idx}>[{i.level}] {i.nodePath} {i.message}</div>
              ))}
              {issues.length > 8 && <div>… 共 {issues.length} 条</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
