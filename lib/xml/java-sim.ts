// lib/xml/java-sim.ts — M199：Java/Kotlin 代码的「轻量仿真」解释层
//
// 目标：不编译、不执行，只把常见写法**认出来**，转成可执行的「效果」。
// 识别不到的语句不会假装成功，进 `skipped` 由 UI 提示。
//
// 现在支持的写法（Java / Kotlin 混合认，够覆盖示例项目）：
//   - `findViewById(R.id.xxx)`  → 成员字段绑定
//   - `X.setText("...")` / `X.setVisibility(View.GONE)` / `X.setEnabled(false)`
//   - `X.setOnClickListener(...)`（匿名类 / lambda / Kotlin `{}`）
//   - `Toast.makeText(this, "msg", ...).show()`
//   - `Log.d/i/w/e("tag", "msg")`
//   - `startActivity(new Intent(this, XxxActivity.class))`（Kotlin `XxxActivity::class.java`）
//   - `setContentView(R.layout.activity_main)` → 决定布局名
//   - `R.string.xxx` / `R.color.xxx` 在 setText / setTextColor 里暂存为资源引用
//
// 纯函数 + 单测；DOM 副作用留在 RunPreview.tsx。

export interface JavaSimFile {
  /** 相对路径，例如 app/src/main/java/com/example/MainActivity.kt */
  rel: string;
  text: string;
}

/** 仿真里能存的变量值（数字 / 布尔 就够做计数器与开关） */
export type SimValue = string | number | boolean;

export type SimCmpOp = "==" | "!=" | ">" | ">=" | "<" | "<=";

/** M200：if 条件 —— 数值比较 / 布尔变量 / 控件可见性 */
export type SimCond =
  | { kind: "cmp"; name: string; op: SimCmpOp; value: number }
  | { kind: "truthy"; name: string; negate: boolean }
  | { kind: "vis"; viewId: string; value: "visible" | "invisible" | "gone"; negate: boolean };

export type SimEffect =
  | { kind: "setText"; viewId: string; text: string; resRef?: string }
  | { kind: "setTextVar"; viewId: string; name: string; prefix?: string; suffix?: string }
  | { kind: "setVisibility"; viewId: string; value: "visible" | "invisible" | "gone" }
  | { kind: "setEnabled"; viewId: string; value: boolean }
  | { kind: "toast"; text: string; resRef?: string }
  | { kind: "log"; level: "d" | "i" | "w" | "e"; tag: string; msg: string; resRef?: string }
  | { kind: "startActivity"; className: string; layout?: string }
  | { kind: "assign"; name: string; value: SimValue }
  | { kind: "incr"; name: string; delta: number }
  | { kind: "if"; cond: SimCond; then: SimEffect[]; else?: SimEffect[] };

export interface SimHandler {
  /** 触发它的控件 id（例如 `btn_next`），没有 id 的 onClick 会跳过 */
  viewId: string;
  effects: SimEffect[];
}

export interface SimModel {
  className: string;
  /** 该 Activity 的布局名（不含 .xml） */
  layoutName?: string;
  handlers: SimHandler[];
  /** onCreate 里直接执行的副作用 */
  startup: SimEffect[];
  /** 没认出来的语句（原句，给 UI 提示「暂不支持」） */
  skipped: string[];
  /** M200：成员变量初值（`private int count = 0;`） */
  fields: Record<string, SimValue>;
  /** 来源文件 */
  rel: string;
}

/** M200：运行时状态，跨点击保留（每个 Activity 一份） */
export interface SimState {
  vars: Record<string, SimValue>;
}

export function createSimState(model?: SimModel | null): SimState {
  return { vars: { ...(model?.fields ?? {}) } };
}

/** 从类名猜布局：SettingsActivity → settings / activity_settings */
export function classNameToLayout(className: string): string | null {
  let n = className.trim();
  if (!n) return null;
  // 只留短类名（去掉包）
  const dot = n.lastIndexOf(".");
  if (dot >= 0) n = n.slice(dot + 1);
  if (n.endsWith("Activity")) n = n.slice(0, -"Activity".length);
  if (!n) return null;
  return n.charAt(0).toLowerCase() + n.slice(1);
}

function isKotlin(text: string): boolean {
  return /package\s+[\w.]+\s*$/.test(text) || /\bfun\s+\w+/.test(text) || /::class\.java/.test(text);
}

function findBalanced(s: string, openIdx: number, open = "{", close = "}"): number {
  let depth = 0;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripComments(src: string): string {
  return src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** 取 `findViewById(R.id.x)` / `findViewById(R.id.x as View)` 里的 x */
function findViewId(body: string): string | null {
  const m = /findViewById\s*\(\s*R\.id\.(\w+)/.exec(body);
  return m ? m[1] : null;
}

/** `new Intent(this, FooActivity.class)` / `Intent(this, FooActivity::class.java)` → FooActivity */
function intentTarget(body: string): string | null {
  let m = /new\s+Intent\s*\([^,]*,\s*([\w$]+)\.class\b/.exec(body);
  if (m) return m[1];
  m = /([\w$]+)\s*::class(?:\.java)?\b/.exec(body);
  if (m) return m[1];
  return null;
}

/** 把字面量或资源引用转成 SimEffect 用的文本 */
function textOf(arg: string): { text: string; resRef?: string } {
  const a = arg.trim();
  if (a.startsWith('"') && a.endsWith('"')) return { text: a.slice(1, -1) };
  if (a.startsWith("R.string.")) {
    const name = a.replace(/^R\.string\./, "");
    return { text: name, resRef: "R.string." + name };
  }
  return { text: a };
}

/** 读一条简单语句（到 `;` 或 Kotlin 换行为止，括号/花括号归零才算） */
function readStatement(src: string, start: number, kt: boolean): [string, number] {
  let i = start;
  let paren = 0;
  let brace = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (c === "{") brace++;
    else if (c === "}") {
      if (brace > 0) brace--;
      else return [src.slice(start, i), i + 1]; // 块结束，语句到此为止
    }
    if (paren === 0 && brace === 0 && c === ";") return [src.slice(start, i), i + 1];
    if (kt && paren === 0 && brace === 0 && c === "\n") return [src.slice(start, i), i + 1];
    i++;
  }
  return [src.slice(start, i), i];
}

/** `if (count > 0)` / `if (tv.getVisibility() == View.GONE)` / `if (flag)` */
function parseCond(raw: string): SimCond | null {
  const t = raw.trim();
  let m = /^(\w+)\s*\.\s*getVisibility\s*\(\s*\)\s*(==|!=)\s*View\.(VISIBLE|INVISIBLE|GONE)$/.exec(t);
  if (m) {
    return {
      kind: "vis",
      viewId: m[1],
      value: m[3].toLowerCase() as "visible" | "invisible" | "gone",
      negate: m[2] === "!=",
    };
  }
  m = /^(\w+)\s*\.\s*isVisible\s*$/.exec(t);
  if (m) return { kind: "vis", viewId: m[1], value: "visible", negate: false };
  m = /^!\s*(\w+)\s*\.\s*isVisible\s*$/.exec(t);
  if (m) return { kind: "vis", viewId: m[1], value: "visible", negate: true };
  m = /^(\w+)\s*(==|!=|>=|<=|>|<)\s*(-?\d+)$/.exec(t);
  if (m) return { kind: "cmp", name: m[1], op: m[2] as SimCmpOp, value: Number(m[3]) };
  m = /^(\w+)\s*==\s*(true|false)$/.exec(t);
  if (m) return { kind: "truthy", name: m[1], negate: m[2] === "false" };
  m = /^!\s*(\w+)$/.exec(t);
  if (m) return { kind: "truthy", name: m[1], negate: true };
  m = /^(\w+)$/.exec(t);
  if (m) return { kind: "truthy", name: m[1], negate: false };
  return null;
}

/** 单条语句 → 效果；"skip" = 认识但不支持，null = 无副作用 / 纯绑定 */
function parseOneStatement(s: string): SimEffect | "skip" | null {
  // 先把「整段监听器 / 方法声明」排掉：里面的 Toast / setText 属于 handler 体，不能再当 onCreate 的副作用
  if (/setOnClickListener/.test(s) || /^fun\s/.test(s) || /^(public|private|internal)\s+/.test(s)) return null;

  // 绑定语句本身不产生副作用（Kotlin 泛型 findViewById<Button>(...) 也认）
  if (/^(?:\w+\s+)?(\w+)\s*=\s*findViewById\s*(?:<[^>]*>)?\s*\(\s*R\.id\.\w+/.test(s)) return null;

  // M200：变量自增 / 自减 / 复合赋值
  let m = /^(\w+)\s*\+\+$/.exec(s);
  if (m) return { kind: "incr", name: m[1], delta: 1 };
  m = /^(\w+)\s*--$/.exec(s);
  if (m) return { kind: "incr", name: m[1], delta: -1 };
  m = /^(\w+)\s*([+-])=\s*(\d+)$/.exec(s);
  if (m) return { kind: "incr", name: m[1], delta: (m[2] === "-" ? -1 : 1) * Number(m[3]) };

  // M200：变量赋值（数字 / 布尔），含 Kotlin `var count = 0`
  m = /^(?:var|val|int|boolean|long|float|double|String)\s+(\w+)\s*=\s*(-?\d+|true|false)$/.exec(s);
  if (!m) m = /^(\w+)\s*=\s*(-?\d+|true|false)$/.exec(s);
  if (m) {
    const raw = m[2];
    const value: SimValue = raw === "true" ? true : raw === "false" ? false : Number(raw);
    return { kind: "assign", name: m[1], value };
  }

  // setText（字面量 / 资源引用）
  m = /^(\w+)\s*\.setText\s*\(\s*("[^"]*"|R\.string\.\w+)\s*\)/.exec(s);
  if (m) {
    const { text, resRef } = textOf(m[2]);
    return { kind: "setText", viewId: m[1], text, resRef };
  }
  // setText 带第二个参数（如 setText(text, BufferType.SPANNABLE)）
  m = /^(\w+)\s*\.setText\s*\(\s*("[^"]*"|R\.string\.\w+)\s*,\s*BufferType\.\w+\s*\)/.exec(s);
  if (m) {
    const { text, resRef } = textOf(m[2]);
    return { kind: "setText", viewId: m[1], text, resRef };
  }
  // Kotlin 属性赋值：先认模板串 / 拼接，再当纯字面量
  m = /^(\w+)\s*\.text\s*=\s*"([^"$]*)\$\{?(\w+)\}?([^"]*)"\s*$/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[3], prefix: m[2], suffix: m[4] };
  m = /^(\w+)\s*\.text\s*=\s*"([^"]*)"\s*\+\s*(\w+)\s*\+\s*"([^"]*)"\s*$/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[3], prefix: m[2], suffix: m[4] };
  m = /^(\w+)\s*\.text\s*=\s*""\s*\+\s*(\w+)\s*$/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[2] };
  m = /^(\w+)\s*\.text\s*=\s*("[^"]*"|R\.string\.\w+)\s*$/.exec(s);
  if (m) {
    const { text, resRef } = textOf(m[2]);
    return { kind: "setText", viewId: m[1], text, resRef };
  }

  // M200：显示变量 —— setText(String.valueOf(n)) / setText("" + n) / setText("前缀" + n)
  m = /^(\w+)\s*\.setText\s*\(\s*String\.valueOf\s*\(\s*(\w+)\s*\)\s*\)/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[2] };
  m = /^(\w+)\s*\.setText\s*\(\s*""\s*\+\s*(\w+)\s*\)/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[2] };
  m = /^(\w+)\s*\.setText\s*\(\s*"([^"]*)"\s*\+\s*(\w+)\s*\+\s*"([^"]*)"\s*\)/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[3], prefix: m[2], suffix: m[4] };
  m = /^(\w+)\s*\.setText\s*\(\s*"([^"]*)"\s*\+\s*(\w+)\s*\)/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[3], prefix: m[2] };
  // Kotlin 模板：text = "已点击 ${count} 次"
  m = /^(\w+)\s*\.text\s*=\s*"([^"$]*)\$\{?(\w+)\}?([^"]*)"\s*$/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[3], prefix: m[2], suffix: m[4] };
  m = /^(\w+)\s*\.text\s*=\s*"([^"]*)"\s*\+\s*(\w+)\s*\+\s*"([^"]*)"\s*$/.exec(s);
  if (m) return { kind: "setTextVar", viewId: m[1], name: m[3], prefix: m[2], suffix: m[4] };

  // setVisibility
  m = /^(\w+)\s*\.setVisibility\s*\(\s*View\.(VISIBLE|INVISIBLE|GONE)\s*\)/.exec(s);
  if (m) {
    const v = m[2].toLowerCase() as "visible" | "invisible" | "gone";
    return { kind: "setVisibility", viewId: m[1], value: v };
  }
  // Kotlin 属性风格
  m = /^(\w+)\s*\.visibility\s*=\s*View\.(VISIBLE|INVISIBLE|GONE)\s*$/.exec(s);
  if (m) {
    const v = m[2].toLowerCase() as "visible" | "invisible" | "gone";
    return { kind: "setVisibility", viewId: m[1], value: v };
  }

  // setEnabled
  m = /^(\w+)\s*\.setEnabled\s*\(\s*(true|false)\s*\)/.exec(s);
  if (m) return { kind: "setEnabled", viewId: m[1], value: m[2] === "true" };
  m = /^(\w+)\s*\.isEnabled\s*=\s*(true|false)\s*$/.exec(s);
  if (m) return { kind: "setEnabled", viewId: m[1], value: m[2] === "true" };

  // Toast（锚 ^：避免把监听器体里的 Toast 当成外层副作用）
  m = /^Toast\.makeText\s*\(\s*[^,]+,\s*("[^"]*"|R\.string\.\w+)\s*,\s*Toast\.LENGTH_\w+\s*\)\s*\.show\s*\(\s*\)/.exec(s);
  if (m) {
    const { text, resRef } = textOf(m[1]);
    return { kind: "toast", text, resRef };
  }

  // Log
  m = /^Log\.(d|i|w|e)\s*\(\s*"([^"]*)"\s*,\s*("[^"]*"|R\.string\.\w+)\s*\)/.exec(s);
  if (m) {
    const { text, resRef } = textOf(m[3]);
    return { kind: "log", level: m[1] as "d" | "i" | "w" | "e", tag: m[2], msg: text, resRef };
  }

  // startActivity
  if (/^startActivity\s*\(/.test(s)) {
    const target = intentTarget(s);
    if (target) {
      const layout = classNameToLayout(target);
      return { kind: "startActivity", className: target, layout: layout ?? undefined };
    }
  }

  // 其余带 `.` 的副作用语句（requestFocus / setSelection…）进 skipped，让 UI 提示「暂不支持」
  if (/[.]\w+\s*\(/.test(s) && !/^\s*(if|while|for|when)\s*[(]/.test(s)) return "skip";
  return null;
}

/** 解析一段分支体（`{ ... }` 或单条语句），返回效果与结束位置 */
function parseBranch(
  src: string,
  at: number,
  kt: boolean,
): { effects: SimEffect[]; next: number } | null {
  let i = at;
  while (i < src.length && /\s/.test(src[i])) i++;
  if (src[i] === "{") {
    const close = findBalanced(src, i);
    if (close < 0) return null;
    const { effects } = parseBlock(src.slice(i + 1, close), kt);
    return { effects, next: close + 1 };
  }
  // else if (...) 链：当成 else 里只包一个 if
  if (/^if\s*\(/.test(src.slice(i))) {
    const r = parseIfBlock(src, i, kt);
    if (!r) return null;
    return { effects: [r.effect], next: r.next };
  }
  const [stmt, next] = readStatement(src, i, kt);
  const s = stmt.trim();
  if (!s) return { effects: [], next };
  const e = parseOneStatement(s);
  if (!e || e === "skip") return { effects: [], next };
  return { effects: [e], next };
}

/** `if (cond) { ... } else { ... }`（M200） */
function parseIfBlock(
  src: string,
  at: number,
  kt: boolean,
): { effect: SimEffect; next: number } | null {
  const m = /^if\s*\(/.exec(src.slice(at));
  if (!m) return null;
  const condOpen = at + m[0].length - 1;
  const condClose = findBalanced(src, condOpen, "(", ")");
  if (condClose < 0) return null;
  const cond = parseCond(src.slice(condOpen + 1, condClose));
  if (!cond) return null;

  const thenR = parseBranch(src, condClose + 1, kt);
  if (!thenR) return null;
  let next = thenR.next;

  let k = next;
  while (k < src.length && /\s/.test(src[k])) k++;
  let elseEffects: SimEffect[] | undefined;
  if (/^else\b/.test(src.slice(k))) {
    const elseR = parseBranch(src, k + 4, kt);
    if (elseR) {
      elseEffects = elseR.effects;
      next = elseR.next;
    }
  }

  const effect: SimEffect = elseEffects
    ? { kind: "if", cond, then: thenR.effects, else: elseEffects }
    : { kind: "if", cond, then: thenR.effects };
  return { effect, next };
}

/** 把一段代码体解析成效果列表（处理 if/else 嵌套） */
function parseBlock(src: string, kt: boolean): { effects: SimEffect[]; skipped: string[] } {
  const effects: SimEffect[] = [];
  const skipped: string[] = [];
  let i = 0;
  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;

    if (/^if\s*\(/.test(src.slice(i))) {
      const r = parseIfBlock(src, i, kt);
      if (r) {
        effects.push(r.effect);
        i = r.next;
        continue;
      }
    }

    const [stmt, next] = readStatement(src, i, kt);
    i = next;
    const s = stmt.trim();
    if (!s) continue;
    const e = parseOneStatement(s);
    if (e === "skip") skipped.push(s);
    else if (e) effects.push(e);
  }
  return { effects, skipped };
}

/** 兼容旧调用名 */
function parseEffects(body: string, kt: boolean): { effects: SimEffect[]; skipped: string[] } {
  return parseBlock(stripComments(body), kt);
}

function extractHandlerBody(src: string, fromIdx: number): string | null {
  const open = src.indexOf("{", fromIdx);
  if (open < 0) return null;
  const close = findBalanced(src, open);
  if (close < 0) return null;
  let body = src.slice(open + 1, close);
  // 匿名内部类 / 方法：`new OnClickListener() { @Override public void onClick(View v) { ... } }`
  // 要取的是 onClick 方法体，不是外层花括号
  const meth = /public\s+void\s+onClick\s*\(\s*[^)]*\)\s*\{|fun\s+onClick\s*\([^)]*\)\s*\{/.exec(body);
  if (meth) {
    // body 从 open+1 开始，meth.index 是相对 body 的偏移
    const innerOpen = open + 1 + meth.index + meth[0].length - 1;
    const innerClose = findBalanced(src, innerOpen);
    if (innerClose > innerOpen) {
      body = src.slice(innerOpen + 1, innerClose);
    }
  }
  return body;
}

/** 把效果里的「变量名」换成「真实 view id」：Java 里 `tvTitle.setText` 的 tvTitle 是字段，
 *  DOM 里的控件 id 是 `@+id/tv_title`。idByField 是 字段名 → 真实 id。 */
function mapEffectViewIds(effects: SimEffect[], idByField: Map<string, string>): SimEffect[] {
  const mapId = (v: string) => idByField.get(v) ?? v;
  return effects.map((e) => {
    switch (e.kind) {
      case "setText":
      case "setTextVar":
      case "setVisibility":
      case "setEnabled":
        return { ...e, viewId: mapId(e.viewId) };
      case "if":
        return {
          ...e,
          cond: e.cond.kind === "vis" ? { ...e.cond, viewId: mapId(e.cond.viewId) } : e.cond,
          then: mapEffectViewIds(e.then, idByField),
          else: e.else ? mapEffectViewIds(e.else, idByField) : undefined,
        };
      default:
        return e;
    }
  });
}

/** 成员变量初值：Java `private int count = 0;` / Kotlin `private var count = 0` */
function parseFieldInitializers(src: string): Record<string, SimValue> {
  const out: Record<string, SimValue> = {};
  const put = (name: string, raw: string) => {
    if (raw === "true") out[name] = true;
    else if (raw === "false") out[name] = false;
    else out[name] = Number(raw);
  };
  for (const m of src.matchAll(
    /(?:private|public|protected|internal)\s+(?:static\s+)?(?:final\s+)?(?:int|boolean|long|float|double)\s+(\w+)\s*=\s*(-?\d+|true|false)\s*;/g,
  )) {
    put(m[1], m[2]);
  }
  for (const m of src.matchAll(
    /(?:^|\n)\s*(?:private\s+|internal\s+)?(?:var|val)\s+(\w+)\s*(?::\s*\w+)?\s*=\s*(-?\d+|true|false)\s*(?:\n|$)/g,
  )) {
    put(m[1], m[2]);
  }
  return out;
}

export function parseJavaSim(file: JavaSimFile): SimModel | null {
  const text = file.text;
  if (!text) return null;
  const classNameM = /class\s+(\w+)(?:\s*:\s*[\w.,\s]+)?/.exec(text) ?? /fun\s+main/.exec(text);
  const className =
    (text.match(/class\s+(\w+)/) || text.match(/^object\s+(\w+)/m) || [])[1] || classNameM?.[1] || file.rel.split("/").pop()?.replace(/\.\w+$/, "") || "Activity";

  const src = stripComments(text);
  const kt = isKotlin(text);
  const handlers: SimHandler[] = [];
  const startup: SimEffect[] = [];
  const skipped: string[] = [];
  const fields = parseFieldInitializers(src);

  // 1. setContentView → layoutName
  const sv = /setContentView\s*\(\s*R\.layout\.(\w+)/.exec(src);
  const layoutName = sv ? sv[1] : undefined;

  // 2. findViewById 绑定：字段名 = R.id.xxx
  const idByField = new Map<string, string>();
  for (const m of src.matchAll(/(?:\w+\s+)?(\w+)\s*=\s*findViewById\s*(?:<[^>]*>)?\s*\(\s*R\.id\.(\w+)/g)) {
    idByField.set(m[1], m[2]);
  }

  // 3. setOnClickListener
  for (const m of src.matchAll(/(\w+)\s*\.setOnClickListener\s*(?=[({])/g)) {
    const field = m[1];
    const viewId = idByField.get(field) ?? field;
    const bodyStart = m.index! + m[0].length;
    const body = extractHandlerBody(src, bodyStart);
    if (!body) continue;
    const { effects, skipped: sk } = parseEffects(body, kt);
    handlers.push({ viewId, effects: mapEffectViewIds(effects, idByField) });
    skipped.push(...sk);
  }

  // 4. onCreate 里的直接语句（非 setOnClickListener 包裹的）
  const onCreateOpen = src.search(/\bvoid\s+onCreate\s*\(|override\s+fun\s+onCreate\s*\(/);
  if (onCreateOpen >= 0) {
    const brace = src.indexOf("{", onOpenIdx(onCreateOpen, src));
    if (brace >= 0) {
      const close = findBalanced(src, brace);
      const body = close >= 0 ? src.slice(brace + 1, close) : "";
      // 去掉 onClick 已吃掉的段落（简单做法：再跑一遍 parseEffects，把 handler 里的也并进去，反正 id 不冲突）
      const { effects, skipped: sk } = parseEffects(body, kt);
      startup.push(...mapEffectViewIds(effects, idByField));
      skipped.push(...sk);
    }
  }

  return { className, layoutName, handlers, startup, skipped, fields, rel: file.rel };
}

function onOpenIdx(i: number, s: string): number {
  return s.indexOf("{", i);
}

/** 从多个 Java/Kotlin 文件里挑「跟当前布局最相关」的那个 Activity */
export function pickJavaSim(
  files: JavaSimFile[],
  entryName: string,
  layouts: Record<string, string> = {},
): SimModel | null {
  const want = entryName.trim().toLowerCase();
  const norm = (raw: string) => raw.trim().replace(/\.xml$/i, "").toLowerCase();
  const targetLayout = Object.keys(layouts).find((k) => norm(k) === want) ?? want;

  let best: SimModel | null = null;
  for (const f of files) {
    const m = parseJavaSim(f);
    if (!m) continue;
    if (m.layoutName && m.layoutName.toLowerCase() === targetLayout) {
      // 补 layout（如果 layouts 里有）
      m.handlers = m.handlers.map((h) => ({
        ...h,
        effects: h.effects.map((e) =>
          e.kind === "startActivity" && !e.layout ? { ...e, layout: classNameToLayout(e.className) ?? undefined } : e,
        ),
      }));
      return m;
    }
    if (!best && m.handlers.length + m.startup.length > 0) best = m;
  }
  return best;
}

/** 应用一个 effect 到「效果接收器」（由 RunPreview 提供 DOM / log / toast / nav） */
export interface SimReceiver {
  setText(viewId: string, text: string): void;
  setVisibility(viewId: string, v: "visible" | "invisible" | "gone"): void;
  setEnabled(viewId: string, v: boolean): void;
  toast(text: string): void;
  log(level: "d" | "i" | "w" | "e", tag: string, msg: string): void;
  navigate(layoutOrClass: string, source: string): void;
  /** M200：读当前控件可见性（给 if (x.getVisibility() == View.GONE) 用） */
  getVisibility?(viewId: string): "visible" | "invisible" | "gone" | null;
}

function evalCond(cond: SimCond, rx: SimReceiver, state: SimState): boolean {
  if (cond.kind === "cmp") {
    const v = Number(state.vars[cond.name] ?? 0);
    switch (cond.op) {
      case "==":
        return v === cond.value;
      case "!=":
        return v !== cond.value;
      case ">":
        return v > cond.value;
      case ">=":
        return v >= cond.value;
      case "<":
        return v < cond.value;
      case "<=":
        return v <= cond.value;
    }
  }
  if (cond.kind === "truthy") {
    const v = !!state.vars[cond.name];
    return cond.negate ? !v : v;
  }
  const vis = rx.getVisibility?.(cond.viewId) ?? null;
  if (!vis) return false;
  const hit = vis === cond.value;
  return cond.negate ? !hit : hit;
}

export function applyEffects(
  model: SimModel,
  effects: SimEffect[],
  rx: SimReceiver,
  state: SimState = createSimState(model),
): void {
  for (const e of effects) {
    switch (e.kind) {
      case "setText":
        rx.setText(e.viewId, e.text);
        break;
      case "setTextVar": {
        const raw = state.vars[e.name];
        const txt = (e.prefix ?? "") + String(raw ?? 0) + (e.suffix ?? "");
        rx.setText(e.viewId, txt);
        break;
      }
      case "setVisibility":
        rx.setVisibility(e.viewId, e.value);
        break;
      case "setEnabled":
        rx.setEnabled(e.viewId, e.value);
        break;
      case "toast":
        rx.toast(e.text);
        break;
      case "log":
        rx.log(e.level, e.tag, e.resRef ? `${e.msg} (${e.resRef})` : e.msg);
        break;
      case "startActivity": {
        const target = e.layout || e.className;
        rx.navigate(target, e.className);
        break;
      }
      case "assign":
        state.vars[e.name] = e.value;
        break;
      case "incr":
        state.vars[e.name] = Number(state.vars[e.name] ?? 0) + e.delta;
        break;
      case "if": {
        const hit = evalCond(e.cond, rx, state);
        applyEffects(model, hit ? e.then : (e.else ?? []), rx, state);
        break;
      }
    }
  }
}
