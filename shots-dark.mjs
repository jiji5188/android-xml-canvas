import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/xml/", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.setItem("axv.theme", "dark");
  localStorage.setItem("axv.themePreset", "pine");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1000);

await page.screenshot({ path: "shots/dark-main.png" });

// 选中画布里的按钮 → 右侧属性面板出内容
await page.locator(".axv-node").nth(6).click({ force: true }).catch(() => {});
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/dark-selected.png" });

// 项目管理 / 设置
await page.locator('.axv-rail-btn[aria-label*="项目"]').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/dark-project.png" });

await page.locator('.axv-rail-btn[aria-label*="设置"]').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/dark-settings.png" });

// 代码视图
await page.locator('.axv-mob-tab, .axv-tab, button:has-text("XML 代码")').first().click().catch(() => {});
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/dark-code.png" });

await browser.close();
console.log("dark shots done");
