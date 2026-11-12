// lib/xml/lint-doc.ts — M138：非布局 XML 的行内校验
//
// 背景：`doc-kind.ts` 把非布局文件（manifest / values / drawable / anim…）判成 codeOnly 后，
// XmlEditor 直接 `if (codeOnly) return []` 跳过了所有校验 → 这些文件写错只能等到 aapt 报错。
//
// 这里补上「按文件类型」的检查：
//   ① 通用结构检查永远跑（标签配对 / 注释 / CDATA / 声明闭合）——复用 lintXml
//   ② 再按类型叠领域规则（manifest 的必填属性、values 的重名与取值格式…）
//
// 设计原则和 lintXml 一致：只报「真会出问题」的，不做风格建议；能定位到行就给行号。

import { lintXml, type LintIssue } from "./lint";
import { rootTagOf, isValuesPath } from "./doc-kind";
import { parseManifest, attrOfElement, isManifestPath, looksLikeManifest } from "./manifest-edit";
import { parseValues } from "./values-edit";

export type CodeDocKind = "manifest" | "values" | "color" | "drawable" | "anim" | "menu" | "other";

const ANIM_ROOTS = new Set(["set", "objectAnimator", "animator", "animation-list", "animated-vector"]);
const DRAWABLE_ROOTS = new Set([
  "shape",
  "selector",
  "layer-list",
  "ripple",
  "inset",
  "clip",
  "scale",
  "rotate",
  "animated-rotate",
  "level-list",
  "transition",
  "bitmap",
  "nine-patch",
  "vector",
  "animation-list",
  "adaptive-icon",
  "color",
  "gradient",
]);

/** 从路径（优先）和根标签判断这份 XML 属于哪类 */
export function codeDocKind(xml: string, path?: string | null): CodeDocKind {
  const p = (path ?? "").replace(/\\/g, "/");
  if (isManifestPath(p) || /AndroidManifest\.xml$/i.test(p)) return "manifest";
  if (isValuesPath(p)) return "values";
  if (/(^|\/)res\/color[^/]*\/[^/]+\.xml$/i.test(p)) return "color";
  if (/(^|\/)res\/anim(ator)?[^/]*\/[^/]+\.xml$/i.test(p)) return "anim";
  if (/(^|\/)res\/drawable[^/]*\/[^/]+\.xml$/i.test(p)) return "drawable";
  if (/(^|\/)res\/menu[^/]*\/[^/]+\.xml$/i.test(p)) return "menu";

  // 路径认不出来 → 看根标签
  if (looksLikeManifest(xml)) return "manifest";
  const tag = rootTagOf(xml);
  if (tag === "resources") return "values";
  if (tag === "menu") return "menu";
  if (tag && ANIM_ROOTS.has(tag)) return "anim";
  if (tag && DRAWABLE_ROOTS.has(tag)) return "drawable";
  return "other";
}

/* ── 行号工具（统一在 text-pos.ts）── */

import { lineOf as lineAt, lineStarts } from "./text-pos";

/* ── manifest ── */

const COMPONENT_TAGS = ["activity", "activity-alias", "service", "receiver", "provider"];

function lintManifest(xml: string, starts: number[]): LintIssue[] {
  const out: LintIssue[] = [];
  const root = rootTagOf(xml);
  if (root !== "manifest") {
    out.push({
      line: 1,
      level: "error",
      message: `根节点应该是 <manifest>，当前是 <${root ?? "?"}>（清单文件 aapt 会直接报错）`,
    });
    return out;
  }
  const doc = parseManifest(xml);
  const at = (pos: number) => lineAt(starts, Math.max(0, pos));

  // ① <manifest> 自身
  if (doc.manifest) {
    const open = xml.slice(doc.manifest.from, doc.manifest.to);
    if (!/xmlns:android\s*=/.test(open)) {
      out.push({
        line: at(doc.manifest.from),
        level: "error",
        message: "<manifest> 缺少 xmlns:android 声明，所有 android: 属性都会报 undefined",
      });
    }
    if (!/\bpackage\s*=/.test(open)) {
      // M194：不再报「没有 package」—— AGP 8+ 用 build.gradle 的 namespace 就够，
      // 我们自己的打包/真机渲染也不读它；对用户只是噪音（列为「问题」更误导）
    }
  }

  // ② <application>
  if (!doc.application) {
    out.push({ line: at(0), level: "error", message: "缺少 <application>，应用装不上也启动不了" });
  } else {
    const appOpen = xml.slice(doc.application.from, doc.application.to);
    if (!/\bandroid:label\s*=/.test(appOpen) && !/\bandroid:icon\s*=/.test(appOpen)) {
      out.push({
        line: at(doc.application.from),
        level: "warn",
        message: "<application> 没写 android:label / android:icon：桌面上的名字和图标会是空的",
      });
    }
  }

  // ③ 组件
  for (const c of doc.components) {
    const name = attrOfElement(xml, c, "android:name");
    if (!name.trim()) {
      out.push({
        line: at(c.from),
        level: "error",
        message: `<${c.tag}> 缺少 android:name，aapt 会报错（组件必须有类名）`,
      });
      continue;
    }
    const body = xml.slice(c.from, c.end);
    const hasFilter = body.includes("<intent-filter");
    if (hasFilter && !/\bandroid:exported\s*=/.test(xml.slice(c.from, c.to))) {
      out.push({
        line: at(c.from),
        level: "warn",
        message: `<${c.tag}> 带 intent-filter 但没写 android:exported：Android 12+ 安装会直接失败`,
      });
    }
    if (c.tag === "activity-alias" && !/\bandroid:targetActivity\s*=/.test(xml.slice(c.from, c.to))) {
      out.push({
        line: at(c.from),
        level: "error",
        message: "<activity-alias> 缺少 android:targetActivity，别名没有指向",
      });
    }
  }

  // ④ 权限
  for (const p of doc.permissions) {
    if (!attrOfElement(xml, p, "android:name").trim()) {
      out.push({ line: at(p.from), level: "error", message: "<uses-permission> 缺少 android:name" });
    }
  }

  // ⑤ 重复声明的权限（真机上会合并，不算错，但基本是复制粘贴留下的）
  const seen = new Map<string, number>();
  for (const p of doc.permissions) {
    const n = attrOfElement(xml, p, "android:name").trim();
    if (!n) continue;
    const first = seen.get(n);
    if (first !== undefined) {
      out.push({
        line: at(p.from),
        level: "warn",
        message: `${n} 重复声明（第 ${first} 行已写过），可以删掉一条`,
      });
    } else {
      seen.set(n, at(p.from));
    }
  }

  return out;
}

/* ── values ── */

const VALUES_NO_NAME = new Set(["skip", "eat-comment", "java-symbol", "public", "add-resource", "attr", "enum", "flag"]);

/** <resources> 的直接子元素（元素名 + 行号 + 是否有 name + type 属性） */
interface TopLevel {
  tag: string;
  line: number;
  name: string;
  type: string;
}

const ELEM_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/**
 * 自己扫一遍顶层元素：parseValues 只收「带 name」的条目，
 * 缺 name 的那种它直接丢掉 —— 而「缺 name」恰恰是最常见的写法错误。
 */
function topLevelElements(xml: string, starts: number[]): TopLevel[] {
  const out: TopLevel[] = [];
  let depth = -1; // -1 = 还没进 <resources>
  ELEM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ELEM_RE.exec(xml))) {
    const [, close, tag, attrs, selfClose] = m;
    if (close) {
      if (depth >= 0) depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth < 0) {
      if (tag === "resources") depth = 0;
      continue;
    }
    if (depth === 0) {
      const nm = /\bname\s*=\s*("[^"]*"|'[^']*')/.exec(attrs);
      const ty = /\btype\s*=\s*("[^"]*"|'[^']*')/.exec(attrs);
      out.push({
        tag,
        line: lineAt(starts, m.index),
        name: nm ? nm[1].slice(1, -1) : "",
        type: ty ? ty[1].slice(1, -1) : "",
      });
    }
    if (!selfClose) depth++;
  }
  return out;
}

function looksLikeColor(v: string): boolean {
  const s = v.trim();
  return /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(s) || /^@[\w:./+]+$/.test(s);
}

function looksLikeDimension(v: string): boolean {
  const s = v.trim();
  return /^-?\d+(\.\d+)?(dp|dip|sp|px|pt|mm|in|%)$/.test(s) || /^@[\w:./+]+$/.test(s);
}

function lintValues(xml: string, starts: number[]): LintIssue[] {
  const out: LintIssue[] = [];
  const doc = parseValues(xml);
  if (!doc.ok) {
    if (doc.reason) out.push({ line: 1, level: "error", message: doc.reason });
    return out;
  }

  // ① 必须带 name + ② 同类型重名（用自己扫的顶层清单，含缺 name 的）
  const seen = new Map<string, { line: number; name: string }>();
  for (const el of topLevelElements(xml, starts)) {
    const type = el.type || el.tag;
    if (!el.name.trim()) {
      if (!VALUES_NO_NAME.has(el.tag)) {
        out.push({
          line: el.line,
          level: "error",
          message: `<${el.tag}> 缺少 name 属性，aapt 会报「missing name attribute」`,
        });
      }
      continue;
    }
    const key = `${type}/${el.name}`;
    const first = seen.get(key);
    if (first) {
      out.push({
        line: el.line,
        level: "error",
        message: `${type}/${el.name} 重复定义（第 ${first.line} 行已有同名资源），aapt 会报 duplicate resources`,
      });
    } else {
      seen.set(key, { line: el.line, name: el.name });
    }
  }

  // ③ 取值格式（靠 parseValues 拿到值区间）
  for (const it of doc.items) {
    const type = it.itemType ?? it.tag;
    if (!it.name.trim()) continue;
    if (type === "color" && it.value.trim() && !looksLikeColor(it.value)) {
      out.push({
        line: it.line,
        level: "warn",
        message: `${it.name} 的值「${it.value.trim()}」不是合法颜色（#RGB / #AARRGGBB 或 @color/…）`,
      });
    }
    if (type === "dimen" && it.value.trim() && !looksLikeDimension(it.value)) {
      out.push({
        line: it.line,
        level: "warn",
        message: `${it.name} 的值「${it.value.trim()}」缺少单位（dp / sp / px …）`,
      });
    }
    if (type === "string") {
      // 用原文切片判断 CDATA：parseValues 会把 CDATA 解成纯文本
      const raw = xml.slice(it.valueFrom, it.valueTo);
      if (/<!\[CDATA\[/.test(raw)) continue;
      const bare = raw.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, "");
      if (bare.includes("&")) {
        out.push({
          line: it.line,
          level: "error",
          message: `${it.name} 的值里有未转义的 &（要写 &amp;），aapt 会报错`,
        });
      } else if (/(^|[^\\])'/.test(raw)) {
        out.push({
          line: it.line,
          level: "warn",
          message: `${it.name} 的值里有裸单引号（要写 \\' 或用双引号包住整段）`,
        });
      }
    }
  }

  return out;
}

/* ── color / drawable / anim / menu ── */

function lintRootTag(kind: CodeDocKind, xml: string): LintIssue[] {
  const tag = rootTagOf(xml);
  if (!tag) return [{ line: 1, level: "error", message: "没有找到根节点" }];

  if (kind === "menu" && tag !== "menu") {
    return [{ line: 1, level: "error", message: `menu 文件的根节点必须是 <menu>，当前是 <${tag}>` }];
  }
  if (kind === "color" && tag !== "selector" && tag !== "color" && tag !== "gradient") {
    return [
      {
        line: 1,
        level: "warn",
        message: `res/color 文件通常以 <selector> 为根（状态着色），当前是 <${tag}>`,
      },
    ];
  }
  if (kind === "anim" && !ANIM_ROOTS.has(tag)) {
    return [{ line: 1, level: "warn", message: `动画文件的根节点应该是 <set> / <objectAnimator>，当前是 <${tag}>` }];
  }
  if (kind === "drawable" && !DRAWABLE_ROOTS.has(tag)) {
    return [{ line: 1, level: "warn", message: `drawable 文件的根节点不认识：<${tag}>` }];
  }
  return [];
}

/**
 * 非布局 XML 的完整检查：通用结构 + 按类型叠加的领域规则。
 * path 用来判类型（传相对路径最准），传空则只看根标签。
 */
export function lintCodeDoc(xml: string, path?: string | null): LintIssue[] {
  if (!xml.trim()) return [];
  const kind = codeDocKind(xml, path);
  const starts = lineStarts(xml);
  const out = [...lintXml(xml)];

  // 结构上已经有错就先别叠领域规则：解析器拿到的残缺树只会刷一堆连锁误报
  const structuralError = out.some((i) => i.level === "error");
  if (structuralError) return out.sort((a, b) => a.line - b.line);

  if (kind === "manifest") out.push(...lintManifest(xml, starts));
  else if (kind === "values") out.push(...lintValues(xml, starts));
  else out.push(...lintRootTag(kind, xml));

  return out.sort((a, b) => a.line - b.line || (a.level === b.level ? 0 : a.level === "error" ? -1 : 1));
}
