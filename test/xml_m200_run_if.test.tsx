// @vitest-environment jsdom
// M200：运行调试里 if/else + 计数变量真的生效（点一下隐藏，再点一下显示）
import { describe, expect, it } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { RunPreview } from "@/components/RunPreview";

const flush = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5));
};

const XML = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">
    <TextView
        android:id="@+id/tv_title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="标题" />
    <TextView
        android:id="@+id/tv_count"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="0" />
    <Button
        android:id="@+id/btn_toggle"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="切换" />
    <Button
        android:id="@+id/btn_plus"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="加一" />
</LinearLayout>`;

const JAVA = `package com.example;

public class MainActivity extends AppCompatActivity {
    private TextView tvTitle;
    private TextView tvCount;
    private int count = 0;
    private boolean hidden = false;

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
                if (hidden) {
                    tvTitle.setVisibility(View.VISIBLE);
                    hidden = false;
                } else {
                    tvTitle.setVisibility(View.GONE);
                    hidden = true;
                }
            }
        });

        btnPlus.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                count++;
                tvCount.setText("点了 " + count + " 次");
            }
        });
    }
}
`;

const mount = async () => {
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
  const screen = host.querySelector<HTMLElement>(".axv-run-screen")!;
  const byText = (tag: string, text: string) =>
    Array.from(screen.querySelectorAll<HTMLElement>(`[data-tag="${tag}"]`)).find((el) =>
      (el.textContent ?? "").includes(text),
    )!;
  const clean = () => {
    root.unmount();
    host.remove();
  };
  return { host, screen, byText, clean };
};

describe("M200 RunPreview if/else", () => {
  it("点一次隐藏 TextView，点第二次又显示回来", async () => {
    const { byText, clean } = await mount();
    const toggle = byText("Button", "切换");
    expect(toggle).toBeTruthy();

    const title = byText("TextView", "标题");
    expect(title.style.display).toBe("");

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(title.style.display).toBe("none");

    toggle.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(title.style.display).toBe("");

    clean();
  });

  it("计数变量跨点击累加，文本按模板变化", async () => {
    const { byText, clean } = await mount();
    const plus = byText("Button", "加一");
    const count = byText("TextView", "0");

    plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(count.textContent ?? "").toContain("点了 1 次");

    plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    plus.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
    expect(count.textContent ?? "").toContain("点了 3 次");

    clean();
  });
});
