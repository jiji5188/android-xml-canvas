import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { buildLexicon } from "@/lib/xml/lexicon";

const lex = buildLexicon([
  {
    rel: "app/src/main/java/com/x/MainActivity.java",
    text: `package com.x;

import android.app.Activity;
import android.view.View;
import android.widget.TextView;

public class MainActivity extends Activity {
    public void onBtnClick(View v) {
        TextView fn = v.getRootView().findViewById(R.id.tv_hello);
        fn.setText("xkkkkkk已更换");
    }
}
`,
    lang: "java",
  },
]);

function mk(tail: string) {
  return [
    "package com.x;",
    "",
    "import android.app.Activity;",
    "import android.view.View;",
    "import android.widget.TextView;",
    "",
    "public class MainActivity extends Activity {",
    "    public void onBtnClick(View v) {",
    "        TextView fn = v.getRootView().findViewById(R.id.tv_hello);",
    "        " + tail,
    "    }",
    "}",
  ].join("\n");
}

describe("M391 fn. 成员列表", () => {
  it("fn. 刚点完点号（空前缀）→ 列 TextView 方法+常量，setText 在前", () => {
    const r = computeJavaSuggest(mk("fn."), { line: 10, col: 12 }, lex);
    console.log("[fn.] items=", r?.items?.slice(0, 12));
    expect(r?.items?.includes("setText")).toBe(true);
    expect(r?.items?.[0]).toBe("setText");
    // 常量通过前缀可达（fn. 全列时空前缀 24 条会被方法占满，用 fn.v 验常量可达）
  });
  it("fn.V → 继承自 View 的常量 VISIBLE 可达", () => {
    const r = computeJavaSuggest(mk("fn.V"), { line: 10, col: 15 }, lex);
    console.log("[fn.V] items=", r?.items?.slice(0, 8));
    expect(r?.items?.includes("VISIBLE")).toBe(true);
  });
  it("fn.se → setText 第一", () => {
    const r = computeJavaSuggest(mk("fn.se"), { line: 10, col: 15 }, lex);
    expect(r?.items?.[0]).toBe("setText");
  });
  it("fn.v → 过滤出 VISIBLE/VIS...（1字符成员过滤）", () => {
    const r = computeJavaSuggest(mk("fn.v"), { line: 10, col: 14 }, lex);
    console.log("[fn.v] items=", r?.items?.slice(0, 8));
    expect(r?.items?.includes("VISIBLE")).toBe(true);
  });
});
