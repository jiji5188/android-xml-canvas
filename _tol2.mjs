import { chromium } from "playwright";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message.slice(0, 150)));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 150));
  if (m.type() === "warning" && m.text().includes("axv")) console.log("WARN:", m.text().slice(0, 150));
});
await page.goto("http://localhost:3000/xml/", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

// 看工具栏所有按钮 title
const titles = await page.$$eval("button.axv-tb-btn", (bs) => bs.map((b) => b.getAttribute("title") || b.textContent?.trim().slice(0, 12)));
console.log("工具栏:", JSON.stringify(titles, null, 0));

// 找「打开」并点击
const idx = titles.findIndex((t) => (t || "").includes("打开"));
console.log("打开 index:", idx);
if (idx >= 0) {
  await page.locator("button.axv-tb-btn").nth(idx).click();
  await page.waitForTimeout(2500);
  console.log("点击后 exportNote:", await page.locator(".axv-note, .axv-export-note").first().innerText().catch(() => "(无)"));
}

// 用 textarea 直接灌垃圾 XML 验证容错（与打开同一管线 loadXmlFile→setXmlAndTrack）
await page.getByText("XML 代码").first().click();
await page.waitForTimeout(500);
const ta = page.locator("textarea.axv-code-ta").first();
console.log("代码编辑器存在:", await ta.count(), "可编辑:", await ta.isEditable());
await ta.fill("这不是 xml {{{ <<< >>> 乱写");
await page.waitForTimeout(800);
await page.getByText("预览").first().click();
await page.waitForTimeout(900);
console.log("失败卡:", await page.locator(".axv-parse-fail").count(), "结构提示:", await page.locator(".axv-struct-warn").count());
await page.screenshot({ path: "shots/verify-garbage.png" });
await browser.close();
