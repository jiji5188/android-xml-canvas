import path from "node:path";
import { defineConfig } from "vitest/config";

// 单测只跑 test/*.test.ts(x)；e2e/ 是 Playwright 的（npm run e2e），不进 vitest。
// 环境保持 vitest 默认（node）：个别文件用 @vitest-environment 注释自己切 jsdom。
export default defineConfig({
  resolve: {
    // 跟 tsconfig 的 paths 对齐，组件里用 "@/lib/..." 才能被 vitest 解析
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    exclude: ["node_modules", "out", "e2e"],
    testTimeout: 20000,
    // M144：jsdom 不提供 localStorage（Node 24 的同名全局占了位），make 一份内存版
    setupFiles: ["test/setup.ts"],
    // M144：树展开状态走 localStorage，jsdom 必须给个非 opaque 的 url 才有 storage
    environmentOptions: { jsdom: { url: "http://localhost/" } },
  },
});
