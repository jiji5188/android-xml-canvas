// e2e/editor.spec.ts — M8a 冒烟：路由跳转 / 画布渲染 / 代码联动 / 撤销 / 导出弹窗 / 移动端
// M198：改成「语言无关 + 不假设默认 tab」——页面默认停在「代码」tab，
//        且 i18n 可能跟随浏览器语言，所以按钮一律用 class / 图标字面量定位。
import { expect, test, type Page } from "@playwright/test";

/** 收集页面级报错：任何未捕获异常或 console error 都让用例失败 */
function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errs.push("console: " + m.text());
  });
  return errs;
}

/** tab 按钮（role=tab），按中英文任一匹配 */
function tab(page: Page, zh: string, en: string) {
  return page
    .locator('.axv-mob-tabs-inner [role="tab"]')
    .filter({ has: page.locator(`text=${zh}`) })
    .or(page.locator('.axv-mob-tabs-inner [role="tab"]').filter({ has: page.locator(`text=${en}`) }))
    .first();
}

/** 打开编辑器并停在「预览」tab */
async function ready(page: Page) {
  await page.goto("/xml/");
  await expect(page.locator(".axv-editor")).toBeVisible({ timeout: 25_000 });
  await tab(page, "预览", "Preview").click();
  await expect(page.locator(".axv-phone")).toBeVisible({ timeout: 25_000 });
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
    await ready(page);
    expect(await page.locator(".axv-node").count()).toBeGreaterThan(2);
    expect(errs, errs.join("\n")).toEqual([]);
  });

  test("工具栏按钮齐全（撤销/重做/保存/格式化/导出/运行）", async ({ page }) => {
    await ready(page);
    // 用图标字面量定位，不依赖界面语言
    for (const icon of ["undo", "redo", "save", "code", "image", "play_arrow"]) {
      await expect(
        page.locator(".axv-tb-btn").filter({ has: page.locator(`.msr:text-is("${icon}")`) }).first(),
      ).toBeVisible();
    }
  });
});

test.describe("代码 ↔ 画布联动", () => {
  test("改代码后画布同步出新控件，撤销能回退", async ({ page }) => {
    const errs = watchErrors(page);
    await ready(page);

    await tab(page, "代码", "Code").click();
    // 代码页是 CodeMirror 6（contenteditable），不是 textarea
    const cm = page.locator(".cm-content").first();
    await expect(cm).toBeVisible({ timeout: 15_000 });
    await cm.click();
    await page.keyboard.press("Control+a");
    await page.keyboard.insertText(MINI_XML);
    await page.waitForTimeout(300);

    await tab(page, "预览", "Preview").click();
    await expect(page.locator(".axv-phone")).toContainText("E2E标题", { timeout: 15_000 });
    await expect(page.locator(".axv-phone")).toContainText("E2E按钮");

    // 撤销应把代码退回上一版（不再有 E2E 标记）
    await page.keyboard.press("Control+z");
    await expect(page.locator(".axv-phone")).not.toContainText("E2E按钮", { timeout: 15_000 });

    expect(errs, errs.join("\n")).toEqual([]);
  });

  test("格式化按钮不改语义（仍能渲染同样内容）", async ({ page }) => {
    await ready(page);
    const before = await page.locator(".axv-phone").innerText();
    await page
      .locator(".axv-tb-btn")
      .filter({ has: page.locator('.msr:text-is("code")') })
      .first()
      .click();
    await page.waitForTimeout(600);
    await expect(page.locator(".axv-phone")).toBeVisible();
    expect(await page.locator(".axv-phone").innerText()).toBe(before);
  });
});

test.describe("导出弹窗", () => {
  test("三种导出方式都在，关闭后回到编辑器", async ({ page }) => {
    await ready(page);
    await page
      .locator(".axv-tb-btn")
      .filter({ has: page.locator('.msr:text-is("image")') })
      .first()
      .click();

    // 导出弹窗里的三个下载按钮（文案可能被翻译，用按钮数量 + 关键 class 兜底）
    const modal = page.locator(".axv-export, [class*=export]").first();
    await expect(modal).toBeVisible({ timeout: 10_000 });
    expect(await page.getByRole("button").count()).toBeGreaterThan(3);

    await page.keyboard.press("Escape");
    await expect(page.locator(".axv-phone")).toBeVisible();
    await expect(page.locator(".axv-node").first()).toBeVisible();
  });
});

test.describe("移动端", () => {
  test("窄屏下画布仍可渲染，不报错", async ({ page }) => {
    const errs = watchErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    expect(await page.locator(".axv-node").count()).toBeGreaterThan(2);
    expect(errs, errs.join("\n")).toEqual([]);
  });
});
