// lib/xml/manifest-edit.ts — M43：AndroidManifest.xml 的可视化编辑（纯逻辑，可单测）
//
// 和 values 一样：**不做全量 parse → stringify**。清单文件里通常有注释、顺序和手写
// 缩进，全量重建会把它们丢掉。这里只做「外科手术」：
//   - 解析出各区块（package / 版本 / minSdk / targetSdk / 权限 / 组件）的字符区间
//   - 改基本字段 = 替换 <manifest> 或 <uses-sdk> 的某个属性值
//   - 改组件属性 = 替换对应 <activity> 等开标签里的属性值
//   - 删条目 = 删整段；加 = 插到合适位置（权限加到 </manifest> 前，组件加到 </application> 前）
// 原文件的注释、空白、顺序全部原样保留。

const ELEM_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ATTR_RE = /([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;

export interface AttrSpan {
  value: string;
  /** 属性值（不含引号）在原文中的区间 */
  from: number;
  to: number;
  /** 整个属性（含名和引号）在原文中的区间，用于删属性 */
  attrFrom: number;
  attrTo: number;
}

function attrSpanInTag(xml: string, tagFrom: number, tagEnd: number, want: string): AttrSpan | null {
  const attrs = xml.slice(tagFrom, tagEnd);
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(attrs))) {
    if (m[1] !== want) continue;
    const quoted = m[2];
    const valueStart = tagFrom + m.index + m[0].indexOf(quoted) + 1;
    return {
      value: quoted.slice(1, -1),
      from: valueStart,
      to: valueStart + quoted.length - 2,
      attrFrom: tagFrom + m.index,
      attrTo: tagFrom + m.index + m[0].length,
    };
  }
  return null;
}

export interface ManifestItem {
  /** 开标签起点 */
  from: number;
  /** 开标签结束（含 > 或 />） */
  to: number;
  /** 元素结束（</tag> 之后；自闭合就是 to） */
  end: number;
  tag: string;
  /** 开标签里的属性区（不含 <tag 和末尾 >） */
  attrsFrom: number;
  attrsTo: number;
  /** 自包含标签 */
  selfClose: boolean;
}

/** 找所有指定标签的元素（含开/闭标签区间） */
export function findElements(xml: string, tag: string): ManifestItem[] {
  const out: ManifestItem[] = [];
  ELEM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ELEM_RE.exec(xml))) {
    const [whole, slash, t, , selfClose] = m;
    if (slash || t !== tag) continue;
    const from = m.index;
    const to = from + whole.length;
    let end: number;
    if (selfClose) {
      end = to;
    } else {
      const close = `</${tag}>`;
      const ci = xml.indexOf(close, to);
      end = ci < 0 ? xml.length : ci + close.length;
    }
    const attrsFrom = from + 1 + tag.length;
    const attrsTo = to - (selfClose ? 2 : 1); // 去掉末尾 /> 或 >
    out.push({ from, to, end, tag, attrsFrom, attrsTo, selfClose: !!selfClose });
  }
  return out;
}

export interface ManifestDoc {
  ok: boolean;
  /** <manifest> 开标签 */
  manifest: ManifestItem | null;
  /** <application> 开标签 */
  application: ManifestItem | null;
  /** <uses-sdk> 元素（可能没有） */
  usesSdk: ManifestItem | null;
  /** 所有 <uses-permission> */
  permissions: ManifestItem[];
  /** 组件：activity / service / receiver / provider / activity-alias */
  components: ManifestItem[];
  /** </application> 的起点（插入组件用） */
  appCloseAt: number;
  /** </manifest> 的起点（插入权限用） */
  manifestCloseAt: number;
  /** 解析失败原因 */
  reason?: string;
}

export function parseManifest(xml: string): ManifestDoc {
  const manifests = findElements(xml, "manifest");
  if (!manifests.length) {
    return {
      ok: false,
      manifest: null,
      application: null,
      usesSdk: null,
      permissions: [],
      components: [],
      appCloseAt: -1,
      manifestCloseAt: -1,
      reason: "没找到 <manifest> 根节点",
    };
  }
  const manifest = manifests[0];

  const application = findElements(xml, "application")[0] || null;
  const appCloseAt = application ? xml.indexOf(`</application>`, application.to) : -1;
  const usesSdk = findElements(xml, "uses-sdk")[0] || null;
  const permissions = findElements(xml, "uses-permission");

  const components: ManifestItem[] = [];
  for (const t of ["activity", "service", "receiver", "provider", "activity-alias"]) {
    components.push(...findElements(xml, t));
  }
  components.sort((a, b) => a.from - b.from);

  const manifestCloseAt = xml.indexOf(`</manifest>`, manifest.to);
  if (manifestCloseAt < 0) {
    return {
      ok: false,
      manifest,
      application,
      usesSdk,
      permissions,
      components,
      appCloseAt,
      manifestCloseAt: -1,
      reason: "没找到 </manifest> 结束标签",
    };
  }
  return { ok: true, manifest, application, usesSdk, permissions, components, appCloseAt, manifestCloseAt };
}

/** 读某个元素开标签上的属性值（不存在返回空串） */
export function attrOfElement(xml: string, el: ManifestItem, name: string): string {
  return attrSpanInTag(xml, el.attrsFrom, el.attrsTo, name)?.value ?? "";
}

/* ===== 编辑（全部返回新字符串，不改原对象） ===== */

/** 改某个元素上的属性值；属性不存在就补上 */
export function setElementAttr(xml: string, el: ManifestItem, name: string, value: string): string {
  const span = attrSpanInTag(xml, el.attrsFrom, el.attrsTo, name);
  if (span) return xml.slice(0, span.from) + value + xml.slice(span.to);
  // 属性不存在：插到开标签收尾（/ 或 >）之前
  let at = el.attrsTo;
  while (at > el.attrsFrom && (xml[at - 1] === " " || xml[at - 1] === "\t")) at--;
  const hadSpace = at < el.attrsTo;
  const pad = el.selfClose && !hadSpace ? " " : "";
  return xml.slice(0, at) + ` ${name}="${value}"${pad}` + xml.slice(at);
}

/** 删某个元素上的属性（连同前面的空白） */
export function removeElementAttr(xml: string, el: ManifestItem, name: string): string {
  const span = attrSpanInTag(xml, el.attrsFrom, el.attrsTo, name);
  if (!span) return xml;
  let from = span.attrFrom;
  while (from > el.attrsFrom && (xml[from - 1] === " " || xml[from - 1] === "\t")) from--;
  return xml.slice(0, from) + xml.slice(span.attrTo);
}

/** 改 <uses-sdk> 的属性；没有 <uses-sdk> 就补一个 */
export function setUsesSdkAttr(xml: string, name: string, value: string, doc?: ManifestDoc): string {
  const d = doc || parseManifest(xml);
  if (d.usesSdk) return setElementAttr(xml, d.usesSdk, name, value);
  if (!d.ok) return xml;
  const indent = detectManifestIndent(xml, d.permissions.length ? d.permissions : d.components);
  const line = `${indent}<uses-sdk ${name}="${value}" />`;
  const anchor = d.permissions[0]?.from ?? d.application?.from ?? d.manifestCloseAt;
  let at = anchor;
  while (at > 0 && (xml[at - 1] === " " || xml[at - 1] === "\t")) at--;
  const crlf = xml.includes("\r\n");
  if (at > 0 && xml[at - 1] === "\n") {
    return xml.slice(0, at) + line + (crlf ? "\r\n" : "\n") + xml.slice(at);
  }
  return xml;
}

/** 删一个元素整段（吞掉同一行的缩进和行尾换行） */
export function removeElement(xml: string, el: ManifestItem): string {
  let from = el.from;
  let to = el.end;
  while (from > 0 && (xml[from - 1] === " " || xml[from - 1] === "\t")) from--;
  while (to < xml.length && (xml[to] === " " || xml[to] === "\t")) to++;
  if (xml[to] === "\r") to++;
  if (xml[to] === "\n") to++;
  return xml.slice(0, from) + xml.slice(to);
}

/** 在 </manifest> 前追加一条 <uses-permission> */
export function appendPermission(xml: string, permission: string, doc?: ManifestDoc): string {
  const d = doc || parseManifest(xml);
  if (d.manifestCloseAt < 0) return xml;
  const indent = detectManifestIndent(xml, d.permissions);
  const line = `${indent}<uses-permission android:name="${permission}" />`;
  let at = d.manifestCloseAt;
  while (at > 0 && (xml[at - 1] === " " || xml[at - 1] === "\t")) at--;
  const crlf = xml.includes("\r\n");
  if (at > 0 && xml[at - 1] === "\n") {
    return xml.slice(0, at) + line + (crlf ? "\r\n" : "\n") + xml.slice(at);
  }
  return xml;
}

/** 在 </application> 前追加一个组件（activity / service / receiver / provider） */
export function appendComponent(
  xml: string,
  tag: "activity" | "service" | "receiver" | "provider",
  attrs: Record<string, string>,
  doc?: ManifestDoc,
): string {
  const d = doc || parseManifest(xml);
  if (d.appCloseAt < 0) return xml;
  const indent = detectManifestIndent(xml, d.components);
  const attrStr = Object.entries(attrs)
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}="${v}"`)
    .join(" ");
  const line = `${indent}<${tag}${attrStr ? " " + attrStr : ""} />`;
  let at = d.appCloseAt;
  while (at > 0 && (xml[at - 1] === " " || xml[at - 1] === "\t")) at--;
  const crlf = xml.includes("\r\n");
  if (at > 0 && xml[at - 1] === "\n") {
    return xml.slice(0, at) + line + (crlf ? "\r\n" : "\n") + xml.slice(at);
  }
  return xml;
}

/** 探测清单里的缩进（默认 4 空格） */
export function detectManifestIndent(xml: string, els: ManifestItem[]): string {
  const first = els[0];
  if (first) {
    let i = first.from;
    let n = 0;
    while (i > 0 && (xml[i - 1] === " " || xml[i - 1] === "\t")) {
      i--;
      n++;
    }
    if (n > 0) {
      const s = xml.slice(i, first.from);
      if (s.includes("\t")) return "\t";
      if (n <= 8) return " ".repeat(n);
    }
  }
  return "    ";
}

/** 根节点是不是 <manifest>（网页项目里可能没有路径） */
export function looksLikeManifest(xml: string): boolean {
  if (!xml) return false;
  const head = xml.slice(0, 4000).replace(/^\uFEFF/, "");
  const at = head.search(/<manifest[\s>]/);
  if (at < 0) return false;
  const before = head
    .slice(0, at)
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  return before.trim() === "";
}

/** 按路径判断：是不是 AndroidManifest.xml */
export function isManifestPath(relOrName?: string | null): boolean {
  if (!relOrName) return false;
  const p = relOrName.replace(/\\/g, "/");
  return p.split("/").pop()?.toLowerCase() === "androidmanifest.xml";
}

/** 给界面用的人话说明 */
export function manifestNotice(): { title: string; msg: string } {
  return {
    title: "AndroidManifest.xml · 视图编辑",
    msg: "这是应用清单文件。视图里改基本字段、权限、组件；复杂 intent-filter 等直接切「代码」改。",
  };
}

export const COMPONENT_LABEL: Record<string, string> = {
  activity: "Activity",
  service: "Service",
  receiver: "Receiver",
  provider: "Provider",
  "activity-alias": "ActivityAlias",
};
