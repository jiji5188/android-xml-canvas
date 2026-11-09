// test/xml_m200_java_if.test.ts — M200：if/else + 变量 + 可见性条件
import { describe, expect, it } from "vitest";
import { applyEffects, createSimState, parseJavaSim, type SimModel, type SimReceiver } from "@/lib/xml/java-sim";

const JAVA = `package com.example;

public class MainActivity extends AppCompatActivity {
    private TextView tvTitle;
    private TextView tvCount;
    private int count = 0;
    private boolean expanded = false;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        tvTitle = findViewById(R.id.tv_title);
        tvCount = findViewById(R.id.tv_count);
        Button btnToggle = findViewById(R.id.btn_toggle);
        Button btnPlus = findViewById(R.id.btn_plus);

        btnToggle.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                if (expanded) {
                    tvTitle.setVisibility(View.GONE);
                    expanded = false;
                } else {
                    tvTitle.setVisibility(View.VISIBLE);
                    expanded = true;
                }
            }
        });

        btnPlus.setOnClickListener(v -> {
            count++;
            tvCount.setText("已点击 " + count + " 次");
            if (count >= 3) {
                Toast.makeText(MainActivity.this, "够了", Toast.LENGTH_SHORT).show();
            }
        });
    }
}
`;

const KOTLIN = `package com.example

class MainActivity : AppCompatActivity() {
    private var count = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        val tvCount = findViewById<TextView>(R.id.tv_count)
        val btnPlus = findViewById<Button>(R.id.btn_plus)
        btnPlus.setOnClickListener {
            count++
            tvCount.text = "计数 \${count}"
        }
    }
}
`;

const makeRx = () => {
  const calls: string[] = [];
  const vis: Record<string, "visible" | "invisible" | "gone"> = {};
  const rx: SimReceiver = {
    setText: (id, text) => calls.push(`setText:${id}:${text}`),
    setVisibility: (id, v) => {
      vis[id] = v;
      calls.push(`vis:${id}:${v}`);
    },
    setEnabled: (id, v) => calls.push(`enable:${id}:${v}`),
    toast: (t) => calls.push(`toast:${t}`),
    log: (l, tag, m) => calls.push(`log:${l}:${tag}:${m}`),
    navigate: (t) => calls.push(`nav:${t}`),
    getVisibility: (id) => vis[id] ?? "visible",
  };
  return { calls, vis, rx };
};

describe("M200 字段初值", () => {
  it("Java private int / boolean 被读进来", () => {
    const m = parseJavaSim({ rel: "a.java", text: JAVA })!;
    expect(m.fields).toEqual({ count: 0, expanded: false });
    expect(createSimState(m).vars).toEqual({ count: 0, expanded: false });
  });

  it("Kotlin private var 被读进来", () => {
    const m = parseJavaSim({ rel: "a.kt", text: KOTLIN })!;
    expect(m.fields).toEqual({ count: 0 });
  });
});

describe("M200 if/else", () => {
  it("Java 匿名类里的 if/else 解析成单个 if 效果", () => {
    const m = parseJavaSim({ rel: "a.java", text: JAVA })!;
    const toggle = m.handlers.find((h) => h.viewId === "btn_toggle")!;
    expect(toggle.effects.length).toBe(1);
    const e = toggle.effects[0];
    expect(e.kind).toBe("if");
    if (e.kind !== "if") throw new Error("not if");
    expect(e.cond).toEqual({ kind: "truthy", name: "expanded", negate: false });
    expect(e.then.length).toBe(2);
    expect(e.else?.length).toBe(2);
  });

  it("变量能翻转：点第一次走 else，第二次走 then", () => {
    const m = parseJavaSim({ rel: "a.java", text: JAVA })!;
    const toggle = m.handlers.find((h) => h.viewId === "btn_toggle")!;
    const state = createSimState(m);
    const a = makeRx();
    applyEffects(m, toggle.effects, a.rx, state);
    expect(a.vis["tv_title"]).toBe("visible");
    expect(state.vars.expanded).toBe(true);

    const b = makeRx();
    applyEffects(m, toggle.effects, b.rx, state);
    expect(b.vis["tv_title"]).toBe("gone");
    expect(state.vars.expanded).toBe(false);
  });

  it("计数 + 字符串拼接 + 阈值内嵌 if", () => {
    const m = parseJavaSim({ rel: "a.java", text: JAVA })!;
    const plus = m.handlers.find((h) => h.viewId === "btn_plus")!;
    const state = createSimState(m);
    const r1 = makeRx();
    applyEffects(m, plus.effects, r1.rx, state);
    expect(r1.calls).toContain("setText:tv_count:已点击 1 次");
    expect(r1.calls.some((c) => c.startsWith("toast:"))).toBe(false);

    const r2 = makeRx();
    applyEffects(m, plus.effects, r2.rx, state);
    applyEffects(m, plus.effects, r2.rx, state);
    expect(state.vars.count).toBe(3);
    expect(r2.calls).toContain("setText:tv_count:已点击 3 次");
    expect(r2.calls).toContain("toast:够了");
  });
});

describe("M200 可见性条件", () => {
  it("if (tv.getVisibility() == View.GONE) 读 DOM 状态", () => {
    const src = `public class A extends Activity {
  void onCreate(Bundle b) {
    setContentView(R.layout.activity_main);
    Button btn = findViewById(R.id.btn_toggle);
    btn.setOnClickListener(new View.OnClickListener() {
      public void onClick(View v) {
        if (tvText.getVisibility() == View.GONE) {
          tvText.setVisibility(View.VISIBLE);
        } else {
          tvText.setVisibility(View.GONE);
        }
      }
    });
  }
}`;
    const m = parseJavaSim({ rel: "a.java", text: src })!;
    const h = m.handlers[0];
    const e = h.effects[0];
    expect(e.kind).toBe("if");

    const hidden = makeRx();
    hidden.vis["tvText"] = "gone";
    applyEffects(m, h.effects, hidden.rx);
    expect(hidden.vis["tvText"]).toBe("visible");

    const shown = makeRx();
    applyEffects(m, h.effects, shown.rx);
    expect(shown.vis["tvText"]).toBe("gone");
  });
});

describe("M200 Kotlin", () => {
  it("lambda 里的自增 + 模板字符串", () => {
    const m = parseJavaSim({ rel: "a.kt", text: KOTLIN })!;
    const h = m.handlers[0];
    expect(h.viewId).toBe("btn_plus");
    const state = createSimState(m);
    const r = makeRx();
    applyEffects(m, h.effects, r.rx, state);
    expect(r.calls).toContain("setText:tv_count:计数 1");
    expect(state.vars.count).toBe(1);
  });
});

describe("M200 不回退：普通语句仍在", () => {
  it("未知方法仍进 skipped", () => {
    const m = parseJavaSim({
      rel: "a.java",
      text: `public class A { void onCreate(Bundle b) { setContentView(R.layout.a); v.requestFocus(); } }`,
    })!;
    expect(m.skipped.some((s) => s.includes("requestFocus"))).toBe(true);
  });

  it("监听器里的 Toast 不再串到 startup", () => {
    const m: SimModel = parseJavaSim({ rel: "a.java", text: JAVA })!;
    expect(m.startup).toEqual([]);
  });
});
