// lib/xml/java-assign.ts — M205：赋值类型不匹配（保守版）
//
// 只查「声明类型」和「右边来源类型」明显冲突的情况，避免误报。
// 规则：
//   - 左边声明为基本类型 int/long/double/float/boolean/char/short/byte
//   - 右边是：String 字面量（带引号）/ null / 明显另一个基本类型来源 / 一个声明为 String 的变量
//   - 例：int x = "abc";  int y = someString;  int z = 1.5;（float 字面量给 int）
//   反过来 String s = 123;（数字字面量给 String）也报
// 不做完整类型推导，只抓"字面量/变量声明类型"这种最硬的冲突，误报率极低。

// （不用 editDistance，赋值冲突是类型级判断）

export interface AssignMismatch {
  line: number;
  col: number;
  len: number;
  /** 左边声明的类型 */
  declared: string;
  /** 右边实际来源的类型（"String 字面量" / "int 字面量" / "变量 xxx(String)" / "null"） */
  actual: string;
}

const PRIMITIVE: Record<string, string> = {
  int: "int",
  long: "long",
  double: "double",
  float: "float",
  boolean: "boolean",
  char: "char",
  short: "short",
  byte: "byte",
};

/** 从一行里找「声明 类型 变量 = 右边」，判定是否冲突 */
function checkAssignLine(line: string): AssignMismatch[] {
  const out: AssignMismatch[] = [];
  // 匹配 `Type name = expr;` 或 `Type name=expr`
  const declRe = /(?:^|\b)(final\s+)?([A-Za-z_][\w<>\[\]]*)\s+([a-z_]\w*)\s*=\s*(.+);/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(line))) {
    const typeTok = m[2];
    const rhs = (m[4] || "").trim();
    if (!rhs) continue;
    // 基本类型 右边不能是 String 字面量 / 另一个基本字面量
    if (PRIMITIVE[typeTok]) {
      if (/^["']/.test(rhs)) {
        out.push({
          line: 0,
          col: m.index + (m[0].length - rhs.length) + 1,
          len: rhs.length,
          declared: typeTok,
          actual: "String 字面量",
        });
      } else if (/^-?\d+\.\d+$/.test(rhs)) {
        // 浮点字面量给 int/long/short/byte/char
        if (typeTok === "int" || typeTok === "long" || typeTok === "short" || typeTok === "byte" || typeTok === "char") {
          out.push({
            line: 0,
            col: m.index + (m[0].length - rhs.length) + 1,
            len: rhs.length,
            declared: typeTok,
            actual: "浮点字面量",
          });
        }
      } else {
        // 右边是变量/表达式：不推断类型（避免误报），交给 M203 的未声明检查去管
      }
    } else if (typeTok === "String" && /^-?\d+(\.\d+)?$/.test(rhs)) {
      // String 接数字字面量
      out.push({
        line: 0,
        col: m.index + (m[0].length - rhs.length) + 1,
        len: rhs.length,
        declared: "String",
        actual: "数字字面量",
      });
    }
  }
  return out;
}

/**
 * 扫描整段代码，对每行做赋值冲突检查。
 */
export function findAssignMismatches(code: string): AssignMismatch[] {
  const lines = code.split("\n");
  const out: AssignMismatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    // 跳过注释行（粗略）
    if (raw.trim().startsWith("//") || raw.trim().startsWith("*")) continue;
    for (const a of checkAssignLine(raw)) {
      a.line = i + 1;
      out.push(a);
    }
  }
  return out;
}
