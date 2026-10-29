import { chromium } from "playwright";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 2 });
await page.goto("http://localhost:3000/xml/", { waitUntil: "networkidle" });
await page.evaluate(() => {
  localStorage.setItem("axv.theme", "dark");
  localStorage.setItem("axv.themePreset", "ocean");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);

// 1) 导出检查弹窗：工具栏「复制生成 XML」旁边的 导出？用 title 匹配
const tb = page.locator(".axv-tb-btn[title*='预览图']");
await tb.first().click();
await page.waitForTimeout(800);
await page.screenshot({ path: "shots/dark-modal-export.png" });
await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// 2) 资源面板里的 shape（<shape> 双击开 ShapeEditor）——直接找触发器麻烦，
//    改开 图标编辑器（工具栏没有入口？在资源面板里）
// 3) 设备/显示 下拉
const dev = page.locator(".axv-device select, [class*=device] select").first();
await dev.focus({ force: true }).catch(() => {});

// 4) 左侧 rail「生成资源 / 项目管理」里的 形状资源？没有独立 shape 入口。
// 先截 项目管理 里的资源 tab
await page.locator('.axv-rail-btn[aria-label*="项目"]').first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: "shots/dark-modal-project.png" });

await browser.close();
console.log("modal shots done");
