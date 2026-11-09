// @vitest-environment jsdom
// M199：Java 逻辑仿真接进运行调试（点击按钮 → 执行 setOnClickListener 里的语句）
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { RunPreview } from "@/components/RunPreview";
const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 5));
};

const XML = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">
    <TextView
        android:id="@+id/tv_title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="原始标题" />
    <Button
        android:id="@+id/btn_next"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="下一步" />
</LinearLayout>`;

const JAVA = `package com.example;
import android.view.View;
import android.widget.Button;
import android.widget.TextView;
import android.widget.Toast;

public class MainActivity extends AppCompatActivity {
    private TextView tvTitle;
    private Button btnNext;
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);
        tvTitle = findViewById(R.id.tv_title);
        btnNext = findViewById(R.id.btn_next);
        btnNext.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                tvTitle.setText("点过了");
                tvTitle.setVisibility(View.VISIBLE);
                Toast.makeText(MainActivity.this, "收到点击", Toast.LENGTH_SHORT).show();
                Log.d("Main", "clicked");
            }
        });
    }
}
`;

describe("M199 RunPreview + Java 仿真", () => {
  it("点按钮执行 Java 里的 setText / Toast / Log", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root: Root = createRoot(host);
    root.render(
      <RunPreview
        entryXml={XML}
        entryName="activity_main"
        layouts={{}}
        resources={{} as never}
        device={{ label: "Test", w: 360, h: 640 }}
        javaFiles={[{ rel: "app/src/main/java/com/example/MainActivity.java", text: JAVA }]}
        onClose={() => {}}
      />,
    );
    await flush();

    const screen = host.querySelector<HTMLElement>(".axv-run-screen");
    expect(screen).toBeTruthy();
    expect(screen!.textContent ?? "").toContain("原始标题");

    const btn = screen!.querySelector<HTMLElement>('[data-tag="Button"]');
    expect(btn).toBeTruthy();
    btn!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();

    // 文案被 Java 改了
    expect(screen!.textContent ?? "").toContain("点过了");
    // Toast 出现了
    expect(host.querySelector(".axv-run-toast")?.textContent ?? "").toContain("收到点击");
    // 日志里有 Java 的 Log.d
    expect(host.textContent ?? "").toContain("clicked");

    root.unmount();
    host.remove();
  });
});
