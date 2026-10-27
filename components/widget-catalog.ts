// components/widget-catalog.ts — 可添加组件目录（组件面板用）
// 每个组件给一份 XML 模板 + Material Symbol 图标 + 中文名。
// 图标名走 M3E 已加载的 "Material Symbols Rounded" 字体（.msr 类）。

export interface WidgetDef {
  key: string;
  label: string; // 中文名
  tag: string; // 短标签（标题栏用）
  icon: string; // Material Symbol 名（.msr 字联体）
  group: "布局" | "文本" | "输入" | "控件" | "进度" | "图片" | "Material";
  /** 模板 XML（不含 <?xml 声明；xmlns:android 可省，parser 会忽略） */
  xml: string;
}

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

export const WIDGETS: WidgetDef[] = [
  // ===== 布局 =====
  {
    key: "linear_v", label: "线性布局（竖）", tag: "LinearLayout", icon: "view_headline", group: "布局",
    xml: `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    android:padding="8dp">
</LinearLayout>`,
  },
  {
    key: "linear_h", label: "线性布局（横）", tag: "LinearLayout", icon: "view_headline", group: "布局",
    xml: `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="horizontal">
</LinearLayout>`,
  },
  {
    key: "frame", label: "框架布局", tag: "FrameLayout", icon: "view_compact", group: "布局",
    xml: `<FrameLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">
</FrameLayout>`,
  },
  {
    key: "rel", label: "相对布局", tag: "RelativeLayout", icon: "hub", group: "布局",
    xml: `<RelativeLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">
</RelativeLayout>`,
  },
  {
    key: "constr", label: "约束布局", tag: "ConstraintLayout", icon: "grid_view", group: "布局",
    xml: `<androidx.constraintlayout.widget.ConstraintLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent">
</androidx.constraintlayout.widget.ConstraintLayout>`,
  },
  {
    key: "scroll", label: "滚动视图", tag: "ScrollView", icon: "unfold_more", group: "布局",
    xml: `<ScrollView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">
</ScrollView>`,
  },
  {
    key: "card", label: "卡片", tag: "CardView", icon: "screenshot", group: "布局",
    xml: `<androidx.cardview.widget.CardView ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_margin="8dp"
    app:cardCornerRadius="8dp">
</androidx.cardview.widget.CardView>`,
  },
  {
    key: "listview", label: "列表", tag: "RecyclerView", icon: "view_list", group: "布局",
    xml: `<androidx.recyclerview.widget.RecyclerView ${A}
    android:id="@+id/recycler"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"/>`,
  },
  {
    key: "divider", label: "分割线", tag: "View", icon: "horizontal_rule", group: "布局",
    xml: `<View ${A}
    android:layout_width="match_parent"
    android:layout_height="1dp"
    android:background="#E0E0E0"/>`,
  },
  {
    key: "include", label: "引入布局", tag: "include", icon: "insert_drive_file", group: "布局",
    xml: `<include ${A}
    android:layout="@layout/"/>`,
  },

  // ===== 文本 =====
  {
    key: "text", label: "文本", tag: "TextView", icon: "text_fields", group: "文本",
    xml: `<TextView ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="文本"
    android:textSize="16sp"/>`,
  },
  {
    key: "heading", label: "标题", tag: "TextView", icon: "title", group: "文本",
    xml: `<TextView ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="标题"
    android:textSize="24sp"
    android:textStyle="bold"/>`,
  },
  {
    key: "caption", label: "辅助文字", tag: "TextView", icon: "short_text", group: "文本",
    xml: `<TextView ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="辅助说明"
    android:textSize="12sp"
    android:textColor="#757575"/>`,
  },
  {
    key: "marquee", label: "跑马灯", tag: "TextView", icon: "format_list_bulleted", group: "文本",
    xml: `<TextView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:text="这是会自动滚动的长文本"
    android:singleLine="true"
    android:marqueeRepeatLimit="marquee_forever"
    android:ellipsize="marquee"
    android:scrollHorizontally="true"
    android:focusable="true"
    android:focusableInTouchMode="true"/>`,
  },

  // ===== 输入 =====
  {
    key: "edittext", label: "输入框", tag: "EditText", icon: "edit", group: "输入",
    xml: `<EditText ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="请输入"
    android:padding="12dp"/>`,
  },
  {
    key: "password", label: "密码框", tag: "EditText", icon: "key", group: "输入",
    xml: `<EditText ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="密码"
    android:inputType="textPassword"
    android:padding="12dp"/>`,
  },
  {
    key: "search_edit", label: "搜索框", tag: "EditText", icon: "search", group: "输入",
    xml: `<EditText ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="搜索…"
    android:inputType="text"
    android:padding="12dp"/>`,
  },

  // ===== 控件 =====
  {
    key: "button", label: "按钮", tag: "Button", icon: "touch_app", group: "控件",
    xml: `<Button ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="按钮"/>`,
  },
  {
    key: "btn_primary", label: "主按钮", tag: "Button", icon: "touch_app", group: "控件",
    xml: `<Button ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:background="#6750A4"
    android:text="确定"
    android:textColor="#FFFFFF"/>`,
  },
  {
    key: "btn_text", label: "文字按钮", tag: "Button", icon: "touch_app", group: "控件",
    xml: `<Button ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:background="@null"
    android:text="文字按钮"/>`,
  },
  {
    key: "switch", label: "开关", tag: "Switch", icon: "toggle_on", group: "控件",
    xml: `<Switch ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:checked="true"/>`,
  },
  {
    key: "checkbox", label: "复选框", tag: "CheckBox", icon: "check_box", group: "控件",
    xml: `<CheckBox ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="选项"/>`,
  },
  {
    key: "radio", label: "单选钮", tag: "RadioButton", icon: "radio_button_checked", group: "控件",
    xml: `<RadioButton ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="选项"/>`,
  },
  {
    key: "radiogroup", label: "单选组", tag: "RadioGroup", icon: "radio_button_unchecked", group: "控件",
    xml: `<RadioGroup ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical">
</RadioGroup>`,
  },
  {
    key: "seekbar", label: "进度滑杆", tag: "SeekBar", icon: "linear_scale", group: "控件",
    xml: `<SeekBar ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:progress="40"/>`,
  },
  {
    key: "slider", label: "滑杆（Material）", tag: "Slider", icon: "input_range", group: "Material",
    xml: `<com.google.android.material.slider.Slider ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:valueFrom="0"
    android:valueTo="100"
    android:value="50"/>`,
  },
  {
    key: "spinner", label: "下拉选择", tag: "Spinner", icon: "expand_more", group: "控件",
    xml: `<Spinner ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"/>`,
  },

  // ===== 进度 =====
  {
    key: "progress_linear", label: "线性进度条", tag: "ProgressBar", icon: "hourglass_bottom", group: "进度",
    xml: `<ProgressBar ${A}
    style="?android:attr/progressBarStyleHorizontal"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"/>`,
  },
  {
    key: "progress_circle", label: "圆形进度", tag: "ProgressBar", icon: "progress_activity", group: "进度",
    xml: `<ProgressBar ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"/>`,
  },

  // ===== 图片 =====
  {
    key: "image", label: "图片", tag: "ImageView", icon: "image", group: "图片",
    xml: `<ImageView ${A}
    android:layout_width="match_parent"
    android:layout_height="120dp"
    android:adjustViewBounds="true"
    android:background="#EEEEEE"/>`,
  },
  {
    key: "avatar", label: "头像", tag: "ImageView", icon: "person", group: "图片",
    xml: `<ImageView ${A}
    android:layout_width="48dp"
    android:layout_height="48dp"
    android:background="#E0E0E0"/>`,
  },
  {
    key: "imgbtn", label: "图片按钮", tag: "ImageButton", icon: "apps", group: "图片",
    xml: `<ImageButton ${A}
    android:layout_width="48dp"
    android:layout_height="48dp"
    android:background="#E0E0E0"/>`,
  },
  {
    key: "iconbtn", label: "图标按钮", tag: "ImageButton", icon: "touch_app", group: "图片",
    xml: `<ImageButton ${A}
    android:layout_width="48dp"
    android:layout_height="48dp"
    android:background="?attr/selectableItemBackgroundBorderless"/>`,
  },

  // ===== Material Components（Material 库，与平台控件分开） =====
  {
    key: "mat_button", label: "M 按钮", tag: "MaterialButton", icon: "smart_button", group: "Material",
    xml: `<com.google.android.material.button.MaterialButton ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="按钮"/>`,
  },
  {
    key: "mat_fab", label: "浮动按钮", tag: "FloatingActionButton", icon: "add_circle", group: "Material",
    xml: `<com.google.android.material.floatingactionbutton.FloatingActionButton ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    app:srcCompat="@drawable/ic_add"/>`,
  },
  {
    key: "mat_fab_ext", label: "扩展浮动按钮", tag: "ExtendedFloatingActionButton", icon: "add_circle", group: "Material",
    xml: `<com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="新建"/>`,
  },
  {
    key: "mat_card", label: "M 卡片", tag: "MaterialCardView", icon: "screenshot", group: "Material",
    xml: `<com.google.android.material.card.MaterialCardView ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_margin="8dp"
    app:cardCornerRadius="12dp"
    app:cardElevation="2dp">
</com.google.android.material.card.MaterialCardView>`,
  },
  {
    key: "mat_textfield", label: "M 输入框", tag: "TextInputLayout", icon: "edit_note", group: "Material",
    xml: `<com.google.android.material.textfield.TextInputLayout ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="标签">

    <com.google.android.material.textfield.TextInputEditText ${A}
        android:layout_width="match_parent"
        android:layout_height="wrap_content"/>
</com.google.android.material.textfield.TextInputLayout>`,
  },
  {
    key: "mat_toolbar", label: "顶部栏", tag: "MaterialToolbar", icon: "web_asset", group: "Material",
    xml: `<com.google.android.material.appbar.MaterialToolbar ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="?attr/actionBarSize"
    app:title="标题"/>`,
  },
  {
    key: "mat_appbar", label: "应用栏容器", tag: "AppBarLayout", icon: "expand_more", group: "Material",
    xml: `<com.google.android.material.appbar.AppBarLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">
</com.google.android.material.appbar.AppBarLayout>`,
  },
  {
    key: "mat_bottom_nav", label: "底部导航", tag: "BottomNavigationView", icon: "bottom_navigation", group: "Material",
    xml: `<com.google.android.material.bottomnavigation.BottomNavigationView ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    app:menu="@menu/bottom_nav"/>`,
  },
  {
    key: "mat_tabs", label: "标签页", tag: "TabLayout", icon: "tab", group: "Material",
    xml: `<com.google.android.material.tabs.TabLayout ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    app:tabMode="fixed">

    <com.google.android.material.tabs.TabItem
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="标签一"/>

    <com.google.android.material.tabs.TabItem
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="标签二"/>
</com.google.android.material.tabs.TabLayout>`,
  },
  {
    key: "mat_chip", label: "芯片", tag: "Chip", icon: "label", group: "Material",
    xml: `<com.google.android.material.chip.Chip ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="标签"
    app:chipStrokeWidth="1dp"/>`,
  },
  {
    key: "mat_chip_group", label: "芯片组", tag: "ChipGroup", icon: "label", group: "Material",
    xml: `<com.google.android.material.chip.ChipGroup ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    app:chipSpacingHorizontal="8dp">

    <com.google.android.material.chip.Chip ${A}
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="芯片一"/>

    <com.google.android.material.chip.Chip ${A}
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="芯片二"/>
</com.google.android.material.chip.ChipGroup>`,
  },
  {
    key: "mat_switch", label: "M 开关", tag: "SwitchMaterial", icon: "toggle_on", group: "Material",
    xml: `<com.google.android.material.switchmaterial.SwitchMaterial ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:checked="true"/>`,
  },
  {
    key: "mat_progress_circle", label: "M 圆形进度", tag: "CircularProgressIndicator", icon: "progress_activity", group: "Material",
    xml: `<com.google.android.material.progressindicator.CircularProgressIndicator ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:indeterminate="true"/>`,
  },
  {
    key: "mat_progress_linear", label: "M 条形进度", tag: "LinearProgressIndicator", icon: "hourglass_bottom", group: "Material",
    xml: `<com.google.android.material.progressindicator.LinearProgressIndicator ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:progress="60"/>`,
  },
  {
    key: "mat_swipe", label: "下拉刷新", tag: "SwipeRefreshLayout", icon: "refresh", group: "Material",
    xml: `<androidx.swiperefreshlayout.widget.SwipeRefreshLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <androidx.recyclerview.widget.RecyclerView ${A}
        android:layout_width="match_parent"
        android:layout_height="match_parent"/>
</androidx.swiperefreshlayout.widget.SwipeRefreshLayout>`,
  },
  {
    key: "mat_pager2", label: "翻页容器", tag: "ViewPager2", icon: "swipe", group: "Material",
    xml: `<androidx.viewpager2.widget.ViewPager2 ${A}
    android:layout_width="match_parent"
    android:layout_height="200dp"/>`,
  },
];

/** 组件 key → 定义 */
export const WIDGET_MAP: Record<string, WidgetDef> = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));

/** 分组顺序（面板展示用） */
export const WIDGET_GROUPS: WidgetDef["group"][] = ["布局", "文本", "输入", "控件", "进度", "图片", "Material"];

/** 分组图标 */
export const GROUP_ICON: Record<WidgetDef["group"], string> = {
  布局: "widgets",
  文本: "text_fields",
  输入: "edit",
  控件: "touch_app",
  进度: "progress_activity",
  图片: "image",
  Material: "extension",
};

/** 拖拽时写入 dataTransfer 的 MIME */
export const DRAG_WIDGET_MIME = "application/x-axv-widget";
