// e2e/editor.spec.ts — M8a 冒烟：路由跳转 / 画布渲染 / 代码联动 / 撤销 / 导出弹窗 / 移动端
// 这些用例跑的是真实浏览器，防止「tsc 过了、单测绿了，但页面白屏」这类事故。
import { expect, test, type Page } from "@playwright/test";

/** 收集页面级报错：任何未捕获异常/console error 都让用例失败 */
function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("console: " + m.text());
  });
  return errs;
}

const MINI_XML = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="16dp">

    <TextView
        android:id="@+id/e2e_title"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="E2E标题"
        android:textSize="20sp" />

    <Button
        android:id="@+id/e2e_btn"
        android:layout_width="match_parent"
        android:layout_height="48dp"
        android:text="E2E按钮" />

</LinearLayout>`;

test.describe("加载与渲染", () => {
  test("根路由自动跳到 /xml/，画布能渲染出示例布局", async ({ page }) => {
    const errs = watchErrors(page);
    await page.goto("/");
    await expect(page).toHaveURL(/\/xml\/?$/, { timeout: 20_000 });
    await expect(page.locator(".axv-phone")).toBeVisible({ timeout: 25_000 });
    expect(await page.locator(".axv-node").count()).toBeGreaterThan(2);
    expect(errs, errs.join("\n")).toEqual([]);
  });

  test("工具栏按钮齐全（撤销/重做/保存/格式化/导出/运行）", async ({ page }) => {
    await page.goto("/xml/");
    await expect(page.locator(".axv-phone")).toBeVisible({ timeout: 25_000 });
    for (const label of ["撤销", "重做", "保存", "格式化", "导出预览图", "运行", "打开 XML 文件"]) {
      await expect(page.getByRole("button", { name: label, exact: true }).first()).toBeVisible();
    }
  });
});

test.describe("代码 ↔ 画布联动", () => {
  test("改代码后画布同步出新控件，撤销能回退", async ({ page }) => {
    const errs = watchErrors(page);
    await page.goto("/xml/");
    await expect(page.locator(".axv-phone")).toBeVisible({ timeout: 25_000 });

    // 切到代码页（画布被代码编辑器取代，.axv-phone 此时不存在 —— 这是正常的）
    await page.getByText("XML 代码", { exact: false }).first().click();
    const ta = page.locator("textarea.axv-code-ta");
    await expect(ta).toBeVisible();

    await ta.fill(MINI_XML);
    // 切回预览，验证画布吃到了新 XML（tab 标签含图标连字，用包含匹配）
    await page.getByText("预览", { exact: false }).first().click();
    await expect(page.locator(".axv-phone")).toContainText("E2E标题", { timeout: 15_000 });
    await expect(page.locator(".axv-phone")).toContainText("E2E按钮");

    // 撤销应把代码退回上一版（不再含 E2E 标记）
    await page.getByRole("button", { name: "撤销", exact: true }).first().click();
    await expect(page.locator(".axv-phone")).not.toContainText("E2E按钮", { timeout: 15_000 });

    expect(errs, errs.join("\n")).toEqual([]);
  });

  test("格式化按钮不改语义（仍能渲染同样内容）", async ({ page }) => {
    await page.goto("/xml/");
    await expect(page.locator(".axv-phone")).toBeVisible({ timeout: 25_000 });
    const before = await page.locator(".axv-phone").innerText();
    await page.getByRole("button", { name: "格式化", exact: true }).click();
    await page.waitForTimeout(600);
    await expect(page.locator(".axv-phone")).toBeVisible();
    expect(await page.locator(".axv-phone").innerText()).toBe(before);
  });
});

test.describe("导出弹窗", () => {
  test("三种导出方式都在，关闭后回到编辑器", async ({ page }) => {
    await page.goto("/xml/");
    await expect(page.locator(".axv-phone")).toBeVisible({ timeout: 25_000 });
    await page.getByRole("button", { name: "导出预览图", exact: true }).click();
    await expect(page.getByRole("button", { name: "下载 PNG" })).toBeVisible();
    await expect(page.getByRole("button", { name: "下载 SVG" })).toBeVisible();
    await expect(page.getByRole("button", { name: "矢量 SVG" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "下载 PNG" })).toHaveCount(0);
    // 取消后画布仍可交互
    await expect(page.locator(".axv-node").first()).toBeVisible();
  });
});

test.describe("移动端", () => {
  test("窄屏下画布仍可渲染，不报错", async ({ page }) => {
    const errs = watchErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/xml/");
    await expect(page.locator(".axv-phone")).toBeVisible({ timeout: 25_000 });
    expect(await page.locator(".axv-node").count()).toBeGreaterThan(2);
    expect(errs, errs.join("\n")).toEqual([]);
  });
});
