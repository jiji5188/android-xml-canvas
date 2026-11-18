// lib/xml/pre-build-check.ts — M382：编译前检查（纯逻辑，不阻断；结果写进构建日志）
//
// 背景（2026-11-18 连环事故）：mipmap 图标缺失 / gradle 声明的依赖没有本地实体，
// 都是 aapt2/ECJ 深处报一堆难懂的错才暴露。这里在收集完资源/源码/库之后、
// 真正调设备端 aapt2+ECJ 之前，把「确定会炸 / 大概率会炸」的点提前列出来。
//
// 原则：只报有把握的，宁缺毋滥——漏报伤可信度，误报伤可用性。

import { parseGradleDepsDetailed, gradleDepFname, type GradleDep } from "./gradle-deps";

/** gradle 声明了、但项目 libs/共享库里找不到实体文件的依赖 */
export interface MissingDep {
  /** 原始坐标 group:artifact:version */
  coord: string;
  /** 期望的实体文件名（appcompat-1.0.0.aar） */
  fname: string;
}

/**
 * gradle maven 坐标 → 本地实体检查。
 * 设备端打包没有 maven：每个坐标都得有对应 jar/aar 文件进 classpath，
 * 缺实体的包编译时必报 "package does not exist"。
 * 匹配规则：先精确（artifact-version.ext），再宽松（artifact.ext，防版本对不上误报）。
 */
export function missingGradleEntities(
  gradleText: string | null | undefined,
  libRels: string[],
): MissingDep[] {
  if (!gradleText) return [];
  let deps: GradleDep[];
  try {
    deps = parseGradleDepsDetailed(gradleText).deps;
  } catch {
    return [];
  }
  const present = new Set(
    libRels.map((r) => (r.split("/").pop() || "").toLowerCase()).filter(Boolean),
  );
  const out: MissingDep[] = [];
  const seen = new Set<string>();
  for (const d of deps) {
    const fname = gradleDepFname(d);
    const key = `${d.group}:${d.name}:${d.version}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const f = fname.toLowerCase();
    if (!f || f === "-.aar" || f === "-.jar" || present.has(f)) continue;
    const art = d.name.toLowerCase();
    if (art && (present.has(`${art}.aar`) || present.has(`${art}.jar`))) continue;
    out.push({ coord: key, fname });
  }
  return out;
}

/** 缺失资源 key 列表 → 人话（截断到 top 个，多余的显示「还有 N 个」） */
export function formatMissingList(list: string[], top = 12): { shown: string; more: number } {
  const l = list.filter(Boolean);
  return { shown: l.slice(0, top).join("、"), more: Math.max(0, l.length - top) };
}
