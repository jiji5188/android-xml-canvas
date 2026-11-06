// lib/xml/res-preview.ts — M158：资源编辑器里的「aapt2 真预览」要渲染什么
//
// 需求：资源编辑器页加一个入口，点一下用设备上的 aapt2 真编译 + LayoutInflater 真渲染，
// 而不是继续看 CSS 近似。资源本身（drawable xml / vector）不是布局，没法直接 inflate，
// 所以这里生成一份「用完这个资源的示例布局」：View / Button / 禁用态 Button 都引
// @drawable/<name>，图标则用 24/48/96dp 三档 ImageView。
//
// 只生成纯平台控件（View/TextView/Button/ImageView），不引用 @string/@color/@style，
// 这样 aapt2 link 只要有这一个 drawable 就能过，不依赖项目其它资源。

import { applyResNamePrefix, sanitizeResName } from "./resname";

export type ResPreviewKind = "drawable" | "icon";

export interface ResPreviewFile {
  path: string;
  text: string;
}

export interface ResPreview {
  /** 生成的布局名（不带 .xml），renderReal 要它 */
  layoutName: string;
  /** 交给 native-render 的 res 相对路径文件清单 */
  files: ResPreviewFile[];
}

const DECL = '<?xml version="1.0" encoding="utf-8"?>\n';

function drawableLayout(ref: string): string {
  return `${DECL}<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:background="#FFFFFFFF"
    android:padding="20dp">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="normal / enabled"
        android:textColor="#FF333333"
        android:textSize="14sp" />

    <View
        android:id="@+id/res_plain"
        android:layout_width="match_parent"
        android:layout_height="96dp"
        android:layout_marginTop="8dp"
        android:background="${ref}" />

    <Button
        android:id="@+id/res_button"
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:layout_marginTop="16dp"
        android:text="Button"
        android:background="${ref}" />

    <Button
        android:id="@+id/res_button_disabled"
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:layout_marginTop="12dp"
        android:enabled="false"
        android:text="Button (disabled)"
        android:background="${ref}" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="16dp"
        android:text="${ref}"
        android:textColor="#FF888888"
        android:textSize="12sp" />
</LinearLayout>
`;
}

function iconLayout(ref: string): string {
  return `${DECL}<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:gravity="center"
    android:background="#FFFFFFFF"
    android:padding="20dp">

    <ImageView
        android:id="@+id/res_icon_96"
        android:layout_width="96dp"
        android:layout_height="96dp"
        android:src="${ref}" />

    <ImageView
        android:id="@+id/res_icon_48"
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:layout_marginTop="16dp"
        android:src="${ref}" />

    <ImageView
        android:id="@+id/res_icon_24"
        android:layout_width="24dp"
        android:layout_height="24dp"
        android:layout_marginTop="8dp"
        android:src="${ref}" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="16dp"
        android:text="${ref} · 96 / 48 / 24 dp"
        android:textColor="#FF888888"
        android:textSize="12sp" />
</LinearLayout>
`;
}

/**
 * 生成真预览用的 res 文件清单。
 * @param resName 资源名（保存前会按类型清理成合法名）
 * @param resXml  资源 XML 正文（编辑器当前树生成的，不必先保存）
 * @param kind    drawable（形状/selector/layer-list/ripple）或 icon（vector）
 * @param extraDrawables 可选：项目里其它 drawable xml（资源里 @drawable/xxx 引用能一起编译）
 */
export function buildResourcePreviewFiles(
  resName: string,
  resXml: string,
  kind: ResPreviewKind,
  extraDrawables?: Record<string, string> | null,
): ResPreview {
  const base = sanitizeResName(resName, kind === "icon" ? "ic" : "bg");
  // 按根类型补前缀：<selector> → bg_select_，<layer-list> → bg_layer_，vector → ic_
  const tag = (resXml.match(/<\s*([A-Za-z][\w.:-]*)/)?.[1] ?? "").toLowerCase();
  const prefixTag = kind === "icon" ? "vector" : tag;
  const name = sanitizeResName(applyResNamePrefix(base, prefixTag), kind === "icon" ? "ic" : "bg");
  const layoutName = `res_preview_${name}`;
  const ref = `@drawable/${name}`;
  const files: ResPreviewFile[] = [
    { path: `drawable/${name}.xml`, text: resXml },
    {
      path: `layout/${layoutName}.xml`,
      text: kind === "icon" ? iconLayout(ref) : drawableLayout(ref),
    },
  ];
  const seen = new Set(files.map((f) => f.path));
  for (const [rawName, xml] of Object.entries(extraDrawables ?? {})) {
    if (!xml) continue;
    const n = rawName.replace(/\.xml$/i, "").toLowerCase();
    if (!/^[a-z][a-z0-9_]*$/.test(n) || n === name) continue;
    const path = `drawable/${n}.xml`;
    if (seen.has(path)) continue;
    seen.add(path);
    files.push({ path, text: xml });
  }
  return { layoutName, files };
}
