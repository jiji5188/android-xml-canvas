// e2e/flows.spec.ts — M198：补关键路径（插入控件 / 运行调试 / 问题抽屉）
// editor.spec.ts 覆盖「加载 + 代码联动 + 导出」；这里补三条最容易回归的交互路径。
// 注意：页面默认停在「代码」tab，且语言可能跟随浏览器（英文/中文），所以：
//   - 进入后先切到「预览」tab（用 role=tab + 正则匹配两种语言）
//   - 按钮一律用 class 选择器，不依赖中英文文案
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

/** 打开编辑器并保证停在「预览」tab（画布可见） */
async function ready(page: Page) {
  await page.goto("/xml/");
  await expect(page.locator(".axv-editor")).toBeVisible({ timeout: 25_000 });

  const previewTab = page
    .locator('.axv-mob-tabs-inner [role="tab"]')
    .filter({ hasText: /预览|Preview/ })
    .first();
  if ((await previewTab.count()) > 0) {
    await previewTab.click();
  }

  await expect(page.locator(".axv-phone")).toBeVisible({ timeout: 25_000 });
  await expect(page.locator(".axv-node").first()).toBeVisible({ timeout: 15_000 });
}

test.describe("插入控件", () => {
  test("点组件面板的控件 → 画布节点 +1 → Ctrl+Z 回退", async ({ page }) => {
    const errs = watchErrors(page);
    await ready(page);

    const before = await page.locator(".axv-node").count();
    expect(before).toBeGreaterThan(2);

    const tile = page.locator(".axv-pp-tile").first();
    await expect(tile).toBeVisible({ timeout: 15_000 });
    await tile.click();

    await expect
      .poll(() => page.locator(".axv-node").count(), { timeout: 10_000 })
      .toBeGreaterThan(before);

    await page.keyboard.press("Control+z");
    await expect
      .poll(() => page.locator(".axv-node").count(), { timeout: 10_000 })
      .toBe(before);

    expect(errs, errs.join("\n")).toEqual([]);
  });
});

test.describe("运行调试", () => {
  test("进调试页 → 点控件出日志 → Esc 退出", async ({ page }) => {
    const errs = watchErrors(page);
    await ready(page);

    await page.locator(".axv-tb-run").first().click();
    await expect(page.locator(".axv-run-backdrop")).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(".axv-run-body")).toBeVisible();

    const target = page.locator(".axv-run-body .axv-node").first();
    await expect(target).toBeVisible({ timeout: 10_000 });
    await target.click();
    await expect
      .poll(() => page.locator(".axv-run-line").count(), { timeout: 10_000 })
      .toBeGreaterThan(0);

    await page.keyboard.press("Escape");
    await expect(page.locator(".axv-run-backdrop")).toHaveCount(0, { timeout: 10_000 });

    expect(errs, errs.join("\n")).toEqual([]);
  });
});

test.describe("问题抽屉", () => {
  test("点底部把手展开抽屉，能看到内容或空状态，再点收起", async ({ page }) => {
    const errs = watchErrors(page);
    await ready(page);

    const bar = page.locator(".axv-drawer-bar");
    await expect(bar).toBeVisible();

    // 点 tab 按钮展开（直接点把手中心会落在状态条上，那儿 stopPropagation）
    await page.locator(".axv-drawer-tab").first().click();
    await expect(bar).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator(".axv-drawer-body")).toBeVisible({ timeout: 10_000 });
    const n =
      (await page.locator(".axv-drawer-list li").count()) +
      (await page.locator(".axv-drawer-empty").count());
    expect(n).toBeGreaterThan(0);

    await page.locator(".axv-drawer-chevron").click();
    await expect(bar).toHaveAttribute("aria-expanded", "false");

    expect(errs, errs.join("\n")).toEqual([]);
  });
});
