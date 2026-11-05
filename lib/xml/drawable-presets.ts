// lib/xml/drawable-presets.ts — 常用 drawable 预设（M123）
//
// 为什么给预设：从零搭 selector / layer-list 门槛太高（要先懂 item 包装、state_* 互斥、
// 遮罩 id），但日常 90% 的需求就那几种。预设直接产出「真 XML」，编辑器再 parseDrawable 吃进来，
// 所以预设和手搭走完全同一条路 —— 不存在「预设写出来的东西编辑器改不了」这种坑。

export interface DrawablePreset {
  id: string;
  /** 菜单里的名字 */
  name: string;
  /** 一行说明：这个预设长什么样、什么时候用 */
  hint: string;
  /** 完整 XML（带 xmlns，可直接写进 res/drawable/*.xml） */
  xml: string;
  /** M143：菜单分组（基础样式 / 控件样式），不写算基础 */
  group?: "base" | "widget";
}

const NS = `<selector xmlns:android="http://schemas.android.com/apk/res/android">`;
const NS_LAYER = `<layer-list xmlns:android="http://schemas.android.com/apk/res/android">`;
const NS_RIPPLE = `<ripple xmlns:android="http://schemas.android.com/apk/res/android" android:color="#33000000">`;
export const DRAWABLE_PRESETS: DrawablePreset[] = [
  {
    id: "card",
    name: "圆角卡片",
    hint: "白底 + 12dp 圆角 + 1dp 描边，最常用的卡片底",
    xml: `<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
    <solid android:color="#FFFFFFFF"/>
    <corners android:radius="12dp"/>
    <stroke android:width="1dp" android:color="#FFE5E7EB"/>
</shape>`,
  },
  {
    id: "button",
    name: "主按钮（按下变深）",
    hint: "selector：默认蓝底，按下用深一档的蓝",
    xml: `${NS}
    <item android:state_pressed="true">
        <shape android:shape="rectangle">
            <solid android:color="#FF1D4ED8"/>
            <corners android:radius="8dp"/>
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FF3B82F6"/>
            <corners android:radius="8dp"/>
        </shape>
    </item>
</selector>`,
  },
  {
    id: "ripple-card",
    name: "水波纹卡片",
    hint: "圆角卡片 + 点按水波纹（ripple 里放卡片形状）",
    xml: `${NS_RIPPLE}
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FFFFFFFF"/>
            <corners android:radius="12dp"/>
            <stroke android:width="1dp" android:color="#FFE5E7EB"/>
        </shape>
    </item>
</ripple>`,
  },
  {
    id: "selectable",
    name: "可选中（选中变蓝框）",
    hint: "selector：选中态蓝边蓝底，默认灰边白底，做列表项 / 标签用",
    xml: `${NS}
    <item android:state_selected="true">
        <shape android:shape="rectangle">
            <solid android:color="#FFEFF6FF"/>
            <corners android:radius="10dp"/>
            <stroke android:width="2dp" android:color="#FF3B82F6"/>
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FFFFFFFF"/>
            <corners android:radius="10dp"/>
            <stroke android:width="1dp" android:color="#FFE5E7EB"/>
        </shape>
    </item>
</selector>`,
  },
  {
    id: "avatar-ripple",
    name: "水波纹头像",
    hint: "圆形 + 点按水波纹，头像 / 图标按钮常用",
    xml: `${NS_RIPPLE}
    <item>
        <shape android:shape="oval">
            <solid android:color="#FFE5E7EB"/>
        </shape>
    </item>
</ripple>`,
  },
  {
    id: "shadow-card",
    name: "带阴影卡片",
    hint: "layer-list：下层偏移灰块做阴影，上层白底卡片",
    xml: `${NS_LAYER}
    <item android:left="2dp" android:top="4dp">
        <shape android:shape="rectangle">
            <solid android:color="#1A000000"/>
            <corners android:radius="12dp"/>
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FFFFFFFF"/>
            <corners android:radius="12dp"/>
        </shape>
    </item>
</layer-list>`,
  },

  // ---- M143：复杂控件用的绘制样式 ----
  // 说明：真机上 SeekBar/ProgressBar 的进度是 <clip>/<scale> 动态裁出来的，
  // 那两个在结构树里是只读类型（preset 写进去用户就改不动了）。
  // 所以预设用「两层 shapes 叠」表达轨道和进度——看着一致、参数全可改，
  // 真要上真机再自己换成 clip（参数页能看到提醒）。
  {
    id: "seekbar-track",
    group: "widget",
    name: "滑块条（轨道 + 进度）",
    hint: "layer-list：灰轨道 + 蓝色进度条，2dp 圆角，做 SeekBar 的 progressDrawable",
    xml: `${NS_LAYER}
    <item android:gravity="center_vertical">
        <shape android:shape="rectangle">
            <solid android:color="#FFE5E7EB"/>
            <corners android:radius="2dp"/>
            <size android:height="4dp"/>
        </shape>
    </item>
    <item android:gravity="center_vertical">
        <shape android:shape="rectangle">
            <solid android:color="#FF3B82F6"/>
            <corners android:radius="2dp"/>
            <size android:height="4dp"/>
        </shape>
    </item>
</layer-list>`,
  },
  {
    id: "seekbar-thumb",
    group: "widget",
    name: "滑块条（圆形拖柄）",
    hint: "圆形白底 + 蓝边 + 外阴影，做 SeekBar 的 android:thumb",
    xml: `${NS_LAYER}
    <item>
        <shape android:shape="oval">
            <solid android:color="#33000000"/>
            <size android:width="20dp" android:height="20dp"/>
        </shape>
    </item>
    <item android:left="1dp" android:top="1dp" android:right="1dp" android:bottom="1dp">
        <shape android:shape="oval">
            <solid android:color="#FFFFFFFF"/>
            <stroke android:width="2dp" android:color="#FF3B82F6"/>
            <size android:width="18dp" android:height="18dp"/>
        </shape>
    </item>
</layer-list>`,
  },
  {
    id: "progress-bar",
    group: "widget",
    name: "进度条（横向）",
    hint: "layer-list：浅灰底槽 + 圆头蓝进度，做 ProgressBar 的 progressDrawable",
    xml: `${NS_LAYER}
    <item android:gravity="center_vertical">
        <shape android:shape="rectangle">
            <solid android:color="#FFF1F5F9"/>
            <corners android:radius="4dp"/>
            <size android:height="8dp"/>
        </shape>
    </item>
    <item android:right="60dp" android:gravity="center_vertical">
        <shape android:shape="rectangle">
            <solid android:color="#FF3B82F6"/>
            <corners android:radius="4dp"/>
            <size android:height="8dp"/>
        </shape>
    </item>
</layer-list>`,
  },
  {
    id: "input-field",
    group: "widget",
    name: "输入框（聚焦变蓝边）",
    hint: "selector：常态灰边、focused 蓝边 2dp，8dp 圆角，做 EditText 背景",
    xml: `${NS}
    <item android:state_focused="true">
        <shape android:shape="rectangle">
            <solid android:color="#FFFFFFFF"/>
            <corners android:radius="8dp"/>
            <stroke android:width="2dp" android:color="#FF3B82F6"/>
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FFFFFFFF"/>
            <corners android:radius="8dp"/>
            <stroke android:width="1dp" android:color="#FFD1D5DB"/>
        </shape>
    </item>
</selector>`,
  },
  {
    id: "checkbox",
    group: "widget",
    name: "复选框（勾选变实心）",
    hint: "selector：未选白底灰边，勾选是实心蓝色方块，4dp 圆角",
    xml: `${NS}
    <item android:state_checked="true">
        <shape android:shape="rectangle">
            <solid android:color="#FF3B82F6"/>
            <corners android:radius="4dp"/>
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FFFFFFFF"/>
            <corners android:radius="4dp"/>
            <stroke android:width="2dp" android:color="#FF9CA3AF"/>
        </shape>
    </item>
</selector>`,
  },
  {
    id: "radio",
    group: "widget",
    name: "单选框（圆点）",
    hint: "selector：勾选是蓝色粗环留白心，未勾是灰细环，做 RadioButton 的 button",
    xml: `${NS}
    <item android:state_checked="true">
        <shape android:shape="oval">
            <solid android:color="#FFFFFFFF"/>
            <stroke android:width="6dp" android:color="#FF3B82F6"/>
            <size android:width="22dp" android:height="22dp"/>
        </shape>
    </item>
    <item>
        <shape android:shape="oval">
            <solid android:color="#FFFFFFFF"/>
            <stroke android:width="2dp" android:color="#FF9CA3AF"/>
            <size android:width="22dp" android:height="22dp"/>
        </shape>
    </item>
</selector>`,
  },
  {
    id: "switch-track",
    group: "widget",
    name: "开关轨道（打开变蓝）",
    hint: "selector：开=蓝色胶囊，关=灰色胶囊，24dp 高，做 Switch 的 track",
    xml: `${NS}
    <item android:state_checked="true">
        <shape android:shape="rectangle">
            <solid android:color="#FF3B82F6"/>
            <corners android:radius="12dp"/>
            <size android:height="24dp"/>
        </shape>
    </item>
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FFE5E7EB"/>
            <corners android:radius="12dp"/>
            <size android:height="24dp"/>
        </shape>
    </item>
</selector>`,
  },
  {
    id: "list-item",
    group: "widget",
    name: "列表项（点按水波纹）",
    hint: "ripple：白底 + 涟漪，做 RecyclerView 条目的 background / 前景",
    xml: `${NS_RIPPLE}
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FFFFFFFF"/>
        </shape>
    </item>
</ripple>`,
  },
];

export function presetById(id: string): DrawablePreset | undefined {
  return DRAWABLE_PRESETS.find((p) => p.id === id);
}
