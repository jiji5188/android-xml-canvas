import { describe, expect, it } from "vitest";
import {
  eventText,
  previewInput,
  runRoleOf,
  sampleRows,
  seekRatio,
  seekValue,
  shortName,
  spinnerOptions,
  targetLabel,
  wantsRipple,
  vibeMs,
  vibrate,
} from "../lib/xml/run-sim";

describe("M18 run-sim：角色判定", () => {
  it("输入类控件", () => {
    expect(runRoleOf("EditText")).toBe("input");
    expect(runRoleOf("com.google.android.material.textfield.TextInputEditText")).toBe("input");
    expect(runRoleOf("AutoCompleteTextView")).toBe("input");
  });
  it("勾选 / 开关 / 单选", () => {
    expect(runRoleOf("CheckBox")).toBe("check");
    expect(runRoleOf("Switch")).toBe("switch");
    expect(runRoleOf("com.google.android.material.materialswitch.MaterialSwitch")).toBe("switch");
    expect(runRoleOf("RadioButton")).toBe("radio");
  });
  it("进度 / 下拉 / 列表 / 网格", () => {
    expect(runRoleOf("SeekBar")).toBe("seek");
    expect(runRoleOf("com.google.android.material.slider.Slider")).toBe("seek");
    expect(runRoleOf("Spinner")).toBe("spinner");
    expect(runRoleOf("androidx.recyclerview.widget.RecyclerView")).toBe("list");
    expect(runRoleOf("GridView")).toBe("grid");
  });
  it("按钮类只给涟漪，不给其它交互", () => {
    expect(runRoleOf("Button")).toBe("button");
    expect(runRoleOf("com.google.android.material.button.MaterialButton")).toBe("button");
    expect(runRoleOf("ImageView")).toBe("none");
    expect(wantsRipple("button")).toBe(true);
    expect(wantsRipple("input")).toBe(false);
  });
});

describe("M18 run-sim：假数据与数值", () => {
  it("sampleRows 固定 8 条，名字循环", () => {
    const rows = sampleRows(8);
    expect(rows).toHaveLength(8);
    expect(rows[0].title).toBe("张三");
    expect(rows[3].sub).toBeTruthy();
    expect(sampleRows(50)).toHaveLength(30);
  });

  it("spinnerOptions：逗号分隔的 entries 优先；@array 给提示；没写给默认三项", () => {
    expect(spinnerOptions("北京,上海|广州，深圳")).toEqual(["北京", "上海", "广州", "深圳"]);
    expect(spinnerOptions("@array/cities")).toEqual(["（未解析 @array）选项一", "选项二", "选项三"]);
    expect(spinnerOptions(undefined)).toEqual(["选项一", "选项二", "选项三"]);
  });

  it("seekRatio 夹取到 0..1；seekValue 按 max 取整", () => {
    expect(seekRatio(10, 0, 100)).toBe(0.1);
    expect(seekRatio(-50, 0, 100)).toBe(0);
    expect(seekRatio(999, 0, 100)).toBe(1);
    expect(seekRatio(50, 0, 0)).toBe(0);
    expect(seekValue(0.333, 3)).toBe(1);
    expect(seekValue(1, 100)).toBe(100);
    expect(seekValue(2, 50)).toBe(50);
  });
});

describe("M18 run-sim：触觉反馈策略", () => {
  it("普通按下/选择不震，长按 30ms，开关/勾选/单选 15ms", () => {
    expect(vibeMs("button", "press")).toBe(0);
    expect(vibeMs("button", "select")).toBe(0);
    expect(vibeMs("button", "long")).toBe(30);
    expect(vibeMs("switch", "toggle")).toBe(15);
    expect(vibeMs("check", "toggle")).toBe(15);
    expect(vibeMs("radio", "toggle")).toBe(15);
    expect(vibeMs("list", "select")).toBe(15);
    expect(vibeMs("grid", "select")).toBe(15);
    expect(vibeMs("spinner", "select")).toBe(0);
    expect(vibeMs("input", "press")).toBe(0);
  });
  it("vibrate 0 毫秒不碰 navigator", () => {
    vibrate(0);
    vibrate(-5); // 不报错就行
  });
});

describe("M18 run-sim：文案", () => {
  it("targetLabel 去掉 @+id/ 前缀，无 id 只留类名", () => {
    expect(targetLabel("Button", "@+id/btn_ok")).toBe("Button#btn_ok");
    expect(targetLabel("android.widget.Button", "id2")).toBe("Button#id2");
    expect(targetLabel("TextView", undefined)).toBe("TextView");
  });
  it("eventText 拼出 logcat 风格", () => {
    expect(eventText("click", "Button#ok", 'onClick="go"')).toBe('点击 Button#ok · onClick="go"');
    expect(eventText("input", "EditText#name")).toBe("输入 EditText#name");
  });
  it("previewInput 转义换行、超长截断", () => {
    expect(previewInput("a\nb\r\n\n c")).toBe("a⏎b⏎ c");
    expect(previewInput("x".repeat(100), 10)).toBe("xxxxxxxxxx…");
  });
  it("shortName 展开全限定类名", () => {
    expect(shortName("com.example.MyView")).toBe("MyView");
    expect(shortName("LinearLayout")).toBe("LinearLayout");
  });
});
