// lib/xml/new-project.ts — M31i：新建项目时把完整 Android 工程骨架一起落盘
//
// 之前「新建项目」只会在应用内存里建一个 activity_main.xml，用户还得自己点「保存」选目录。
// 现在：确认项目名（+ 可选自定义图标）后，直接在工作目录下建：
//   项目名/
//     settings.gradle  build.gradle  gradle.properties  .gitignore
//     app/build.gradle  app/proguard-rules.pro
//     app/src/main/AndroidManifest.xml
//     app/src/main/java/<包名路径>/MainActivity.java
//     app/src/main/res/{layout,values,drawable,mipmap-anydpi-v26}/...
// 写文件走 NewProjectIO（native：bridge.writeText；web：目录句柄），与 UI 解耦，纯函数部分可单测。

export interface NewProjectIO {
  /** 写文本文件（rel 相对项目根）；返回是否成功 */
  writeText(rel: string, text: string): Promise<boolean>;
  /** 写二进制（base64，自定义图标用）；没有该能力可不实现 */
  writeBinary?(rel: string, base64: string, mime: string): Promise<boolean>;
}

export interface SkeletonFile {
  rel: string;
  text: string;
}

/** gradle 里能用的名字（Theme.xxx / rootProject.name）：去掉非法字符，别以数字开头 */
export function safeProjectName(raw: string): string {
  const cleaned = (raw || "").trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!cleaned) return "MyApp";
  return /^[0-9]/.test(cleaned) ? `App${cleaned}` : cleaned;
}

/** 包名：com.example.<小写项目名> */
export function packageOf(name: string): string {
  const seg = safeProjectName(name).toLowerCase().replace(/_+/g, "");
  return `com.example.${seg || "myapp"}`;
}

const XML_HEAD = '<?xml version="1.0" encoding="utf-8"?>';

function adaptiveLauncher(): string {
  return [
    XML_HEAD,
    '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <background android:drawable="@drawable/ic_launcher_background" />',
    '    <foreground android:drawable="@drawable/ic_launcher_foreground" />',
    "</adaptive-icon>",
    "",
  ].join("\n");
}

/** 默认自适应图标的前景（一片白色圆角方块 + 简单图形，够用且不含版权素材） */
function launcherForeground(): string {
  return [
    XML_HEAD,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="108dp"',
    '    android:height="108dp"',
    '    android:viewportWidth="108"',
    '    android:viewportHeight="108">',
    '    <path',
    '        android:fillColor="#FFFFFF"',
    '        android:pathData="M34,40h40v4H34zM34,54h40v4H34zM34,68h26v4H34z" />',
    "</vector>",
    "",
  ].join("\n");
}

function launcherBackground(): string {
  return [
    XML_HEAD,
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="108dp"',
    '    android:height="108dp"',
    '    android:viewportWidth="108"',
    '    android:viewportHeight="108">',
    '    <path android:fillColor="#3F51B5" android:pathData="M0,0h108v108H0z" />',
    "</vector>",
    "",
  ].join("\n");
}

export interface SkeletonOptions {
  /** 是否生成自适应图标 xml（用户上传了自己的 png 图标时可传 false，改用 png 顶替） */
  adaptiveIcon?: boolean;
}

/** 完整工程骨架（不含二进制图标）。顺序固定，方便测试与进度显示 */
export function androidSkeleton(name: string, opts: SkeletonOptions = {}): SkeletonFile[] {
  const proj = safeProjectName(name);
  const pkg = packageOf(name);
  const pkgPath = pkg.replace(/\./g, "/");
  const theme = `Theme.${proj}`;
  const adaptive = opts.adaptiveIcon !== false;

  const files: SkeletonFile[] = [
    {
      rel: "settings.gradle",
      text: [
        "pluginManagement {",
        "    repositories {",
        "        google()",
        "        mavenCentral()",
        "        gradlePluginPortal()",
        "    }",
        "}",
        "dependencyResolutionManagement {",
        "    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)",
        "    repositories {",
        "        google()",
        "        mavenCentral()",
        "    }",
        "}",
        "",
        `rootProject.name = '${proj}'`,
        "include ':app'",
        "",
      ].join("\n"),
    },
    {
      rel: "build.gradle",
      text: ["plugins {", "    id 'com.android.application' version '8.5.2' apply false", "}", ""].join("\n"),
    },
    {
      rel: "gradle.properties",
      text: ["org.gradle.jvmargs=-Xmx2048m", "android.useAndroidX=true", "android.nonTransitiveRClass=true", ""].join("\n"),
    },
    {
      rel: ".gitignore",
      text: ["*.iml", ".gradle", "/local.properties", "/.idea", "build/", "captures/", ".DS_Store", ""].join("\n"),
    },
    {
      rel: "app/build.gradle",
      text: [
        "plugins {",
        "    id 'com.android.application'",
        "}",
        "",
        "android {",
        `    namespace '${pkg}'`,
        "    compileSdk 34",
        "",
        "    defaultConfig {",
        `        applicationId "${pkg}"`,
        "        minSdk 21",
        "        targetSdk 34",
        "        versionCode 1",
        '        versionName "1.0"',
        "    }",
        "",
        "    buildTypes {",
        "        release {",
        "            minifyEnabled false",
        "            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'",
        "        }",
        "    }",
        "",
        "    compileOptions {",
        "        sourceCompatibility JavaVersion.VERSION_1_8",
        "        targetCompatibility JavaVersion.VERSION_1_8",
        "    }",
        "}",
        "",
        "dependencies {",
        "    implementation 'androidx.appcompat:appcompat:1.7.0'",
        "    implementation 'com.google.android.material:material:1.12.0'",
        "    implementation 'androidx.constraintlayout:constraintlayout:2.1.4'",
        "}",
        "",
      ].join("\n"),
    },
    {
      rel: "app/proguard-rules.pro",
      text: ["# 这里写混淆规则（默认不混淆）", ""].join("\n"),
    },
    {
      rel: "app/src/main/AndroidManifest.xml",
      text: [
        XML_HEAD,
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        "",
        "    <application",
        '        android:allowBackup="true"',
        '        android:icon="@mipmap/ic_launcher"',
        '        android:label="@string/app_name"',
        '        android:roundIcon="@mipmap/ic_launcher_round"',
        '        android:supportsRtl="true"',
        `        android:theme="@style/${theme}">`,
        "        <activity",
        '            android:name=".MainActivity"',
        '            android:exported="true">',
        "            <intent-filter>",
        '                <action android:name="android.intent.action.MAIN" />',
        '                <category android:name="android.intent.category.LAUNCHER" />',
        "            </intent-filter>",
        "        </activity>",
        "    </application>",
        "",
        "</manifest>",
        "",
      ].join("\n"),
    },
    {
      rel: `app/src/main/java/${pkgPath}/MainActivity.java`,
      text: [
        `package ${pkg};`,
        "",
        "import android.os.Bundle;",
        "",
        "import androidx.appcompat.app.AppCompatActivity;",
        "",
        "public class MainActivity extends AppCompatActivity {",
        "",
        "    @Override",
        "    protected void onCreate(Bundle savedInstanceState) {",
        "        super.onCreate(savedInstanceState);",
        "        setContentView(R.layout.activity_main);",
        "    }",
        "}",
        "",
      ].join("\n"),
    },
    {
      rel: "app/src/main/res/layout/activity_main.xml",
      text: [
        XML_HEAD,
        '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"',
        '    android:layout_width="match_parent"',
        '    android:layout_height="match_parent"',
        '    android:gravity="center"',
        '    android:orientation="vertical">',
        "",
        "    <TextView",
        '        android:id="@+id/tv_hello"',
        '        android:layout_width="wrap_content"',
        '        android:layout_height="wrap_content"',
        `        android:text="@string/hello_${proj.toLowerCase()}"`,
        '        android:textSize="20sp" />',
        "",
        "</LinearLayout>",
        "",
      ].join("\n"),
    },
    {
      rel: "app/src/main/res/values/strings.xml",
      text: [
        XML_HEAD,
        "<resources>",
        `    <string name="app_name">${proj}</string>`,
        `    <string name="hello_${proj.toLowerCase()}">Hello ${proj}!</string>`,
        "</resources>",
        "",
      ].join("\n"),
    },
    {
      rel: "app/src/main/res/values/colors.xml",
      text: [
        XML_HEAD,
        "<resources>",
        '    <color name="primary">#3F51B5</color>',
        '    <color name="primary_dark">#303F9F</color>',
        '    <color name="accent">#FF4081</color>',
        "</resources>",
        "",
      ].join("\n"),
    },
    {
      rel: "app/src/main/res/values/themes.xml",
      text: [
        XML_HEAD,
        "<resources>",
        "",
        `    <style name="${theme}" parent="Theme.Material3.DayNight.NoActionBar">`,
        '        <item name="colorPrimary">@color/primary</item>',
        '        <item name="colorPrimaryDark">@color/primary_dark</item>',
        '        <item name="colorAccent">@color/accent</item>',
        "    </style>",
        "",
        "</resources>",
        "",
      ].join("\n"),
    },
  ];

  if (adaptive) {
    files.push(
      { rel: "app/src/main/res/drawable/ic_launcher_background.xml", text: launcherBackground() },
      { rel: "app/src/main/res/drawable/ic_launcher_foreground.xml", text: launcherForeground() },
      { rel: "app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml", text: adaptiveLauncher() },
      { rel: "app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml", text: adaptiveLauncher() },
    );
  }

  return files;
}

export interface CreateResult {
  ok: boolean;
  written: number;
  failed: string[];
}

/** 把骨架+可选自定义图标写进项目目录（io 决定落在哪） */
export async function createAndroidProject(
  io: NewProjectIO,
  name: string,
  opts: SkeletonOptions & { iconBase64?: string; iconMime?: string } = {},
): Promise<CreateResult> {
  const files = androidSkeleton(name, opts);
  const failed: string[] = [];
  let written = 0;

  for (const f of files) {
    let ok = false;
    try {
      ok = await io.writeText(f.rel, f.text);
    } catch {
      ok = false;
    }
    if (ok) written += 1;
    else failed.push(f.rel);
  }

  if (opts.iconBase64 && io.writeBinary) {
    // 自定义图标：作为位图塞进 mipmap-xxxhdpi（低版本系统用 png，API26+ 仍会优先用任何可用的 png）
    try {
      const ok = await io.writeBinary(
        "app/src/main/res/mipmap-xxxhdpi/ic_launcher.png",
        opts.iconBase64,
        opts.iconMime || "image/png",
      );
      if (ok) written += 1;
      else failed.push("app/src/main/res/mipmap-xxxhdpi/ic_launcher.png");
      const ok2 = await io.writeBinary(
        "app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png",
        opts.iconBase64,
        opts.iconMime || "image/png",
      );
      if (ok2) written += 1;
      else failed.push("app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png");
    } catch {
      failed.push("app/src/main/res/mipmap-xxxhdpi/ic_launcher.png");
    }
  }

  return { ok: failed.length === 0, written, failed };
}
