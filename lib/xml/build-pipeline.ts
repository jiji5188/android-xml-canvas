// lib/xml/build-pipeline.ts — M212：打包流程的「插件」注册表
//
// 为什么要这个：设备端打包现在有两套完全不同的活——
//   1) shell：aapt2 编资源 + 注入壳 dex + 签名（把当前布局变成一个能装的空壳 App）
//   2) repack：拿一个现成 APK，换里面的原始资源再重签名
// 以后还要加：ECJ+d8 真编 Java、连电脑 Gradle 编、Kotlin……
// 这些能力互相独立、可单独开关/单独发版，所以不写死在 XmlEditor 里，
// 每条流程实现一个 BuildPipeline，注册进注册表，UI 按 available() 决定显不显示。
//
// 注意：本文件只提供类型 + 注册表，不 import 任何 UI，避免循环依赖。

export interface BuildContext {
  /** 项目名（人话） */
  projectName?: string;
  /** 当前打开的文档相对路径 */
  openRel?: string;
  /** 打包用的签名配置（已解析成绝对路径的那些由各 pipeline 自己处理） */
  signing?: { storeFile: string; storePass: string; alias: string; keyPass?: string };
}

export interface BuildOutcome {
  ok: boolean;
  /** 失败阶段（pkg/keystore/compile/sign/output/env/...） */
  step?: string;
  /** 产物绝对路径（成功时） */
  path?: string;
  /** 产物名 */
  name?: string;
  bytes?: number;
  ms?: number;
  /** 详细日志（给「构建日志」页签看） */
  log?: string;
}

export interface BuildPipeline {
  /** 稳定 id，用于记住用户上次选择 */
  id: string;
  /** 界面上显示的名字（中文原文，交给 tt() 翻译） */
  label: string;
  /** 一句话说明（弹出菜单/工具提示用） */
  hint?: string;
  /** 当前环境是否可用（网页版没 aapt2/apksig → false） */
  available(): boolean;
  /** 跑一次 */
  run(ctx: BuildContext): Promise<BuildOutcome>;
}

const registry = new Map<string, BuildPipeline>();

export function registerBuildPipeline(p: BuildPipeline): void {
  if (!p || !p.id) return;
  registry.set(p.id, p);
}

export function listBuildPipelines(): BuildPipeline[] {
  return [...registry.values()];
}

export function availableBuildPipelines(): BuildPipeline[] {
  return [...registry.values()].filter((p) => {
    try {
      return p.available();
    } catch {
      return false;
    }
  });
}

export function getBuildPipeline(id: string): BuildPipeline | null {
  return registry.get(id) ?? null;
}

/** 仅测试用：清空注册表 */
export function __clearBuildPipelines(): void {
  registry.clear();
}
