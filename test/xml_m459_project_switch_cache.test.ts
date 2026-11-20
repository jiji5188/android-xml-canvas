// M459：项目切换时清理跨项目缓存
// 验证 activateProject / openWsProject / createNewProject 路径上确实调用了 clearResIndex + invalidateNativeProjectCache
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");

describe("M459 项目切换缓存清理", () => {
  it("use-xml-project-fns.ts 里 activateProject 调用 clearResIndex + invalidateNativeProjectCache", () => {
    const s = fs.readFileSync(path.join(root, "components/use-xml-project-fns.ts"), "utf8");
    expect(s).toContain("clearResIndex()");
    expect(s).toContain("invalidateNativeProjectCache()");
    // 确认在 activateProject 函数体内（不是 import 行）
    const actIdx = s.indexOf("const activateProject");
    const endIdx = s.indexOf("\n  );", actIdx);
    const body = s.slice(actIdx, endIdx);
    expect(body).toContain("clearResIndex()");
    expect(body).toContain("invalidateNativeProjectCache()");
  });

  it("use-xml-project-fns.ts 里 openWsProject 调用 clearResIndex + invalidateNativeProjectCache", () => {
    const s = fs.readFileSync(path.join(root, "components/use-xml-project-fns.ts"), "utf8");
    const openIdx = s.indexOf("const openWsProject");
    const endIdx = s.indexOf("\n  );", openIdx);
    const body = s.slice(openIdx, endIdx);
    expect(body).toContain("clearResIndex()");
    expect(body).toContain("invalidateNativeProjectCache()");
  });

  it("use-project-create.ts 里 createNewProject 调用 clearResIndex + invalidateNativeProjectCache", () => {
    const s = fs.readFileSync(path.join(root, "components/use-project-create.ts"), "utf8");
    const createIdx = s.indexOf("const createNewProject");
    const endIdx = s.indexOf("\n  }, [", createIdx);
    const body = s.slice(createIdx, endIdx);
    expect(body).toContain("clearResIndex()");
    expect(body).toContain("invalidateNativeProjectCache()");
  });

  it("import 行存在（clearResIndex / invalidateNativeProjectCache）", () => {
    const s1 = fs.readFileSync(path.join(root, "components/use-xml-project-fns.ts"), "utf8");
    expect(s1).toMatch(/import\s*\{?\s*clearResIndex\s*\}?\s*from\s*["']@\/lib\/xml\/res-index["']/);
    expect(s1).toMatch(/invalidateNativeProjectCache\s*\}?\s*from\s*["']@\/lib\/xml\/workspace["']/);
    const s2 = fs.readFileSync(path.join(root, "components/use-project-create.ts"), "utf8");
    expect(s2).toMatch(/import\s*\{\s*clearResIndex\s*\}\s*from\s*["']@\/lib\/xml\/res-index["']/);
    expect(s2).toMatch(/invalidateNativeProjectCache/);
  });
});
