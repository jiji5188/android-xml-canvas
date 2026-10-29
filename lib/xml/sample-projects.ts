// lib/xml/sample-projects.ts
// 完整示例项目：每个项目 = 布局 XML + 自己的 drawable 资源（vector 图标 / shape 背景）+ values。
// 为什么带资源：只给布局的话 @drawable/ic_xxx 全是红色虚线占位，「示例」看着像坏了；
// 带上真资源才能一眼看出这是能跑的界面，同时顺带验证「生成图标 → 引用 → 渲染 → 导出 res 包」链路。

/** 24dp 矢量图标（Material 风格 path） */
export function sampleIcon(pathData: string, color = "#1D1B20"): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
  <path
      android:fillColor="${color}"
      android:pathData="${pathData}" />
</vector>
`;
}

/** 纯色/渐变 + 圆角（可选描边）的 shape */
export function sampleShape(opts: {
  solid?: string;
  radius?: number;
  stroke?: string;
  strokeWidth?: number;
  gradient?: [string, string];
  angle?: number;
}): string {
  const { solid, radius = 0, stroke, strokeWidth = 1, gradient, angle = 270 } = opts;
  const fill = gradient
    ? `  <gradient android:angle="${angle}" android:endColor="${gradient[1]}" android:startColor="${gradient[0]}" />`
    : solid
      ? `  <solid android:color="${solid}" />`
      : "";
  const corners = radius > 0 ? `  <corners android:radius="${radius}dp" />` : "";
  const strokeXml = stroke
    ? `  <stroke android:width="${strokeWidth}dp" android:color="${stroke}" />`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
${[fill, corners, strokeXml].filter(Boolean).join("\n")}
</shape>
`;
}

/* ---------- 共用图标（路径取自 Material Design Icons） ---------- */
export const SAMPLE_ICONS: Record<string, string> = {
  ic_lock: sampleIcon(
    "M18,8h-1V6c0,-2.76 -2.24,-5 -5,-5S7,3.24 7,6v2H6c-1.1,0 -2,0.9 -2,2v10c0,1.1 0.9,2 2,2h12c1.1,0 2,-0.9 2,-2V10c0,-1.1 -0.9,-2 -2,-2zM12,17c-1.1,0 -2,-0.9 -2,-2s0.9,-2 2,-2 2,0.9 2,2 -0.9,2 -2,2zM15.1,8H8.9V6c0,-1.71 1.39,-3.1 3.1,-3.1 1.71,0 3.1,1.39 3.1,3.1v2z",
  ),
  ic_phone: sampleIcon(
    "M6.62,10.79c1.44,2.83 3.76,5.14 6.59,6.59l2.2,-2.2c0.27,-0.27 0.67,-0.36 1.02,-0.24 1.12,0.37 2.33,0.57 3.57,0.57 0.55,0 1,0.45 1,1V20c0,0.55 -0.45,1 -1,1 -9.39,0 -17,-7.61 -17,-17 0,-0.55 0.45,-1 1,-1h3.5c0.55,0 1,0.45 1,1 0,1.25 0.2,2.45 0.57,3.57 0.11,0.35 0.03,0.74 -0.25,1.02l-2.2,2.2z",
  ),
  ic_search: sampleIcon(
    "M15.5,14h-0.79l-0.28,-0.27C15.41,12.59 16,11.11 16,9.5 16,5.91 13.09,3 9.5,3S3,5.91 3,9.5 5.91,16 9.5,16c1.61,0 3.09,-0.59 4.23,-1.57l0.27,0.28v0.79l5,4.99L20.49,19l-4.99,-5zM9.5,14C7.01,14 5,11.99 5,9.5S7.01,5 9.5,5 14,7.01 14,9.5 11.99,14 9.5,14z",
  ),
  ic_cart: sampleIcon(
    "M7,18c-1.1,0 -1.99,0.9 -1.99,2S5.9,22 7,22s2,-0.9 2,-2 -0.9,-2 -2,-2zM1,2v2h2l3.6,7.59 -1.35,2.45c-0.16,0.28 -0.25,0.61 -0.25,0.96 0,1.1 0.9,2 2,2h12v-2H7.42c-0.14,0 -0.25,-0.11 -0.25,-0.25l0.03,-0.12 0.9,-1.63h7.45c0.75,0 1.41,-0.41 1.75,-1.03l3.58,-6.49c0.08,-0.14 0.12,-0.31 0.12,-0.48 0,-0.55 -0.45,-1 -1,-1H5.21l-0.94,-2H1zM17,18c-1.1,0 -1.99,0.9 -1.99,2s0.89,2 1.99,2 2,-0.9 2,-2 -0.9,-2 -2,-2z",
  ),
  ic_person: sampleIcon(
    "M12,12c2.21,0 4,-1.79 4,-4s-1.79,-4 -4,-4 -4,1.79 -4,4 1.79,4 4,4zM12,14c-2.67,0 -8,1.34 -8,4v2h16v-2c0,-2.66 -5.33,-4 -8,-4z",
  ),
  ic_notifications: sampleIcon(
    "M12,22c1.1,0 2,-0.9 2,-2h-4c0,1.1 0.89,2 2,2zM18,16v-5c0,-3.07 -1.64,-5.64 -4.5,-6.32V4c0,-0.83 -0.67,-1.5 -1.5,-1.5s-1.5,0.67 -1.5,1.5v0.68C7.63,5.36 6,7.92 6,11v5l-2,2v1h16v-1l-2,-2z",
  ),
  ic_settings: sampleIcon(
    "M19.14,12.94c0.04,-0.3 0.06,-0.61 0.06,-0.94c0,-0.32 -0.02,-0.64 -0.07,-0.94l2.03,-1.58c0.18,-0.14 0.23,-0.41 0.12,-0.61l-1.92,-3.32c-0.12,-0.22 -0.37,-0.29 -0.59,-0.22l-2.39,0.96c-0.5,-0.38 -1.03,-0.7 -1.62,-0.94L14.4,2.81c-0.04,-0.24 -0.24,-0.41 -0.48,-0.41h-3.84c-0.24,0 -0.43,0.17 -0.47,0.41L9.25,5.35C8.66,5.59 8.12,5.92 7.63,6.29L5.24,5.33c-0.22,-0.08 -0.47,0 -0.59,0.22L2.74,8.87C2.62,9.08 2.66,9.34 2.86,9.48l2.03,1.58C4.84,11.36 4.8,11.69 4.8,12s0.02,0.64 0.07,0.94l-2.03,1.58c-0.18,0.14 -0.23,0.41 -0.12,0.61l1.92,3.32c0.12,0.22 0.37,0.29 0.59,0.22l2.39,-0.96c0.5,0.38 1.03,0.7 1.62,0.94l0.36,2.54c0.05,0.24 0.24,0.41 0.48,0.41h3.84c0.24,0 0.44,-0.17 0.47,-0.41l0.36,-2.54c0.59,-0.24 1.13,-0.56 1.62,-0.94l2.39,0.96c0.22,0.08 0.47,0 0.59,-0.22l1.92,-3.32c0.12,-0.22 0.07,-0.47 -0.12,-0.61L19.14,12.94zM12,15.6c-1.98,0 -3.6,-1.62 -3.6,-3.6s1.62,-3.6 3.6,-3.6s3.6,1.62 3.6,3.6S13.98,15.6 12,15.6z",
  ),
  ic_favorite: sampleIcon(
    "M12,21.35l-1.45,-1.32C5.4,15.36 2,12.28 2,8.5 2,5.42 4.42,3 7.5,3c1.74,0 3.41,0.81 4.5,2.09C13.09,3.81 14.76,3 16.5,3 19.58,3 22,5.42 22,8.5c0,3.78 -3.4,6.86 -8.55,11.54L12,21.35z",
    "#B3261E",
  ),
  ic_star: sampleIcon(
    "M12,17.27L18.18,21l-1.64,-7.03L22,9.24l-7.19,-0.61L12,2 9.19,8.63 2,9.24l5.46,4.73L5.82,21z",
    "#F2B01E",
  ),
  ic_arrow_back: sampleIcon(
    "M20,11H7.83l5.59,-5.59L12,4l-8,8 8,8 1.41,-1.41L7.83,13H20v-2z",
  ),
  ic_location: sampleIcon(
    "M12,2C8.13,2 5,5.13 5,9c0,5.25 7,13 7,13s7,-7.75 7,-13c0,-3.87 -3.13,-7 -7,-7zM12,11.5c-1.38,0 -2.5,-1.12 -2.5,-2.5s1.12,-2.5 2.5,-2.5 2.5,1.12 2.5,2.5 -1.12,2.5 -2.5,2.5z",
  ),
  ic_more: sampleIcon(
    "M12,8c1.1,0 2,-0.9 2,-2s-0.9,-2 -2,-2 -2,0.9 -2,2 0.9,2 2,2zM12,10c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2zM12,16c-1.1,0 -2,0.9 -2,2s0.9,2 2,2 2,-0.9 2,-2 -0.9,-2 -2,-2z",
  ),
  ic_chevron: sampleIcon("M10,6L8.59,7.41 13.17,12l-4.58,4.59L10,18l6,-6z", "#9AA0A6"),
  ic_home: sampleIcon("M10,20v-6h4v6h5v-8h3L12,3 2,12h3v8z"),
  ic_menu: sampleIcon("M3,18h18v-2H3v2zM3,13h18v-2H3v2zM3,6v2h18V6H3z"),
  ic_image: sampleIcon(
    "M21,19V5c0,-1.1 -0.9,-2 -2,-2H5c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2zM8.5,13.5l2.5,3.01L14.5,12l4.5,6H5l3.5,-4.5z",
    "#9AA0A6",
  ),
  ic_check: sampleIcon("M9,16.17L4.83,12l-1.42,1.41L9,19 21,7l-1.41,-1.41z", "#146C2E"),
  ic_add: sampleIcon("M19,13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"),
};

/* ---------- 共用 shape（背景） ---------- */
export const SAMPLE_SHAPES: Record<string, string> = {
  bg_logo_circle: sampleShape({ solid: "#EADDFF", radius: 38 }),
  bg_input: sampleShape({ solid: "#FFFFFF", radius: 12, stroke: "#E0D9E3", strokeWidth: 1 }),
  bg_btn_primary: sampleShape({ solid: "#6750A4", radius: 14 }),
  bg_social_circle: sampleShape({ solid: "#F3EDF7", radius: 24 }),
  bg_thumb: sampleShape({ solid: "#F1F3F4", radius: 10 }),
  bg_card: sampleShape({ solid: "#FFFFFF", radius: 16 }),
  bg_section: sampleShape({ solid: "#FFFFFF", radius: 16 }),
  bg_divider: sampleShape({ solid: "#E0D9E3" }),
  bg_avatar: sampleShape({ solid: "#6750A4", radius: 28 }),
  bg_chip: sampleShape({ solid: "#EADDFF", radius: 12 }),
  bg_hero: sampleShape({ gradient: ["#6750A4", "#9A82DB"], angle: 270 }),
  bg_stat: sampleShape({ solid: "#F3EDF7", radius: 14 }),
  bg_price_tag: sampleShape({ solid: "#FDECEA", radius: 8 }),
  bg_bottom_bar: sampleShape({ solid: "#FFFFFF", radius: 20 }),
};

export interface SampleProject {
  key: string;
  /** 显示名，如「登录页」 */
  name: string;
  /** 用到的布局/组件库（显示在选项与说明里） */
  library: string;
  desc: string;
  layout: string;
  /** 这个项目自带的 drawable：资源名 → xml 原文 */
  drawables: Record<string, string>;
  /** values 片段（@color/@string/@dimen 的真实定义） */
  values?: string;
}

/** 从共用表里挑资源，组装成项目自带的 drawable */
function pickDrawables(names: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const n of names) {
    const xml = SAMPLE_ICONS[n] ?? SAMPLE_SHAPES[n];
    if (xml) out[n] = xml;
  }
  return out;
}

/* ============================================================
   1. 登录页 —— ConstraintLayout + 输入框 + 图标
   ============================================================ */
const LOGIN_LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/page_bg"
    android:paddingStart="24dp"
    android:paddingEnd="24dp">

  <ImageView
      android:id="@+id/ivLogo"
      android:layout_width="76dp"
      android:layout_height="76dp"
      android:layout_marginTop="56dp"
      android:background="@drawable/bg_logo_circle"
      android:padding="20dp"
      android:src="@drawable/ic_lock"
      android:tint="@color/primary"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toTopOf="parent" />

  <TextView
      android:id="@+id/tvWelcome"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="20dp"
      android:text="@string/login_welcome"
      android:textColor="@color/text_primary"
      android:textSize="24sp"
      android:textStyle="bold"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/ivLogo" />

  <TextView
      android:id="@+id/tvSub"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="6dp"
      android:text="@string/login_subtitle"
      android:textColor="@color/text_secondary"
      android:textSize="13sp"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/tvWelcome" />

  <EditText
      android:id="@+id/etPhone"
      android:layout_width="0dp"
      android:layout_height="52dp"
      android:layout_marginTop="32dp"
      android:background="@drawable/bg_input"
      android:drawableStart="@drawable/ic_phone"
      android:drawablePadding="12dp"
      android:hint="@string/login_phone_hint"
      android:inputType="phone"
      android:paddingStart="16dp"
      android:paddingEnd="16dp"
      android:textColor="@color/text_primary"
      android:textColorHint="@color/text_hint"
      android:textSize="15sp"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/tvSub" />

  <EditText
      android:id="@+id/etPwd"
      android:layout_width="0dp"
      android:layout_height="52dp"
      android:layout_marginTop="14dp"
      android:background="@drawable/bg_input"
      android:drawableStart="@drawable/ic_lock"
      android:drawablePadding="12dp"
      android:hint="@string/login_pwd_hint"
      android:inputType="textPassword"
      android:paddingStart="16dp"
      android:paddingEnd="16dp"
      android:textColor="@color/text_primary"
      android:textColorHint="@color/text_hint"
      android:textSize="15sp"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/etPhone" />

  <CheckBox
      android:id="@+id/cbRemember"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="12dp"
      android:checked="true"
      android:text="@string/login_remember"
      android:textColor="@color/text_secondary"
      android:textSize="13sp"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/etPwd" />

  <TextView
      android:id="@+id/tvForgot"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:text="@string/login_forgot"
      android:textColor="@color/primary"
      android:textSize="13sp"
      app:layout_constraintBaseline_toBaselineOf="@+id/cbRemember"
      app:layout_constraintEnd_toEndOf="parent" />

  <Button
      android:id="@+id/btnLogin"
      android:layout_width="0dp"
      android:layout_height="52dp"
      android:layout_marginTop="24dp"
      android:background="@drawable/bg_btn_primary"
      android:text="@string/login_action"
      android:textColor="@color/on_primary"
      android:textSize="16sp"
      android:textStyle="bold"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/tvForgot" />

  <TextView
      android:id="@+id/tvOther"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="36dp"
      android:text="@string/login_other"
      android:textColor="@color/text_hint"
      android:textSize="12sp"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/btnLogin" />

  <LinearLayout
      android:layout_width="wrap_content"
      android:layout_height="wrap_content"
      android:layout_marginTop="16dp"
      android:orientation="horizontal"
      app:layout_constraintEnd_toEndOf="parent"
      app:layout_constraintStart_toStartOf="parent"
      app:layout_constraintTop_toBottomOf="@+id/tvOther">

    <ImageButton
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:layout_marginEnd="16dp"
        android:background="@drawable/bg_social_circle"
        android:padding="13dp"
        android:src="@drawable/ic_person"
        android:tint="@color/text_secondary" />

    <ImageButton
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:layout_marginEnd="16dp"
        android:background="@drawable/bg_social_circle"
        android:padding="13dp"
        android:src="@drawable/ic_phone"
        android:tint="@color/text_secondary" />

    <ImageButton
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:background="@drawable/bg_social_circle"
        android:padding="13dp"
        android:src="@drawable/ic_notifications"
        android:tint="@color/text_secondary" />
  </LinearLayout>

</androidx.constraintlayout.widget.ConstraintLayout>
`;

const LOGIN_VALUES = `<resources>
  <string name="login_welcome">欢迎回来</string>
  <string name="login_subtitle">登录后继续你的工作</string>
  <string name="login_phone_hint">手机号 / 邮箱</string>
  <string name="login_pwd_hint">密码</string>
  <string name="login_remember">记住我</string>
  <string name="login_forgot">忘记密码？</string>
  <string name="login_action">登 录</string>
  <string name="login_other">— 其他登录方式 —</string>
  <color name="page_bg">#FEF7FF</color>
  <color name="text_primary">#1D1B20</color>
  <color name="text_secondary">#49454F</color>
  <color name="text_hint">#9AA0A6</color>
</resources>`;

/* ============================================================
   2. 商品列表 —— LinearLayout + ScrollView + CardView
   ============================================================ */
const CARD_BLOCK = (iconName: string, title: string, desc: string, price: string) => `      <androidx.cardview.widget.CardView
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:layout_marginBottom="12dp"
          app:cardBackgroundColor="@color/card_bg"
          app:cardCornerRadius="14dp"
          app:cardElevation="2dp">

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:orientation="horizontal"
            android:padding="12dp">

          <ImageView
              android:layout_width="72dp"
              android:layout_height="72dp"
              android:background="@drawable/bg_thumb"
              android:padding="20dp"
              android:scaleType="centerInside"
              android:src="@drawable/${iconName}" />

          <LinearLayout
              android:layout_width="0dp"
              android:layout_height="wrap_content"
              android:layout_marginStart="12dp"
              android:layout_weight="1"
              android:orientation="vertical">

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:text="${title}"
                android:textColor="@color/text_primary"
                android:textSize="15sp"
                android:textStyle="bold" />

            <TextView
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="4dp"
                android:text="${desc}"
                android:textColor="@color/text_secondary"
                android:textSize="12sp" />

            <LinearLayout
                android:layout_width="match_parent"
                android:layout_height="wrap_content"
                android:layout_marginTop="10dp"
                android:gravity="center_vertical"
                android:orientation="horizontal">

              <ImageView
                  android:layout_width="14dp"
                  android:layout_height="14dp"
                  android:src="@drawable/ic_star" />

              <TextView
                  android:layout_width="wrap_content"
                  android:layout_height="wrap_content"
                  android:layout_marginStart="4dp"
                  android:text="4.8 · 已售 1.2k"
                  android:textColor="@color/text_secondary"
                  android:textSize="12sp" />

              <TextView
                  android:layout_width="0dp"
                  android:layout_height="wrap_content"
                  android:layout_weight="1"
                  android:gravity="end"
                  android:text="${price}"
                  android:textColor="@color/price"
                  android:textSize="17sp"
                  android:textStyle="bold" />
            </LinearLayout>
          </LinearLayout>
        </LinearLayout>
      </androidx.cardview.widget.CardView>

`;

const LIST_LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/page_bg"
    android:orientation="vertical">

  <LinearLayout
      android:layout_width="match_parent"
      android:layout_height="56dp"
      android:gravity="center_vertical"
      android:orientation="horizontal"
      android:paddingStart="16dp"
      android:paddingEnd="16dp">

    <TextView
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:text="@string/shop_title"
        android:textColor="@color/text_primary"
        android:textSize="20sp"
        android:textStyle="bold" />

    <ImageView
        android:layout_width="24dp"
        android:layout_height="24dp"
        android:src="@drawable/ic_cart"
        android:tint="@color/text_primary" />
  </LinearLayout>

  <EditText
      android:layout_width="match_parent"
      android:layout_height="44dp"
      android:layout_marginStart="16dp"
      android:layout_marginEnd="16dp"
      android:background="@drawable/bg_input"
      android:drawableStart="@drawable/ic_search"
      android:drawablePadding="10dp"
      android:hint="@string/shop_search"
      android:paddingStart="14dp"
      android:paddingEnd="14dp"
      android:textColorHint="@color/text_hint"
      android:textSize="14sp" />

  <ScrollView
      android:layout_width="match_parent"
      android:layout_height="0dp"
      android:layout_weight="1"
      android:paddingStart="16dp"
      android:paddingTop="12dp"
      android:paddingEnd="16dp"
      android:paddingBottom="16dp">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical">

${CARD_BLOCK("ic_image", "无线降噪耳机 Pro", "主动降噪 · 38 小时续航", "¥899")}${CARD_BLOCK("ic_cart", "便携咖啡手冲套装", "含滤杯 / 分享壶 / 温度计", "¥268")}${CARD_BLOCK("ic_image", "机械键盘 87 键", "热插拔 · 三模连接", "¥459")}    </LinearLayout>
  </ScrollView>

</LinearLayout>
`;

const LIST_VALUES = `<resources>
  <string name="shop_title">好物商店</string>
  <string name="shop_search">搜商品、品牌</string>
  <color name="price">#B3261E</color>
</resources>`;

/* ============================================================
   3. 设置页 —— LinearLayout + Switch + 分组卡片
   ============================================================ */
const ROW_ICON = (iconName: string, label: string, tint = "@color/text_primary") => `      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="56dp"
          android:gravity="center_vertical"
          android:orientation="horizontal"
          android:paddingStart="16dp"
          android:paddingEnd="12dp">

        <ImageView
            android:layout_width="22dp"
            android:layout_height="22dp"
            android:src="@drawable/${iconName}"
            android:tint="${tint}" />

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="14dp"
            android:layout_weight="1"
            android:text="${label}"
            android:textColor="@color/text_primary"
            android:textSize="15sp" />

        <ImageView
            android:layout_width="20dp"
            android:layout_height="20dp"
            android:src="@drawable/ic_chevron" />
      </LinearLayout>

`;

const ROW_SWITCH = (iconName: string, label: string, checked: string) => `      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="56dp"
          android:gravity="center_vertical"
          android:orientation="horizontal"
          android:paddingStart="16dp"
          android:paddingEnd="12dp">

        <ImageView
            android:layout_width="22dp"
            android:layout_height="22dp"
            android:src="@drawable/${iconName}"
            android:tint="@color/text_primary" />

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="14dp"
            android:layout_weight="1"
            android:text="${label}"
            android:textColor="@color/text_primary"
            android:textSize="15sp" />

        <Switch
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:checked="${checked}" />
      </LinearLayout>

`;

const SETTINGS_LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/page_bg"
    android:orientation="vertical">

  <LinearLayout
      android:layout_width="match_parent"
      android:layout_height="56dp"
      android:gravity="center_vertical"
      android:orientation="horizontal"
      android:paddingStart="12dp"
      android:paddingEnd="16dp">

    <ImageView
        android:layout_width="24dp"
        android:layout_height="24dp"
        android:layout_marginEnd="12dp"
        android:src="@drawable/ic_arrow_back"
        android:tint="@color/text_primary" />

    <TextView
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:text="@string/settings_title"
        android:textColor="@color/text_primary"
        android:textSize="20sp"
        android:textStyle="bold" />

    <ImageView
        android:layout_width="24dp"
        android:layout_height="24dp"
        android:src="@drawable/ic_more"
        android:tint="@color/text_primary" />
  </LinearLayout>

  <ScrollView
      android:layout_width="match_parent"
      android:layout_height="0dp"
      android:layout_weight="1"
      android:paddingStart="16dp"
      android:paddingEnd="16dp"
      android:paddingBottom="16dp">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical">

      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:background="@drawable/bg_avatar"
          android:gravity="center_vertical"
          android:orientation="horizontal"
          android:padding="16dp">

        <ImageView
            android:layout_width="52dp"
            android:layout_height="52dp"
            android:padding="13dp"
            android:src="@drawable/ic_person"
            android:tint="@color/on_primary" />

        <LinearLayout
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_marginStart="14dp"
            android:layout_weight="1"
            android:orientation="vertical">

          <TextView
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:text="@string/settings_user"
              android:textColor="@color/on_primary"
              android:textSize="17sp"
              android:textStyle="bold" />

          <TextView
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:layout_marginTop="2dp"
              android:text="@string/settings_user_desc"
              android:textColor="@color/on_primary"
              android:textSize="12sp" />
        </LinearLayout>
      </LinearLayout>

      <TextView
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:layout_marginTop="20dp"
          android:layout_marginBottom="8dp"
          android:text="@string/settings_group1"
          android:textColor="@color/text_secondary"
          android:textSize="12sp" />

      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:background="@drawable/bg_section"
          android:orientation="vertical">

${ROW_ICON("ic_person", "个人资料")}${ROW_SWITCH("ic_notifications", "消息通知", "true")}${ROW_SWITCH("ic_lock", "生物识别锁", "false")}      </LinearLayout>

      <TextView
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:layout_marginTop="20dp"
          android:layout_marginBottom="8dp"
          android:text="@string/settings_group2"
          android:textColor="@color/text_secondary"
          android:textSize="12sp" />

      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:background="@drawable/bg_section"
          android:orientation="vertical">

${ROW_ICON("ic_settings", "通用设置")}${ROW_ICON("ic_home", "存储与缓存")}${ROW_ICON("ic_location", "定位与隐私")}      </LinearLayout>

      <Button
          android:layout_width="match_parent"
          android:layout_height="50dp"
          android:layout_marginTop="24dp"
          android:background="@drawable/bg_btn_primary"
          android:text="@string/settings_logout"
          android:textColor="@color/on_primary"
          android:textSize="15sp" />
    </LinearLayout>
  </ScrollView>

</LinearLayout>
`;

const SETTINGS_VALUES = `<resources>
  <string name="settings_title">设置</string>
  <string name="settings_user">张三</string>
  <string name="settings_user_desc">zhangsan@example.com</string>
  <string name="settings_group1">账号</string>
  <string name="settings_group2">通用</string>
  <string name="settings_logout">退出登录</string>
</resources>`;

/* ============================================================
   4. 详情页 —— NestedScrollView + FrameLayout 头图 + 底部栏
   ============================================================ */
const DETAIL_LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/page_bg"
    android:orientation="vertical">

  <androidx.core.widget.NestedScrollView
      android:layout_width="match_parent"
      android:layout_height="0dp"
      android:layout_weight="1">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical">

      <FrameLayout
          android:layout_width="match_parent"
          android:layout_height="240dp"
          android:background="@drawable/bg_hero">

        <ImageView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_gravity="center"
            android:background="@drawable/bg_social_circle"
            android:padding="22dp"
            android:src="@drawable/ic_image"
            android:tint="@color/on_primary" />

        <ImageView
            android:layout_width="24dp"
            android:layout_height="24dp"
            android:layout_gravity="start|top"
            android:layout_marginStart="16dp"
            android:layout_marginTop="16dp"
            android:src="@drawable/ic_arrow_back"
            android:tint="@color/on_primary" />

        <ImageView
            android:layout_width="24dp"
            android:layout_height="24dp"
            android:layout_gravity="end|top"
            android:layout_marginTop="16dp"
            android:layout_marginEnd="16dp"
            android:src="@drawable/ic_favorite" />
      </FrameLayout>

      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:background="@drawable/bg_card"
          android:orientation="vertical"
          android:padding="20dp">

        <TextView
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text="@string/detail_title"
            android:textColor="@color/text_primary"
            android:textSize="21sp"
            android:textStyle="bold" />

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="10dp"
            android:gravity="center_vertical"
            android:orientation="horizontal">

          <ImageView
              android:layout_width="16dp"
              android:layout_height="16dp"
              android:src="@drawable/ic_star" />

          <TextView
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:layout_marginStart="4dp"
              android:text="@string/detail_rating"
              android:textColor="@color/text_secondary"
              android:textSize="13sp" />

          <ImageView
              android:layout_width="16dp"
              android:layout_height="16dp"
              android:layout_marginStart="14dp"
              android:src="@drawable/ic_location"
              android:tint="@color/text_hint" />

          <TextView
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:layout_marginStart="4dp"
              android:text="@string/detail_city"
              android:textColor="@color/text_secondary"
              android:textSize="13sp" />
        </LinearLayout>

        <TextView
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="16dp"
            android:lineSpacingExtra="6dp"
            android:text="@string/detail_body"
            android:textColor="@color/text_secondary"
            android:textSize="14sp" />

        <LinearLayout
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="18dp"
            android:orientation="horizontal">

          <TextView
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:background="@drawable/bg_chip"
              android:paddingStart="12dp"
              android:paddingTop="6dp"
              android:paddingEnd="12dp"
              android:paddingBottom="6dp"
              android:text="@string/detail_tag1"
              android:textColor="@color/primary"
              android:textSize="12sp" />

          <TextView
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:layout_marginStart="8dp"
              android:background="@drawable/bg_chip"
              android:paddingStart="12dp"
              android:paddingTop="6dp"
              android:paddingEnd="12dp"
              android:paddingBottom="6dp"
              android:text="@string/detail_tag2"
              android:textColor="@color/primary"
              android:textSize="12sp" />
        </LinearLayout>
      </LinearLayout>
    </LinearLayout>
  </androidx.core.widget.NestedScrollView>

  <LinearLayout
      android:layout_width="match_parent"
      android:layout_height="72dp"
      android:background="@drawable/bg_bottom_bar"
      android:elevation="8dp"
      android:gravity="center_vertical"
      android:orientation="horizontal"
      android:paddingStart="20dp"
      android:paddingEnd="20dp">

    <LinearLayout
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:orientation="vertical">

      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="@string/detail_price"
          android:textColor="@color/price"
          android:textSize="22sp"
          android:textStyle="bold" />

      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="@string/detail_price_note"
          android:textColor="@color/text_hint"
          android:textSize="11sp" />
    </LinearLayout>

    <Button
        android:layout_width="140dp"
        android:layout_height="48dp"
        android:background="@drawable/bg_btn_primary"
        android:text="@string/detail_buy"
        android:textColor="@color/on_primary"
        android:textSize="15sp"
        android:textStyle="bold" />
  </LinearLayout>

</LinearLayout>
`;

const DETAIL_VALUES = `<resources>
  <string name="detail_title">云南小粒咖啡 · 中度烘焙</string>
  <string name="detail_rating">4.9（326 条评价）</string>
  <string name="detail_city">云南 普洱</string>
  <string name="detail_body">手工采摘当季成熟果，水洗处理后中度烘焙。入口是坚果与焦糖的甜感，尾段带着一点柑橘的清爽酸质，适合手冲与意式。</string>
  <string name="detail_tag1">当季新豆</string>
  <string name="detail_tag2">顺丰包邮</string>
  <string name="detail_price">¥128</string>
  <string name="detail_price_note">250g / 袋 · 含运费</string>
  <string name="detail_buy">立即购买</string>
</resources>`;

/* ============================================================
   5. 工作台 —— HorizontalScrollView + GridLayout 数据卡
   ============================================================ */
const STAT_CARD = (title: string, value: string, iconName: string) => `        <LinearLayout
            android:layout_width="132dp"
            android:layout_height="wrap_content"
            android:layout_marginEnd="12dp"
            android:background="@drawable/bg_section"
            android:orientation="vertical"
            android:padding="14dp">

          <ImageView
              android:layout_width="20dp"
              android:layout_height="20dp"
              android:src="@drawable/${iconName}"
              android:tint="@color/primary" />

          <TextView
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:layout_marginTop="10dp"
              android:text="${value}"
              android:textColor="@color/text_primary"
              android:textSize="20sp"
              android:textStyle="bold" />

          <TextView
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:layout_marginTop="2dp"
              android:text="${title}"
              android:textColor="@color/text_secondary"
              android:textSize="12sp" />
        </LinearLayout>

`;

const GRID_TILE = (iconName: string, label: string, row: number, col: number) => `      <LinearLayout
          android:layout_width="0dp"
          android:layout_height="96dp"
          android:layout_column="${col}"
          android:layout_columnWeight="1"
          android:layout_margin="6dp"
          android:layout_row="${row}"
          android:background="@drawable/bg_card"
          android:gravity="center"
          android:orientation="vertical">

        <ImageView
            android:layout_width="26dp"
            android:layout_height="26dp"
            android:src="@drawable/${iconName}"
            android:tint="@color/primary" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp"
            android:text="${label}"
            android:textColor="@color/text_primary"
            android:textSize="13sp" />
      </LinearLayout>

`;

const DASHBOARD_LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/page_bg"
    android:orientation="vertical">

  <LinearLayout
      android:layout_width="match_parent"
      android:layout_height="56dp"
      android:gravity="center_vertical"
      android:orientation="horizontal"
      android:paddingStart="16dp"
      android:paddingEnd="16dp">

    <ImageView
        android:layout_width="24dp"
        android:layout_height="24dp"
        android:src="@drawable/ic_menu"
        android:tint="@color/text_primary" />

    <TextView
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_marginStart="16dp"
        android:layout_weight="1"
        android:text="@string/dash_title"
        android:textColor="@color/text_primary"
        android:textSize="20sp"
        android:textStyle="bold" />

    <ImageView
        android:layout_width="24dp"
        android:layout_height="24dp"
        android:src="@drawable/ic_notifications"
        android:tint="@color/text_primary" />
  </LinearLayout>

  <ScrollView
      android:layout_width="match_parent"
      android:layout_height="0dp"
      android:layout_weight="1">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="vertical"
        android:paddingStart="16dp"
        android:paddingEnd="16dp"
        android:paddingBottom="16dp">

      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="140dp"
          android:background="@drawable/bg_hero"
          android:orientation="vertical"
          android:padding="20dp">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="@string/dash_hero_label"
            android:textColor="@color/on_primary"
            android:textSize="13sp" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp"
            android:text="@string/dash_hero_value"
            android:textColor="@color/on_primary"
            android:textSize="30sp"
            android:textStyle="bold" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:layout_marginTop="6dp"
            android:text="@string/dash_hero_note"
            android:textColor="@color/on_primary"
            android:textSize="12sp" />
      </LinearLayout>

      <TextView
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:layout_marginTop="20dp"
          android:layout_marginBottom="10dp"
          android:text="@string/dash_stat_title"
          android:textColor="@color/text_primary"
          android:textSize="15sp"
          android:textStyle="bold" />

      <HorizontalScrollView
          android:layout_width="match_parent"
          android:layout_height="wrap_content">

        <LinearLayout
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:orientation="horizontal">

${STAT_CARD("订单", "128", "ic_cart")}${STAT_CARD("待发货", "9", "ic_notifications")}${STAT_CARD("收藏", "36", "ic_favorite")}        </LinearLayout>
      </HorizontalScrollView>

      <TextView
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:layout_marginTop="20dp"
          android:text="@string/dash_entry_title"
          android:textColor="@color/text_primary"
          android:textSize="15sp"
          android:textStyle="bold" />

      <GridLayout
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:layout_marginTop="6dp"
          android:columnCount="2">

${GRID_TILE("ic_home", "门店", 0, 0)}${GRID_TILE("ic_cart", "库存", 0, 1)}${GRID_TILE("ic_person", "会员", 1, 0)}${GRID_TILE("ic_settings", "设置", 1, 1)}      </GridLayout>
    </LinearLayout>
  </ScrollView>

</LinearLayout>
`;

const DASHBOARD_VALUES = `<resources>
  <string name="dash_title">工作台</string>
  <string name="dash_hero_label">本月营业额</string>
  <string name="dash_hero_value">¥ 86,420</string>
  <string name="dash_hero_note">较上月 +12.4%</string>
  <string name="dash_stat_title">今日概况</string>
  <string name="dash_entry_title">快捷入口</string>
  <color name="price">#B3261E</color>
</resources>`;

/* ============================================================
   汇总
   ============================================================ */
/* ============================================================
   9. 全组件总览 —— 把常用控件按分类摆一遍，用来检查渲染保真度
   （同时挂在 public/samples/all-widgets.xml，可以单独下载）
   ============================================================ */
const ALL_WIDGETS_LAYOUT = `<?xml version="1.0" encoding="utf-8"?>
<!-- 全组件总览：一条纵向 ScrollView 里把常用控件全摆一遍，用来看渲染保真度 -->
<ScrollView xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#F5F4F7"
    android:fillViewport="true">

  <LinearLayout
      android:layout_width="match_parent"
      android:layout_height="wrap_content"
      android:orientation="vertical"
      android:padding="12dp">

    <!-- ========== 1. 文本 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="1. 文本类"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingBottom="8dp" />

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="标题 TextView（20sp bold + 阴影）"
        android:textSize="20sp"
        android:textStyle="bold"
        android:textColor="#1D1B20"
        android:shadowColor="#406750A4"
        android:shadowDx="1"
        android:shadowDy="2"
        android:shadowRadius="3" />

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="正文 TextView：14sp、行距 1.3、字间距 0.02em，用来检查换行、行高与中文排版是否和 Android 一致。"
        android:textSize="14sp"
        android:textColor="#49454F"
        android:lineSpacingMultiplier="1.3"
        android:letterSpacing="0.02"
        android:paddingTop="4dp" />

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="单行省略：这是一段很长很长很长很长很长很长很长很长很长很长的文字"
        android:maxLines="1"
        android:ellipsize="end"
        android:textSize="14sp"
        android:paddingTop="4dp" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="fontFamily=sans-serif-medium"
        android:fontFamily="sans-serif-medium"
        android:textSize="14sp"
        android:paddingTop="4dp" />

    <CheckedTextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="CheckedTextView（勾选）"
        android:checkMark="@drawable/ic_check"
        android:checked="true"
        android:textSize="14sp"
        android:paddingTop="4dp" />

    <Chronometer
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="00:12"
        android:textSize="14sp"
        android:paddingTop="4dp" />

    <!-- ========== 2. 按钮 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="2. 按钮"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingTop="16dp"
        android:paddingBottom="8dp" />

    <Button
        android:id="@+id/btn_primary"
        android:layout_width="match_parent"
        android:layout_height="48dp"
        android:text="普通 Button"
        android:textAllCaps="false"
        android:textColor="#FFFFFF"
        android:background="@drawable/bg_btn_primary" />

    <com.google.android.material.button.MaterialButton
        android:layout_width="match_parent"
        android:layout_height="48dp"
        android:layout_marginTop="8dp"
        android:text="MaterialButton（描边）"
        app:cornerRadius="14dp"
        app:strokeColor="#6750A4"
        app:strokeWidth="1dp"
        app:icon="@drawable/ic_add"
        app:iconGravity="textStart"
        app:iconPadding="8dp" />

    <Button
        android:layout_width="match_parent"
        android:layout_height="48dp"
        android:layout_marginTop="8dp"
        android:text="禁用按钮"
        android:enabled="false"
        android:background="@drawable/bg_btn_primary" />

    <com.google.android.material.button.MaterialButtonToggleGroup
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp">

      <Button
          android:layout_width="wrap_content"
          android:layout_height="40dp"
          android:text="左" />

      <Button
          android:layout_width="wrap_content"
          android:layout_height="40dp"
          android:text="中" />

      <Button
          android:layout_width="wrap_content"
          android:layout_height="40dp"
          android:text="右" />
    </com.google.android.material.button.MaterialButtonToggleGroup>

    <ToggleButton
        android:layout_width="wrap_content"
        android:layout_height="40dp"
        android:layout_marginTop="8dp"
        android:textOn="开"
        android:textOff="关"
        android:checked="true" />

    <!-- ========== 3. 输入 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="3. 输入"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingTop="16dp"
        android:paddingBottom="8dp" />

    <EditText
        android:id="@+id/et_plain"
        android:layout_width="match_parent"
        android:layout_height="44dp"
        android:hint="普通 EditText（hint）"
        android:textColorHint="#8C8794"
        android:inputType="text"
        android:singleLine="true"
        android:background="@drawable/bg_input"
        android:paddingStart="12dp"
        android:paddingEnd="12dp" />

    <com.google.android.material.textfield.TextInputLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:hint="TextInputLayout（outline）"
        android:boxBackgroundMode="outline"
        android:boxStrokeColor="#6750A4">

      <com.google.android.material.textfield.TextInputEditText
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:text="输入内容"
          android:inputType="text" />
    </com.google.android.material.textfield.TextInputLayout>

    <AutoCompleteTextView
        android:layout_width="match_parent"
        android:layout_height="44dp"
        android:layout_marginTop="8dp"
        android:hint="AutoCompleteTextView"
        android:background="@drawable/bg_input"
        android:paddingStart="12dp"
        android:paddingEnd="12dp" />

    <SearchView
        android:layout_width="match_parent"
        android:layout_height="44dp"
        android:layout_marginTop="8dp"
        android:queryHint="SearchView 搜索" />

    <NumberPicker
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:value="30" />

    <!-- ========== 4. 图片 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="4. 图片"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingTop="16dp"
        android:paddingBottom="8dp" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gravity="center_vertical">

      <ImageView
          android:layout_width="56dp"
          android:layout_height="56dp"
          android:src="@drawable/ic_home"
          android:scaleType="fitCenter"
          android:padding="8dp"
          android:background="@drawable/bg_card" />

      <ImageView
          android:layout_width="56dp"
          android:layout_height="56dp"
          android:layout_marginStart="8dp"
          android:src="@drawable/ic_favorite"
          android:scaleType="centerCrop"
          android:tint="#E91E63"
          android:background="@drawable/bg_card" />

      <ImageButton
          android:layout_width="56dp"
          android:layout_height="56dp"
          android:layout_marginStart="8dp"
          android:src="@drawable/ic_search"
          android:tint="#6750A4"
          android:background="@drawable/bg_stat" />

      <ImageView
          android:layout_width="56dp"
          android:layout_height="56dp"
          android:layout_marginStart="8dp"
          android:src="@drawable/ic_person"
          android:scaleType="fitXY"
          android:tint="#1D1B20"
          android:background="@drawable/bg_chip" />
    </LinearLayout>

    <ImageView
        android:layout_width="match_parent"
        android:layout_height="96dp"
        android:layout_marginTop="8dp"
        android:src="@drawable/ic_image"
        android:scaleType="centerInside"
        android:background="@drawable/bg_hero" />

    <!-- ========== 5. 选择 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="5. 选择"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingTop="16dp"
        android:paddingBottom="8dp" />

    <CheckBox
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="CheckBox 已勾选"
        android:checked="true" />

    <CheckBox
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="CheckBox 未勾选"
        android:buttonTint="#6750A4" />

    <RadioGroup
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal">

      <RadioButton
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="选项 A"
          android:checked="true" />

      <RadioButton
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="选项 B" />
    </RadioGroup>

    <Switch
        android:id="@+id/sw_plain"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Switch 打开"
        android:checked="true" />

    <Switch
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="Switch 关闭 + 染色"
        android:trackTint="#B0AEB8"
        android:thumbTint="#6750A4" />

    <com.google.android.material.switchmaterial.SwitchMaterial
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="SwitchMaterial 打开"
        android:checked="true" />

    <SeekBar
        android:id="@+id/seek_1"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:max="100"
        android:progress="40" />

    <SeekBar
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:max="100"
        android:progress="75"
        android:progressTint="#E91E63"
        android:thumbTint="#E91E63"
        android:trackTint="#F8BBD0" />

    <RatingBar
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:numStars="5"
        android:rating="3.5"
        android:stepSize="0.5"
        android:buttonTint="#F5A524" />

    <RatingBar
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="4dp"
        android:numStars="5"
        android:rating="4"
        android:isIndicator="true" />

    <com.google.android.material.slider.Slider
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:valueFrom="0"
        android:valueTo="100"
        android:value="60" />

    <!-- ========== 6. 进度 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="6. 进度"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingTop="16dp"
        android:paddingBottom="8dp" />

    <ProgressBar
        style="?android:attr/progressBarStyleHorizontal"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:max="100"
        android:progress="30"
        android:secondaryProgress="60"
        android:progressTint="#6750A4" />

    <ProgressBar
        style="?android:attr/progressBarStyleHorizontal"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:indeterminate="true"
        android:indeterminateTint="#E91E63" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal"
        android:gravity="center_vertical"
        android:paddingTop="8dp">

      <ProgressBar
          android:layout_width="48dp"
          android:layout_height="48dp"
          android:indeterminate="true"
          android:indeterminateTint="#6750A4" />

      <com.google.android.material.progressindicator.CircularProgressIndicator
          android:layout_width="48dp"
          android:layout_height="48dp"
          android:layout_marginStart="8dp"
          android:indeterminate="true"
          app:indicatorColor="#E91E63" />

      <com.google.android.material.progressindicator.LinearProgressIndicator
          android:layout_width="0dp"
          android:layout_height="wrap_content"
          android:layout_weight="1"
          android:layout_marginStart="8dp"
          android:progress="55"
          app:indicatorColor="#6750A4" />
    </LinearLayout>

    <!-- ========== 7. 列表 / 容器 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="7. 列表与容器"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingTop="16dp"
        android:paddingBottom="8dp" />

    <androidx.recyclerview.widget.RecyclerView
        android:layout_width="match_parent"
        android:layout_height="120dp"
        android:background="@drawable/bg_card" />

    <ListView
        android:layout_width="match_parent"
        android:layout_height="96dp"
        android:layout_marginTop="8dp"
        android:background="@drawable/bg_card" />

    <Spinner
        android:layout_width="match_parent"
        android:layout_height="44dp"
        android:layout_marginTop="8dp"
        android:background="@drawable/bg_input" />

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:orientation="vertical"
        android:divider="#E0D9E3"
        android:dividerHeight="1dp"
        android:showDividers="middle"
        android:background="@drawable/bg_card">

      <TextView
          android:layout_width="match_parent"
          android:layout_height="40dp"
          android:text="分割线上一行"
          android:gravity="center_vertical"
          android:paddingStart="12dp" />

      <TextView
          android:layout_width="match_parent"
          android:layout_height="40dp"
          android:text="分割线中间行"
          android:gravity="center_vertical"
          android:paddingStart="12dp" />

      <TextView
          android:layout_width="match_parent"
          android:layout_height="40dp"
          android:text="分割线下一行"
          android:gravity="center_vertical"
          android:paddingStart="12dp" />
    </LinearLayout>

    <TableLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:stretchColumns="0"
        android:background="@drawable/bg_card">

      <TableRow>

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="36dp"
            android:text="表格 A1"
            android:gravity="center_vertical" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="36dp"
            android:text="B1"
            android:gravity="center_vertical" />
      </TableRow>

      <TableRow>

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="36dp"
            android:text="表格 A2"
            android:gravity="center_vertical" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="36dp"
            android:text="B2"
            android:gravity="center_vertical" />
      </TableRow>
    </TableLayout>

    <GridLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:columnCount="3">

      <TextView
          android:layout_width="0dp"
          android:layout_height="56dp"
          android:layout_columnWeight="1"
          android:text="格 1"
          android:gravity="center"
          android:background="@drawable/bg_chip" />

      <TextView
          android:layout_width="0dp"
          android:layout_height="56dp"
          android:layout_columnWeight="1"
          android:text="格 2"
          android:gravity="center"
          android:background="@drawable/bg_stat" />

      <TextView
          android:layout_width="0dp"
          android:layout_height="56dp"
          android:layout_columnWeight="1"
          android:text="格 3"
          android:gravity="center"
          android:background="@drawable/bg_chip" />
    </GridLayout>

    <View
        android:layout_width="match_parent"
        android:layout_height="1dp"
        android:layout_marginTop="12dp"
        android:background="#E0D9E3" />

    <Space
        android:layout_width="match_parent"
        android:layout_height="12dp" />

    <!-- ========== 8. Material 组件 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="8. Material 卡片 / Chip / FAB"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingBottom="8dp" />

    <androidx.cardview.widget.CardView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:cardCornerRadius="16dp"
        android:cardElevation="2dp"
        android:cardBackgroundColor="#FFFFFF"
        android:contentPadding="16dp">

      <TextView
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:text="CardView + contentPadding 16dp"
          android:textSize="14sp" />
    </androidx.cardview.widget.CardView>

    <com.google.android.material.card.MaterialCardView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        app:cardCornerRadius="16dp"
        app:cardElevation="4dp"
        app:strokeColor="#E0D9E3"
        app:strokeWidth="1dp">

      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:orientation="vertical"
          android:padding="16dp">

        <TextView
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:text="MaterialCardView 带描边" />

        <com.google.android.material.chip.ChipGroup
            android:layout_width="match_parent"
            android:layout_height="wrap_content"
            android:layout_marginTop="8dp">

          <com.google.android.material.chip.Chip
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:text="Chip"
              android:checkable="true"
              android:checked="true" />

          <com.google.android.material.chip.Chip
              android:layout_width="wrap_content"
              android:layout_height="wrap_content"
              android:text="可关闭"
              app:closeIcon="@drawable/ic_check" />
        </com.google.android.material.chip.ChipGroup>
      </LinearLayout>
    </com.google.android.material.card.MaterialCardView>

    <com.google.android.material.floatingactionbutton.FloatingActionButton
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:src="@drawable/ic_add"
        android:backgroundTint="#6750A4" />

    <com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp"
        android:text="Extended FAB"
        app:icon="@drawable/ic_add" />

    <com.google.android.material.tabs.TabLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp">

      <com.google.android.material.tabs.TabItem
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="页签一" />

      <com.google.android.material.tabs.TabItem
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="页签二" />
    </com.google.android.material.tabs.TabLayout>

    <com.google.android.material.bottomnavigation.BottomNavigationView
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:layout_marginTop="8dp"
        android:background="@drawable/bg_bottom_bar" />

    <androidx.appcompat.widget.Toolbar
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:layout_marginTop="8dp"
        android:background="#6750A4"
        android:title="Toolbar 标题"
        android:subtitle="副标题"
        android:titleTextColor="#FFFFFF"
        android:subtitleTextColor="#EADDFF"
        android:navigationIcon="@drawable/ic_arrow_back" />

    <com.google.android.material.appbar.AppBarLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:layout_marginTop="8dp">

      <com.google.android.material.appbar.CollapsingToolbarLayout
          android:layout_width="match_parent"
          android:layout_height="120dp"
          android:background="@drawable/bg_hero"
          app:layout_scrollFlags="scroll|exitUntilCollapsed">

        <androidx.appcompat.widget.Toolbar
            android:layout_width="match_parent"
            android:layout_height="56dp"
            app:layout_collapseMode="pin"
            android:title="折叠标题" />
      </com.google.android.material.appbar.CollapsingToolbarLayout>
    </com.google.android.material.appbar.AppBarLayout>

    <androidx.swiperefreshlayout.widget.SwipeRefreshLayout
        android:layout_width="match_parent"
        android:layout_height="96dp"
        android:layout_marginTop="8dp"
        android:background="@drawable/bg_card">

      <TextView
          android:layout_width="match_parent"
          android:layout_height="match_parent"
          android:text="SwipeRefreshLayout 内容"
          android:gravity="center" />
    </androidx.swiperefreshlayout.widget.SwipeRefreshLayout>

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="ViewPager2（子项由 adapter 生成，预览里是空占位）"
        android:textSize="12sp"
        android:textColor="#8C8794"
        android:paddingTop="12dp" />

    <androidx.viewpager2.widget.ViewPager2
        android:layout_width="match_parent"
        android:layout_height="120dp"
        android:layout_marginTop="4dp"
        android:background="@drawable/bg_stat" />

    <com.google.android.material.bottomnavigation.BottomNavigationView
        android:id="@+id/bottom_nav"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:visibility="gone" />

    <!-- ========== 9. 约束布局 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="9. ConstraintLayout（约束 + 参考线 + 屏障）"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingTop="16dp"
        android:paddingBottom="8dp" />

    <androidx.constraintlayout.widget.ConstraintLayout
        android:layout_width="match_parent"
        android:layout_height="180dp"
        android:background="@drawable/bg_card">

      <TextView
          android:id="@+id/tv_a"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:text="A"
          android:textSize="16sp"
          android:textStyle="bold"
          app:layout_constraintStart_toStartOf="parent"
          app:layout_constraintTop_toTopOf="parent"
          android:layout_marginStart="16dp"
          android:layout_marginTop="16dp" />

      <TextView
          android:id="@+id/tv_b"
          android:layout_width="0dp"
          android:layout_height="wrap_content"
          android:text="B：宽 0dp + 左右约束 + 50% 水平偏置"
          app:layout_constraintStart_toEndOf="@id/tv_a"
          app:layout_constraintEnd_toEndOf="parent"
          app:layout_constraintTop_toTopOf="@id/tv_a"
          app:layout_constraintHorizontal_bias="0.5"
          android:layout_marginStart="8dp"
          android:layout_marginEnd="16dp" />

      <androidx.constraintlayout.widget.Guideline
          android:id="@+id/guide_mid"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:orientation="horizontal"
          app:layout_constraintGuide_percent="0.45" />

      <TextView
          android:layout_width="0dp"
          android:layout_height="wrap_content"
          android:text="参考线下方 + 宽度 60%"
          android:gravity="center"
          android:background="@drawable/bg_chip"
          app:layout_constraintTop_toBottomOf="@id/guide_mid"
          app:layout_constraintStart_toStartOf="parent"
          app:layout_constraintEnd_toEndOf="parent"
          app:layout_constraintWidth_percent="0.6" />

      <androidx.constraintlayout.widget.Barrier
          android:id="@+id/barrier"
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          app:barrierDirection="bottom"
          app:constraint_referenced_ids="tv_a,tv_b" />

      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:layout_marginTop="8dp"
          android:text="屏障下方"
          app:layout_constraintTop_toBottomOf="@id/barrier"
          app:layout_constraintStart_toStartOf="parent" />
    </androidx.constraintlayout.widget.ConstraintLayout>

    <!-- ========== 10. 相对布局 / 帧布局 / 抽屉 ========== -->
    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="10. RelativeLayout / FrameLayout / DrawerLayout"
        android:textSize="18sp"
        android:textStyle="bold"
        android:textColor="#6750A4"
        android:paddingTop="16dp"
        android:paddingBottom="8dp" />

    <RelativeLayout
        android:layout_width="match_parent"
        android:layout_height="96dp"
        android:background="@drawable/bg_card">

      <ImageView
          android:id="@+id/rl_icon"
          android:layout_width="40dp"
          android:layout_height="40dp"
          android:layout_alignParentStart="true"
          android:layout_centerVertical="true"
          android:layout_marginStart="12dp"
          android:src="@drawable/ic_person" />

      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:layout_toEndOf="@id/rl_icon"
          android:layout_alignTop="@id/rl_icon"
          android:layout_marginStart="12dp"
          android:text="RelativeLayout 标题" />

      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:layout_toEndOf="@id/rl_icon"
          android:layout_below="@id/rl_icon"
          android:layout_marginStart="12dp"
          android:text="下方描述文字"
          android:textSize="12sp"
          android:textColor="#8C8794" />
    </RelativeLayout>

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="120dp"
        android:layout_marginTop="8dp"
        android:background="@drawable/bg_stat">

      <ImageView
          android:layout_width="match_parent"
          android:layout_height="match_parent"
          android:src="@drawable/ic_image"
          android:scaleType="centerCrop" />

      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:layout_gravity="bottom|end"
          android:layout_margin="8dp"
          android:padding="4dp"
          android:text="FrameLayout 叠层"
          android:background="#CCFFFFFF" />

      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:layout_gravity="center"
          android:text="居中"
          android:textColor="#FFFFFF"
          android:textSize="18sp"
          android:textStyle="bold" />
    </FrameLayout>

    <androidx.drawerlayout.widget.DrawerLayout
        android:layout_width="match_parent"
        android:layout_height="160dp"
        android:layout_marginTop="8dp">

      <LinearLayout
          android:layout_width="match_parent"
          android:layout_height="match_parent"
          android:orientation="vertical"
          android:gravity="center"
          android:background="@drawable/bg_card">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="DrawerLayout 主内容" />
      </LinearLayout>

      <LinearLayout
          android:layout_width="200dp"
          android:layout_height="match_parent"
          android:layout_gravity="start"
          android:orientation="vertical"
          android:background="#F3EDF7"
          android:padding="12dp">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="抽屉面板" />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="第二项"
            android:paddingTop="8dp" />
      </LinearLayout>
    </androidx.drawerlayout.widget.DrawerLayout>

    <androidx.coordinatorlayout.widget.CoordinatorLayout
        android:layout_width="match_parent"
        android:layout_height="100dp"
        android:layout_marginTop="8dp"
        android:background="@drawable/bg_hero">

      <TextView
          android:layout_width="wrap_content"
          android:layout_height="wrap_content"
          android:layout_gravity="center"
          android:text="CoordinatorLayout" />
    </androidx.coordinatorlayout.widget.CoordinatorLayout>

    <androidx.core.widget.NestedScrollView
        android:layout_width="match_parent"
        android:layout_height="96dp"
        android:layout_marginTop="8dp"
        android:background="@drawable/bg_card">

      <TextView
          android:layout_width="match_parent"
          android:layout_height="wrap_content"
          android:padding="12dp"
          android:text="NestedScrollView：内容可以比它高，超出部分滚动" />
    </androidx.core.widget.NestedScrollView>

    <HorizontalScrollView
        android:layout_width="match_parent"
        android:layout_height="56dp"
        android:layout_marginTop="8dp"
        android:background="@drawable/bg_chip">

      <LinearLayout
          android:layout_width="wrap_content"
          android:layout_height="match_parent"
          android:orientation="horizontal"
          android:gravity="center_vertical"
          android:padding="8dp">

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="横向滚动一  " />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="横向滚动二  " />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="横向滚动三  " />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="横向滚动四  " />

        <TextView
            android:layout_width="wrap_content"
            android:layout_height="wrap_content"
            android:text="横向滚动五  " />
      </LinearLayout>
    </HorizontalScrollView>

    <TextView
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:text="—— 全组件总览结束 ——"
        android:gravity="center"
        android:paddingTop="24dp"
        android:paddingBottom="24dp"
        android:textColor="#8C8794" />
  </LinearLayout>
</ScrollView>
`;

export const SAMPLE_PROJECTS: SampleProject[] = [
  {
    key: "login",
    name: "登录页",
    library: "ConstraintLayout + 输入框 + ImageButton",
    desc: "居中对齐的 logo，两个带左图标的输入框，记住我 / 忘记密码，主按钮与三种第三方登录。",
    layout: LOGIN_LAYOUT,
    drawables: pickDrawables([
      "ic_lock",
      "ic_phone",
      "ic_person",
      "ic_notifications",
      "bg_logo_circle",
      "bg_input",
      "bg_btn_primary",
      "bg_social_circle",
    ]),
    values: LOGIN_VALUES,
  },
  {
    key: "shop",
    name: "商品列表",
    library: "LinearLayout + ScrollView + CardView",
    desc: "顶部标题栏 + 搜索框 + 卡片式商品列表（缩略图 / 评分 / 价格），带嘘升阴影。",
    layout: LIST_LAYOUT,
    drawables: pickDrawables([
      "ic_cart",
      "ic_search",
      "ic_star",
      "ic_image",
      "bg_input",
      "bg_thumb",
    ]),
    values: LIST_VALUES,
  },
  {
    key: "settings",
    name: "设置页",
    library: "LinearLayout + Switch + 分组卡片",
    desc: "头像卡 + 两组设置项：普通行带右侧箭头，开关行带 Switch，底部退出登录按钮。",
    layout: SETTINGS_LAYOUT,
    drawables: pickDrawables([
      "ic_arrow_back",
      "ic_more",
      "ic_person",
      "ic_notifications",
      "ic_lock",
      "ic_settings",
      "ic_home",
      "ic_location",
      "ic_chevron",
      "bg_avatar",
      "bg_section",
      "bg_btn_primary",
    ]),
    values: SETTINGS_VALUES,
  },
  {
    key: "detail",
    name: "详情页",
    library: "NestedScrollView + FrameLayout 头图 + 底部栏",
    desc: "渐变头图 + 返回/收藏悬浮图标，内容区标题与标签，底部固定价格栏（elevation 阴影）。",
    layout: DETAIL_LAYOUT,
    drawables: pickDrawables([
      "ic_arrow_back",
      "ic_favorite",
      "ic_star",
      "ic_location",
      "ic_image",
      "bg_hero",
      "bg_card",
      "bg_chip",
      "bg_social_circle",
      "bg_btn_primary",
      "bg_bottom_bar",
    ]),
    values: DETAIL_VALUES,
  },
  {
    key: "dashboard",
    name: "工作台",
    library: "HorizontalScrollView + GridLayout",
    desc: "渐变数据卡 + 横向滑动的三张统计卡 + 2×2 宫格快捷入口。",
    layout: DASHBOARD_LAYOUT,
    drawables: pickDrawables([
      "ic_menu",
      "ic_notifications",
      "ic_cart",
      "ic_favorite",
      "ic_home",
      "ic_person",
      "ic_settings",
      "bg_hero",
      "bg_section",
      "bg_card",
    ]),
    values: DASHBOARD_VALUES,
  },
  {
    key: "all-widgets",
    name: "全组件总览",
    library: "全部常用控件（10 大类）",
    desc: "文本/按钮/输入/图片/选择/进度/列表/Material/约束/容器 一次摆全，用来核对渲染。",
    layout: ALL_WIDGETS_LAYOUT,
    drawables: pickDrawables([
      "ic_check",
      "ic_add",
      "ic_home",
      "ic_favorite",
      "ic_search",
      "ic_person",
      "ic_image",
      "ic_arrow_back",
      "bg_btn_primary",
      "bg_input",
      "bg_card",
      "bg_stat",
      "bg_chip",
      "bg_hero",
      "bg_bottom_bar",
    ]),
  },
];

/** 新建空白模板（不带资源） */
export const SAMPLE_BLANKS: { key: string; name: string; layout: string }[] = [
  {
    key: "blank-cl",
    name: "ConstraintLayout",
    layout: `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- 从左侧「组件」把控件拖进来，或选中后在右侧加约束 -->

</androidx.constraintlayout.widget.ConstraintLayout>
`,
  },
  {
    key: "blank-ll",
    name: "LinearLayout（竖）",
    layout: `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

  <!-- 从左侧「组件」把控件拖进来 -->

</LinearLayout>
`,
  },
  {
    key: "blank-frame",
    name: "FrameLayout",
    layout: `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- 从左侧「组件」把控件拖进来 -->

</FrameLayout>
`,
  },
];

/** 按 key 找示例项目 */
export function sampleProjectByKey(key: string): SampleProject | undefined {
  return SAMPLE_PROJECTS.find((p) => p.key === key);
}

/** 所有示例项目里用到的资源（供“一键导入示例资源”用） */
export function allSampleDrawables(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of SAMPLE_PROJECTS) Object.assign(out, p.drawables);
  return out;
}

