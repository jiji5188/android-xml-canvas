import { defineConfig } from "vitest/config";

// 单测走 test/*.test.ts；e2e/ 是 Playwright 的（npm run e2e），不进 vitest。
// 环境保持 vitest 默认（node）：历史上没有配置文件，64 个测试文件都是在默认环境跑绿的，
// 个别文件自己带 @vitest-environment 注释，这里不强行覆盖。
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["node_modules", "out", "e2e"],
    testTimeout: 20000,
  },
});
