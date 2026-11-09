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

export type SimEffect =
  | { kind: "setText"; viewId: string; text: string; resRef?: string }
  | { kind: "setVisibility"; viewId: string; value: "visible" | "invisible" | "gone" }
  | { kind: "setEnabled"; viewId: string; value: boolean }
  | { kind: "toast"; text: string; resRef?: string }
  | { kind: "log"; level: "d" | "i" | "w" | "e"; tag: string; msg: string; resRef?: string }
  | { kind: "startActivity"; className: string; layout?: string };

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
  /** 来源文件 */
  rel: string;
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

/** 切语句：Java 按顶层 `;`，Kotlin（没分号）按行 + 花括号深度 */
function splitStatements(src: string): string[] {
  const out: string[] = [];
  if (src.includes(";")) {
    let depth = 0;
    let cur = "";
    for (const ch of src) {
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0 && cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
      if (depth === 0 && ch === ";") {
        if (cur.trim()) out.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  // Kotlin 风格：一行一句，跳过块结构行
  let depth = 0;
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const before = depth;
    for (const ch of line) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (before !== 0 || depth !== 0) continue;
    if (/^(fun|class|object|if|else|when|for|while|try|catch)\b/.test(line)) continue;
    out.push(line);
  }
  return out;
}

function parseEffects(body: string, kt: boolean): { effects: SimEffect[]; skipped: string[] } {
  const effects: SimEffect[] = [];
  const skipped: string[] = [];
  const src = stripComments(body);
  const stmts = splitStatements(src);

  for (const s of stmts) {
    if (!s) continue;

    // findViewById 绑定
    let m = /^(\w+)\s*=\s*findViewById\s*\(\s*R\.id\.(\w+)/.exec(s);
    if (m) continue; // 绑定语句本身不产生副作用（但会被 handlers 用到）

    // setText
    m = /^(\w+)\s*\.setText\s*\(\s*("[^"]*"|R\.string\.\w+)\s*\)/.exec(s);
    if (m) {
      const { text, resRef } = textOf(m[2]);
      effects.push({ kind: "setText", viewId: m[1], text, resRef });
      continue;
    }
    // Kotlin 属性赋值：X.text = "..." / R.string.xxx
    m = /^(\w+)\s*\.text\s*=\s*("[^"]*"|R\.string\.\w+)\s*$/.exec(s);
    if (m) {
      const { text, resRef } = textOf(m[2]);
      effects.push({ kind: "setText", viewId: m[1], text, resRef });
      continue;
    }
    // setText 带第二个参数（如 setText(text, BufferType.SPANNABLE)）
    m = /^(\w+)\s*\.setText\s*\(\s*("[^"]*"|R\.string\.\w+)\s*,\s*BufferType\.\w+\s*\)/.exec(s);
    if (m) {
      const { text, resRef } = textOf(m[2]);
      effects.push({ kind: "setText", viewId: m[1], text, resRef });
      continue;
    }

    // setVisibility
    m = /^(\w+)\s*\.setVisibility\s*\(\s*View\.(VISIBLE|INVISIBLE|GONE)\s*\)/.exec(s);
    if (m) {
      const v = m[2].toLowerCase() as "visible" | "invisible" | "gone";
      effects.push({ kind: "setVisibility", viewId: m[1], value: v });
      continue;
    }
    // setVisible / isVisible 直接赋值（Kotlin 属性风格）
    m = /^(\w+)\s*\.visibility\s*=\s*View\.(VISIBLE|INVISIBLE|GONE)\s*$/.exec(s);
    if (m) {
      const v = m[2].toLowerCase() as "visible" | "invisible" | "gone";
      effects.push({ kind: "setVisibility", viewId: m[1], value: v });
      continue;
    }

    // setEnabled
    m = /^(\w+)\s*\.setEnabled\s*\(\s*(true|false)\s*\)/.exec(s);
    if (m) {
      effects.push({ kind: "setEnabled", viewId: m[1], value: m[2] === "true" });
      continue;
    }
    m = /^(\w+)\s*\.isEnabled\s*=\s*(true|false)\s*$/.exec(s);
    if (m) {
      effects.push({ kind: "setEnabled", viewId: m[1], value: m[2] === "true" });
      continue;
    }

    // Toast
    m = /Toast\.makeText\s*\(\s*[^,]+,\s*("[^"]*"|R\.string\.\w+)\s*,\s*Toast\.LENGTH_\w+\s*\)\s*\.show\s*\(\s*\)/.exec(s);
    if (m) {
      const { text, resRef } = textOf(m[1]);
      effects.push({ kind: "toast", text, resRef });
      continue;
    }

    // Log
    m = /^Log\.(d|i|w|e)\s*\(\s*"([^"]*)"\s*,\s*("[^"]*"|R\.string\.\w+)\s*\)/.exec(s);
    if (m) {
      const { text, resRef } = textOf(m[3]);
      effects.push({ kind: "log", level: m[1] as "d" | "i" | "w" | "e", tag: m[2], msg: text, resRef });
      continue;
    }

    // startActivity（Java `new Intent(...)` / Kotlin `Intent(this, X::class.java)` 都认）
    if (/^startActivity\s*\(/.test(s)) {
      const target = intentTarget(s);
      if (target) {
        const layout = classNameToLayout(target);
        effects.push({ kind: "startActivity", className: target, layout: layout ?? undefined });
        continue;
      }
    }

    // 有 setOnClickListener 但里面是空体/注释，当 noop 不报 skipped
    if (/setOnClickListener/.test(s) || /^fun\s/.test(s) || /^(public|private|internal)\s+/.test(s)) {
      // 方法声明 / 嵌套函数，先跳过（下面单独处理）
      continue;
    }

    // 其余带 `.` 的副作用语句（例如 requestFocus、setSelection）才进 skipped；
    // 纯赋值 / import / 控制流不算
    if (/[.]\w+\s*\(/.test(s) && !/^\s*if\s*\(/.test(s) && !/^\s*while\s*\(/.test(s) && !/^\s*for\s*\(/.test(s)) {
      skipped.push(s);
    }
  }

  return { effects, skipped };
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
  return effects.map((e) => {
    if (e.kind === "setText" || e.kind === "setVisibility" || e.kind === "setEnabled") {
      const real = idByField.get(e.viewId) ?? e.viewId;
      return { ...e, viewId: real };
    }
    return e;
  });
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

  // 1. setContentView → layoutName
  const sv = /setContentView\s*\(\s*R\.layout\.(\w+)/.exec(src);
  const layoutName = sv ? sv[1] : undefined;

  // 2. findViewById 绑定：字段名 = R.id.xxx
  const idByField = new Map<string, string>();
  for (const m of src.matchAll(/(\w+)\s*=\s*findViewById\s*\(\s*R\.id\.(\w+)/g)) {
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

  return { className, layoutName, handlers, startup, skipped, rel: file.rel };
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
}

export function applyEffects(model: SimModel, effects: SimEffect[], rx: SimReceiver): void {
  for (const e of effects) {
    switch (e.kind) {
      case "setText":
        rx.setText(e.viewId, e.resRef ? e.text : e.text);
        break;
      case "setVisibility":
        rx.setVisibility(e.viewId, e.value);
        break;
      case "setEnabled":
        rx.setEnabled(e.viewId, e.value);
        break;
      case "toast":
        rx.toast(e.resRef ? e.text : e.text);
        break;
      case "log":
        rx.log(e.level, e.tag, e.resRef ? `${e.msg} (${e.resRef})` : e.msg);
        break;
      case "startActivity": {
        const target = e.layout || e.className;
        rx.navigate(target, e.className);
        break;
      }
    }
  }
}
