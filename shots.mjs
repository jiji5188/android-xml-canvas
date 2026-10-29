import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/xml/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

await page.locator('.axv-rail-btn[aria-label*="设置"]').first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/settings-light.png" });

await page.locator(".axv-theme-card", { hasText: "松绿" }).click();
await page.locator(".axv-set-seg-btn", { hasText: "深色" }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: "shots/settings-pine-dark.png" });

await page.locator(".axv-theme-card", { hasText: "丁香紫" }).click();
await page.locator(".axv-set-seg-btn", { hasText: "浅色" }).click();
await page.waitForTimeout(400);

await page.locator('.axv-rail-btn[aria-label*="项目"]').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: "shots/project-current.png" });
await page.locator(".axv-proj-tab", { hasText: "工作目录" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: "shots/project-workspace.png" });

await browser.close();
console.log("shots done");
