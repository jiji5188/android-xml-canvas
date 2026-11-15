// lib/xml/new-file.ts
// M294：新建文件两步交互的数据定义（分类 / 模板 / 默认路径 / 内容生成）

export interface NewFileTemplate {
  key: string;
  label: string;
  /** 文件扩展名，如 .java / .kt / .xml */
  ext: string;
  /** 文件内容模板，{name} 会被替换为文件名（不含扩展名） */
  body: string;
  /** 是否支持「同时创建配套布局」（Activity / Fragment） */
  companion?: boolean;
}

export interface NewFileCategory {
  key: string;
  label: string;
  icon: string;
  /** 默认保存路径（不含文件名） */
  defaultPath: string;
  templates: NewFileTemplate[];
}

const JAVA_ACTIVITY = `package com.example.app;

import android.app.Activity;
import android.os.Bundle;

public class {name} extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.{name_l});
    }
}
`;

const JAVA_FRAGMENT = `package com.example.app;

import android.app.Fragment;
import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;

public class {name} extends Fragment {
    @Override
    public View onCreateView(LayoutInflater inflater, ViewGroup container, Bundle savedInstanceState) {
        return inflater.inflate(R.layout.{name_l}, container, false);
    }
}
`;

const JAVA_SERVICE = `package com.example.app;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

public class {name} extends Service {
    @Override
    public void onCreate() {
        super.onCreate();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
`;

const JAVA_CLASS = `package com.example.app;

public class {name} {
}
`;

const KOTLIN_ACTIVITY = `package com.example.app

import android.app.Activity
import android.os.Bundle

class {name} : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.{name_l})
    }
}
`;

const KOTLIN_FRAGMENT = `package com.example.app

import android.app.Fragment
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup

class {name} : Fragment() {
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View? {
        return inflater.inflate(R.layout.{name_l}, container, false)
    }
}
`;

const KOTLIN_CLASS = `package com.example.app

class {name}
`;

const LAYOUT_BLANK_CL = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- 从左侧「组件」把控件拖进来，或选中后在右侧加约束 -->

</androidx.constraintlayout.widget.ConstraintLayout>
`;

const LAYOUT_BLANK_LL = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

  <!-- 从左侧「组件」把控件拖进来 -->

</LinearLayout>
`;

export const LAYOUT_BLANK_LL_EXPORT = LAYOUT_BLANK_LL;

const LAYOUT_BLANK_FRAME = `<?xml version="1.0" encoding="utf-8"?>
<FrameLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

  <!-- 从左侧「组件」把控件拖进来 -->

</FrameLayout>
`;

const DRAWABLE_BLANK_SHAPE = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="#FFFFFF" />
    <corners android:radius="8dp" />
</shape>
`;

const DRAWABLE_CIRCLE = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="oval">
    <solid android:color="#FFFFFF" />
</shape>
`;

const VALUES_BLANK = `<?xml version="1.0" encoding="utf-8"?>
<resources>

</resources>
`;

const VALUES_STRINGS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">My App</string>
</resources>
`;

const VALUES_COLORS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="black">#FF000000</color>
    <color name="white">#FFFFFFFF</color>
</resources>
`;

const VALUES_STYLES = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <style name="AppTheme" parent="android:Theme.Material.Light" />
</resources>
`;

const VALUES_DIMENS = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <dimen name="activity_margin">16dp</dimen>
</resources>
`;

const OTHER_BLANK = ``;

export const NEW_FILE_CATEGORIES: NewFileCategory[] = [
  {
    key: "java",
    label: "Java 文件",
    icon: "coffee",
    defaultPath: "java/",
    templates: [
      { key: "java-activity", label: "Activity", ext: ".java", body: JAVA_ACTIVITY, companion: true },
      { key: "java-fragment", label: "Fragment", ext: ".java", body: JAVA_FRAGMENT, companion: true },
      { key: "java-service", label: "Service", ext: ".java", body: JAVA_SERVICE },
      { key: "java-class", label: "普通类", ext: ".java", body: JAVA_CLASS },
      { key: "java-blank", label: "空文件", ext: ".java", body: "" },
    ],
  },
  {
    key: "kotlin",
    label: "Kotlin 文件",
    icon: "language_kotlin",
    defaultPath: "kotlin/",
    templates: [
      { key: "kt-activity", label: "Activity", ext: ".kt", body: KOTLIN_ACTIVITY, companion: true },
      { key: "kt-fragment", label: "Fragment", ext: ".kt", body: KOTLIN_FRAGMENT, companion: true },
      { key: "kt-class", label: "普通类", ext: ".kt", body: KOTLIN_CLASS },
      { key: "kt-blank", label: "空文件", ext: ".kt", body: "" },
    ],
  },
  {
    key: "layout",
    label: "布局 XML",
    icon: "grid_view",
    defaultPath: "res/layout/",
    templates: [
      { key: "layout-cl", label: "ConstraintLayout", ext: ".xml", body: LAYOUT_BLANK_CL },
      { key: "layout-ll", label: "LinearLayout（竖）", ext: ".xml", body: LAYOUT_BLANK_LL },
      { key: "layout-frame", label: "FrameLayout", ext: ".xml", body: LAYOUT_BLANK_FRAME },
      { key: "layout-blank", label: "空布局", ext: ".xml", body: "" },
    ],
  },
  {
    key: "drawable",
    label: "Drawable 绘制 XML",
    icon: "colorize",
    defaultPath: "res/drawable/",
    templates: [
      { key: "drawable-shape", label: "Shape 矩形", ext: ".xml", body: DRAWABLE_BLANK_SHAPE },
      { key: "drawable-circle", label: "Shape 圆形", ext: ".xml", body: DRAWABLE_CIRCLE },
      { key: "drawable-blank", label: "空文件", ext: ".xml", body: "" },
    ],
  },
  {
    key: "values",
    label: "Values 资源文件",
    icon: "table_chart",
    defaultPath: "res/values/",
    templates: [
      { key: "values-blank", label: "空 resources", ext: ".xml", body: VALUES_BLANK },
      { key: "values-strings", label: "strings.xml", ext: ".xml", body: VALUES_STRINGS },
      { key: "values-colors", label: "colors.xml", ext: ".xml", body: VALUES_COLORS },
      { key: "values-styles", label: "styles.xml", ext: ".xml", body: VALUES_STYLES },
      { key: "values-dimens", label: "dimens.xml", ext: ".xml", body: VALUES_DIMENS },
    ],
  },
  {
    key: "other",
    label: "其它文件",
    icon: "insert_drive_file",
    defaultPath: "",
    templates: [
      { key: "other-blank", label: "空文本", ext: ".txt", body: OTHER_BLANK },
      { key: "other-xml", label: "纯 XML", ext: ".xml", body: `<?xml version="1.0" encoding="utf-8"?>\n<root>\n\n</root>\n` },
    ],
  },
];

export function findCategory(key: string): NewFileCategory | undefined {
  return NEW_FILE_CATEGORIES.find((c) => c.key === key);
}

export function findTemplate(catKey: string, tplKey: string): { cat: NewFileCategory; tpl: NewFileTemplate } | null {
  const cat = findCategory(catKey);
  const tpl = cat?.templates.find((t) => t.key === tplKey);
  if (!cat || !tpl) return null;
  return { cat, tpl };
}

/** 把模板体里的 {name} / {name_l} 换成实际名称 */
export function renderTemplate(body: string, rawName: string): string {
  const stem = rawName.replace(/\.[^.]+$/, "");
  const lower = stem.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return body.replaceAll("{name}", stem).replaceAll("{name_l}", lower);
}

/** 生成配套布局名：MainActivity → activity_main.xml */
export function companionLayoutName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const snake = stem
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  return `${snake || "new_layout"}.xml`;
}
