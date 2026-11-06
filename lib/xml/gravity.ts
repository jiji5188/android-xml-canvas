// lib/xml/gravity.ts — 对齐方式（gravity / layout_gravity / drawable item android:gravity）
// M163：用户反馈「只有上下左右 center，选不了左中、右中、上中、下中」。
// 这里把 3 纵向 × 5 横向的交叉组合全列出来，供属性面板与 drawable item 共用。

const VS = ["top", "center_vertical", "bottom"] as const;
const HS = ["left", "start", "center_horizontal", "end", "right"] as const;

const SINGLES = [
  "center",
  "center_vertical",
  "center_horizontal",
  "top",
  "bottom",
  "left",
  "right",
  "start",
  "end",
  "fill",
  "fill_vertical",
  "fill_horizontal",
];

/** 单值中文标签（和 components/drawable/AttrRows.tsx 的 ENUM_LABEL 保持一致） */
export const GRAVITY_LABELS: Record<string, string> = {
  center: "居中",
  center_vertical: "垂直居中",
  center_horizontal: "水平居中",
  top: "上",
  bottom: "下",
  left: "左",
  right: "右",
  start: "起始",
  end: "末尾",
  fill: "填满",
  fill_vertical: "纵向填满",
  fill_horizontal: "横向填满",
};

const V_CN: Record<string, string> = { top: "上", center_vertical: "中", bottom: "下" };
const H_CN: Record<string, string> = {
  left: "左",
  start: "左",
  center_horizontal: "中",
  end: "右",
  right: "右",
};

/** 组合值的中文标签：top|left → 左上，center_vertical|right → 右中，top|center_horizontal → 上中 */
function comboLabel(v: string, h: string): string {
  const vc = V_CN[v];
  const hc = H_CN[h];
  return h === "center_horizontal" ? `${vc}中` : `${hc}${vc}`;
}

/** 完整选项（常用单值在前，组合在后；组合里补中文标签） */
export const GRAVITY_OPTIONS: string[] = (() => {
  const combos: string[] = [];
  for (const v of VS) {
    for (const h of HS) {
      if (v === "center_vertical" && h === "center_horizontal") continue;
      const key = `${v}|${h}`;
      combos.push(key);
      // 同一个中文标签只留第一个写法（left 优先于 start，right 优先于 end）
      const label = comboLabel(v, h);
      if (!Object.values(GRAVITY_LABELS).includes(label)) GRAVITY_LABELS[key] = label;
    }
  }
  return [...SINGLES, ...combos];
})();
