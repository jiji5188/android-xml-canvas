// components/widget-catalog.ts — 可添加组件目录（组件面板用）
// 每个组件给一份 XML 模板 + Material Symbol 图标 + 中文名。
// 图标名走 M3E 已加载的 "Material Symbols Rounded" 字体（.msr 类）。

export type LibKind = "android" | "androidx" | "material";

export type WidgetCat = "布局" | "文本" | "输入" | "控件" | "进度" | "图片";

export interface WidgetDef {
  key: string;
  label: string; // 中文名
  tag: string; // 短标签（标题栏用）
  icon: string; // Material Symbol 名（.msr 字联体）
  /** 所属库：平台（android.widget）/ AndroidX / Material Components —— 面板第一层分类 */
  lib: LibKind;
  /** 用途分类 —— 面板第二层分类 */
  group: WidgetCat;
  /** 模板 XML（不含 <?xml 声明；xmlns:android 可省，parser 会忽略） */
  xml: string;
}

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';
/** M16b：带 app: 属性的模板要同时声明 res-auto 命名空间 */
const AP = 'xmlns:app="http://schemas.android.com/apk/res-auto"';

export const WIDGETS: WidgetDef[] = [
  // ===== 布局 =====
  {
    key: "linear_v", label: "线性布局（竖）", tag: "LinearLayout", icon: "view_headline", lib: "android", group: "布局",
    xml: `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    android:padding="8dp">
</LinearLayout>`,
  },
  {
    key: "linear_h", label: "线性布局（横）", tag: "LinearLayout", icon: "view_headline", lib: "android", group: "布局",
    xml: `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="horizontal">
</LinearLayout>`,
  },
  {
    key: "frame", label: "帧布局", tag: "FrameLayout", icon: "view_compact", lib: "android", group: "布局",
    xml: `<FrameLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">
</FrameLayout>`,
  },
  {
    key: "rel", label: "相对布局", tag: "RelativeLayout", icon: "hub", lib: "android", group: "布局",
    xml: `<RelativeLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">
</RelativeLayout>`,
  },
  {
    key: "constr", label: "约束布局", tag: "ConstraintLayout", icon: "grid_view", lib: "androidx", group: "布局",
    xml: `<androidx.constraintlayout.widget.ConstraintLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent">
</androidx.constraintlayout.widget.ConstraintLayout>`,
  },
  {
    key: "scroll", label: "纵向滚动", tag: "ScrollView", icon: "swap_vert", lib: "android", group: "布局",
    xml: `<ScrollView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:fillViewport="true">
</ScrollView>`,
  },
  {
    key: "scroll_h", label: "横向滚动", tag: "HorizontalScrollView", icon: "swap_horiz", lib: "android", group: "布局",
    xml: `<HorizontalScrollView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:scrollbars="horizontal">
</HorizontalScrollView>`,
  },
  {
    key: "absolute", label: "绝对布局", tag: "AbsoluteLayout", icon: "open_with", lib: "android", group: "布局",
    xml: `<AbsoluteLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="240dp">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_x="16dp"
        android:layout_y="16dp"
        android:text="坐标 16,16"/>

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_x="64dp"
        android:layout_y="96dp"
        android:text="坐标 64,96"/>
</AbsoluteLayout>`,
  },
  {
    key: "table", label: "表格布局", tag: "TableLayout", icon: "table_chart", lib: "android", group: "布局",
    xml: `<TableLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:stretchColumns="*">

    <TableRow
        android:layout_width="match_parent"
        android:layout_height="wrap_content">

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:padding="8dp"
            android:text="名称"/>

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:padding="8dp"
            android:text="数量"/>
    </TableRow>

    <TableRow
        android:layout_width="match_parent"
        android:layout_height="wrap_content">

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:padding="8dp"
            android:text="椅子"/>

        <TextView
            android:layout_width="0dp"
            android:layout_height="wrap_content"
            android:layout_weight="1"
            android:padding="8dp"
            android:text="3"/>
    </TableRow>
</TableLayout>`,
  },
  {
    key: "table_row", label: "表格行", tag: "TableRow", icon: "table_rows", lib: "android", group: "布局",
    xml: `<TableRow ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">

    <TextView
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:padding="8dp"
        android:text="单元格 1"/>

    <TextView
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:padding="8dp"
        android:text="单元格 2"/>
</TableRow>`,
  },
  {
    key: "button_bar", label: "按钮条", tag: "LinearLayout", icon: "horizontal_split", lib: "android", group: "布局",
    xml: `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="horizontal"
    android:gravity="end|center_vertical"
    android:padding="8dp">

    <Button
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_marginEnd="8dp"
        android:text="取消"/>

    <Button
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="确定"/>
</LinearLayout>`,
  },
  {
    // 平台 Toolbar（API 21+）；android:title / subtitle / navigationIcon 都是框架属性，不需要库
    key: "toolbar", label: "工具栏", tag: "Toolbar", icon: "web_asset", lib: "android", group: "布局",
    xml: `<Toolbar ${A}
    android:layout_width="match_parent"
    android:layout_height="?android:attr/actionBarSize"
    android:background="#3F51B5"
    android:elevation="4dp"
    android:navigationIcon="@android:drawable/ic_menu_sort_by_size"
    android:title="标题"
    android:titleTextColor="#FFFFFF"/>`,
  },
  {
    // 完全用平台控件搭的工具栏（老工程 / AIDE 里最常用，不依赖 Toolbar 的 API 级别）
    key: "toolbar_layout", label: "工具栏（布局）", tag: "LinearLayout", icon: "view_agenda", lib: "android", group: "布局",
    xml: `<LinearLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="56dp"
    android:orientation="horizontal"
    android:gravity="center_vertical"
    android:background="#3F51B5"
    android:paddingStart="4dp"
    android:paddingEnd="4dp">

    <ImageButton
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:background="?android:attr/selectableItemBackgroundBorderless"
        android:contentDescription="返回"
        android:src="@android:drawable/ic_menu_revert"/>

    <TextView
        android:layout_width="0dp"
        android:layout_height="wrap_content"
        android:layout_weight="1"
        android:paddingStart="8dp"
        android:text="标题"
        android:textColor="#FFFFFF"
        android:textSize="18sp"/>

    <ImageButton
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:background="?android:attr/selectableItemBackgroundBorderless"
        android:contentDescription="搜索"
        android:src="@android:drawable/ic_menu_search"/>

    <ImageButton
        android:layout_width="48dp"
        android:layout_height="48dp"
        android:background="?android:attr/selectableItemBackgroundBorderless"
        android:contentDescription="更多"
        android:src="@android:drawable/ic_menu_more"/>
</LinearLayout>`,
  },
  {
    key: "card", label: "卡片", tag: "CardView", icon: "screenshot", lib: "androidx", group: "布局",
    xml: `<androidx.cardview.widget.CardView ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_margin="8dp"
    app:cardCornerRadius="8dp">
</androidx.cardview.widget.CardView>`,
  },
  {
    key: "listview", label: "列表", tag: "RecyclerView", icon: "view_list", lib: "androidx", group: "布局",    xml: `<androidx.recyclerview.widget.RecyclerView ${A}
    android:id="@+id/recycler"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"/>`,
  },
  {
    key: "divider", label: "分割线", tag: "View", icon: "horizontal_rule", lib: "android", group: "布局",
    xml: `<View ${A}
    android:layout_width="match_parent"
    android:layout_height="1dp"
    android:background="#E0E0E0"/>`,
  },
  {
    // 注：ListView / GridView 是 AdapterView，内容由 Adapter 给，所以模板不能带子控件（带了运行时会崩）
    key: "list_view", label: "列表（ListView）", tag: "ListView", icon: "list", lib: "android", group: "布局",
    xml: `<ListView ${A}
    android:layout_width="match_parent"
    android:layout_height="240dp"
    android:divider="#E0E0E0"
    android:dividerHeight="1dp"/>`,
  },
  {
    key: "grid_view", label: "网格（GridView）", tag: "GridView", icon: "grid_on", lib: "android", group: "布局",
    xml: `<GridView ${A}
    android:layout_width="match_parent"
    android:layout_height="240dp"
    android:numColumns="3"
    android:horizontalSpacing="4dp"
    android:verticalSpacing="4dp"/>`,
  },
  {
    key: "expandable_list", label: "可展开列表", tag: "ExpandableListView", icon: "account_tree", lib: "android", group: "布局",
    xml: `<ExpandableListView ${A}
    android:layout_width="match_parent"
    android:layout_height="240dp"
    android:groupIndicator="@null"
    android:divider="#E0E0E0"
    android:dividerHeight="1dp"/>`,
  },
  {
    key: "include", label: "引入布局", tag: "include", icon: "insert_drive_file", lib: "android", group: "布局",
    xml: `<include ${A}
    android:layout="@layout/"/>`,
  },

  // ===== 文本 =====
  {
    key: "text", label: "文本", tag: "TextView", icon: "text_fields", lib: "android", group: "文本",
    xml: `<TextView ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="文本"
    android:textSize="16sp"/>`,
  },
  {
    key: "heading", label: "标题", tag: "TextView", icon: "title", lib: "android", group: "文本",
    xml: `<TextView ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="标题"
    android:textSize="24sp"
    android:textStyle="bold"/>`,
  },
  {
    key: "caption", label: "辅助文字", tag: "TextView", icon: "short_text", lib: "android", group: "文本",
    xml: `<TextView ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="辅助说明"
    android:textSize="12sp"
    android:textColor="#757575"/>`,
  },
  {
    key: "marquee", label: "跑马灯", tag: "TextView", icon: "format_list_bulleted", lib: "android", group: "文本",
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
    key: "edittext", label: "输入框", tag: "EditText", icon: "edit", lib: "android", group: "输入",
    xml: `<EditText ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="请输入"
    android:padding="12dp"/>`,
  },
  {
    key: "password", label: "密码框", tag: "EditText", icon: "key", lib: "android", group: "输入",
    xml: `<EditText ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="密码"
    android:inputType="textPassword"
    android:padding="12dp"/>`,
  },
  {
    key: "search_edit", label: "搜索框", tag: "EditText", icon: "search", lib: "android", group: "输入",
    xml: `<EditText ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="搜索…"
    android:inputType="text"
    android:padding="12dp"/>`,
  },

  // ===== 控件 =====
  {
    key: "button", label: "按钮", tag: "Button", icon: "touch_app", lib: "android", group: "控件",
    xml: `<Button ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="按钮"/>`,
  },
  {
    key: "btn_primary", label: "主按钮", tag: "Button", icon: "touch_app", lib: "android", group: "控件",
    xml: `<Button ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:background="#6750A4"
    android:text="确定"
    android:textColor="#FFFFFF"/>`,
  },
  {
    key: "btn_text", label: "文字按钮", tag: "Button", icon: "touch_app", lib: "android", group: "控件",
    xml: `<Button ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:background="@null"
    android:text="文字按钮"/>`,
  },
  {
    key: "switch", label: "开关", tag: "Switch", icon: "toggle_on", lib: "android", group: "控件",
    xml: `<Switch ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:checked="true"/>`,
  },
  {
    key: "checkbox", label: "复选框", tag: "CheckBox", icon: "check_box", lib: "android", group: "控件",
    xml: `<CheckBox ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="选项"/>`,
  },
  {
    key: "radio", label: "单选钮", tag: "RadioButton", icon: "radio_button_checked", lib: "android", group: "控件",
    xml: `<RadioButton ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="选项"/>`,
  },
  {
    key: "radiogroup", label: "单选组", tag: "RadioGroup", icon: "radio_button_unchecked", lib: "android", group: "控件",
    xml: `<RadioGroup ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical">
</RadioGroup>`,
  },
  {
    key: "seekbar", label: "进度滑杆", tag: "SeekBar", icon: "linear_scale", lib: "android", group: "控件",
    xml: `<SeekBar ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:progress="40"/>`,
  },
  {
    key: "slider", label: "滑杆（Material）", tag: "Slider", icon: "input_range", lib: "material", group: "控件",
    xml: `<com.google.android.material.slider.Slider ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:valueFrom="0"
    android:valueTo="100"
    android:value="50"/>`,
  },
  {
    key: "spinner", label: "下拉选择", tag: "Spinner", icon: "expand_more", lib: "android", group: "控件",
    xml: `<Spinner ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"/>`,
  },
  {
    key: "number_picker", label: "数字选择器", tag: "NumberPicker", icon: "pin", lib: "android", group: "控件",
    xml: `<NumberPicker ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:minValue="0"
    android:maxValue="99"
    android:value="8"/>`,
  },
  {
    key: "date_picker", label: "日期选择器", tag: "DatePicker", icon: "calendar_month", lib: "android", group: "控件",
    xml: `<DatePicker ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:datePickerMode="calendar"/>`,
  },
  {
    key: "time_picker", label: "时间选择器", tag: "TimePicker", icon: "schedule", lib: "android", group: "控件",
    xml: `<TimePicker ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:timePickerMode="clock"/>`,
  },

  // ===== 进度 =====
  {
    key: "progress_linear", label: "线性进度条", tag: "ProgressBar", icon: "hourglass_bottom", lib: "android", group: "进度",
    xml: `<ProgressBar ${A}
    style="?android:attr/progressBarStyleHorizontal"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"/>`,
  },
  {
    key: "progress_circle", label: "圆形进度", tag: "ProgressBar", icon: "progress_activity", lib: "android", group: "进度",
    xml: `<ProgressBar ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"/>`,
  },

  // ===== 图片 =====
  {
    key: "image", label: "图片", tag: "ImageView", icon: "image", lib: "android", group: "图片",
    xml: `<ImageView ${A}
    android:layout_width="match_parent"
    android:layout_height="120dp"
    android:adjustViewBounds="true"
    android:background="#EEEEEE"/>`,
  },
  {
    key: "avatar", label: "头像", tag: "ImageView", icon: "person", lib: "android", group: "图片",
    xml: `<ImageView ${A}
    android:layout_width="48dp"
    android:layout_height="48dp"
    android:background="#E0E0E0"/>`,
  },
  {
    key: "imgbtn", label: "图片按钮", tag: "ImageButton", icon: "apps", lib: "android", group: "图片",
    xml: `<ImageButton ${A}
    android:layout_width="48dp"
    android:layout_height="48dp"
    android:background="#E0E0E0"/>`,
  },
  {
    key: "iconbtn", label: "图标按钮", tag: "ImageButton", icon: "touch_app", lib: "android", group: "图片",
    xml: `<ImageButton ${A}
    android:layout_width="48dp"
    android:layout_height="48dp"
    android:background="?attr/selectableItemBackgroundBorderless"/>`,
  },

  // ===== Material Components（Material 库，与平台控件分开） =====
  {
    key: "mat_button", label: "M 按钮", tag: "MaterialButton", icon: "smart_button", lib: "material", group: "控件",
    xml: `<com.google.android.material.button.MaterialButton ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="按钮"/>`,
  },
  {
    key: "mat_fab", label: "浮动按钮", tag: "FloatingActionButton", icon: "add_circle", lib: "material", group: "控件",
    xml: `<com.google.android.material.floatingactionbutton.FloatingActionButton ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    app:srcCompat="@drawable/ic_add"/>`,
  },
  {
    key: "mat_fab_ext", label: "扩展浮动按钮", tag: "ExtendedFloatingActionButton", icon: "add_circle", lib: "material", group: "控件",
    xml: `<com.google.android.material.floatingactionbutton.ExtendedFloatingActionButton ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="新建"/>`,
  },
  {
    key: "mat_card", label: "M 卡片", tag: "MaterialCardView", icon: "screenshot", lib: "material", group: "布局",
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
    key: "mat_textfield", label: "M 输入框", tag: "TextInputLayout", icon: "edit_note", lib: "material", group: "输入",
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
    key: "mat_toolbar", label: "顶部栏", tag: "MaterialToolbar", icon: "web_asset", lib: "material", group: "布局",
    xml: `<com.google.android.material.appbar.MaterialToolbar ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="?attr/actionBarSize"
    app:title="标题"/>`,
  },
  {
    key: "mat_appbar", label: "应用栏容器", tag: "AppBarLayout", icon: "expand_more", lib: "material", group: "布局",
    xml: `<com.google.android.material.appbar.AppBarLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">
</com.google.android.material.appbar.AppBarLayout>`,
  },
  {
    key: "mat_bottom_nav", label: "底部导航", tag: "BottomNavigationView", icon: "bottom_navigation", lib: "material", group: "布局",
    xml: `<com.google.android.material.bottomnavigation.BottomNavigationView ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    app:menu="@menu/bottom_nav"/>`,
  },
  {
    key: "mat_tabs", label: "标签页", tag: "TabLayout", icon: "tab", lib: "material", group: "布局",
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
    key: "mat_chip", label: "芯片", tag: "Chip", icon: "label", lib: "material", group: "控件",
    xml: `<com.google.android.material.chip.Chip ${A}
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="标签"
    app:chipStrokeWidth="1dp"/>`,
  },
  {
    key: "mat_chip_group", label: "芯片组", tag: "ChipGroup", icon: "label", lib: "material", group: "布局",
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
    key: "mat_switch", label: "M 开关", tag: "SwitchMaterial", icon: "toggle_on", lib: "material", group: "控件",
    xml: `<com.google.android.material.switchmaterial.SwitchMaterial ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:checked="true"/>`,
  },
  {
    key: "mat_progress_circle", label: "M 圆形进度", tag: "CircularProgressIndicator", icon: "progress_activity", lib: "material", group: "进度",
    xml: `<com.google.android.material.progressindicator.CircularProgressIndicator ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:indeterminate="true"/>`,
  },
  {
    key: "mat_progress_linear", label: "M 条形进度", tag: "LinearProgressIndicator", icon: "hourglass_bottom", lib: "material", group: "进度",
    xml: `<com.google.android.material.progressindicator.LinearProgressIndicator ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:progress="60"/>`,
  },
  {
    key: "nested_scroll", label: "嵌套滚动（AX）", tag: "NestedScrollView", icon: "unfold_more", lib: "androidx", group: "布局",
    xml: `<androidx.core.widget.NestedScrollView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:fillViewport="true">
</androidx.core.widget.NestedScrollView>`,
  },
  {
    key: "mat_swipe", label: "下拉刷新", tag: "SwipeRefreshLayout", icon: "refresh", lib: "androidx", group: "布局",    xml: `<androidx.swiperefreshlayout.widget.SwipeRefreshLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <androidx.recyclerview.widget.RecyclerView ${A}
        android:layout_width="match_parent"
        android:layout_height="match_parent"/>
</androidx.swiperefreshlayout.widget.SwipeRefreshLayout>`,
  },
  {
    key: "mat_pager2", label: "翻页容器", tag: "ViewPager2", icon: "swipe", lib: "androidx", group: "布局",
    xml: `<androidx.viewpager2.widget.ViewPager2 ${A}
    android:layout_width="match_parent"
    android:layout_height="200dp"/>`,
  },

  // ===== M16：补齐「文档/渲染已有、面板却点不到」的遗漏组件 =====
  {
    key: "grid_layout", label: "网格布局", tag: "GridLayout", icon: "grid_on", lib: "android", group: "布局",
    xml: `<GridLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:columnCount="2"
    android:rowCount="2">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="1"
        android:layout_columnWeight="1"
        android:gravity="center" />

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="2"
        android:layout_columnWeight="1"
        android:gravity="center" />
</GridLayout>`,
  },
  {
    key: "space", label: "间距占位", tag: "Space", icon: "space_bar", lib: "android", group: "布局",
    xml: `<Space ${A}
    android:layout_width="match_parent"
    android:layout_height="16dp"/>`,
  },
  {
    key: "coordinator", label: "协调布局", tag: "CoordinatorLayout", icon: "layers", lib: "androidx", group: "布局",
    xml: `<androidx.coordinatorlayout.widget.CoordinatorLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent">
</androidx.coordinatorlayout.widget.CoordinatorLayout>`,
  },
  {
    key: "drawer", label: "抽屉布局", tag: "DrawerLayout", icon: "view_sidebar", lib: "androidx", group: "布局",
    xml: `<androidx.drawerlayout.widget.DrawerLayout ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent">
    </FrameLayout>

    <FrameLayout
        android:layout_width="280dp"
        android:layout_height="match_parent"
        android:layout_gravity="start"
        android:background="#FFFFFF">
    </FrameLayout>
</androidx.drawerlayout.widget.DrawerLayout>`,
  },
  {
    key: "fragment_container", label: "Fragment 容器", tag: "FragmentContainerView", icon: "view_quilt", lib: "androidx", group: "布局",
    xml: `<androidx.fragment.app.FragmentContainerView ${A}
    android:layout_width="match_parent"
    android:layout_height="match_parent" />`,
  },
  {
    key: "guideline", label: "参考线", tag: "Guideline", icon: "border_vertical", lib: "androidx", group: "布局",
    xml: `<androidx.constraintlayout.widget.Guideline ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    app:layout_constraintGuide_percent="0.5"
    xmlns:app="http://schemas.android.com/apk/res-auto" />`,
  },
  {
    key: "barrier", label: "屏障", tag: "Barrier", icon: "block", lib: "androidx", group: "布局",
    xml: `<androidx.constraintlayout.widget.Barrier ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    app:barrierDirection="end"
    xmlns:app="http://schemas.android.com/apk/res-auto" />`,
  },
  {
    key: "viewstub", label: "懒加载占位", tag: "ViewStub", icon: "inbox", lib: "android", group: "布局",
    xml: `<ViewStub ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout="@layout/placeholder" />`,
  },
  {
    key: "autocomplete", label: "自动完成输入", tag: "AutoCompleteTextView", icon: "manage_search", lib: "android", group: "输入",
    xml: `<AutoCompleteTextView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="输入关键词"
    android:completionThreshold="1" />`,
  },
  {
    key: "multi_autocomplete", label: "多值自动完成", tag: "MultiAutoCompleteTextView", icon: "dynamic_feed", lib: "android", group: "输入",
    xml: `<MultiAutoCompleteTextView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="多个值用逗号分隔" />`,
  },
  {
    key: "search_view", label: "搜索视图", tag: "SearchView", icon: "search", lib: "android", group: "输入",
    xml: `<SearchView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:queryHint="搜索" />`,
  },
  {
    key: "mat_text_input_edit", label: "M 输入框（内层）", tag: "TextInputEditText", icon: "edit_note", lib: "material", group: "输入",
    xml: `<TextInputEditText ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:hint="内容" />`,
  },
  {
    key: "toggle", label: "开关按钮", tag: "ToggleButton", icon: "toggle_on", lib: "android", group: "控件",
    xml: `<ToggleButton ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:textOn="开"
    android:textOff="关"
    android:checked="true" />`,
  },
  {
    key: "rating", label: "评分条", tag: "RatingBar", icon: "star", lib: "android", group: "控件",
    xml: `<RatingBar ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:numStars="5"
    android:rating="3.5"
    android:stepSize="0.5" />`,
  },
  {
    key: "mat_tab_item", label: "标签项", tag: "TabItem", icon: "tab", lib: "material", group: "布局",
    xml: `<com.google.android.material.tabs.TabItem ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:text="标签" />`,
  },
  {
    key: "checked_text", label: "可选文本", tag: "CheckedTextView", icon: "checklist", lib: "android", group: "控件",
    xml: `<CheckedTextView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:text="可勾选文本"
    android:checkMark="?android:attr/listChoiceIndicatorMultiple" />`,
  },

  // ===== M16b：第二批补齐（带占位渲染） =====
  {
    key: "webview", label: "网页视图", tag: "WebView", icon: "language", lib: "android", group: "控件",
    xml: `<WebView ${A}
    android:layout_width="match_parent"
    android:layout_height="200dp" />`,
  },
  {
    key: "videoview", label: "视频播放", tag: "VideoView", icon: "videocam", lib: "android", group: "图片",
    xml: `<VideoView ${A}
    android:layout_width="match_parent"
    android:layout_height="200dp" />`,
  },
  {
    key: "textureview", label: "纹理视图", tag: "TextureView", icon: "texture", lib: "android", group: "图片",
    xml: `<TextureView ${A}
    android:layout_width="match_parent"
    android:layout_height="200dp" />`,
  },
  {
    key: "surfaceview", label: "画布表面", tag: "SurfaceView", icon: "brush", lib: "android", group: "图片",
    xml: `<SurfaceView ${A}
    android:layout_width="match_parent"
    android:layout_height="200dp" />`,
  },
  {
    key: "chronometer", label: "计时器", tag: "Chronometer", icon: "timer", lib: "android", group: "文本",
    xml: `<Chronometer ${A}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    android:format="%s" />`,
  },
  {
    key: "calendar_view", label: "日历", tag: "CalendarView", icon: "calendar_month", lib: "android", group: "控件",
    xml: `<CalendarView ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content" />`,
  },
  {
    key: "view_flipper", label: "轮播容器", tag: "ViewFlipper", icon: "auto_awesome_motion", lib: "android", group: "布局",
    xml: `<ViewFlipper ${A}
    android:layout_width="match_parent"
    android:layout_height="200dp">

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent">
    </FrameLayout>

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent">
    </FrameLayout>
</ViewFlipper>`,
  },
  {
    key: "view_animator", label: "页面动画容器", tag: "ViewAnimator", icon: "animation", lib: "android", group: "布局",
    xml: `<ViewAnimator ${A}
    android:layout_width="match_parent"
    android:layout_height="wrap_content">

    <TextView
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="第一页" />
</ViewAnimator>`,
  },
  {
    key: "view_pager", label: "翻页（旧）", tag: "ViewPager", icon: "view_carousel", lib: "androidx", group: "布局",
    xml: `<androidx.viewpager.widget.ViewPager ${A}
    android:layout_width="match_parent"
    android:layout_height="200dp" />`,
  },
  {
    key: "tabhost", label: "选项卡容器", tag: "TabHost", icon: "tabs", lib: "android", group: "布局",
    xml: `<TabHost ${A}
    android:id="@android:id/tabhost"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <LinearLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent"
        android:orientation="vertical">

        <TabWidget
            android:id="@android:id/tabs"
            android:layout_width="match_parent"
            android:layout_height="wrap_content" />

        <FrameLayout
            android:id="@android:id/tabcontent"
            android:layout_width="match_parent"
            android:layout_height="match_parent" />
    </LinearLayout>
</TabHost>`,
  },
  {
    key: "tabwidget", label: "选项卡标签", tag: "TabWidget", icon: "tab_unselected", lib: "android", group: "控件",
    xml: `<TabWidget ${A}
    android:id="@android:id/tabs"
    android:layout_width="match_parent"
    android:layout_height="wrap_content" />`,
  },
  {
    key: "mat_btn_toggle", label: "M 按钮组", tag: "MaterialButtonToggleGroup", icon: "join_full", lib: "material", group: "控件",
    xml: `<com.google.android.material.button.MaterialButtonToggleGroup ${A}
    ${AP}
    android:layout_width="wrap_content"
    android:layout_height="wrap_content"
    app:singleSelection="true">

    <com.google.android.material.button.MaterialButton
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="左"
        style="@style/Widget.Material3.Button.OutlinedButton" />

    <com.google.android.material.button.MaterialButton
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="右"
        style="@style/Widget.Material3.Button.OutlinedButton" />
</com.google.android.material.button.MaterialButtonToggleGroup>`,
  },
  {
    key: "mat_collapsing", label: "折叠标题栏", tag: "CollapsingToolbarLayout", icon: "unfold_more", lib: "material", group: "布局",
    xml: `<com.google.android.material.appbar.CollapsingToolbarLayout ${A}
    ${AP}
    android:layout_width="match_parent"
    android:layout_height="200dp"
    app:layout_scrollFlags="scroll|exitUntilCollapsed"
    app:title="折叠标题">

    <androidx.appcompat.widget.Toolbar
        android:layout_width="match_parent"
        android:layout_height="?attr/actionBarSize"
        app:layout_collapseMode="pin" />
</com.google.android.material.appbar.CollapsingToolbarLayout>`,
  },
  {
    key: "mat_nav_view", label: "侧滑菜单", tag: "NavigationView", icon: "menu", lib: "material", group: "布局",
    xml: `<com.google.android.material.navigation.NavigationView ${A}
    ${AP}
    android:layout_width="280dp"
    android:layout_height="match_parent"
    app:headerLayout="@layout/nav_header"
    app:menu="@menu/nav_menu" />`,
  },
  {
    key: "motion_layout", label: "动效布局", tag: "MotionLayout", icon: "animation", lib: "androidx", group: "布局",
    xml: `<androidx.constraintlayout.motion.widget.MotionLayout ${A}
    ${AP}
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    app:layoutDescription="@xml/scene">
</androidx.constraintlayout.motion.widget.MotionLayout>`,
  },
  {
    key: "flow", label: "流式辅助", tag: "Flow", icon: "wrap_text", lib: "androidx", group: "布局",
    xml: `<androidx.constraintlayout.helper.widget.Flow ${A}
    ${AP}
    android:layout_width="0dp"
    android:layout_height="wrap_content"
    app:flow_wrapMode="chain"
    app:constraint_referenced_ids="" />`,
  },
];

/** 组件 key → 定义 */
export const WIDGET_MAP: Record<string, WidgetDef> = Object.fromEntries(WIDGETS.map((w) => [w.key, w]));

/** 分组顺序（面板展示用） */
export const WIDGET_GROUPS: WidgetCat[] = ["布局", "文本", "输入", "控件", "进度", "图片"];

/** 库大类顺序 + 显示名 + 图标（面板第一层） */
export const WIDGET_LIBS: { lib: LibKind; label: string; hint: string; icon: string }[] = [
  { lib: "android", label: "Android 平台", hint: "android.widget.*，无需任何依赖", icon: "phone_android" },
  { lib: "androidx", label: "AndroidX 库", hint: "androidx.*（constraintlayout / cardview / recyclerview）", icon: "extension" },
  { lib: "material", label: "Material 库", hint: "com.google.android.material.*", icon: "palette" },
];

/** 分组图标 */
export const GROUP_ICON: Record<WidgetCat, string> = {
  布局: "widgets",
  文本: "text_fields",
  输入: "edit",
  控件: "touch_app",
  进度: "progress_activity",
  图片: "image",
};

/** 拖拽时写入 dataTransfer 的 MIME */
export const DRAG_WIDGET_MIME = "application/x-axv-widget";
