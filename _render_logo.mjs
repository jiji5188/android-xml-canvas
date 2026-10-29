// 用 Playwright 把 SVG 渲染成各尺寸 PNG（浏览器里的渲染跟设计稿一致，不需要装 sharp/resvg）
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const svg = fs.readFileSync("public/logo.svg", "utf8");
const targets = [
  { file: "public/icons/icon-48.png", size: 48 },
  { file: "public/icons/icon-192.png", size: 192 },
  { file: "public/icons/icon-512.png", size: 512 },
  { file: "app/apple-icon.png", size: 180 },
  { file: "public/logo-preview.png", size: 256 },
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  const html = `<!doctype html><meta charset="utf-8">
  <style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>
  ${svg}`;
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(html, { waitUntil: "load" });
  fs.mkdirSync(path.dirname(t.file), { recursive: true });
  await page.screenshot({ path: t.file, omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
  console.log("wrote", t.file, t.size);
}
await browser.close();
