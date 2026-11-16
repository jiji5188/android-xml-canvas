/** M330：内置库目录 —— 常用 AndroidX / Material / 第三方库清单。
 * 工具不把所有库塞进 APK（保持轻量），而是给一个「按需下载」的目录：
 * 用户勾选某个库 → 工具从 maven 源下载 aar/jar 放进项目 libs/ → 编译时自动进 classpath（复用 M266/M278 aar 处理）。
 * 纯数据 + 纯函数，可单测。
 */

export type LibKind = "androidx" | "material" | "thirdparty";

export interface LibEntry {
  /** maven groupId */
  group: string;
  /** maven artifactId */
  artifact: string;
  /** 默认版本 */
  version: string;
  /** 库类型（决定下载源 + 展示分组） */
  kind: LibKind;
  /** 一句话用途（中文） */
  note: string;
  /** 是否 aar（androidx/material 一般是 aar，纯 jar 第三方是 jar） */
  isAar: boolean;
}

/** 库清单（按 kind 分组展示）。覆盖用户最常用的库。 */
export const LIBRARY_CATALOG: LibEntry[] = [
  // —— Material / AndroidX 组件库（Google Maven，aar）——
  { group: "com.google.android.material", artifact: "material", version: "1.12.0", kind: "material", isAar: true, note: "Material 组件库：MaterialButton / MaterialCardView / TextInputLayout / Chip / BottomNavigationView" },
  { group: "androidx.constraintlayout", artifact: "constraintlayout", version: "2.1.4", kind: "androidx", isAar: true, note: "ConstraintLayout 约束布局" },
  { group: "androidx.recyclerview", artifact: "recyclerview", version: "1.3.2", kind: "androidx", isAar: true, note: "RecyclerView 列表" },
  { group: "androidx.cardview", artifact: "cardview", version: "1.0.0", kind: "androidx", isAar: true, note: "CardView 卡片" },
  { group: "androidx.appcompat", artifact: "appcompat", version: "1.7.0", kind: "androidx", isAar: true, note: "AppCompatActivity / 主题" },
  { group: "androidx.fragment", artifact: "fragment", version: "1.8.4", kind: "androidx", isAar: true, note: "Fragment 分块" },
  { group: "androidx.lifecycle", artifact: "lifecycle-viewmodel", version: "2.8.6", kind: "androidx", isAar: true, note: "ViewModel 生命周期" },
  { group: "androidx.lifecycle", artifact: "lifecycle-livedata", version: "2.8.4", kind: "androidx", isAar: true, note: "LiveData 数据观察" },
  { group: "androidx.exoplayer", artifact: "exoplayer", version: "2.19.1", kind: "androidx", isAar: true, note: "ExoPlayer 视频播放" },
  { group: "androidx.room", artifact: "room-runtime", version: "2.6.1", kind: "androidx", isAar: true, note: "Room 数据库" },
  { group: "androidx.palette", artifact: "palette", version: "1.0.0", kind: "androidx", isAar: true, note: "从图片提取主色" },

  // —— 常用第三方库（Maven Central，jar）——
  { group: "com.google.code.gson", artifact: "gson", version: "2.10.1", kind: "thirdparty", isAar: false, note: "JSON 解析" },
  { group: "com.google.guava", artifact: "guava", version: "33.1.0-jre", kind: "thirdparty", isAar: false, note: "集合/缓存工具" },
  { group: "com.squareup.picasso", artifact: "picasso", version: "2.8", kind: "thirdparty", isAar: true, note: "图片加载（Picasso）" },
  { group: "com.github.bumptech.glide", artifact: "glide", version: "4.16.0", kind: "thirdparty", isAar: true, note: "图片加载（Glide）" },
  { group: "org.greenrobot", artifact: "eventbus", version: "3.3.1", kind: "thirdparty", isAar: false, note: "事件总线" },
  { group: "com.squareup.okhttp3", artifact: "okhttp", version: "4.12.0", kind: "thirdparty", isAar: true, note: "网络请求（OkHttp）" },
];

/** maven 坐标唯一标识（判断是否已下载用） */
export function libKey(e: LibEntry): string {
  return e.group + ":" + e.artifact + ":" + e.version;
}

/** 按 kind 分组（material 单列 / androidx / 第三方） */
export function groupCatalog(libs: LibEntry[] = LIBRARY_CATALOG): { kind: LibKind; label: string; libs: LibEntry[] }[] {
  const order: [LibKind, string][] = [
    ["material", "Material"],
    ["androidx", "AndroidX"],
    ["thirdparty", "第三方库"],
  ];
  return order.map(([kind, label]) => ({ kind, label, libs: libs.filter((e) => e.kind === kind) }));
}

/** 下载源 maven 基础 URL */
export function mavenBase(e: LibEntry): string {
  // Google Maven（dl.google.com）只覆盖 androidx.* 与 com.google.android.*；
  // 其它 com.google.*（gson/guava 等）与第三方都在 Maven Central
  const isGoogle = e.group.startsWith("androidx.") || e.group.startsWith("com.google.android.");
  return isGoogle ? "https://dl.google.com/dl/android/maven2" : "https://repo1.maven.org/maven2";
}

/** 生成 aar/jar 的直连下载 URL */
export function libDownloadUrl(e: LibEntry): string {
  const path = e.group.replace(/\./g, "/") + "/" + e.artifact + "/" + e.version + "/" + e.artifact + "-" + e.version + (e.isAar ? ".aar" : ".jar");
  return mavenBase(e) + "/" + path;
}
