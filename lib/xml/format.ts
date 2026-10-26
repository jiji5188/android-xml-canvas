// lib/xml/format.ts — XML 格式化（重排缩进，保留注释/CDATA/声明与属性原样）
// 纯文本 token 级处理，不依赖解析树，因此不会丢注释；解析失败的文件也能排。

type Tok =
  | { kind: "decl" | "comment" | "cdata"; raw: string }
  | { kind: "open" | "close" | "self"; raw: string; name: string }
  | { kind: "text"; raw: string };

const NAME_RE = /[\s>/]/;

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const e = src.indexOf("-->", i);
      const end = e === -1 ? src.length : e + 3;
      toks.push({ kind: "comment", raw: src.slice(i, end) });
      i = end;
      continue;
    }
    if (src.startsWith("<![CDATA[", i)) {
      const e = src.indexOf("]]>", i);
      const end = e === -1 ? src.length : e + 3;
      toks.push({ kind: "cdata", raw: src.slice(i, end) });
      i = end;
      continue;
    }
    if (src.startsWith("<?", i)) {
      const e = src.indexOf("?>", i);
      const end = e === -1 ? src.length : e + 2;
      toks.push({ kind: "decl", raw: src.slice(i, end) });
      i = end;
      continue;
    }
    if (src[i] === "<") {
      // 扫到标签结束 >（跳过引号内的 >）
      let j = i + 1;
      let quote: string | null = null;
      while (j < src.length) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === ">") {
          break;
        }
        j++;
      }
      const end = Math.min(j + 1, src.length);
      const raw = src.slice(i, end);
      const isClose = raw.startsWith("</");
      const isSelf = !isClose && /\/>$/.test(raw.trimEnd());
      const body = isClose ? raw.slice(2) : raw.slice(1);
      const m = NAME_RE.exec(body);
      const name = (m ? body.slice(0, m.index) : body).trim();
      toks.push({ kind: isClose ? "close" : isSelf ? "self" : "open", raw, name });
      i = end;
      continue;
    }
    const j = src.indexOf("<", i);
    const end = j === -1 ? src.length : j;
    toks.push({ kind: "text", raw: src.slice(i, end) });
    i = end;
  }
  return toks;
}

/** 多行标签（属性换行写法）按「首行 d 缩进、续行 d+1 缩进」重排 */
function reindentRaw(raw: string, d: number, indentSize: number): string[] {
  const pad = (n: number) => " ".repeat(Math.max(0, n) * indentSize);
  const trimmed = raw.replace(/\s+$/, "");
  if (!trimmed.includes("\n")) return [pad(d) + trimmed.trim()];
  const parts = trimmed.split("\n").map((s) => s.trim()).filter((s, idx, arr) => !(s === "" && idx === arr.length - 1));
  return [pad(d) + parts[0], ...parts.slice(1).map((p) => pad(d + 1) + p)];
}

export function formatXml(src: string, indentSize = 2): string {
  const toks = tokenize(src);
  const out: string[] = [];
  let depth = 0;

  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];

    if (t.kind === "text") {
      const txt = t.raw.replace(/\s+/g, " ").trim();
      if (txt) out.push(" ".repeat(depth * indentSize) + txt);
      continue;
    }

    if (t.kind === "decl" || t.kind === "comment" || t.kind === "cdata") {
      out.push(...reindentRaw(t.raw, depth, indentSize));
      continue;
    }

    if (t.kind === "self") {
      out.push(...reindentRaw(t.raw, depth, indentSize));
      continue;
    }

    if (t.kind === "open") {
      const n1 = toks[k + 1];
      const n2 = toks[k + 2];
      // <tag>文本</tag> → 保持一行
      if (n1 && n1.kind === "text" && n1.raw.trim() && !n1.raw.includes("\n") && n2 && n2.kind === "close" && n2.name === t.name) {
        const lines = reindentRaw(t.raw, depth, indentSize);
        lines[lines.length - 1] += n1.raw.trim() + n2.raw.trim();
        out.push(...lines);
        k += 2;
        continue;
      }
      // <tag></tag> → 合并一行
      if (n1 && n1.kind === "close" && n1.name === t.name) {
        const lines = reindentRaw(t.raw, depth, indentSize);
        lines[lines.length - 1] += n1.raw.trim();
        out.push(...lines);
        k += 1;
        continue;
      }
      out.push(...reindentRaw(t.raw, depth, indentSize));
      depth++;
      continue;
    }

    // close
    depth = Math.max(0, depth - 1);
    out.push(" ".repeat(depth * indentSize) + t.raw.trim());
  }

  return out.join("\n") + "\n";
}
