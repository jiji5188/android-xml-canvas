// playwright.config.ts — M8a e2e（Playwright）
// 默认复用已经在跑的 dev server；没有的话自动起一个。
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      // 用本机已安装的 Chrome（channel: "chrome"），不用再下 150MB 的 Playwright 版 Chromium
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/xml/",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
