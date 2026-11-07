// lib/xml/xml-res-check.ts — M179：XML 里的资源引用检查 + 一键修复
//
// 场景：布局里写了 `@drawable/ic_hom`、`@string/app_nam`、`@color/primry`，
// 名字拼错一个字母，aapt2 要等到编译/渲染才报「resource not found」，还只说文件名不说行号。
// 这里在编辑器里本地检查：引用名不在项目资源清单里、但跟某个真实资源只差 1~2 个字符
// → 给一条 warn，带 from/to，编辑器工具条上就能「一键修复」。
//
// 设计上的三个保守点（都是为了不误报）：
//   1. 只检查「资源清单里确实有这一类资源」的类型——没上传/没扫到 res 时一律不报，
//      否则满屏都是「未找到」；
//   2. 给「修复」建议要求唯一最近 + 编辑距离在阈值内；平票不猜；
//   3. 只有 drawable / mipmap / layout 这种几乎必然是项目本地的类型，
//      才在「没找到近似项」时也报一条；string / color 等可能是 AAR 库里的，只报能修的。
//
// 纯函数，Node 环境可单测。

import type { LintIssue } from "./lint";
import { nearestName } from "./nearest-name";

/** 检查用到的资源清单（名字不带扩展名、不带 @type/ 前缀） */
export interface XmlResEnv {
  layout?: Iterable<string>;
  drawable?: Iterable<string>;
  mipmap?: Iterable<string>;
  string?: Iterable<string>;
  color?: Iterable<string>;
  dimen?: Iterable<string>;
  style?: Iterable<string>;
  /** 布局里声明过的 @+id（@id/xxx 引用拼错时给建议） */
  id?: Iterable<string>;
  integer?: Iterable<string>;
  bool?: Iterable<string>;
}

/** 会检查的类型（其他类型如 anim / attr 多半来自框架或 AAR，不碰） */
const CHECK_TYPES = [
  "drawable",
  "mipmap",
  "layout",
  "string",
  "color",
  "dimen",
  "style",
  "id",
  "integer",
  "bool",
] as const;
type CheckType = (typeof CHECK_TYPES)[number];

/**
 * 没近似项时也值得报的类型（几乎必然是项目自己该有的）。
 * id / style / string / color 等不在此列：它们可能来自未扫描的目录、AAR 或框架，
 * 只在「能找到唯一近似名」时才给建议，宁漏勿扰。
 */
const STRICT_TYPES = new Set<CheckType>(["drawable", "mipmap", "layout"]);

const REF_RE = /@([a-z][a-z0-9_-]*)\/([A-Za-z0-9_.]+)/g;

/** 引用值里的扩展名（@drawable/ic_launcher.png 这种写法少见但见过） */
function stripExt(name: string): string {
  return name.replace(/\.(9\.)?(png|jpg|jpeg|webp|gif|xml)$/i, "");
}

/** 拼写建议的距离阈值：名字越长允许差越多（activity_mian 这种长名允许 2） */
function maxDistFor(name: string): number {
  return name.length >= 8 ? 2 : 1;
}

/** 把一段文本里的注释换成空格（保持长度，行号/偏移不变），返回跨行注释状态 */
function maskComment(line: string, inComment: boolean): { text: string; inComment: boolean } {
  let out = "";
  let i = 0;
  let comment = inComment;
  while (i < line.length) {
    if (comment) {
      const end = line.indexOf("-->", i);
      if (end === -1) {
        out += " ".repeat(line.length - i);
        i = line.length;
      } else {
        out += " ".repeat(end + 3 - i);
        i = end + 3;
        comment = false;
      }
    } else {
      const start = line.indexOf("<!--", i);
      if (start === -1) {
        out += line.slice(i);
        i = line.length;
      } else {
        out += line.slice(i, start);
        i = start;
        comment = true;
      }
    }
  }
  return { text: out, inComment: comment };
}

/**
 * 检查 XML 源码里的资源引用。
 * 返回的 LintIssue 里，能修的带 `fix`（from/to/label），交给编辑器「一键修复」。
 */
export function checkXmlResRefs(src: string, env: XmlResEnv): LintIssue[] {
  const known = new Map<CheckType, Set<string>>();
  for (const type of CHECK_TYPES) {
    const list = env[type];
    if (!list) continue;
    const set = new Set<string>();
    for (const n of list) {
      const name = stripExt(String(n));
      if (name) set.add(name);
    }
    // 空集合代表「这一类没扫到」，不检查，避免满屏误报
    if (set.size > 0) known.set(type, set);
  }
  if (known.size === 0) return [];

  const out: LintIssue[] = [];
  const seen = new Set<string>();
  const lines = src.split("\n");
  let inComment = false;

  for (let li = 0; li < lines.length; li++) {
    const masked = maskComment(lines[li], inComment);
    inComment = masked.inComment;
    const line = masked.text;
    if (!line.includes("@")) continue;

    REF_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REF_RE.exec(line)) !== null) {
      const type = m[1] as CheckType;
      if (!CHECK_TYPES.includes(type)) continue; // @android:… / @*android:… 走不到这里，但兜一层
      const names = known.get(type);
      if (!names) continue;
      const rawName = m[2];
      const name = stripExt(rawName);
      if (names.has(name)) continue;

      const key = `${li}|${type}|${name}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const from = `@${type}/${rawName}`;
      const sug = nearestName(name, names, maxDistFor(name));
      if (!sug) {
        if (!STRICT_TYPES.has(type)) continue; // string/color 等可能是库里的资源，不猜
        out.push({
          line: li + 1,
          level: "warn",
          message: `${from} 在项目 res 里没找到（是不是还没加进 res/${type}/？）`,
        });
        continue;
      }
      const to = `@${type}/${sug}`;
      out.push({
        line: li + 1,
        level: "warn",
        message: `${from} 在项目 res 里没找到，是不是想写 ${to}？`,
        fix: { from, to, label: `${from} → ${to}` },
      });
    }
  }

  return out;
}

/**
 * 在一行里把 from 换成 to，要求 from 后面不是资源名/标识符字符。
 * 关键：`@drawable/ic_hom` 不能把 `@drawable/ic_home` 改坏（前缀包含关系）。
 */
export function applyFixToLine(line: string, from: string, to: string): { text: string; count: number } {
  if (!from || from === to) return { text: line, count: 0 };
  const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${esc}(?![A-Za-z0-9_.])`, "g");
  let count = 0;
  const text = line.replace(re, () => {
    count++;
    return to;
  });
  return { text, count };
}
