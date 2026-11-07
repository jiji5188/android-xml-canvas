// test/xml_m178_java_api_check.test.ts
// M178：控件方法名拼错检查（只报编辑距离 1 的极近拼写错误，宁漏勿误）
// @vitest-environment node

import { describe, expect, it } from "vitest";
import { checkApiTypos, editDistance, formatApiIssue } from "@/lib/xml/java-api-check";

describe("editDistance", () => {
  it("基本距离", () => {
    expect(editDistance("setText", "setText")).toBe(0);
    expect(editDistance("setTxt", "setText")).toBe(1);
    expect(editDistance("setVisiblity", "setVisibility")).toBe(1);
    expect(editDistance("abc", "xyz")).toBe(3);
  });
});

describe("checkApiTypos", () => {
  it("TextView.setTxt → 建议 setText", () => {
    const src = `public class A extends Activity {
  void f() {
    TextView tv = (TextView) findViewById(R.id.title);
    tv.setTxt("hi");
  }
}`;
    const out = checkApiTypos(src);
    expect(out).toHaveLength(1);
    expect(out[0].method).toBe("setTxt");
    expect(out[0].suggest).toBe("setText");
    expect(out[0].type).toBe("TextView");
    expect(out[0].line).toBe(4);
  });

  it("正确方法不报", () => {
    const src = `public class A {
  void f() {
    TextView tv = (TextView) findViewById(R.id.title);
    tv.setText("hi");
    tv.setVisibility(View.VISIBLE);
    tv.setOnClickListener(v -> {});
  }
}`;
    expect(checkApiTypos(src)).toHaveLength(0);
  });

  it("继承方法不报（Button 用 TextView 的 setText）", () => {
    const src = `public class A {
  void f() {
    Button b = (Button) findViewById(R.id.go);
    b.setText("ok");
    b.setEnabled(true);
  }
}`;
    expect(checkApiTypos(src)).toHaveLength(0);
  });

  it("不认识的类型不报（自定义 View 子类）", () => {
    const src = `public class A {
  void f() {
    MyChartView chart = new MyChartView(this);
    chart.setSeriesDta(list);
  }
}`;
    expect(checkApiTypos(src)).toHaveLength(0);
  });

  it("文件里自己定义的同名方法不报", () => {
    const src = `public class A {
  void setTxt(String s) {}
  void f() {
    TextView tv = (TextView) findViewById(R.id.title);
    tv.setTxt("hi");
  }
}`;
    expect(checkApiTypos(src)).toHaveLength(0);
  });

  it("注释和字符串里的调用不算", () => {
    const src = `public class A {
  void f() {
    TextView tv = (TextView) findViewById(R.id.title);
    // tv.setTxt("in comment");
    String s = "tv.setTxt(1)";
  }
}`;
    expect(checkApiTypos(src)).toHaveLength(0);
  });

  it("编辑距离 2 以上不报（避免瞎猜）", () => {
    const src = `public class A {
  void f() {
    TextView tv = (TextView) findViewById(R.id.title);
    tv.setTextSz(12);
  }
}`;
    expect(checkApiTypos(src)).toHaveLength(0);
  });

  it("Image 拼错 setImageResource → 报告", () => {
    const src = `public class A {
  void f() {
    ImageView iv = (ImageView) findViewById(R.id.icon);
    iv.setImageResourse(R.drawable.ic);
  }
}`;
    const out = checkApiTypos(src);
    expect(out).toHaveLength(1);
    expect(out[0].suggest).toBe("setImageResource");
  });

  it("formatApiIssue 文案完整", () => {
    const msg = formatApiIssue({
      line: 5,
      method: "setTxt",
      receiver: "tv",
      type: "TextView",
      suggest: "setText",
    });
    expect(msg).toContain("setTxt()");
    expect(msg).toContain("setText()");
    expect(msg).toContain("TextView");
  });
});
