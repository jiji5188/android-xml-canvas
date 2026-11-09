// test/xml_m199_java_sim.test.ts — M199：Java 逻辑仿真
import { describe, expect, it } from "vitest";
import { applyEffects, classNameToLayout, parseJavaSim, pickJavaSim } from "@/lib/xml/java-sim";
import { idToPath } from "@/lib/xml/run-sim";

const JAVA = `package com.example;

import android.os.Bundle;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;
import androidx.appcompat.app.AppCompatActivity;

public class MainActivity extends AppCompatActivity {
    private TextView tvTitle;
    private Button btnNext;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        tvTitle = findViewById(R.id.tv_title);
        btnNext = findViewById(R.id.btn_next);
        tvTitle.setText("Hello");
        tvTitle.setVisibility(View.GONE);
        btnNext.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                tvTitle.setText("After click");
                Toast.makeText(MainActivity.this, "Tapped", Toast.LENGTH_SHORT).show();
                Log.d("Main", "btn pressed");
                startActivity(new Intent(this, SettingsActivity.class));
            }
        });
    }
}
`;

const KOTLIN = `package com.example

import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    private lateinit var tvTitle: TextView
    private lateinit var btnNext: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        tvTitle = findViewById(R.id.tv_title)
        btnNext = findViewById(R.id.btn_next)
        tvTitle.text = "Kotlin"
        btnNext.setOnClickListener {
            tvTitle.setText("Done")
            Toast.makeText(this, "Kotlin toast", Toast.LENGTH_SHORT).show()
            startActivity(Intent(this, SettingsActivity::class.java))
        }
    }
}
`;

describe("classNameToLayout", () => {
  it("Activity 类名 → 布局名", () => {
    expect(classNameToLayout("SettingsActivity")).toBe("settings");
    expect(classNameToLayout("com.example.Main")).toBe("main");
  });
});

describe("parseJavaSim", () => {
  it("Java：setContentView + setText + setVisibility + onClick 里的 Toast / Log / startActivity", () => {
    const m = parseJavaSim({ rel: "app/src/main/java/com/example/MainActivity.java", text: JAVA })!;
    expect(m.className).toBe("MainActivity");
    expect(m.layoutName).toBe("activity_main");
    expect(m.startup.map((e) => e.kind)).toEqual(["setText", "setVisibility"]);
    expect(m.startup[0]).toMatchObject({ kind: "setText", viewId: "tv_title", text: "Hello" });
    expect(m.handlers.length).toBe(1);
    const h = m.handlers[0];
    expect(h.viewId).toBe("btn_next");
    expect(h.effects.map((e) => e.kind)).toEqual(["setText", "toast", "log", "startActivity"]);
    expect(h.effects[3]).toMatchObject({ kind: "startActivity", className: "SettingsActivity", layout: "settings" });
  });

  it("Kotlin：属性赋值 + lambda onClick", () => {
    const m = parseJavaSim({ rel: "MainActivity.kt", text: KOTLIN })!;
    expect(m.layoutName).toBe("activity_main");
    expect(m.startup).toContainEqual(expect.objectContaining({ kind: "setText", viewId: "tv_title", text: "Kotlin" }));
    expect(m.handlers[0].viewId).toBe("btn_next");
    expect(m.handlers[0].effects.map((e) => e.kind)).toEqual(["setText", "toast", "startActivity"]);
    expect(m.handlers[0].effects[2]).toMatchObject({ className: "SettingsActivity", layout: "settings" });
  });

  it("没有可识别语句时不炸，skipped 为空", () => {
    const m = parseJavaSim({
      rel: "A.java",
      text: "public class A { void f() { int x = 1; } }",
    })!;
    expect(m.handlers).toHaveLength(0);
    expect(m.startup).toHaveLength(0);
    expect(m.skipped).toHaveLength(0);
  });
});

describe("pickJavaSim", () => {
  it("按布局名挑对应 Activity", () => {
    const m = pickJavaSim(
      [
        { rel: "MainActivity.java", text: JAVA },
        { rel: "SettingsActivity.kt", text: KOTLIN.replace("MainActivity", "SettingsActivity").replace("activity_main", "activity_settings") },
      ],
      "activity_main",
      { activity_main: "<xml/>", activity_settings: "<xml/>" },
    )!;
    expect(m.className).toBe("MainActivity");
  });

  it("没有布局对应时取第一个有 handler 的", () => {
    const m = pickJavaSim(
      [
        { rel: "Empty.java", text: "public class Empty {}" },
        { rel: "MainActivity.java", text: JAVA },
      ],
      "other_layout",
    )!;
    expect(m.className).toBe("MainActivity");
  });
});

describe("applyEffects + idToPath", () => {
  it("把 Java 效果按顺序打给接收器", () => {
    const model = parseJavaSim({ rel: "a.java", text: JAVA })!;
    const calls: string[] = [];
    const rx = {
      setText(id: string, text: string) { calls.push(`setText:${id}:${text}`); },
      setVisibility(id: string, v: string) { calls.push(`vis:${id}:${v}`); },
      setEnabled(id: string, v: boolean) { calls.push(`enable:${id}:${v}`); },
      toast(t: string) { calls.push(`toast:${t}`); },
      log(l: string, tag: string, m: string) { calls.push(`log:${l}:${tag}:${m}`); },
      navigate(t: string) { calls.push(`nav:${t}`); },
    };
    applyEffects(model, model.startup, rx as any);
    expect(calls).toEqual(["setText:tv_title:Hello", "vis:tv_title:gone"]);
    applyEffects(model, model.handlers[0].effects, rx as any);
    expect(calls).toContain("setText:tv_title:After click");
    expect(calls).toContain("toast:Tapped");
    expect(calls).toContain("log:d:Main:btn pressed");
    expect(calls).toContain("nav:settings");
  });

  it("按 id 找布局路径（去掉 @+id/ 前缀）", () => {
    const root = {
      tag: "LinearLayout",
      attrs: { "android:orientation": "vertical" },
      children: [
        { tag: "TextView", attrs: { id: "@+id/tv_title", "android:text": "t" }, children: [], path: "0/0" },
        { tag: "Button", attrs: { id: "@+id/btn_next" }, children: [], path: "0/1" },
      ],
      path: "0",
      text: "",
    } as any;
    expect(idToPath(root, "tv_title")).toBe("0/0");
    expect(idToPath(root, "@+id/btn_next")).toBe("0/1");
    expect(idToPath(root, "nope")).toBeNull();
  });
});
