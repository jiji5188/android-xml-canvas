#!/usr/bin/env node
// tools/install-hooks.mjs — 把仓库自带的 .githooks 挂上（幂等、永不失败）
//
// 为什么：pre-commit 编码闸门很好用，但 core.hooksPath 是本地配置，
// 每个克隆都得手动跑一次 `git config core.hooksPath .githooks`，容易忘。
// 挂到 npm 的 prepare 里，`npm install` 就顺手装好。
//
// 设计原则：**永不阻断安装**。不是 git 仓库 / 没有 .githooks / git 不可用 → 静默跳过。

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function quiet(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

try {
  // 只在 git 仓库里干活
  if (quiet("git", ["rev-parse", "--is-inside-work-tree"]) !== "true") process.exit(0);

  const hooksDir = path.join(process.cwd(), ".githooks");
  if (!fs.existsSync(hooksDir)) process.exit(0);

  const current = quiet("git", ["config", "--get", "core.hooksPath"]);
  if (current === ".githooks") process.exit(0); // 已经装好

  // 别的工具（husky 等）已经占了 hooksPath 就不抢
  if (current) {
    console.log(`[hooks] core.hooksPath 已是 "${current}"，跳过（要换成本仓库的钩子请手动 git config core.hooksPath .githooks）`);
    process.exit(0);
  }

  quiet("git", ["config", "core.hooksPath", ".githooks"]);
  console.log("[hooks] 已启用 .githooks（提交前会检查编码）");
} catch {
  // 安装钩子永远不该让 npm install 失败
}
