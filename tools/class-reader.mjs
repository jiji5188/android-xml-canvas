// tools/class-reader.mjs — 正确的 .class 常量池 + 方法表解析（供 sdk-digest 用）
// 关键点（踩过的坑）：
//   - 常量池 tag 尺寸：1=变长, 3/4=4, 5/6=8(+占1索引), 7/8/16/19/20=2, 15=3,
//     9/10/11/12/17/18=4
//   - 声明的方法名在「方法表」（methods_count 之后），不是常量池 Methodref
//   - attribute 是变长的：name_index(2)+length(4)+data(length)，必须按 length 跳
//   - 字段表在方法表之前，也要按 attribute length 跳过

export function isClassFile(buf) {
  return buf.length >= 10 && buf.readUInt32BE(0) === 0xcafebabe;
}

function utf8At(buf, q) {
  const len = buf.readUInt16BE(q);
  return { s: buf.toString("utf8", q + 2, q + 2 + len), next: q + 2 + len };
}

/** 读常量池 → 返回 { utf8: Map(idx→string), end: 常量池结束偏移 } */
function readConstantPool(buf) {
  let q = 8;
  const cpCount = buf.readUInt16BE(q);
  q += 2;
  const utf8 = new Map();
  let i = 1;
  while (i < cpCount) {
    const tag = buf.readUInt8(q);
    q += 1;
    if (tag === 1) {
      const r = utf8At(buf, q);
      utf8.set(i, r.s);
      q = r.next;
    } else if (tag === 3 || tag === 4) {
      q += 4;
    } else if (tag === 5 || tag === 6) {
      q += 8;
      i++; // long/double 占两个常量池索引
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) {
      q += 2;
    } else if (tag === 15) {
      q += 3;
    } else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) {
      q += 4;
    } else {
      throw new Error(`bad cp tag ${tag} at ${q - 1}`);
    }
    i++;
  }
  return { utf8, end: q };
}

/** 跳过 count 个 attribute（每个 name_idx(2)+length(4)+data(length)） */
function skipAttributes(buf, r, count) {
  for (let a = 0; a < count; a++) {
    const len = buf.readUInt32BE(r + 2);
    r += 6 + len;
  }
  return r;
}

/**
 * 解析一个 class 文件 → 声明的公开方法名 + 是否 @Deprecated + 类名/父类名
 * 只统计 public 方法（access_flags & 0x0001）；构造 <init>/<clinit> 跳过。
 */
export function parseClassInfo(buf) {
  if (!isClassFile(buf)) return null;
  const { utf8, end } = readConstantPool(buf);
  let r = end;
  const accessFlags = buf.readUInt16BE(r);
  const thisClassIdx = buf.readUInt16BE(r + 2);
  const superIdx = buf.readUInt16BE(r + 4);
  r += 6;
  const ifCount = buf.readUInt16BE(r);
  const interfaces = [];
  r += 2;
  for (let k = 0; k < ifCount; k++) {
    interfaces.push(buf.readUInt16BE(r));
    r += 2;
  }

  // 字段表（跳过，但要按 attribute 长度正确前进）
  const fieldsCount = buf.readUInt16BE(r);
  r += 2;
  for (let f = 0; f < fieldsCount; f++) {
    const attrs = buf.readUInt16BE(r + 6);
    r += 8; // access(2)+name(2)+desc(2)+attrsCount(2)
    r = skipAttributes(buf, r, attrs);
  }

  // 方法表
  const methodsCount = buf.readUInt16BE(r);
  r += 2;
  const methods = [];
  for (let m = 0; m < methodsCount; m++) {
    const mAccess = buf.readUInt16BE(r);
    const nameIdx = buf.readUInt16BE(r + 2);
    const attrs = buf.readUInt16BE(r + 6);
    const name = utf8.get(nameIdx) || "";
    // 检查方法属性里有没有 "Deprecated"
    let hasDep = false;
    let ar = r + 8;
    for (let a = 0; a < attrs; a++) {
      const aNameIdx = buf.readUInt16BE(ar);
      const aLen = buf.readUInt32BE(ar + 2);
      const aName = utf8.get(aNameIdx);
      if (aName === "Deprecated") hasDep = true;
      ar += 6 + aLen;
    }
    r = ar;
    if (name && name !== "<init>" && name !== "<clinit>" && (mAccess & 0x0001)) {
      methods.push({ name, isDeprecated: hasDep });
    }
  }

  // 类级 attribute（方法表之后）→ 只有这里出现 "Deprecated" 才算类本身废弃
  let classDeprecated = false;
  {
    const classAttrs = buf.readUInt16BE(r);
    let ar = r + 2;
    for (let a = 0; a < classAttrs; a++) {
      const aNameIdx = buf.readUInt16BE(ar);
      const aLen = buf.readUInt32BE(ar + 2);
      if (utf8.get(aNameIdx) === "Deprecated") classDeprecated = true;
      ar += 6 + aLen;
    }
  }

  // 类/父类名（this_class → Class 表项的 name_idx，这里简化：从 utf8 找不到 Class 表）
  // this/super 的 Class 表项没直接存名字，需要再查；这里只返回索引，类名用文件路径更省事
  return {
    accessFlags,
    thisClassIdx,
    superIdx,
    interfaces,
    methods,
    classDeprecated,
    utf8,
  };
}

/** Class 表项（tag 7）的 name_index → 需要再读一次 CP 才能拿到；这里给工具函数 */
export function classNameOf(buf, utf8, classIdx) {
  // 重新走 CP 找 tag 7 的第 classIdx 项
  let q = 8;
  const cpCount = buf.readUInt16BE(q);
  q += 2;
  let i = 1;
  while (i < cpCount) {
    const tag = buf.readUInt8(q);
    q += 1;
    if (tag === 1) {
      const len = buf.readUInt16BE(q);
      q += 2 + len;
    } else if (tag === 3 || tag === 4) q += 4;
    else if (tag === 5 || tag === 6) { q += 8; i++; }
    else if (tag === 7) {
      if (i === classIdx) return utf8.get(buf.readUInt16BE(q)) || "";
      q += 2;
    } else if (tag === 8 || tag === 16 || tag === 19 || tag === 20) q += 2;
    else if (tag === 15) q += 3;
    else if (tag === 9 || tag === 10 || tag === 11 || tag === 12 || tag === 17 || tag === 18) q += 4;
    else break;
    i++;
  }
  return "";
}
