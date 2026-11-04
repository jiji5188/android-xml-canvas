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
];

export function presetById(id: string): DrawablePreset | undefined {
  return DRAWABLE_PRESETS.find((p) => p.id === id);
}
