// lib/xml/ai-facts.ts — M64i（A6）：把「项目里真实有什么」喂给模型
//
// 以前 prompt 里没有任何项目事实，模型只能靠猜：让它加个圆角背景，它就写
// `@drawable/bg_card`——这个名字在你项目里根本不存在，粘进去就红。
// 这里在发请求前扫一遍 res（预算很紧：最多 40 次 list/read），把真实的
// drawable / color / string / dimen 名字和库类型（androidx vs support）塞进 system prompt。
// 拿不到清单时**明确写「禁止引用 @ 资源」**，而不是让模型自由发挥。

import type { AiFileIo } from "./ai-tools";

export interface ProjectFacts {
  rootLabel: string;
  /** res 目录相对路径（找不到就是空串） */
  resRel: string;
  resDirs: string[];
  drawables: string[];
  colors: string[];
  strings: string[];
  dimens: string[];
  lib: "androidx" | "support" | "unknown";
  /** 实际发生的 list+read 次数 */
  ops: number;
  /** 撞到预算被截断（列表可能不全） */
  truncated: boolean;
}

export const FACTS_BUDGET = {
  maxOps: 40,
  maxNames: 60,
  maxValuesFiles: 6,
};

/** 允许模型用的控件（清单外的自定义 View 一律别写，除非项目里真有） */
export const WIDGET_WHITELIST = [
  "TextView",
  "Button",
  "ImageButton",
  "ImageView",
  "EditText",
  "LinearLayout",
  "FrameLayout",
  "RelativeLayout",
  "ConstraintLayout",
  "ScrollView",
  "NestedScrollView",
  "RecyclerView",
  "ListView",
  "GridView",
  "ViewPager2",
  "Toolbar",
  "CardView",
  "MaterialButton",
  "MaterialCardView",
  "TextInputLayout",
  "TextInputEditText",
  "Switch",
  "SwitchCompat",
  "CheckBox",
  "RadioButton",
  "RadioGroup",
  "SeekBar",
  "ProgressBar",
  "Spinner",
  "FloatingActionButton",
  "Chip",
  "ChipGroup",
  "TabLayout",
  "BottomNavigationView",
  "NavigationView",
  "DrawerLayout",
  "CoordinatorLayout",
  "AppBarLayout",
  "SwipeRefreshLayout",
  "View",
  "Space",
  "WebView",
];

/** 单次 io 调用最多等多久（扫描是「配件」，不能把发请求拖死） */
const OP_TIMEOUT_MS = 800;

const withTimeout = async <T,>(p: Promise<T>, ms = OP_TIMEOUT_MS): Promise<T | null> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<null>((res) => {
        timer = setTimeout(() => res(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const IMG_EXT = /\.(png|jpg|jpeg|webp|gif|xml|9\.png)$/i;

/** 从 docRel 推 res 目录；推不出来再试常见约定 */
function resCandidates(docRel?: string | null): string[] {
  const out: string[] = [];
  if (docRel) {
    const i = docRel.indexOf("res/");
    if (i >= 0) out.push(docRel.slice(0, i + 4));
  }
  for (const c of ["app/src/main/res", "src/main/res", "res"]) if (!out.includes(c)) out.push(c);
  return out;
}

function namesFromXml(text: string, tag: string, cap: number): string[] {
  const re = new RegExp(`<${tag}\\s[^>]*name\\s*=\\s*"([^"]+)"`, "g");
  const out: string[] = [];
  for (const m of text.matchAll(re)) {
    const n = m[1].trim();
    if (n && !out.includes(n)) out.push(n);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * 扫项目事实。**只读**，对构建文件也允许读（保护区只拦写）。
 * 所有次数都记在 ops 上，超预算就停并标 truncated。
 */
export async function collectProjectFacts(
  io: AiFileIo | null,
  docRel?: string | null,
  budget = FACTS_BUDGET,
): Promise<ProjectFacts> {
  const facts: ProjectFacts = {
    rootLabel: io ? io.rootLabel() : "",
    resRel: "",
    resDirs: [],
    drawables: [],
    colors: [],
    strings: [],
    dimens: [],
    lib: "unknown",
    ops: 0,
    truncated: false,
  };
  if (!io) return facts;

  const over = () => facts.ops >= budget.maxOps;
  const stop = () => {
    facts.truncated = true;
  };

  // 1) 找 res，顺手把子目录列出来
  let dirs: string[] = [];
  for (const cand of resCandidates(docRel)) {
    if (over()) {
      stop();
      break;
    }
    facts.ops++;
    const r = (await withTimeout(io.list(cand))) || { ok: false };
    if (!r.ok || !r.items) continue;
    facts.resRel = cand;
    dirs = r.items.filter((it) => it.kind === "dir").map((it) => it.name);
    break;
  }
  facts.resDirs = dirs;

  // 2) drawable / mipmap 文件名（去掉扩展名，.9.png 也去干净）
  for (const d of dirs.filter((x) => /^(drawable|mipmap)/.test(x))) {
    if (over() || facts.drawables.length >= budget.maxNames) {
      stop();
      break;
    }
    facts.ops++;
    const r = (await withTimeout(io.list(`${facts.resRel}/${d}`))) || { ok: false as const };
    for (const it of r.items || []) {
      if (it.kind !== "file" || !IMG_EXT.test(it.name)) continue;
      const n = it.name.replace(/\.9\.png$/i, "").replace(IMG_EXT, "");
      if (n && !facts.drawables.includes(n)) facts.drawables.push(n);
      if (facts.drawables.length >= budget.maxNames) break;
    }
  }

  // 3) values 里的 color / string / dimen 名字
  const valuesDirs = dirs.filter((x) => /^values/.test(x)).slice(0, 3);
  let filesRead = 0;
  for (const d of valuesDirs) {
    if (over() || filesRead >= budget.maxValuesFiles) {
      stop();
      break;
    }
    facts.ops++;
    const list = (await withTimeout(io.list(`${facts.resRel}/${d}`))) || { ok: false as const };
    for (const it of list.items || []) {
      if (it.kind !== "file" || !/\.xml$/i.test(it.name)) continue;
      if (over() || filesRead >= budget.maxValuesFiles) {
        stop();
        break;
      }
      facts.ops++;
      filesRead++;
      const rr = (await withTimeout(io.read(`${facts.resRel}/${d}/${it.name}`))) || { ok: false as const };
      if (!rr.ok) continue;
      const txt = rr.text || "";
      for (const n of namesFromXml(txt, "color", budget.maxNames)) if (!facts.colors.includes(n)) facts.colors.push(n);
      for (const n of namesFromXml(txt, "string", budget.maxNames)) if (!facts.strings.includes(n)) facts.strings.push(n);
      for (const n of namesFromXml(txt, "dimen", budget.maxNames)) if (!facts.dimens.includes(n)) facts.dimens.push(n);
    }
  }

  // 4) 库类型：读 build.gradle（读 protected 文件是允许的，只有写才拦）
  if (!over()) {
    const gradle = ["app/build.gradle", "app/build.gradle.kts", "build.gradle", "build.gradle.kts"];
    for (const g of gradle) {
      if (over()) {
        stop();
        break;
      }
      facts.ops++;
      const r = (await withTimeout(io.read(g))) || { ok: false };
      if (!r.ok || !r.text) continue;
      if (/androidx\./.test(r.text)) facts.lib = "androidx";
      else if (/com\.android\.support/.test(r.text)) facts.lib = "support";
      break;
    }
  }

  return facts;
}

/** 拼成给模型看的段落（空清单时明确禁止引用，别让它自由发挥） */
export function formatProjectFacts(f: ProjectFacts): string {
  if (!f.rootLabel) return "";
  const lines: string[] = ["项目事实（下面列出的都是真实存在的；没列出的就当不存在）："];
  lines.push(`- 项目根：${f.rootLabel}`);
  if (f.lib !== "unknown") {
    lines.push(
      f.lib === "androidx"
        ? "- 依赖库：androidx（不要写 com.android.support.*；不要用已废弃的 support 类）"
        : "- 依赖库：com.android.support（不要混用 androidx.*）",
    );
  }
  if (!f.resRel) {
    lines.push("- 拿不到 res 目录：**禁止**引用任何 @drawable / @color / @string / @dimen，需要时先 read_file / list_files 确认。");
    return lines.join("\n");
  }
  lines.push(`- res 目录：${f.resDirs.join(", ") || "（空）"}`);
  const cap = f.truncated ? "（已达扫描上限，可能不全——不确定就 list_files 再看）" : "";
  const listOrNone = (names: string[], prefix: string) =>
    names.length
      ? `- ${prefix}：${names.join(", ")}${names.length >= FACTS_BUDGET.maxNames ? " …" : ""}`
      : `- ${prefix}：**一个都没有**（不要引用）`;
  lines.push(listOrNone(f.drawables, "@drawable / @mipmap"));
  lines.push(listOrNone(f.colors, "@color"));
  lines.push(listOrNone(f.strings, "@string"));
  if (f.dimens.length) lines.push(`- @dimen：${f.dimens.join(", ")}`);
  lines.push(`- 可用控件：${WIDGET_WHITELIST.join(" / ")}（清单外的自定义 View 别写）`);
  if (cap) lines.push(cap);
  return lines.join("\n");
}
